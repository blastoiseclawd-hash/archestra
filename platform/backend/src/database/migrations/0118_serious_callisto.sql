ALTER TABLE "agent_labels" DROP CONSTRAINT "agent_labels_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_team" DROP CONSTRAINT "agent_team_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_tools" DROP CONSTRAINT "agent_tools_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "dual_llm_results" DROP CONSTRAINT "dual_llm_results_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "interactions" DROP CONSTRAINT "interactions_profile_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" DROP CONSTRAINT "mcp_tool_calls_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "tools" DROP CONSTRAINT "tools_agent_id_agents_id_fk";
