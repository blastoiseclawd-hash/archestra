import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasPermission } from "@/auth";
import { McpGatewayLabelModel, McpGatewayModel, TeamModel } from "@/models";
import {
  ApiError,
  constructResponseSchema,
  createPaginatedResponseSchema,
  createSortingQuerySchema,
  DeleteObjectResponseSchema,
  InsertMcpGatewaySchema,
  PaginationQuerySchema,
  SelectMcpGatewaySchema,
  UpdateMcpGatewaySchema,
  UuidIdSchema,
} from "@/types";

const mcpGatewayEntityRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/mcp-gateways",
    {
      schema: {
        operationId: RouteId.GetMcpGatewayEntities,
        description:
          "Get all MCP Gateways with pagination, sorting, and filtering",
        tags: ["MCP Gateway"],
        querystring: z
          .object({
            name: z.string().optional().describe("Filter by gateway name"),
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
          createPaginatedResponseSchema(SelectMcpGatewaySchema),
        ),
      },
    },
    async (
      {
        query: { name, limit, offset, sortBy, sortDirection },
        user,
        headers,
        organizationId,
      },
      reply,
    ) => {
      const { success: isMcpGatewayAdmin } = await hasPermission(
        { mcpGatewayEntity: ["admin"] },
        headers,
      );
      return reply.send(
        await McpGatewayModel.findAllPaginated(
          organizationId,
          { limit, offset },
          { sortBy, sortDirection },
          { name },
          user.id,
          isMcpGatewayAdmin,
        ),
      );
    },
  );

  fastify.get(
    "/api/mcp-gateways/all",
    {
      schema: {
        operationId: RouteId.GetAllMcpGatewayEntities,
        description: "Get all MCP Gateways without pagination",
        tags: ["MCP Gateway"],
        response: constructResponseSchema(z.array(SelectMcpGatewaySchema)),
      },
    },
    async ({ headers, user, organizationId }, reply) => {
      const { success: isMcpGatewayAdmin } = await hasPermission(
        { mcpGatewayEntity: ["admin"] },
        headers,
      );
      return reply.send(
        await McpGatewayModel.findAll(
          organizationId,
          user.id,
          isMcpGatewayAdmin,
        ),
      );
    },
  );

  fastify.get(
    "/api/mcp-gateways/default",
    {
      schema: {
        operationId: RouteId.GetDefaultMcpGatewayEntity,
        description: "Get or create default MCP Gateway",
        tags: ["MCP Gateway"],
        response: constructResponseSchema(SelectMcpGatewaySchema),
      },
    },
    async ({ organizationId }, reply) => {
      return reply.send(
        await McpGatewayModel.getOrCreateDefault(organizationId),
      );
    },
  );

  fastify.post(
    "/api/mcp-gateways",
    {
      schema: {
        operationId: RouteId.CreateMcpGatewayEntity,
        description: "Create a new MCP Gateway",
        tags: ["MCP Gateway"],
        body: InsertMcpGatewaySchema,
        response: constructResponseSchema(SelectMcpGatewaySchema),
      },
    },
    async ({ body, user, headers, organizationId }, reply) => {
      const { success: isMcpGatewayAdmin } = await hasPermission(
        { mcpGatewayEntity: ["admin"] },
        headers,
      );

      // Validate team assignment for non-admin users
      if (!isMcpGatewayAdmin) {
        const userTeamIds = await TeamModel.getUserTeamIds(user.id);

        if (body.teams.length === 0) {
          // Non-admin users must select at least one team they're a member of
          if (userTeamIds.length === 0) {
            throw new ApiError(
              403,
              "You must be a member of at least one team to create an MCP Gateway",
            );
          }
          throw new ApiError(
            400,
            "You must assign at least one team to the MCP Gateway",
          );
        }

        // Verify user is a member of all specified teams
        const userTeamIdSet = new Set(userTeamIds);
        const invalidTeams = body.teams.filter((id) => !userTeamIdSet.has(id));
        if (invalidTeams.length > 0) {
          throw new ApiError(
            403,
            "You can only assign MCP Gateways to teams you are a member of",
          );
        }
      }

      const gateway = await McpGatewayModel.create({
        ...body,
        organizationId,
      });
      return reply.send(gateway);
    },
  );

  fastify.get(
    "/api/mcp-gateways/:id",
    {
      schema: {
        operationId: RouteId.GetMcpGatewayEntity,
        description: "Get MCP Gateway by ID",
        tags: ["MCP Gateway"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(SelectMcpGatewaySchema),
      },
    },
    async ({ params: { id }, headers, user }, reply) => {
      const { success: isMcpGatewayAdmin } = await hasPermission(
        { mcpGatewayEntity: ["admin"] },
        headers,
      );

      const gateway = await McpGatewayModel.findById(
        id,
        user.id,
        isMcpGatewayAdmin,
      );

      if (!gateway) {
        throw new ApiError(404, "MCP Gateway not found");
      }

      return reply.send(gateway);
    },
  );

  fastify.put(
    "/api/mcp-gateways/:id",
    {
      schema: {
        operationId: RouteId.UpdateMcpGatewayEntity,
        description: "Update an MCP Gateway",
        tags: ["MCP Gateway"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: UpdateMcpGatewaySchema.partial(),
        response: constructResponseSchema(SelectMcpGatewaySchema),
      },
    },
    async ({ params: { id }, body, user, headers }, reply) => {
      // Validate team assignment for non-admin users if teams are being updated
      if (body.teams !== undefined) {
        const { success: isMcpGatewayAdmin } = await hasPermission(
          { mcpGatewayEntity: ["admin"] },
          headers,
        );

        if (!isMcpGatewayAdmin) {
          const userTeamIds = await TeamModel.getUserTeamIds(user.id);

          if (body.teams.length === 0) {
            // Non-admin users must assign at least one team
            throw new ApiError(
              400,
              "You must assign at least one team to the MCP Gateway",
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
              "You can only assign MCP Gateways to teams you are a member of",
            );
          }
        }
      }

      const gateway = await McpGatewayModel.update(id, body);

      if (!gateway) {
        throw new ApiError(404, "MCP Gateway not found");
      }

      return reply.send(gateway);
    },
  );

  fastify.delete(
    "/api/mcp-gateways/:id",
    {
      schema: {
        operationId: RouteId.DeleteMcpGatewayEntity,
        description: "Delete an MCP Gateway",
        tags: ["MCP Gateway"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { id } }, reply) => {
      const success = await McpGatewayModel.delete(id);

      if (!success) {
        throw new ApiError(404, "MCP Gateway not found");
      }

      return reply.send({ success: true });
    },
  );

  fastify.get(
    "/api/mcp-gateways/labels/keys",
    {
      schema: {
        operationId: RouteId.GetMcpGatewayEntityLabelKeys,
        description: "Get all available label keys for MCP Gateways",
        tags: ["MCP Gateway"],
        response: constructResponseSchema(z.array(z.string())),
      },
    },
    async (_request, reply) => {
      return reply.send(await McpGatewayLabelModel.getAllKeys());
    },
  );

  fastify.get(
    "/api/mcp-gateways/labels/values",
    {
      schema: {
        operationId: RouteId.GetMcpGatewayEntityLabelValues,
        description: "Get all available label values for MCP Gateways",
        tags: ["MCP Gateway"],
        querystring: z.object({
          key: z.string().optional().describe("Filter values by label key"),
        }),
        response: constructResponseSchema(z.array(z.string())),
      },
    },
    async ({ query: { key } }, reply) => {
      return reply.send(
        key
          ? await McpGatewayLabelModel.getValuesByKey(key)
          : await McpGatewayLabelModel.getAllKeys(),
      );
    },
  );
};

export default mcpGatewayEntityRoutes;
