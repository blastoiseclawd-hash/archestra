import { randomUUID } from "node:crypto";
import logger from "@/logging";
import { messageBrokerManager } from "./manager";
import type {
  AgentInvocationEvent,
  InvokeAgentOptions,
  InvokeAgentResult,
} from "./types";

/**
 * Unified utility for invoking agents asynchronously or synchronously.
 *
 * This function handles the decision between async and sync modes:
 * - If the message broker is enabled, it publishes the event and returns immediately
 * - If the message broker is not configured, it falls back to the sync handler
 *
 * The message broker itself provides durability and can serve as an audit log
 * (Kafka has log retention, Redis Streams has MAXLEN, RabbitMQ has message TTL).
 *
 * Usage in routes:
 * ```typescript
 * const result = await invokeAgentAsync({
 *   channel: 'email',
 *   agentId: agent.id,
 *   organizationId,
 *   userId,
 *   payload: { message: emailBody },
 *   replyContext: { emailId, from, to, subject, conversationId, providerId: 'outlook' },
 *   syncHandler: () => executeIncomingEmailMessage(...)
 * });
 *
 * if (result.async) {
 *   return reply.status(202).send({ status: 'accepted', eventId: result.eventId });
 * }
 * return reply.send(result.result);
 * ```
 *
 * @param options - Invocation options
 * @returns Either { async: true, eventId } or { async: false, result }
 */
export async function invokeAgentAsync<T>(
  options: InvokeAgentOptions<T>,
): Promise<InvokeAgentResult<T>> {
  const {
    channel,
    agentId,
    organizationId,
    userId,
    payload,
    replyContext,
    metadata,
    syncHandler,
  } = options;

  // If broker is not enabled, fall back to sync mode
  if (!messageBrokerManager.isEnabled) {
    logger.debug(
      { channel, agentId },
      "[InvokeAgent] Broker not enabled, using sync mode",
    );
    const result = await syncHandler();
    return { async: false, result };
  }

  // Build the event
  const eventId = randomUUID();
  const now = new Date();

  const event: AgentInvocationEvent = {
    id: eventId,
    channel,
    agentId,
    organizationId,
    userId,
    payload,
    replyContext,
    metadata: {
      receivedAt: metadata?.receivedAt ?? now.toISOString(),
      sourceIp: metadata?.sourceIp,
      userAgent: metadata?.userAgent,
    },
  };

  // Publish to message broker (broker provides durability)
  try {
    await messageBrokerManager.publish(event);

    logger.info(
      { eventId, channel, agentId },
      "[InvokeAgent] Event published to broker",
    );

    return { async: true, eventId };
  } catch (error) {
    logger.error(
      {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      },
      "[InvokeAgent] Failed to publish to broker, falling back to sync",
    );

    // Fall back to sync mode if broker publish fails
    const result = await syncHandler();
    return { async: false, result };
  }
}

/**
 * Helper to check if a result was processed asynchronously
 */
export function isAsyncResult<T>(
  result: InvokeAgentResult<T>,
): result is { async: true; eventId: string } {
  return result.async;
}

/**
 * Helper to check if a result was processed synchronously
 */
export function isSyncResult<T>(
  result: InvokeAgentResult<T>,
): result is { async: false; result: T } {
  return !result.async;
}

export default invokeAgentAsync;
