-- Rename tables from agents to profiles
ALTER TABLE "agents" RENAME TO "profiles";
ALTER TABLE "agent_tools" RENAME TO "profile_tools";
ALTER TABLE "agent_team" RENAME TO "profile_team";
ALTER TABLE "agent_labels" RENAME TO "profile_labels";

-- Rename columns in profile_tools (formerly agent_tools)
ALTER TABLE "profile_tools" RENAME COLUMN "agent_id" TO "profile_id";

-- Rename columns in profile_team (formerly agent_team)
ALTER TABLE "profile_team" RENAME COLUMN "agent_id" TO "profile_id";

-- Rename columns in profile_labels (formerly agent_labels)
ALTER TABLE "profile_labels" RENAME COLUMN "agent_id" TO "profile_id";

-- Rename agent_id columns in other tables
ALTER TABLE "conversations" RENAME COLUMN "agent_id" TO "profile_id";
ALTER TABLE "dual_llm_results" RENAME COLUMN "agent_id" TO "profile_id";
ALTER TABLE "mcp_tool_calls" RENAME COLUMN "agent_id" TO "profile_id";
ALTER TABLE "prompts" RENAME COLUMN "agent_id" TO "profile_id";
ALTER TABLE "tools" RENAME COLUMN "agent_id" TO "profile_id";

-- Rename indexes
ALTER INDEX IF EXISTS "dual_llm_results_agent_id_idx" RENAME TO "dual_llm_results_profile_id_idx";
ALTER INDEX IF EXISTS "mcp_tool_calls_agent_id_idx" RENAME TO "mcp_tool_calls_profile_id_idx";
