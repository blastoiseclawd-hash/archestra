import type { Consumer, EachMessagePayload, Kafka, Producer } from "kafkajs";
import logger from "@/logging";
import {
  type AgentInvocationEvent,
  AgentInvocationEventSchema,
  type EventHandler,
  type MessageBrokerProvider,
} from "../types";

/**
 * Kafka configuration
 */
export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  topic: string;
  dlqTopic: string;
}

/**
 * Kafka message broker provider using KafkaJS.
 *
 * Features:
 * - Durable message storage with configurable retention
 * - Consumer groups for horizontal scaling
 * - Automatic partition assignment
 * - Dead letter queue for failed messages
 * - At-least-once delivery semantics
 */
export class KafkaBrokerProvider implements MessageBrokerProvider {
  readonly name = "kafka";

  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private handler: EventHandler | null = null;
  private isShuttingDown = false;

  constructor(private readonly config: KafkaConfig) {}

  async initialize(): Promise<void> {
    // Lazy import to avoid loading kafkajs if not used
    const { Kafka: KafkaClient } = await import("kafkajs");

    this.kafka = new KafkaClient({
      clientId: this.config.clientId,
      brokers: this.config.brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });

    // Initialize producer
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });
    await this.producer.connect();

    logger.info(
      { brokers: this.config.brokers, clientId: this.config.clientId },
      "[KafkaBroker] Producer connected",
    );
  }

  async publish(event: AgentInvocationEvent): Promise<void> {
    if (!this.producer) {
      throw new Error("Kafka producer not initialized");
    }

    await this.producer.send({
      topic: this.config.topic,
      messages: [
        {
          key: event.agentId, // Partition by agent for ordering
          value: JSON.stringify(event),
          headers: {
            eventId: event.id,
            channel: event.channel,
            organizationId: event.organizationId,
          },
        },
      ],
    });

    logger.debug(
      { eventId: event.id, topic: this.config.topic },
      "[KafkaBroker] Event published",
    );
  }

  async subscribe(handler: EventHandler): Promise<void> {
    if (!this.kafka) {
      throw new Error("Kafka not initialized");
    }

    this.handler = handler;

    this.consumer = this.kafka.consumer({
      groupId: this.config.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.config.topic,
      fromBeginning: false,
    });

    logger.info(
      { groupId: this.config.groupId, topic: this.config.topic },
      "[KafkaBroker] Consumer subscribed",
    );

    // Start consuming messages
    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.processMessage(payload);
      },
    });
  }

  async acknowledge(_eventId: string): Promise<void> {
    // Kafka auto-commits offsets, so this is a no-op
    // The offset is committed after eachMessage returns successfully
  }

  async reject(eventId: string, requeue: boolean): Promise<void> {
    if (!requeue && this.producer) {
      // Send to dead letter queue
      logger.warn(
        { eventId, dlqTopic: this.config.dlqTopic },
        "[KafkaBroker] Sending event to DLQ",
      );
      // Note: The actual DLQ send happens in processMessage when max retries exceeded
    }
    // If requeue=true, Kafka's consumer will auto-retry on next poll
  }

  async healthCheck(): Promise<boolean> {
    if (!this.kafka) return false;

    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      return true;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "[KafkaBroker] Health check failed",
      );
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }

    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }

    this.kafka = null;
    logger.info("[KafkaBroker] Shutdown complete");
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async processMessage(payload: EachMessagePayload): Promise<void> {
    const { message, partition, topic } = payload;

    if (this.isShuttingDown || !this.handler) return;

    const value = message.value?.toString();
    if (!value) {
      logger.warn(
        { partition, offset: message.offset },
        "[KafkaBroker] Received empty message",
      );
      return;
    }

    let event: AgentInvocationEvent;
    try {
      const parsed = JSON.parse(value);
      event = AgentInvocationEventSchema.parse(parsed);
    } catch (error) {
      logger.error(
        {
          partition,
          offset: message.offset,
          error: error instanceof Error ? error.message : String(error),
        },
        "[KafkaBroker] Failed to parse message, sending to DLQ",
      );
      await this.sendToDlq(value, "parse_error");
      return;
    }

    logger.debug(
      { eventId: event.id, partition, topic },
      "[KafkaBroker] Processing message",
    );

    try {
      await this.handler(event);
      logger.debug(
        { eventId: event.id },
        "[KafkaBroker] Message processed successfully",
      );
    } catch (error) {
      logger.error(
        {
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "[KafkaBroker] Handler error, sending to DLQ",
      );
      await this.sendToDlq(value, "handler_error", error);
    }
  }

  private async sendToDlq(
    originalMessage: string,
    errorType: string,
    error?: unknown,
  ): Promise<void> {
    if (!this.producer) return;

    try {
      await this.producer.send({
        topic: this.config.dlqTopic,
        messages: [
          {
            value: JSON.stringify({
              originalMessage,
              errorType,
              errorMessage:
                error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch (dlqError) {
      logger.error(
        {
          error:
            dlqError instanceof Error ? dlqError.message : String(dlqError),
        },
        "[KafkaBroker] Failed to send to DLQ",
      );
    }
  }
}

export default KafkaBrokerProvider;
