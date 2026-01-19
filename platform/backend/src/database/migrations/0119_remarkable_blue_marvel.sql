CREATE TABLE "prompt_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"response_modifier_template" text,
	"credential_source_mcp_server_id" uuid,
	"execution_source_mcp_server_id" uuid,
	"use_dynamic_team_credential" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_tools_prompt_id_tool_id_unique" UNIQUE("prompt_id","tool_id")
);
--> statement-breakpoint
ALTER TABLE "prompt_tools" ADD CONSTRAINT "prompt_tools_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_tools" ADD CONSTRAINT "prompt_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_tools" ADD CONSTRAINT "prompt_tools_credential_source_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("credential_source_mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_tools" ADD CONSTRAINT "prompt_tools_execution_source_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("execution_source_mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE set null ON UPDATE no action;