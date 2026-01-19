import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { SupportedChatProvider } from "@/types";
import chatApiKeysTable from "./chat-api-key";
import llmProxiesTable from "./llm-proxy";
import mcpGatewaysTable from "./mcp-gateway";
import promptsTable from "./prompt";

const conversationsTable = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  organizationId: text("organization_id").notNull(),
  // agentId is deprecated - kept for backward compatibility but no FK constraint
  agentId: uuid("agent_id").notNull(),
  promptId: uuid("prompt_id").references(() => promptsTable.id, {
    onDelete: "set null",
  }),
  // MCP Gateway for tool execution (resolved from promptId or set directly)
  mcpGatewayId: uuid("mcp_gateway_id").references(() => mcpGatewaysTable.id, {
    onDelete: "set null",
  }),
  // LLM Proxy for policy evaluation (resolved from promptId or set directly)
  llmProxyId: uuid("llm_proxy_id").references(() => llmProxiesTable.id, {
    onDelete: "set null",
  }),
  chatApiKeyId: uuid("chat_api_key_id").references(() => chatApiKeysTable.id, {
    onDelete: "set null",
  }),
  title: text("title"),
  selectedModel: text("selected_model").notNull().default("gpt-4o"),
  selectedProvider: text("selected_provider").$type<SupportedChatProvider>(),
  hasCustomToolSelection: boolean("has_custom_tool_selection")
    .notNull()
    .default(false),
  todoList:
    jsonb("todo_list").$type<
      Array<{
        id: number;
        content: string;
        status: "pending" | "in_progress" | "completed";
      }>
    >(),
  artifact: text("artifact"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export default conversationsTable;
