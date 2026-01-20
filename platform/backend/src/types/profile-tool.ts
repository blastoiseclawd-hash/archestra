import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { UuidIdSchema } from "./api";
import { ToolParametersContentSchema } from "./tool";

export const SelectProfileToolSchema = createSelectSchema(
  schema.profileToolsTable,
)
  .omit({
    profileId: true,
    toolId: true,
  })
  .extend({
    profile: z.object({
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

export const InsertProfileToolSchema = createInsertSchema(
  schema.profileToolsTable,
);
export const UpdateProfileToolSchema = createUpdateSchema(
  schema.profileToolsTable,
);

export const ProfileToolFilterSchema = z.object({
  search: z.string().optional(),
  profileId: UuidIdSchema.optional(),
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
export const ProfileToolSortBySchema = z.enum([
  "name",
  "profile",
  "origin",
  "createdAt",
]);
export const ProfileToolSortDirectionSchema = z.enum(["asc", "desc"]);

export type ProfileTool = z.infer<typeof SelectProfileToolSchema>;
export type InsertProfileTool = z.infer<typeof InsertProfileToolSchema>;
export type UpdateProfileTool = z.infer<typeof UpdateProfileToolSchema>;

export type ProfileToolFilters = z.infer<typeof ProfileToolFilterSchema>;
export type ProfileToolSortBy = z.infer<typeof ProfileToolSortBySchema>;
export type ProfileToolSortDirection = z.infer<
  typeof ProfileToolSortDirectionSchema
>;
