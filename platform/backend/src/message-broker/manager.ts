import config, { type MessageBrokerConfig } from "@/config";
import logger from "@/logging";
import { initializeMessageBrokerMetrics } from "@/metrics";
import type {
  AgentInvocationEvent,
  EventHandler,
  MessageBrokerProvider,
  MessageBrokerType,
} from "./types";

/**
 * Message Broker Manager - singleton that manages the broker provider lifecycle
 *
 * Usage:
 * ```typescript
 * // Initialize on startup
 * await messageBrokerManager.initialize();
 *
 * // Publish an event
 * await messageBrokerManager.publish(event);
 *
 * // Subscribe to events (typically done in worker)
 * await messageBrokerManager.subscribe(handler);
 *
 * // Shutdown on process exit
 * await messageBrokerManager.shutdown();
 * ```
 */
class MessageBrokerManager {
  private provider: MessageBrokerProvider | null = null;
  private config: MessageBrokerConfig;
  private initialized = false;

  constructor() {
    this.config = config.messageBroker;
  }

  /**
   * Check if the message broker is enabled
   */
  get isEnabled(): boolean {
    return this.config.type !== undefined;
  }

  /**
   * Get the broker type (or undefined if disabled)
   */
  get brokerType(): MessageBrokerType | undefined {
    return this.config.type;
  }

  /**
   * Get the worker configuration
   */
  get workerConfig(): MessageBrokerConfig["worker"] {
    return this.config.worker;
  }

  /**
   * Initialize the message broker provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn("[MessageBroker] Already initialized");
      return;
    }

    if (!this.config.type) {
      logger.info("[MessageBroker] No broker configured, running in sync mode");
      return;
    }

    // Initialize metrics (always, even if broker isn't enabled)
    initializeMessageBrokerMetrics();

    logger.info(
      { brokerType: this.config.type },
      "[MessageBroker] Initializing broker",
    );

    this.provider = await this.createProvider(this.config.type);
    await this.provider.initialize();

    this.initialized = true;
    logger.info(
      { brokerType: this.config.type },
      "[MessageBroker] Broker initialized successfully",
    );
  }

  /**
   * Publish an event to the message broker
   * @throws Error if broker is not initialized
   */
  async publish(event: AgentInvocationEvent): Promise<void> {
    if (!this.provider) {
      throw new Error(
        "Message broker not initialized. Call initialize() first or check isEnabled.",
      );
    }

    await this.provider.publish(event);

    logger.info(
      {
        eventId: event.id,
        channel: event.channel,
        agentId: event.agentId,
      },
      "[MessageBroker] Event published",
    );
  }

  /**
   * Subscribe to events from the message broker
   * @param handler - Callback to process each event
   * @throws Error if broker is not initialized
   */
  async subscribe(handler: EventHandler): Promise<void> {
    if (!this.provider) {
      throw new Error(
        "Message broker not initialized. Call initialize() first or check isEnabled.",
      );
    }

    await this.provider.subscribe(handler);
    logger.info("[MessageBroker] Subscribed to events");
  }

  /**
   * Acknowledge successful processing of an event
   */
  async acknowledge(eventId: string): Promise<void> {
    if (!this.provider) return;
    await this.provider.acknowledge(eventId);
  }

  /**
   * Reject an event (processing failed)
   */
  async reject(eventId: string, requeue: boolean): Promise<void> {
    if (!this.provider) return;
    await this.provider.reject(eventId, requeue);
  }

  /**
   * Check if the broker is healthy
   */
  async healthCheck(): Promise<boolean> {
    if (!this.provider) return true; // No broker = always healthy
    return this.provider.healthCheck();
  }

  /**
   * Gracefully shutdown the message broker
   */
  async shutdown(): Promise<void> {
    if (!this.provider) return;

    logger.info("[MessageBroker] Shutting down");
    await this.provider.shutdown();
    this.provider = null;
    this.initialized = false;
    logger.info("[MessageBroker] Shutdown complete");
  }

  /**
   * Get the underlying provider (for testing/advanced use cases)
   */
  getProvider(): MessageBrokerProvider | null {
    return this.provider;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async createProvider(
    type: MessageBrokerType,
  ): Promise<MessageBrokerProvider> {
    switch (type) {
      case "kafka": {
        // Lazy import to avoid loading kafka client if not needed
        const { KafkaBrokerProvider } = await import("./providers/kafka");
        return new KafkaBrokerProvider(this.config.kafka);
      }

      case "redis": {
        // Lazy import to avoid loading redis client if not needed
        const { RedisBrokerProvider } = await import("./providers/redis");
        return new RedisBrokerProvider(this.config.redis);
      }

      case "rabbitmq": {
        // Lazy import to avoid loading amqplib if not needed
        const { RabbitMQBrokerProvider } = await import("./providers/rabbitmq");
        return new RabbitMQBrokerProvider(this.config.rabbitmq);
      }

      default: {
        const exhaustiveCheck: never = type;
        throw new Error(`Unknown broker type: ${exhaustiveCheck}`);
      }
    }
  }
}

// Export singleton instance
export const messageBrokerManager = new MessageBrokerManager();

export default messageBrokerManager;
