import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import llmProxiesTable from "./llm-proxy";
import mcpGatewaysTable from "./mcp-gateway";

/**
 * Represents a historical version of a prompt stored in the history JSONB array
 */
export interface PromptHistoryEntry {
  version: number;
  userPrompt: string | null;
  systemPrompt: string | null;
  createdAt: string; // ISO timestamp
}

const promptsTable = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  // agentId kept for backward compatibility but no FK constraint (optional)
  agentId: uuid("agent_id"),
  // MCP Gateway for tool execution (optional)
  mcpGatewayId: uuid("mcp_gateway_id").references(() => mcpGatewaysTable.id, {
    onDelete: "set null",
  }),
  // LLM Proxy for policy evaluation and observability (optional)
  llmProxyId: uuid("llm_proxy_id").references(() => llmProxiesTable.id, {
    onDelete: "set null",
  }),
  userPrompt: text("user_prompt"),
  systemPrompt: text("system_prompt"),
  version: integer("version").notNull().default(1),
  history: jsonb("history").$type<PromptHistoryEntry[]>().notNull().default([]),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export default promptsTable;
