/**
 * Prometheus metrics for the Message Broker system.
 * Tracks event processing, durations, failures, and queue health.
 */

import client from "prom-client";
import logger from "@/logging";
import type { AgentInvocationChannel } from "@/message-broker/types";

// Message broker metrics
let eventsProcessedCounter: client.Counter<string>;
let eventsFailedCounter: client.Counter<string>;
let eventsDlqCounter: client.Counter<string>;
let eventDurationHistogram: client.Histogram<string>;
let activeProcessingGauge: client.Gauge<string>;
let queueDepthGauge: client.Gauge<string>;

/**
 * Initialize message broker metrics.
 * Should be called once during application startup.
 */
export function initializeMessageBrokerMetrics(): void {
  if (eventsProcessedCounter) {
    logger.info("[MessageBrokerMetrics] Metrics already initialized, skipping");
    return;
  }

  eventsProcessedCounter = new client.Counter({
    name: "message_broker_events_processed_total",
    help: "Total number of events processed by the message broker worker",
    labelNames: ["channel", "status"],
  });

  eventsFailedCounter = new client.Counter({
    name: "message_broker_events_failed_total",
    help: "Total number of events that failed processing",
    labelNames: ["channel", "error_type"],
  });

  eventsDlqCounter = new client.Counter({
    name: "message_broker_events_dlq_total",
    help: "Total number of events sent to the dead letter queue",
    labelNames: ["channel"],
  });

  eventDurationHistogram = new client.Histogram({
    name: "message_broker_event_duration_seconds",
    help: "Duration of event processing in seconds",
    labelNames: ["channel"],
    // Buckets optimized for agent execution (can take longer than typical HTTP requests)
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  });

  activeProcessingGauge = new client.Gauge({
    name: "message_broker_active_processing",
    help: "Number of events currently being processed",
    labelNames: [],
  });

  queueDepthGauge = new client.Gauge({
    name: "message_broker_queue_depth",
    help: "Current depth of the message queue (provider-specific)",
    labelNames: ["provider"],
  });

  logger.info("[MessageBrokerMetrics] Metrics initialized");
}

/**
 * Report a successfully processed event.
 */
export function reportEventProcessed(channel: AgentInvocationChannel): void {
  if (!eventsProcessedCounter) {
    logger.warn(
      "[MessageBrokerMetrics] Metrics not initialized, skipping event processed reporting",
    );
    return;
  }
  eventsProcessedCounter.inc({ channel, status: "success" });
}

/**
 * Report a failed event.
 */
export function reportEventFailed(
  channel: AgentInvocationChannel,
  errorType: string,
): void {
  if (!eventsFailedCounter) {
    logger.warn(
      "[MessageBrokerMetrics] Metrics not initialized, skipping event failed reporting",
    );
    return;
  }
  eventsFailedCounter.inc({ channel, error_type: errorType });
}

/**
 * Report an event sent to the dead letter queue.
 */
export function reportEventDlq(channel: AgentInvocationChannel): void {
  if (!eventsDlqCounter) {
    logger.warn(
      "[MessageBrokerMetrics] Metrics not initialized, skipping DLQ reporting",
    );
    return;
  }
  eventsDlqCounter.inc({ channel });
}

/**
 * Observe event processing duration.
 */
export function reportEventDuration(
  channel: AgentInvocationChannel,
  durationSeconds: number,
): void {
  if (!eventDurationHistogram) {
    logger.warn(
      "[MessageBrokerMetrics] Metrics not initialized, skipping duration reporting",
    );
    return;
  }
  eventDurationHistogram.observe({ channel }, durationSeconds);
}

/**
 * Set the current number of events being processed.
 */
export function setActiveProcessing(count: number): void {
  if (!activeProcessingGauge) {
    logger.warn(
      "[MessageBrokerMetrics] Metrics not initialized, skipping active processing reporting",
    );
    return;
  }
  activeProcessingGauge.set(count);
}

/**
 * Set the current queue depth for a provider.
 */
export function setQueueDepth(provider: string, depth: number): void {
  if (!queueDepthGauge) {
    logger.warn(
      "[MessageBrokerMetrics] Metrics not initialized, skipping queue depth reporting",
    );
    return;
  }
  queueDepthGauge.set({ provider }, depth);
}

/**
 * Create a timer for measuring event processing duration.
 * Returns a function that when called, records the duration.
 */
export function startEventTimer(
  channel: AgentInvocationChannel,
): () => number | undefined {
  if (!eventDurationHistogram) {
    return () => undefined;
  }
  const startTime = Date.now();
  return () => {
    const durationSeconds = (Date.now() - startTime) / 1000;
    eventDurationHistogram.observe({ channel }, durationSeconds);
    return durationSeconds;
  };
}
