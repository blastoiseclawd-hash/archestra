import type {
  Channel,
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from "amqplib";
import logger from "@/logging";
import {
  type AgentInvocationEvent,
  AgentInvocationEventSchema,
  type EventHandler,
  type MessageBrokerProvider,
} from "../types";

/**
 * RabbitMQ configuration
 */
export interface RabbitMQConfig {
  url: string;
  queue: string;
  dlq: string;
}

/**
 * RabbitMQ message broker provider using amqplib.
 *
 * Features:
 * - Durable queues with message persistence
 * - Publisher confirms for reliable publishing
 * - Manual acknowledgment for at-least-once delivery
 * - Dead letter exchange for failed messages
 * - Automatic reconnection on connection loss
 */
export class RabbitMQBrokerProvider implements MessageBrokerProvider {
  readonly name = "rabbitmq";

  private connection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;
  private consumeChannel: Channel | null = null;
  private handler: EventHandler | null = null;
  private isShuttingDown = false;

  /** Exchange for dead letter messages */
  private readonly dlxExchange = "dlx";

  /** Prefetch count for consumers */
  private readonly prefetchCount = 10;

  constructor(private readonly config: RabbitMQConfig) {}

  async initialize(): Promise<void> {
    // Lazy import to avoid loading amqplib if not used
    const amqp = await import("amqplib");

    this.connection = await amqp.connect(this.config.url);

    // Set up connection error handlers
    this.connection.on("error", (error: Error) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "[RabbitMQBroker] Connection error",
      );
    });

    this.connection.on("close", () => {
      if (!this.isShuttingDown) {
        logger.warn("[RabbitMQBroker] Connection closed unexpectedly");
      }
    });

    // Create confirm channel for publishing (supports publisher confirms)
    this.publishChannel = await this.connection.createConfirmChannel();

    // Set up exchanges and queues
    await this.setupTopology();

    logger.info(
      { url: this.config.url, queue: this.config.queue },
      "[RabbitMQBroker] Connected",
    );
  }

  async publish(event: AgentInvocationEvent): Promise<void> {
    const channel = this.publishChannel;
    if (!channel) {
      throw new Error("RabbitMQ publish channel not initialized");
    }

    const message = Buffer.from(JSON.stringify(event));

    // Use publisher confirms for reliable delivery
    await new Promise<void>((resolve, reject) => {
      channel.sendToQueue(
        this.config.queue,
        message,
        {
          persistent: true, // Survive broker restart
          contentType: "application/json",
          messageId: event.id,
          headers: {
            channel: event.channel,
            agentId: event.agentId,
            organizationId: event.organizationId,
          },
        },
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });

    logger.debug(
      { eventId: event.id, queue: this.config.queue },
      "[RabbitMQBroker] Event published",
    );
  }

  async subscribe(handler: EventHandler): Promise<void> {
    if (!this.connection) {
      throw new Error("RabbitMQ not initialized");
    }

    this.handler = handler;

    // Create separate channel for consuming
    this.consumeChannel = await this.connection.createChannel();
    const consumeChannel = this.consumeChannel;
    await consumeChannel.prefetch(this.prefetchCount);

    logger.info(
      { queue: this.config.queue, prefetch: this.prefetchCount },
      "[RabbitMQBroker] Starting consumer",
    );

    await consumeChannel.consume(
      this.config.queue,
      async (msg: ConsumeMessage | null) => {
        if (msg) {
          await this.processMessage(msg);
        }
      },
      { noAck: false }, // Manual acknowledgment
    );
  }

  async acknowledge(eventId: string): Promise<void> {
    // Acknowledgment is handled directly in processMessage via channel.ack()
    // This method is here for interface compliance
    logger.debug({ eventId }, "[RabbitMQBroker] Event acknowledged");
  }

  async reject(eventId: string, requeue: boolean): Promise<void> {
    // Rejection is handled directly in processMessage via channel.nack()
    logger.debug({ eventId, requeue }, "[RabbitMQBroker] Event rejected");
  }

  async healthCheck(): Promise<boolean> {
    const conn = this.connection;
    if (!conn) return false;

    try {
      // Check if connection is still open
      const channel = await conn.createChannel();
      await channel.close();
      return true;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "[RabbitMQBroker] Health check failed",
      );
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    const consumeChannel = this.consumeChannel;
    if (consumeChannel) {
      await consumeChannel.close();
      this.consumeChannel = null;
    }

    const publishChannel = this.publishChannel;
    if (publishChannel) {
      await publishChannel.close();
      this.publishChannel = null;
    }

    const conn = this.connection;
    if (conn) {
      await conn.close();
      this.connection = null;
    }

    logger.info("[RabbitMQBroker] Shutdown complete");
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async setupTopology(): Promise<void> {
    if (!this.publishChannel) return;

    // Create dead letter exchange
    await this.publishChannel.assertExchange(this.dlxExchange, "direct", {
      durable: true,
    });

    // Create dead letter queue
    await this.publishChannel.assertQueue(this.config.dlq, {
      durable: true,
    });

    // Bind DLQ to DLX
    await this.publishChannel.bindQueue(
      this.config.dlq,
      this.dlxExchange,
      this.config.queue, // Routing key matches main queue name
    );

    // Create main queue with DLX configuration
    await this.publishChannel.assertQueue(this.config.queue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": this.dlxExchange,
        "x-dead-letter-routing-key": this.config.queue,
      },
    });

    logger.info(
      { queue: this.config.queue, dlq: this.config.dlq },
      "[RabbitMQBroker] Topology set up",
    );
  }

  private async processMessage(msg: ConsumeMessage): Promise<void> {
    if (!this.handler || !this.consumeChannel) return;

    const content = msg.content.toString();

    let event: AgentInvocationEvent;
    try {
      const parsed = JSON.parse(content);
      event = AgentInvocationEventSchema.parse(parsed);
    } catch (error) {
      logger.error(
        {
          deliveryTag: msg.fields.deliveryTag,
          error: error instanceof Error ? error.message : String(error),
        },
        "[RabbitMQBroker] Failed to parse message, sending to DLQ",
      );
      // Reject without requeue - goes to DLQ via DLX
      this.consumeChannel.nack(msg, false, false);
      return;
    }

    logger.debug(
      { eventId: event.id, deliveryTag: msg.fields.deliveryTag },
      "[RabbitMQBroker] Processing message",
    );

    try {
      await this.handler(event);
      this.consumeChannel.ack(msg);
      logger.debug(
        { eventId: event.id },
        "[RabbitMQBroker] Message processed successfully",
      );
    } catch (error) {
      logger.error(
        {
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "[RabbitMQBroker] Handler error, sending to DLQ",
      );
      // Reject without requeue - goes to DLQ via DLX
      this.consumeChannel.nack(msg, false, false);
    }
  }
}

export default RabbitMQBrokerProvider;
