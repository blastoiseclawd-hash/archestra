/**
 * Metrics Module
 *
 * Centralizes all Prometheus metrics for observability:
 * - LLM metrics (request duration, tokens, TTFT, throughput)
 * - Message broker metrics (event processing, failures, DLQ)
 */

// LLM Metrics
export {
  getObservableFetch,
  getObservableGenAI,
  initializeMetrics,
  reportBlockedTools,
  reportLLMCost,
  reportLLMTokens,
  reportTimeToFirstToken,
  reportTokensPerSecond,
} from "./llm";

// Message Broker Metrics
export {
  initializeMessageBrokerMetrics,
  reportEventDlq,
  reportEventDuration,
  reportEventFailed,
  reportEventProcessed,
  setActiveProcessing,
  setQueueDepth,
  startEventTimer,
} from "./message-broker";
