/**
 * Custom observability metrics for MCP tool calls.
 * Tracks tool invocations through the MCP gateway and MCP client.
 */

import client from "prom-client";
import logger from "@/logging";
import { sanitizeLabelKey } from "./utils";

// MCP tool call counter metric
let mcpToolCallCounter: client.Counter<string>;

// Store current label keys for comparison
let currentLabelKeys: string[] = [];

/**
 * Initialize MCP metrics with dynamic agent label keys
 * @param labelKeys Array of agent label keys to include as metric labels
 */
export function initializeMcpMetrics(labelKeys: string[]): void {
  // Prometheus labels have naming restrictions. Dashes are not allowed, for example.
  const nextLabelKeys = labelKeys.map(sanitizeLabelKey).sort();

  // Check if label keys have changed
  const labelKeysChanged =
    JSON.stringify(nextLabelKeys) !== JSON.stringify(currentLabelKeys);

  if (!labelKeysChanged && mcpToolCallCounter) {
    logger.info(
      "MCP metrics already initialized with same label keys, skipping reinitialization",
    );
    return;
  }

  currentLabelKeys = nextLabelKeys;

  // Unregister old metrics if they exist
  try {
    if (mcpToolCallCounter) {
      client.register.removeSingleMetric("mcp_tool_call_total");
    }
  } catch (_error) {
    // Ignore errors if metrics don't exist
  }

  // Create new metric with labels:
  // - agent_id: Internal Archestra agent ID
  // - agent_name: Internal Archestra agent name
  // - credential_name: Team name or user name that provided the credential
  // - tool_name: Full tool name including MCP server prefix
  // - mcp_server_name: The MCP server that hosts the tool
  // - success: Whether the tool call was successful ("true" or "false")
  // - blocked: Whether the tool call was blocked by policy ("true" or "false")
  const baseLabelNames = [
    "agent_id",
    "agent_name",
    "credential_name",
    "tool_name",
    "mcp_server_name",
    "success",
    "blocked",
  ];

  mcpToolCallCounter = new client.Counter({
    name: "mcp_tool_call_total",
    help: "Total MCP tool calls",
    labelNames: [...baseLabelNames, ...nextLabelKeys],
  });

  logger.info(
    `MCP metrics initialized with ${
      nextLabelKeys.length
    } agent label keys: ${nextLabelKeys.join(", ")}`,
  );
}

/**
 * Context for reporting MCP tool call metrics
 */
export interface McpToolCallMetricContext {
  /** Internal Archestra agent ID */
  agentId: string;
  /** Internal Archestra agent name */
  agentName: string;
  /** Team name or user name that provided the credential */
  credentialName: string;
  /** Full tool name including MCP server prefix */
  toolName: string;
  /** The MCP server that hosts the tool */
  mcpServerName: string;
  /** Whether the tool call was successful */
  success: boolean;
  /** Whether the tool call was blocked by policy */
  blocked: boolean;
  /** Optional agent labels for additional dimensions */
  agentLabels?: Array<{ key: string; value: string }>;
}

/**
 * Reports an MCP tool call metric
 * @param context The metric context containing all label values
 */
export function reportMcpToolCall(context: McpToolCallMetricContext): void {
  if (!mcpToolCallCounter) {
    logger.warn("MCP metrics not initialized, skipping tool call reporting");
    return;
  }

  const labels: Record<string, string> = {
    agent_id: context.agentId,
    agent_name: context.agentName,
    credential_name: context.credentialName,
    tool_name: context.toolName,
    mcp_server_name: context.mcpServerName,
    success: context.success ? "true" : "false",
    blocked: context.blocked ? "true" : "false",
  };

  // Add agent label values for all registered label keys
  for (const labelKey of currentLabelKeys) {
    // Find the label value for this key from the agent's labels
    const agentLabel = context.agentLabels?.find(
      (l) => sanitizeLabelKey(l.key) === labelKey,
    );
    labels[labelKey] = agentLabel?.value ?? "";
  }

  mcpToolCallCounter.inc(labels);
}
