import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { CommonToolCall } from "@/types";
import mcpGatewaysTable from "./mcp-gateway";

const mcpToolCallsTable = pgTable(
  "mcp_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // agentId is deprecated - kept for backward compatibility but no FK constraint
    agentId: uuid("agent_id").notNull(),
    // mcpGatewayId links tool calls to their MCP Gateway for logging
    mcpGatewayId: uuid("mcp_gateway_id").references(() => mcpGatewaysTable.id, {
      onDelete: "cascade",
    }),
    mcpServerName: varchar("mcp_server_name", { length: 255 }).notNull(),
    method: varchar("method", { length: 255 }).notNull(),
    toolCall: jsonb("tool_call").$type<CommonToolCall | null>(),
    // toolResult structure varies by method type:
    // - tools/call: { id, content, isError, error? }
    // - tools/list: { tools: [...] }
    // - initialize: { capabilities, serverInfo }
    toolResult: jsonb("tool_result").$type<unknown>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdIdx: index("mcp_tool_calls_agent_id_idx").on(table.agentId),
    createdAtIdx: index("mcp_tool_calls_created_at_idx").on(table.createdAt),
  }),
);

export default mcpToolCallsTable;
