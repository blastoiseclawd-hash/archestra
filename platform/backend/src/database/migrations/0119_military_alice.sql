-- Migration: Merge prompts into agents with is_internal flag
-- This migration converts prompts to internal agents and uses delegation tools via agent_tools

-- ============================================================================
-- PHASE 1: SCHEMA CHANGES
-- ============================================================================

-- 1.1 Add columns to agents table
ALTER TABLE "agents" ADD COLUMN "organization_id" text;
ALTER TABLE "agents" ADD COLUMN "is_internal" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN "system_prompt" text;
ALTER TABLE "agents" ADD COLUMN "user_prompt" text;
ALTER TABLE "agents" ADD COLUMN "prompt_version" integer DEFAULT 1;
ALTER TABLE "agents" ADD COLUMN "prompt_history" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "agents" ADD COLUMN "allowed_chatops" jsonb DEFAULT '[]'::jsonb;

--> statement-breakpoint

-- 1.2 Add delegation column to tools table
ALTER TABLE "tools" ADD COLUMN "delegate_to_agent_id" uuid;
ALTER TABLE "tools" ADD CONSTRAINT "tools_delegate_to_agent_id_agents_id_fk"
  FOREIGN KEY ("delegate_to_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

-- 1.3 Add agent_id to chatops_channel_binding table
ALTER TABLE "chatops_channel_binding" ADD COLUMN "agent_id" uuid;
ALTER TABLE "chatops_channel_binding" ADD CONSTRAINT "chatops_channel_binding_agent_id_agents_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "chatops_channel_binding_agent_id_idx" ON "chatops_channel_binding" USING btree ("agent_id");

--> statement-breakpoint

-- ============================================================================
-- PHASE 2: DATA MIGRATION
-- ============================================================================

-- 2.1 Backfill organization_id on agents from first organization if missing
-- For existing agents, use the organization_id from the prompt that references them
UPDATE "agents" a SET "organization_id" = (
  SELECT p."organization_id"
  FROM "prompts" p
  WHERE p."agent_id" = a."id"
  LIMIT 1
) WHERE a."organization_id" IS NULL AND EXISTS (
  SELECT 1 FROM "prompts" p WHERE p."agent_id" = a."id"
);

-- For agents without prompts, use first organization as fallback
UPDATE "agents" SET "organization_id" = (
  SELECT "id" FROM "organization" LIMIT 1
) WHERE "organization_id" IS NULL;

--> statement-breakpoint

-- 2.2 Copy prompt fields to agents (these are the prompts that have their own agent)
-- Each prompt has a unique agentId, so we can copy prompt data directly to agents
UPDATE "agents" a SET
  "is_internal" = true,
  "system_prompt" = p."system_prompt",
  "user_prompt" = p."user_prompt",
  "prompt_version" = p."version",
  "prompt_history" = p."history",
  "allowed_chatops" = p."allowed_chatops"
FROM "prompts" p
WHERE p."agent_id" = a."id";

--> statement-breakpoint

-- 2.3 Migrate prompt_agents to agent_tools with delegation tools
-- Step 1: Create delegation tools for each unique target agent (from prompt)
INSERT INTO "tools" ("id", "name", "description", "delegate_to_agent_id", "created_at", "updated_at", "parameters")
SELECT
  gen_random_uuid(),
  'agent__' || LOWER(REGEXP_REPLACE(target_agent."name", '[^a-zA-Z0-9]+', '_', 'g')),
  'Delegate task to agent: ' || target_agent."name",
  target_agent."id",
  NOW(),
  NOW(),
  '{"type": "object", "properties": {"message": {"type": "string", "description": "The task or message to send to the agent"}}, "required": ["message"]}'::jsonb
FROM (
  SELECT DISTINCT a."id", a."name"
  FROM "prompt_agents" pa
  JOIN "prompts" target_prompt ON pa."agent_prompt_id" = target_prompt."id"
  JOIN "agents" a ON target_prompt."agent_id" = a."id"
) target_agent
WHERE NOT EXISTS (
  SELECT 1 FROM "tools" t WHERE t."delegate_to_agent_id" = target_agent."id"
);

--> statement-breakpoint

-- Step 2: Create agent_tools assignments for delegation tools
INSERT INTO "agent_tools" ("id", "agent_id", "tool_id", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  source_agent."id",
  t."id",
  NOW(),
  NOW()
FROM "prompt_agents" pa
JOIN "prompts" source_prompt ON pa."prompt_id" = source_prompt."id"
JOIN "agents" source_agent ON source_prompt."agent_id" = source_agent."id"
JOIN "prompts" target_prompt ON pa."agent_prompt_id" = target_prompt."id"
JOIN "agents" target_agent ON target_prompt."agent_id" = target_agent."id"
JOIN "tools" t ON t."delegate_to_agent_id" = target_agent."id"
ON CONFLICT ("agent_id", "tool_id") DO NOTHING;

--> statement-breakpoint

-- 2.4 Migrate chatops_channel_binding: copy agent_id from prompt
UPDATE "chatops_channel_binding" c SET "agent_id" = (
  SELECT p."agent_id"
  FROM "prompts" p
  WHERE p."id" = c."prompt_id"
)
WHERE c."agent_id" IS NULL AND c."prompt_id" IS NOT NULL;

--> statement-breakpoint

-- 2.5 Update conversations: ensure promptId matches what's in the agent
-- (No action needed - agentId is already set, promptId becomes redundant)

-- ============================================================================
-- PHASE 3: Add NOT NULL constraint to organization_id (after data backfill)
-- ============================================================================

-- Create a default organization if none exists (for fresh/test databases)
INSERT INTO "organization" ("id", "name", "slug", "created_at")
SELECT gen_random_uuid(), 'Default Organization', 'default-org', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "organization" LIMIT 1);

--> statement-breakpoint

-- Set a fallback for any remaining null organization_id
UPDATE "agents" SET "organization_id" = (
  SELECT "id" FROM "organization" LIMIT 1
) WHERE "organization_id" IS NULL;

--> statement-breakpoint

-- Now make organization_id NOT NULL
ALTER TABLE "agents" ALTER COLUMN "organization_id" SET NOT NULL;

--> statement-breakpoint

-- ============================================================================
-- PHASE 4: Create indexes for new columns
-- ============================================================================

CREATE INDEX "agents_organization_id_idx" ON "agents" USING btree ("organization_id");
CREATE INDEX "agents_is_internal_idx" ON "agents" USING btree ("is_internal");
CREATE INDEX "tools_delegate_to_agent_id_idx" ON "tools" USING btree ("delegate_to_agent_id");
