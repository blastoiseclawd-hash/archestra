import { vi } from "vitest";
import { beforeEach, describe, expect, test } from "@/test";

const counterInc = vi.fn();
const registerRemoveSingleMetric = vi.fn();

vi.mock("prom-client", () => {
  return {
    default: {
      Counter: class {
        inc(...args: unknown[]) {
          return counterInc(...args);
        }
      },
      register: {
        removeSingleMetric: (...args: unknown[]) =>
          registerRemoveSingleMetric(...args),
      },
    },
  };
});

import { initializeMcpMetrics, reportMcpToolCall } from "./mcp";

describe("initializeMcpMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("skips reinitialization when label keys haven't changed", () => {
    initializeMcpMetrics(["environment", "team"]);
    registerRemoveSingleMetric.mockClear();

    initializeMcpMetrics(["environment", "team"]);

    expect(registerRemoveSingleMetric).not.toHaveBeenCalled();
  });

  test("reinitializes metrics when label keys are added", () => {
    initializeMcpMetrics(["environment"]);
    registerRemoveSingleMetric.mockClear();

    initializeMcpMetrics(["environment", "team"]);

    expect(registerRemoveSingleMetric).toHaveBeenCalledWith(
      "mcp_tool_call_total",
    );
  });

  test("reinitializes metrics when label keys are removed", () => {
    initializeMcpMetrics(["environment", "team"]);
    registerRemoveSingleMetric.mockClear();

    initializeMcpMetrics(["environment"]);

    expect(registerRemoveSingleMetric).toHaveBeenCalledWith(
      "mcp_tool_call_total",
    );
  });

  test("doesn't reinit if keys are the same but in different order", () => {
    initializeMcpMetrics(["team", "environment"]);
    registerRemoveSingleMetric.mockClear();

    initializeMcpMetrics(["environment", "team"]);

    expect(registerRemoveSingleMetric).not.toHaveBeenCalled();
  });
});

describe("reportMcpToolCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeMcpMetrics([]);
  });

  test("records successful tool call", () => {
    reportMcpToolCall({
      agentId: "agent-123",
      agentName: "test-agent",
      credentialName: "team-alpha",
      toolName: "github__create_issue",
      mcpServerName: "github",
      success: true,
      blocked: false,
    });

    expect(counterInc).toHaveBeenCalledWith({
      agent_id: "agent-123",
      agent_name: "test-agent",
      credential_name: "team-alpha",
      tool_name: "github__create_issue",
      mcp_server_name: "github",
      success: "true",
      blocked: "false",
    });
  });

  test("records failed tool call", () => {
    reportMcpToolCall({
      agentId: "agent-456",
      agentName: "another-agent",
      credentialName: "user-john",
      toolName: "slack__send_message",
      mcpServerName: "slack",
      success: false,
      blocked: false,
    });

    expect(counterInc).toHaveBeenCalledWith({
      agent_id: "agent-456",
      agent_name: "another-agent",
      credential_name: "user-john",
      tool_name: "slack__send_message",
      mcp_server_name: "slack",
      success: "false",
      blocked: "false",
    });
  });

  test("records blocked tool call", () => {
    reportMcpToolCall({
      agentId: "agent-blocked",
      agentName: "blocked-agent",
      credentialName: "team-epsilon",
      toolName: "dangerous__execute",
      mcpServerName: "dangerous",
      success: false,
      blocked: true,
    });

    expect(counterInc).toHaveBeenCalledWith({
      agent_id: "agent-blocked",
      agent_name: "blocked-agent",
      credential_name: "team-epsilon",
      tool_name: "dangerous__execute",
      mcp_server_name: "dangerous",
      success: "false",
      blocked: "true",
    });
  });

  test("records tool call with custom agent labels", () => {
    initializeMcpMetrics(["environment", "team"]);

    reportMcpToolCall({
      agentId: "agent-789",
      agentName: "prod-agent",
      credentialName: "team-beta",
      toolName: "jira__create_ticket",
      mcpServerName: "jira",
      success: true,
      blocked: false,
      agentLabels: [
        { key: "environment", value: "production" },
        { key: "team", value: "platform" },
      ],
    });

    expect(counterInc).toHaveBeenCalledWith({
      agent_id: "agent-789",
      agent_name: "prod-agent",
      credential_name: "team-beta",
      tool_name: "jira__create_ticket",
      mcp_server_name: "jira",
      success: "true",
      blocked: "false",
      environment: "production",
      team: "platform",
    });
  });

  test("handles missing agent labels gracefully", () => {
    initializeMcpMetrics(["environment", "team"]);

    reportMcpToolCall({
      agentId: "agent-999",
      agentName: "minimal-agent",
      credentialName: "team-gamma",
      toolName: "linear__get_issues",
      mcpServerName: "linear",
      success: true,
      blocked: false,
      agentLabels: [{ key: "environment", value: "staging" }],
    });

    expect(counterInc).toHaveBeenCalledWith({
      agent_id: "agent-999",
      agent_name: "minimal-agent",
      credential_name: "team-gamma",
      tool_name: "linear__get_issues",
      mcp_server_name: "linear",
      success: "true",
      blocked: "false",
      environment: "staging",
      team: "",
    });
  });

  test("handles special characters in label keys", () => {
    initializeMcpMetrics(["env-name", "team.id"]);

    reportMcpToolCall({
      agentId: "agent-special",
      agentName: "special-agent",
      credentialName: "team-delta",
      toolName: "notion__search",
      mcpServerName: "notion",
      success: true,
      blocked: false,
      agentLabels: [
        { key: "env-name", value: "dev" },
        { key: "team.id", value: "t-123" },
      ],
    });

    expect(counterInc).toHaveBeenCalledWith({
      agent_id: "agent-special",
      agent_name: "special-agent",
      credential_name: "team-delta",
      tool_name: "notion__search",
      mcp_server_name: "notion",
      success: "true",
      blocked: "false",
      env_name: "dev",
      team_id: "t-123",
    });
  });
});
