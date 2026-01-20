import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { ProfileLabelWithDetailsSchema } from "./label";
import { SelectToolSchema } from "./tool";

// Team info schema for profile responses (just id and name)
export const ProfileTeamInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const SelectProfileSchema = createSelectSchema(
  schema.profilesTable,
).extend({
  tools: z.array(SelectToolSchema),
  teams: z.array(ProfileTeamInfoSchema),
  labels: z.array(ProfileLabelWithDetailsSchema),
});
export const InsertProfileSchema = createInsertSchema(schema.profilesTable)
  .extend({
    teams: z.array(z.string()),
    labels: z.array(ProfileLabelWithDetailsSchema).optional(),
  })
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });

export const UpdateProfileSchema = createUpdateSchema(schema.profilesTable)
  .extend({
    teams: z.array(z.string()),
    labels: z.array(ProfileLabelWithDetailsSchema).optional(),
  })
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });

export type Profile = z.infer<typeof SelectProfileSchema>;
export type InsertProfile = z.infer<typeof InsertProfileSchema>;
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;
