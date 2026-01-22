import { executeA2AMessage } from "@/agents/a2a-executor";
import { chatOpsManager } from "@/agents/chatops/chatops-manager";
import { getEmailProvider } from "@/agents/incoming-email";
import logger from "@/logging";
import { PromptModel } from "@/models";
import { messageBrokerManager } from "./manager";
import type {
  AgentInvocationEvent,
  ChatOpsReplyContext,
  EmailReplyContext,
} from "./types";

/**
 * Worker configuration
 */
interface WorkerConfig {
  /** Maximum concurrent event processing */
  concurrency: number;
  /** Maximum retry attempts before moving to DLQ */
  maxRetries: number;
  /** Initial retry delay in milliseconds */
  retryDelayMs: number;
}

/**
 * Message Broker Worker
 *
 * Consumes events from the message broker, executes agents, and routes responses
 * back through the appropriate channel (email or chatops).
 *
 * Usage:
 * ```typescript
 * // Initialize and start worker (typically in server.ts after broker init)
 * await messageBrokerWorker.start();
 *
 * // Shutdown (on process exit)
 * await messageBrokerWorker.stop();
 * ```
 */
class MessageBrokerWorker {
  private isRunning = false;
  private activeProcessing = 0;
  private config: WorkerConfig;

  constructor() {
    this.config = messageBrokerManager.workerConfig;
  }

  /**
   * Start the worker - subscribe to events and begin processing
   */
  async start(): Promise<void> {
    if (!messageBrokerManager.isEnabled) {
      logger.info("[Worker] Message broker not enabled, worker not started");
      return;
    }

    if (this.isRunning) {
      logger.warn("[Worker] Already running");
      return;
    }

    this.isRunning = true;

    logger.info(
      {
        concurrency: this.config.concurrency,
        maxRetries: this.config.maxRetries,
      },
      "[Worker] Starting worker",
    );

    await messageBrokerManager.subscribe(async (event) => {
      await this.processEvent(event);
    });

    logger.info("[Worker] Worker started and subscribed to events");
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info("[Worker] Stopping worker");
    this.isRunning = false;

    // Wait for active processing to complete (with timeout)
    const maxWaitMs = 30000;
    const startTime = Date.now();

    while (this.activeProcessing > 0 && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.activeProcessing > 0) {
      logger.warn(
        { activeProcessing: this.activeProcessing },
        "[Worker] Shutdown timeout, some events may not have completed",
      );
    }

    logger.info("[Worker] Worker stopped");
  }

  /**
   * Check if the worker is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get the number of events currently being processed
   */
  get processingCount(): number {
    return this.activeProcessing;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Process a single event
   */
  private async processEvent(event: AgentInvocationEvent): Promise<void> {
    if (!this.isRunning) {
      logger.warn(
        { eventId: event.id },
        "[Worker] Skipping event - worker stopped",
      );
      return;
    }

    // Check concurrency limit
    if (this.activeProcessing >= this.config.concurrency) {
      logger.warn(
        { eventId: event.id, activeProcessing: this.activeProcessing },
        "[Worker] At concurrency limit, event will be requeued by broker",
      );
      await messageBrokerManager.reject(event.id, true);
      return;
    }

    this.activeProcessing++;

    try {
      logger.info(
        {
          eventId: event.id,
          channel: event.channel,
          agentId: event.agentId,
        },
        "[Worker] Processing event",
      );

      // Execute the agent
      const result = await this.executeAgent(event);

      // Route the response back through the appropriate channel
      await this.routeResponse(event, result);

      // Acknowledge successful processing
      await messageBrokerManager.acknowledge(event.id);

      logger.info(
        {
          eventId: event.id,
          responseLength: result.text.length,
        },
        "[Worker] Event processed successfully",
      );
    } catch (error) {
      logger.error(
        {
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "[Worker] Event processing failed",
      );

      // Let the broker handle retry/DLQ
      await messageBrokerManager.reject(event.id, false);
    } finally {
      this.activeProcessing--;
    }
  }

  /**
   * Execute the agent using the A2A executor
   */
  private async executeAgent(
    event: AgentInvocationEvent,
  ): Promise<{ text: string; messageId: string }> {
    const result = await executeA2AMessage({
      promptId: event.agentId,
      message: event.payload.message,
      organizationId: event.organizationId,
      userId: event.userId,
      sessionId: `worker-${event.id}`,
    });

    return {
      text: result.text,
      messageId: result.messageId,
    };
  }

  /**
   * Route the response back through the appropriate channel
   */
  private async routeResponse(
    event: AgentInvocationEvent,
    result: { text: string; messageId: string },
  ): Promise<void> {
    switch (event.channel) {
      case "email":
        await this.sendEmailReply(
          event.replyContext as EmailReplyContext,
          event.agentId,
          result.text,
        );
        break;

      case "chatops":
        await this.sendChatOpsReply(
          event.replyContext as ChatOpsReplyContext,
          event.agentId,
          result.text,
        );
        break;

      default: {
        const exhaustiveCheck: never = event.channel;
        logger.error(
          { channel: exhaustiveCheck },
          "[Worker] Unknown channel type",
        );
      }
    }
  }

  /**
   * Send email reply
   */
  private async sendEmailReply(
    context: EmailReplyContext,
    agentId: string,
    responseText: string,
  ): Promise<void> {
    const provider = getEmailProvider();
    if (!provider) {
      logger.error("[Worker] Email provider not configured, cannot send reply");
      return;
    }

    // Get agent name for the reply
    const prompt = await PromptModel.findById(agentId);
    const agentName = prompt?.name || "Archestra Agent";

    try {
      await provider.sendReply({
        originalEmail: {
          messageId: context.emailId,
          fromAddress: context.from,
          toAddress: context.to,
          subject: context.subject,
          body: "", // Not needed for reply
          conversationId: context.conversationId,
          receivedAt: new Date(),
        },
        body: responseText,
        agentName,
      });

      logger.info(
        { emailId: context.emailId, agentId },
        "[Worker] Email reply sent",
      );
    } catch (error) {
      logger.error(
        {
          emailId: context.emailId,
          error: error instanceof Error ? error.message : String(error),
        },
        "[Worker] Failed to send email reply",
      );
      throw error;
    }
  }

  /**
   * Send chatops reply (MS Teams, Slack, etc.)
   */
  private async sendChatOpsReply(
    context: ChatOpsReplyContext,
    agentId: string,
    responseText: string,
  ): Promise<void> {
    // Get the provider based on the context
    const provider = chatOpsManager.getChatOpsProvider(
      context.provider as "ms-teams",
    );

    if (!provider) {
      logger.error(
        { provider: context.provider },
        "[Worker] ChatOps provider not configured, cannot send reply",
      );
      return;
    }

    // Get agent name for the footer
    const prompt = await PromptModel.findById(agentId);
    const agentName = prompt?.name || "Archestra Agent";

    try {
      await provider.sendReply({
        originalMessage: {
          messageId: context.messageId,
          channelId: context.channelId,
          workspaceId: context.workspaceId,
          threadId: context.threadId,
          senderId: context.senderId,
          senderName: context.senderName,
          text: "", // Not needed for reply
          rawText: "",
          timestamp: new Date(),
          isThreadReply: false,
          metadata: {},
        },
        text: responseText,
        footer: `Via ${agentName}`,
        conversationReference: context.conversationReference,
      });

      logger.info(
        { messageId: context.messageId, agentId },
        "[Worker] ChatOps reply sent",
      );
    } catch (error) {
      logger.error(
        {
          messageId: context.messageId,
          error: error instanceof Error ? error.message : String(error),
        },
        "[Worker] Failed to send chatops reply",
      );
      throw error;
    }
  }
}

// Export singleton instance
export const messageBrokerWorker = new MessageBrokerWorker();

export default messageBrokerWorker;
