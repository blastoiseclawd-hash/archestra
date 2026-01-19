CREATE TABLE "llm_proxies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"consider_context_untrusted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_proxy_labels" (
	"llm_proxy_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_proxy_labels_llm_proxy_id_key_id_pk" PRIMARY KEY("llm_proxy_id","key_id")
);
--> statement-breakpoint
CREATE TABLE "llm_proxy_team" (
	"llm_proxy_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_proxy_team_llm_proxy_id_team_id_pk" PRIMARY KEY("llm_proxy_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_gateway_labels" (
	"mcp_gateway_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_gateway_labels_mcp_gateway_id_key_id_pk" PRIMARY KEY("mcp_gateway_id","key_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_gateway_team" (
	"mcp_gateway_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_gateway_team_mcp_gateway_id_team_id_pk" PRIMARY KEY("mcp_gateway_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_gateway_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mcp_gateway_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"response_modifier_template" text,
	"credential_source_mcp_server_id" uuid,
	"execution_source_mcp_server_id" uuid,
	"use_dynamic_team_credential" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_gateway_tools_mcp_gateway_id_tool_id_unique" UNIQUE("mcp_gateway_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_gateways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tools" DROP CONSTRAINT "tools_catalog_id_name_agent_id_prompt_agent_id_unique";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "mcp_gateway_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "llm_proxy_id" uuid;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "llm_proxy_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD COLUMN "mcp_gateway_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "mcp_gateway_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "llm_proxy_id" uuid;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "llm_proxy_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_proxy_labels" ADD CONSTRAINT "llm_proxy_labels_llm_proxy_id_llm_proxies_id_fk" FOREIGN KEY ("llm_proxy_id") REFERENCES "public"."llm_proxies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_proxy_labels" ADD CONSTRAINT "llm_proxy_labels_key_id_label_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."label_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_proxy_labels" ADD CONSTRAINT "llm_proxy_labels_value_id_label_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."label_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_proxy_team" ADD CONSTRAINT "llm_proxy_team_llm_proxy_id_llm_proxies_id_fk" FOREIGN KEY ("llm_proxy_id") REFERENCES "public"."llm_proxies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_proxy_team" ADD CONSTRAINT "llm_proxy_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_labels" ADD CONSTRAINT "mcp_gateway_labels_mcp_gateway_id_mcp_gateways_id_fk" FOREIGN KEY ("mcp_gateway_id") REFERENCES "public"."mcp_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_labels" ADD CONSTRAINT "mcp_gateway_labels_key_id_label_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."label_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_labels" ADD CONSTRAINT "mcp_gateway_labels_value_id_label_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."label_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_team" ADD CONSTRAINT "mcp_gateway_team_mcp_gateway_id_mcp_gateways_id_fk" FOREIGN KEY ("mcp_gateway_id") REFERENCES "public"."mcp_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_team" ADD CONSTRAINT "mcp_gateway_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_tools" ADD CONSTRAINT "mcp_gateway_tools_mcp_gateway_id_mcp_gateways_id_fk" FOREIGN KEY ("mcp_gateway_id") REFERENCES "public"."mcp_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_tools" ADD CONSTRAINT "mcp_gateway_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_tools" ADD CONSTRAINT "mcp_gateway_tools_credential_source_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("credential_source_mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_gateway_tools" ADD CONSTRAINT "mcp_gateway_tools_execution_source_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("execution_source_mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_mcp_gateway_id_mcp_gateways_id_fk" FOREIGN KEY ("mcp_gateway_id") REFERENCES "public"."mcp_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_llm_proxy_id_llm_proxies_id_fk" FOREIGN KEY ("llm_proxy_id") REFERENCES "public"."llm_proxies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_llm_proxy_id_llm_proxies_id_fk" FOREIGN KEY ("llm_proxy_id") REFERENCES "public"."llm_proxies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_mcp_gateway_id_mcp_gateways_id_fk" FOREIGN KEY ("mcp_gateway_id") REFERENCES "public"."mcp_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_mcp_gateway_id_mcp_gateways_id_fk" FOREIGN KEY ("mcp_gateway_id") REFERENCES "public"."mcp_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_llm_proxy_id_llm_proxies_id_fk" FOREIGN KEY ("llm_proxy_id") REFERENCES "public"."llm_proxies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_llm_proxy_id_llm_proxies_id_fk" FOREIGN KEY ("llm_proxy_id") REFERENCES "public"."llm_proxies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_catalog_id_name_agent_id_llm_proxy_id_prompt_agent_id_unique" UNIQUE("catalog_id","name","agent_id","llm_proxy_id","prompt_agent_id");--> statement-breakpoint
-- Data migration: Copy agents data to mcp_gateways and llm_proxies
-- This migration copies existing agents to both new entity types with the same IDs
-- for backward compatibility during the transition period.

-- Step 0: Create a default organization if none exists (for fresh databases with agents but no organizations)
INSERT INTO organization (id, name, slug, created_at)
SELECT 'default-org', 'Default Organization', 'default', NOW()
WHERE NOT EXISTS (SELECT 1 FROM organization LIMIT 1);--> statement-breakpoint
-- Step 1: Insert into mcp_gateways from agents
-- Use the organization_id from the first team association, or the first available organization as fallback
INSERT INTO mcp_gateways (id, organization_id, name, is_default, created_at, updated_at)
SELECT
  a.id,
  COALESCE(
    (SELECT t.organization_id FROM agent_team at2
     JOIN team t ON t.id = at2.team_id
     WHERE at2.agent_id = a.id
     LIMIT 1),
    (SELECT id FROM organization LIMIT 1)
  ) as organization_id,
  a.name,
  a.is_default,
  a.created_at,
  a.updated_at
FROM agents a
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
-- Step 2: Insert into llm_proxies from agents
INSERT INTO llm_proxies (id, organization_id, name, is_default, consider_context_untrusted, created_at, updated_at)
SELECT
  a.id,
  COALESCE(
    (SELECT t.organization_id FROM agent_team at2
     JOIN team t ON t.id = at2.team_id
     WHERE at2.agent_id = a.id
     LIMIT 1),
    (SELECT id FROM organization LIMIT 1)
  ) as organization_id,
  a.name,
  a.is_default,
  a.consider_context_untrusted,
  a.created_at,
  a.updated_at
FROM agents a
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
-- Step 3: Copy agent_team to mcp_gateway_team
INSERT INTO mcp_gateway_team (mcp_gateway_id, team_id, created_at)
SELECT agent_id, team_id, created_at
FROM agent_team
ON CONFLICT (mcp_gateway_id, team_id) DO NOTHING;--> statement-breakpoint
-- Step 4: Copy agent_team to llm_proxy_team
INSERT INTO llm_proxy_team (llm_proxy_id, team_id, created_at)
SELECT agent_id, team_id, created_at
FROM agent_team
ON CONFLICT (llm_proxy_id, team_id) DO NOTHING;--> statement-breakpoint
-- Step 5: Copy agent_tools to mcp_gateway_tools
INSERT INTO mcp_gateway_tools (id, mcp_gateway_id, tool_id, response_modifier_template, credential_source_mcp_server_id, execution_source_mcp_server_id, use_dynamic_team_credential, created_at, updated_at)
SELECT id, agent_id, tool_id, response_modifier_template, credential_source_mcp_server_id, execution_source_mcp_server_id, use_dynamic_team_credential, created_at, updated_at
FROM agent_tools
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
-- Step 6: Copy agent_labels to llm_proxy_labels
-- Labels are used for observability, so they go to LLM Proxy
INSERT INTO llm_proxy_labels (llm_proxy_id, key_id, value_id, created_at)
SELECT agent_id, key_id, value_id, created_at
FROM agent_labels
ON CONFLICT (llm_proxy_id, key_id) DO NOTHING;--> statement-breakpoint
-- Step 7: Update conversations to reference both new entities
UPDATE conversations c
SET
  mcp_gateway_id = c.agent_id,
  llm_proxy_id = c.agent_id
WHERE c.mcp_gateway_id IS NULL OR c.llm_proxy_id IS NULL;--> statement-breakpoint
-- Step 8: Update interactions to reference llm_proxy
UPDATE interactions i
SET llm_proxy_id = i.profile_id
WHERE i.llm_proxy_id IS NULL;--> statement-breakpoint
-- Step 9: Update mcp_tool_calls to reference mcp_gateway
UPDATE mcp_tool_calls m
SET mcp_gateway_id = m.agent_id
WHERE m.mcp_gateway_id IS NULL;--> statement-breakpoint
-- Step 10: Update prompts to reference both new entities (if they have an agent_id)
UPDATE prompts p
SET
  mcp_gateway_id = p.agent_id,
  llm_proxy_id = p.agent_id
WHERE p.mcp_gateway_id IS NULL OR p.llm_proxy_id IS NULL;