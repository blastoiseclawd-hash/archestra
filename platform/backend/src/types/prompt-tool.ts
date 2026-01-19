import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { UuidIdSchema } from "./api";
import { ToolParametersContentSchema } from "./tool";

export const SelectPromptToolSchema = createSelectSchema(
  schema.promptToolsTable,
)
  .omit({
    promptId: true,
    toolId: true,
  })
  .extend({
    prompt: z.object({
      id: z.string(),
      name: z.string(),
    }),
    tool: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      parameters: ToolParametersContentSchema,
      createdAt: z.date(),
      updatedAt: z.date(),
      catalogId: z.string().nullable(),
      mcpServerId: z.string().nullable(),
      mcpServerName: z.string().nullable(),
      mcpServerCatalogId: z.string().nullable(),
    }),
  });

export const InsertPromptToolSchema = createInsertSchema(
  schema.promptToolsTable,
);
export const UpdatePromptToolSchema = createUpdateSchema(
  schema.promptToolsTable,
);

export const PromptToolFilterSchema = z.object({
  search: z.string().optional(),
  promptId: UuidIdSchema.optional(),
  origin: z.string().optional().describe("Can be 'llm-proxy' or a catalogId"),
  mcpServerOwnerId: z
    .string()
    .optional()
    .describe("Filter by MCP server owner user ID"),
  excludeArchestraTools: z.coerce
    .boolean()
    .optional()
    .describe("For test isolation"),
});
export const PromptToolSortBySchema = z.enum([
  "name",
  "prompt",
  "origin",
  "createdAt",
]);
export const PromptToolSortDirectionSchema = z.enum(["asc", "desc"]);

export type PromptTool = z.infer<typeof SelectPromptToolSchema>;
export type InsertPromptTool = z.infer<typeof InsertPromptToolSchema>;
export type UpdatePromptTool = z.infer<typeof UpdatePromptToolSchema>;

export type PromptToolFilters = z.infer<typeof PromptToolFilterSchema>;
export type PromptToolSortBy = z.infer<typeof PromptToolSortBySchema>;
export type PromptToolSortDirection = z.infer<
  typeof PromptToolSortDirectionSchema
>;
