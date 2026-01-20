import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { AgentLabelWithDetailsSchema } from "./label";
import { SelectToolSchema } from "./tool";

// Re-export AgentHistoryEntry type from schema
export type { AgentHistoryEntry } from "@/database/schemas/agent";

// Team info schema for agent responses (just id and name)
export const AgentTeamInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const SelectAgentSchema = createSelectSchema(schema.agentsTable).extend({
  tools: z.array(SelectToolSchema),
  teams: z.array(AgentTeamInfoSchema),
  labels: z.array(AgentLabelWithDetailsSchema),
});
export const InsertAgentSchema = createInsertSchema(schema.agentsTable)
  .extend({
    teams: z.array(z.string()),
    labels: z.array(AgentLabelWithDetailsSchema).optional(),
    // Make organizationId optional - model will auto-assign if not provided
    organizationId: z.string().optional(),
  })
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    promptHistory: true,
    promptVersion: true,
  });

export const UpdateAgentSchema = createUpdateSchema(schema.agentsTable)
  .extend({
    teams: z.array(z.string()),
    labels: z.array(AgentLabelWithDetailsSchema).optional(),
  })
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    promptVersion: true,
    promptHistory: true,
  });

// Schema for history entry in API responses (for internal agents)
export const AgentHistoryEntrySchema = z.object({
  version: z.number(),
  userPrompt: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  createdAt: z.string(),
});

// Schema for versions endpoint response (for internal agents)
export const AgentVersionsResponseSchema = z.object({
  current: SelectAgentSchema,
  history: z.array(AgentHistoryEntrySchema),
});

export type Agent = z.infer<typeof SelectAgentSchema>;
export type InsertAgent = z.infer<typeof InsertAgentSchema>;
export type UpdateAgent = z.infer<typeof UpdateAgentSchema>;
export type AgentVersionsResponse = z.infer<typeof AgentVersionsResponseSchema>;
