import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ChatOpsProviderType } from "@/types/chatops";

/**
 * Represents a historical version of an agent's prompt stored in the prompt_history JSONB array.
 * Only used when is_internal = true.
 */
export interface AgentHistoryEntry {
  version: number;
  userPrompt: string | null;
  systemPrompt: string | null;
  createdAt: string; // ISO timestamp
}

/**
 * Unified agents table supporting both external profiles and internal agents.
 *
 * External profiles (is_internal = false):
 *   - API gateway profiles for routing LLM traffic
 *   - Used for tool assignment and policy enforcement
 *   - Prompt fields are null
 *
 * Internal agents (is_internal = true):
 *   - Chat agents with system/user prompts
 *   - Support version history and rollback
 *   - Can delegate to other internal agents via delegation tools
 *   - Can be triggered by ChatOps providers
 */
const agentsTable = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    considerContextUntrusted: boolean("consider_context_untrusted")
      .notNull()
      .default(false),

    // Internal/External distinction
    isInternal: boolean("is_internal").notNull().default(false),

    // Prompt fields (only used when isInternal = true)
    systemPrompt: text("system_prompt"),
    userPrompt: text("user_prompt"),
    promptVersion: integer("prompt_version").default(1),
    promptHistory: jsonb("prompt_history")
      .$type<AgentHistoryEntry[]>()
      .default([]),
    /** Which chatops providers can trigger this agent (empty = none, only for internal agents) */
    allowedChatops: jsonb("allowed_chatops")
      .$type<ChatOpsProviderType[]>()
      .default([]),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("agents_organization_id_idx").on(table.organizationId),
    index("agents_is_internal_idx").on(table.isInternal),
  ],
);

export default agentsTable;
