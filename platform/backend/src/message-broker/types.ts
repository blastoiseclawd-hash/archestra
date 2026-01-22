import { z } from "zod";

// =============================================================================
// Channel Type
// =============================================================================

export const AgentInvocationChannelSchema = z.enum(["email", "chatops"]);
export type AgentInvocationChannel = z.infer<
  typeof AgentInvocationChannelSchema
>;

// =============================================================================
// Reply Context Types
// =============================================================================

/**
 * Email reply context - contains all information needed to reply to an email
 */
export const EmailReplyContextSchema = z.object({
  /** Original email message ID from provider */
  emailId: z.string(),
  /** Sender email address */
  from: z.string(),
  /** Recipient email address (agent's email) */
  to: z.string(),
  /** Email subject line */
  subject: z.string(),
  /** Conversation/thread ID for maintaining thread context */
  conversationId: z.string().optional(),
  /** Provider-specific email provider ID (e.g., "outlook") */
  providerId: z.string(),
});
export type EmailReplyContext = z.infer<typeof EmailReplyContextSchema>;

/**
 * ChatOps reply context - contains all information needed to reply in MS Teams/Slack
 */
export const ChatOpsReplyContextSchema = z.object({
  /** Provider type (e.g., "ms-teams") */
  provider: z.string(),
  /** Channel ID where the message was received */
  channelId: z.string(),
  /** Workspace/Team ID */
  workspaceId: z.string().nullable(),
  /** Thread ID for maintaining conversation context */
  threadId: z.string().optional(),
  /** Original message ID */
  messageId: z.string(),
  /** Sender ID */
  senderId: z.string(),
  /** Sender display name */
  senderName: z.string(),
  /** Bot Framework conversation reference (for proactive messaging) */
  conversationReference: z.unknown().optional(),
});
export type ChatOpsReplyContext = z.infer<typeof ChatOpsReplyContextSchema>;

// =============================================================================
// Event Schema
// =============================================================================

/**
 * Metadata about the incoming event
 */
export const EventMetadataSchema = z.object({
  /** When the event was received */
  receivedAt: z.string().datetime(),
  /** Source IP address of the webhook request */
  sourceIp: z.string().optional(),
  /** User agent of the webhook request */
  userAgent: z.string().optional(),
});
export type EventMetadata = z.infer<typeof EventMetadataSchema>;

/**
 * Payload of the agent invocation
 */
export const AgentInvocationPayloadSchema = z.object({
  /** The message/prompt to send to the agent */
  message: z.string(),
  /** Conversation ID for context continuity */
  conversationId: z.string().optional(),
  /** Attachments (future use) */
  attachments: z.array(z.unknown()).optional(),
});
export type AgentInvocationPayload = z.infer<
  typeof AgentInvocationPayloadSchema
>;

/**
 * Main event schema for agent invocations published to the message broker
 */
export const AgentInvocationEventSchema = z.object({
  /** Unique event ID (UUID) */
  id: z.string().uuid(),
  /** Channel type */
  channel: AgentInvocationChannelSchema,
  /** Agent (prompt) ID to invoke */
  agentId: z.string().uuid(),
  /** Organization ID */
  organizationId: z.string().uuid(),
  /** User ID (authenticated user or "system" for anonymous) */
  userId: z.string(),
  /** Event payload */
  payload: AgentInvocationPayloadSchema,
  /** Reply context (varies by channel) */
  replyContext: z.union([EmailReplyContextSchema, ChatOpsReplyContextSchema]),
  /** Event metadata */
  metadata: EventMetadataSchema,
});
export type AgentInvocationEvent = z.infer<typeof AgentInvocationEventSchema>;

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * Handler function for processing events from the message broker
 */
export type EventHandler = (event: AgentInvocationEvent) => Promise<void>;

/**
 * Message broker provider interface
 * All broker implementations (Kafka, Redis, RabbitMQ, in-memory) must implement this
 */
export interface MessageBrokerProvider {
  /** Provider name for logging/identification */
  readonly name: string;

  /**
   * Initialize the provider connection
   * Called once on application startup
   */
  initialize(): Promise<void>;

  /**
   * Publish an event to the broker
   * @param event - The agent invocation event to publish
   */
  publish(event: AgentInvocationEvent): Promise<void>;

  /**
   * Subscribe to events from the broker
   * @param handler - Callback function to process received events
   */
  subscribe(handler: EventHandler): Promise<void>;

  /**
   * Acknowledge successful processing of an event
   * @param eventId - The event ID to acknowledge
   */
  acknowledge(eventId: string): Promise<void>;

  /**
   * Reject an event (processing failed)
   * @param eventId - The event ID to reject
   * @param requeue - Whether to requeue the event for retry
   */
  reject(eventId: string, requeue: boolean): Promise<void>;

  /**
   * Check if the provider connection is healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Gracefully shutdown the provider
   * Called on application shutdown
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Broker Types
// =============================================================================

export const MessageBrokerTypeSchema = z.enum(["kafka", "redis", "rabbitmq"]);
export type MessageBrokerType = z.infer<typeof MessageBrokerTypeSchema>;

// =============================================================================
// Invocation Result Types
// =============================================================================

/**
 * Result of invoking an agent asynchronously
 */
export type InvokeAgentResult<T> =
  | { async: true; eventId: string }
  | { async: false; result: T };

/**
 * Options for the unified invokeAgentAsync utility
 */
export interface InvokeAgentOptions<T> {
  /** Channel type */
  channel: AgentInvocationChannel;
  /** Agent (prompt) ID to invoke */
  agentId: string;
  /** Organization ID */
  organizationId: string;
  /** User ID (authenticated user or "system" for anonymous) */
  userId: string;
  /** Event payload */
  payload: AgentInvocationPayload;
  /** Reply context */
  replyContext: EmailReplyContext | ChatOpsReplyContext;
  /** Event metadata (optional, will be auto-populated if not provided) */
  metadata?: Partial<EventMetadata>;
  /**
   * Fallback handler for sync mode (when broker not configured)
   * This function is called directly when the message broker is not enabled
   */
  syncHandler: () => Promise<T>;
}
