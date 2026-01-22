/**
 * Message Broker Module
 *
 * Provides a pluggable message broker layer for async agent invocations.
 * Supports Kafka, Redis Streams, RabbitMQ, and in-memory (dev/testing).
 *
 * Usage:
 * ```typescript
 * import { messageBrokerManager, invokeAgentAsync } from '@/message-broker';
 *
 * // Initialize on startup (in server.ts)
 * await messageBrokerManager.initialize();
 *
 * // In route handlers, use invokeAgentAsync for automatic async/sync handling
 * const result = await invokeAgentAsync({
 *   channel: 'email',
 *   agentId: prompt.id,
 *   organizationId,
 *   userId,
 *   payload: { message: emailBody },
 *   replyContext: { emailId, from, to, subject },
 *   syncHandler: () => processEmailSync(...)
 * });
 *
 * if (result.async) {
 *   return reply.status(202).send({ status: 'accepted', eventId: result.eventId });
 * }
 * return reply.send(result.result);
 * ```
 *
 * Configuration:
 * - ARCHESTRA_MESSAGE_BROKER: 'kafka' | 'redis' | 'rabbitmq' | 'memory' (or unset for sync mode)
 * - See manager.ts for provider-specific configuration options
 */

// Invoke utility
export {
  invokeAgentAsync,
  isAsyncResult,
  isSyncResult,
} from "./invoke";
// Manager (singleton)
export { default, messageBrokerManager } from "./manager";
// Types
export type {
  AgentInvocationChannel,
  AgentInvocationEvent,
  AgentInvocationPayload,
  ChatOpsReplyContext,
  EmailReplyContext,
  EventHandler,
  EventMetadata,
  InvokeAgentOptions,
  InvokeAgentResult,
  MessageBrokerProvider,
  MessageBrokerType,
} from "./types";
// Schemas (for validation)
export {
  AgentInvocationChannelSchema,
  AgentInvocationEventSchema,
  AgentInvocationPayloadSchema,
  ChatOpsReplyContextSchema,
  EmailReplyContextSchema,
  EventMetadataSchema,
  MessageBrokerTypeSchema,
} from "./types";
// Worker (singleton)
export { messageBrokerWorker } from "./worker";
