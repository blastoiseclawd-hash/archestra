import type { Redis } from "ioredis";
import logger from "@/logging";
import {
  type AgentInvocationEvent,
  AgentInvocationEventSchema,
  type EventHandler,
  type MessageBrokerProvider,
} from "../types";

/**
 * Redis Streams configuration
 */
export interface RedisConfig {
  url: string;
  stream: string;
  consumerGroup: string;
}

/**
 * Redis Streams message broker provider using ioredis.
 *
 * Features:
 * - Stream-based message queue with consumer groups
 * - Durable storage with configurable retention (MAXLEN/MINID)
 * - Automatic rebalancing across consumers
 * - Pending entry list for message acknowledgment
 * - Dead letter queue via separate stream
 */
export class RedisBrokerProvider implements MessageBrokerProvider {
  readonly name = "redis";

  private redis: Redis | null = null;
  private handler: EventHandler | null = null;
  private consumerId: string;
  private isShuttingDown = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Stream for dead letter messages */
  private readonly dlqStream: string;

  /** Consumer poll interval in ms */
  private readonly pollIntervalMs = 1000;

  /** Block time for XREADGROUP in ms */
  private readonly blockTimeMs = 5000;

  /** Maximum messages to read per poll */
  private readonly batchSize = 10;

  constructor(private readonly config: RedisConfig) {
    this.consumerId = `consumer-${process.pid}-${Date.now()}`;
    this.dlqStream = `${config.stream}-dlq`;
  }

  async initialize(): Promise<void> {
    // Lazy import to avoid loading ioredis if not used
    const { default: Redis } = await import("ioredis");

    this.redis = new Redis(this.config.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 10) return null; // Stop retrying
        return Math.min(times * 100, 3000);
      },
    });

    // Create consumer group if it doesn't exist
    try {
      await this.redis.xgroup(
        "CREATE",
        this.config.stream,
        this.config.consumerGroup,
        "0",
        "MKSTREAM",
      );
      logger.info(
        { stream: this.config.stream, group: this.config.consumerGroup },
        "[RedisBroker] Created consumer group",
      );
    } catch (error) {
      // BUSYGROUP error means group already exists - that's fine
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }

    logger.info(
      { url: this.config.url, stream: this.config.stream },
      "[RedisBroker] Connected",
    );
  }

  async publish(event: AgentInvocationEvent): Promise<void> {
    if (!this.redis) {
      throw new Error("Redis not initialized");
    }

    await this.redis.xadd(
      this.config.stream,
      "*", // Auto-generate ID
      "event",
      JSON.stringify(event),
    );

    logger.debug(
      { eventId: event.id, stream: this.config.stream },
      "[RedisBroker] Event published",
    );
  }

  async subscribe(handler: EventHandler): Promise<void> {
    if (!this.redis) {
      throw new Error("Redis not initialized");
    }

    this.handler = handler;

    logger.info(
      {
        stream: this.config.stream,
        group: this.config.consumerGroup,
        consumerId: this.consumerId,
      },
      "[RedisBroker] Starting consumer",
    );

    // Start polling loop
    this.pollMessages();
  }

  async acknowledge(eventId: string): Promise<void> {
    if (!this.redis) return;

    // eventId here is the Redis stream message ID
    await this.redis.xack(
      this.config.stream,
      this.config.consumerGroup,
      eventId,
    );

    logger.debug({ eventId }, "[RedisBroker] Event acknowledged");
  }

  async reject(eventId: string, requeue: boolean): Promise<void> {
    if (!this.redis) return;

    if (!requeue) {
      // Move to DLQ by reading the message and adding to DLQ stream
      logger.warn({ eventId }, "[RedisBroker] Sending event to DLQ");
      // The actual DLQ handling happens in processMessage
    }
    // If requeue=true, we simply don't acknowledge - it will be reclaimed
  }

  async healthCheck(): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "[RedisBroker] Health check failed",
      );
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }

    logger.info("[RedisBroker] Shutdown complete");
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private pollMessages(): void {
    if (this.isShuttingDown || !this.redis || !this.handler) return;

    this.readMessages()
      .catch((error) => {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "[RedisBroker] Error polling messages",
        );
      })
      .finally(() => {
        if (!this.isShuttingDown) {
          this.pollTimeout = setTimeout(
            () => this.pollMessages(),
            this.pollIntervalMs,
          );
        }
      });
  }

  private async readMessages(): Promise<void> {
    if (!this.redis || !this.handler) return;

    // Read new messages using XREADGROUP
    const results = await this.redis.xreadgroup(
      "GROUP",
      this.config.consumerGroup,
      this.consumerId,
      "COUNT",
      this.batchSize,
      "BLOCK",
      this.blockTimeMs,
      "STREAMS",
      this.config.stream,
      ">", // Only new messages
    );

    if (!results || results.length === 0) return;

    // Type: [stream: string, messages: [id: string, fields: string[]][]][]
    type StreamResult = [string, [string, string[]][]];
    const typedResults = results as StreamResult[];

    for (const streamResult of typedResults) {
      const messages = streamResult[1];
      for (const message of messages) {
        const messageId = message[0];
        const fields = message[1];
        await this.processMessage(messageId, fields);
      }
    }
  }

  private async processMessage(
    messageId: string,
    fields: string[],
  ): Promise<void> {
    if (!this.handler || !this.redis) return;

    // Parse fields array into key-value pairs
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    const eventJson = data.event;
    if (!eventJson) {
      logger.warn({ messageId }, "[RedisBroker] Message missing event field");
      await this.acknowledge(messageId);
      return;
    }

    let event: AgentInvocationEvent;
    try {
      const parsed = JSON.parse(eventJson);
      event = AgentInvocationEventSchema.parse(parsed);
    } catch (error) {
      logger.error(
        {
          messageId,
          error: error instanceof Error ? error.message : String(error),
        },
        "[RedisBroker] Failed to parse message, sending to DLQ",
      );
      await this.sendToDlq(messageId, eventJson, "parse_error");
      await this.acknowledge(messageId);
      return;
    }

    logger.debug(
      { eventId: event.id, messageId },
      "[RedisBroker] Processing message",
    );

    try {
      await this.handler(event);
      await this.acknowledge(messageId);
      logger.debug(
        { eventId: event.id },
        "[RedisBroker] Message processed successfully",
      );
    } catch (error) {
      logger.error(
        {
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "[RedisBroker] Handler error, sending to DLQ",
      );
      await this.sendToDlq(messageId, eventJson, "handler_error", error);
      await this.acknowledge(messageId);
    }
  }

  private async sendToDlq(
    messageId: string,
    originalMessage: string,
    errorType: string,
    error?: unknown,
  ): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.xadd(
        this.dlqStream,
        "*",
        "originalMessageId",
        messageId,
        "originalMessage",
        originalMessage,
        "errorType",
        errorType,
        "errorMessage",
        error instanceof Error ? error.message : String(error ?? ""),
        "timestamp",
        new Date().toISOString(),
      );
    } catch (dlqError) {
      logger.error(
        {
          error:
            dlqError instanceof Error ? dlqError.message : String(dlqError),
        },
        "[RedisBroker] Failed to send to DLQ",
      );
    }
  }
}

export default RedisBrokerProvider;
