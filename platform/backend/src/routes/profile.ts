import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasPermission } from "@/auth";
import { initializeMetrics } from "@/llm-metrics";
import { ProfileLabelModel, ProfileModel, TeamModel } from "@/models";
import {
  ApiError,
  constructResponseSchema,
  createPaginatedResponseSchema,
  createSortingQuerySchema,
  DeleteObjectResponseSchema,
  InsertProfileSchema,
  PaginationQuerySchema,
  SelectProfileSchema,
  UpdateProfileSchema,
  UuidIdSchema,
} from "@/types";

const profileRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/profiles",
    {
      schema: {
        operationId: RouteId.GetProfiles,
        description: "Get all profiles with pagination, sorting, and filtering",
        tags: ["Profiles"],
        querystring: z
          .object({
            name: z.string().optional().describe("Filter by profile name"),
          })
          .merge(PaginationQuerySchema)
          .merge(
            createSortingQuerySchema([
              "name",
              "createdAt",
              "toolsCount",
              "team",
            ] as const),
          ),
        response: constructResponseSchema(
          createPaginatedResponseSchema(SelectProfileSchema),
        ),
      },
    },
    async (
      { query: { name, limit, offset, sortBy, sortDirection }, user, headers },
      reply,
    ) => {
      const { success: isProfileAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );
      return reply.send(
        await ProfileModel.findAllPaginated(
          { limit, offset },
          { sortBy, sortDirection },
          { name },
          user.id,
          isProfileAdmin,
        ),
      );
    },
  );

  fastify.get(
    "/api/profiles/all",
    {
      schema: {
        operationId: RouteId.GetAllProfiles,
        description: "Get all profiles without pagination",
        tags: ["Profiles"],
        response: constructResponseSchema(z.array(SelectProfileSchema)),
      },
    },
    async ({ headers, user }, reply) => {
      const { success: isProfileAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );
      return reply.send(await ProfileModel.findAll(user.id, isProfileAdmin));
    },
  );

  fastify.get(
    "/api/profiles/default",
    {
      schema: {
        operationId: RouteId.GetDefaultProfile,
        description: "Get or create default profile",
        tags: ["Profiles"],
        response: constructResponseSchema(SelectProfileSchema),
      },
    },
    async (_request, reply) => {
      return reply.send(await ProfileModel.getProfileOrCreateDefault());
    },
  );

  fastify.post(
    "/api/profiles",
    {
      schema: {
        operationId: RouteId.CreateProfile,
        description: "Create a new profile",
        tags: ["Profiles"],
        body: InsertProfileSchema,
        response: constructResponseSchema(SelectProfileSchema),
      },
    },
    async ({ body, user, headers }, reply) => {
      const { success: isProfileAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );

      // Validate team assignment for non-admin users
      if (!isProfileAdmin) {
        const userTeamIds = await TeamModel.getUserTeamIds(user.id);

        if (body.teams.length === 0) {
          // Non-admin users must select at least one team they're a member of
          if (userTeamIds.length === 0) {
            throw new ApiError(
              403,
              "You must be a member of at least one team to create a profile",
            );
          }
          throw new ApiError(
            400,
            "You must assign at least one team to the profile",
          );
        }

        // Verify user is a member of all specified teams
        const userTeamIdSet = new Set(userTeamIds);
        const invalidTeams = body.teams.filter((id) => !userTeamIdSet.has(id));
        if (invalidTeams.length > 0) {
          throw new ApiError(
            403,
            "You can only assign profiles to teams you are a member of",
          );
        }
      }

      const profile = await ProfileModel.create(body);
      const labelKeys = await ProfileLabelModel.getAllKeys();

      // We need to re-init metrics with the new label keys in case label keys changed.
      // Otherwise the newly added labels will not make it to metrics. The labels with new keys, that is.
      initializeMetrics(labelKeys);

      return reply.send(profile);
    },
  );

  fastify.get(
    "/api/profiles/:id",
    {
      schema: {
        operationId: RouteId.GetProfile,
        description: "Get profile by ID",
        tags: ["Profiles"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(SelectProfileSchema),
      },
    },
    async ({ params: { id }, headers, user }, reply) => {
      const { success: isProfileAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );

      const profile = await ProfileModel.findById(id, user.id, isProfileAdmin);

      if (!profile) {
        throw new ApiError(404, "Profile not found");
      }

      return reply.send(profile);
    },
  );

  fastify.put(
    "/api/profiles/:id",
    {
      schema: {
        operationId: RouteId.UpdateProfile,
        description: "Update a profile",
        tags: ["Profiles"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: UpdateProfileSchema.partial(),
        response: constructResponseSchema(SelectProfileSchema),
      },
    },
    async ({ params: { id }, body, user, headers }, reply) => {
      // Validate team assignment for non-admin users if teams are being updated
      if (body.teams !== undefined) {
        const { success: isProfileAdmin } = await hasPermission(
          { profile: ["admin"] },
          headers,
        );

        if (!isProfileAdmin) {
          const userTeamIds = await TeamModel.getUserTeamIds(user.id);

          if (body.teams.length === 0) {
            // Non-admin users must assign at least one team
            throw new ApiError(
              400,
              "You must assign at least one team to the profile",
            );
          }

          // Verify user is a member of all specified teams
          const userTeamIdSet = new Set(userTeamIds);
          const invalidTeams = body.teams.filter(
            (teamId) => !userTeamIdSet.has(teamId),
          );
          if (invalidTeams.length > 0) {
            throw new ApiError(
              403,
              "You can only assign profiles to teams you are a member of",
            );
          }
        }
      }

      const profile = await ProfileModel.update(id, body);

      if (!profile) {
        throw new ApiError(404, "Profile not found");
      }

      const labelKeys = await ProfileLabelModel.getAllKeys();
      // We need to re-init metrics with the new label keys in case label keys changed.
      // Otherwise the newly added labels will not make it to metrics. The labels with new keys, that is.
      initializeMetrics(labelKeys);

      return reply.send(profile);
    },
  );

  fastify.delete(
    "/api/profiles/:id",
    {
      schema: {
        operationId: RouteId.DeleteProfile,
        description: "Delete a profile",
        tags: ["Profiles"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { id } }, reply) => {
      const success = await ProfileModel.delete(id);

      if (!success) {
        throw new ApiError(404, "Profile not found");
      }

      return reply.send({ success: true });
    },
  );

  fastify.get(
    "/api/profiles/labels/keys",
    {
      schema: {
        operationId: RouteId.GetLabelKeys,
        description: "Get all available label keys",
        tags: ["Profiles"],
        response: constructResponseSchema(z.array(z.string())),
      },
    },
    async (_request, reply) => {
      return reply.send(await ProfileLabelModel.getAllKeys());
    },
  );

  fastify.get(
    "/api/profiles/labels/values",
    {
      schema: {
        operationId: RouteId.GetLabelValues,
        description: "Get all available label values",
        tags: ["Profiles"],
        querystring: z.object({
          key: z.string().optional().describe("Filter values by label key"),
        }),
        response: constructResponseSchema(z.array(z.string())),
      },
    },
    async ({ query: { key } }, reply) => {
      return reply.send(
        key
          ? await ProfileLabelModel.getValuesByKey(key)
          : await ProfileLabelModel.getAllValues(),
      );
    },
  );
};

export default profileRoutes;
