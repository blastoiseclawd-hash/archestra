import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasPermission } from "@/auth";
import { clearChatMcpClient } from "@/clients/chat-mcp-client";
import logger from "@/logging";
import {
  InternalMcpCatalogModel,
  McpGatewayModel,
  McpGatewayTeamModel,
  McpGatewayToolModel,
  McpServerModel,
  ToolModel,
  UserModel,
} from "@/models";
import { toolAutoPolicyService } from "@/models/agent-tool-auto-policy";
import type { InternalMcpCatalog, Tool } from "@/types";
import {
  ApiError,
  constructResponseSchema,
  createPaginatedResponseSchema,
  DeleteObjectResponseSchema,
  McpGatewayToolFilterSchema,
  McpGatewayToolSortBySchema,
  McpGatewayToolSortDirectionSchema,
  PaginationQuerySchema,
  SelectMcpGatewayToolSchema,
  SelectToolSchema,
  UpdateMcpGatewayToolSchema,
  UuidIdSchema,
} from "@/types";

const mcpGatewayToolRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/mcp-gateway-tools",
    {
      schema: {
        operationId: RouteId.GetAllAgentTools,
        description:
          "Get all MCP gateway-tool relationships with pagination, sorting, and filtering",
        tags: ["MCP Gateway Tools"],
        querystring: McpGatewayToolFilterSchema.extend({
          sortBy: McpGatewayToolSortBySchema.optional(),
          sortDirection: McpGatewayToolSortDirectionSchema.optional(),
          skipPagination: z.coerce.boolean().optional(),
        }).merge(PaginationQuerySchema),
        response: constructResponseSchema(
          createPaginatedResponseSchema(SelectMcpGatewayToolSchema),
        ),
      },
    },
    async (
      {
        query: {
          limit,
          offset,
          sortBy,
          sortDirection,
          search,
          mcpGatewayId,
          origin,
          mcpServerOwnerId,
          excludeArchestraTools,
          skipPagination,
        },
        headers,
        user,
      },
      reply,
    ) => {
      const { success: isMcpGatewayAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );

      const result = await McpGatewayToolModel.findAll({
        pagination: { limit, offset },
        sorting: { sortBy, sortDirection },
        filters: {
          search,
          mcpGatewayId,
          origin,
          mcpServerOwnerId,
          excludeArchestraTools,
        },
        userId: user.id,
        isMcpGatewayAdmin,
        skipPagination,
      });

      return reply.send(result);
    },
  );

  fastify.post(
    "/api/mcp-gateways/:mcpGatewayId/tools/:toolId",
    {
      schema: {
        operationId: RouteId.AssignToolToAgent,
        description: "Assign a tool to an MCP gateway",
        tags: ["MCP Gateway Tools"],
        params: z.object({
          mcpGatewayId: UuidIdSchema,
          toolId: UuidIdSchema,
        }),
        body: z
          .object({
            credentialSourceMcpServerId: UuidIdSchema.nullable().optional(),
            executionSourceMcpServerId: UuidIdSchema.nullable().optional(),
            useDynamicTeamCredential: z.boolean().optional(),
          })
          .nullish(),
        response: constructResponseSchema(z.object({ success: z.boolean() })),
      },
    },
    async (request, reply) => {
      const { mcpGatewayId, toolId } = request.params;
      const {
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        useDynamicTeamCredential,
      } = request.body || {};

      const result = await assignToolToMcpGateway(
        mcpGatewayId,
        toolId,
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        undefined,
        useDynamicTeamCredential,
      );

      if (result && result !== "duplicate" && result !== "updated") {
        throw new ApiError(result.status, result.error.message);
      }

      // Clear chat MCP client cache to ensure fresh tools are fetched
      clearChatMcpClient(mcpGatewayId);

      return reply.send({ success: true });
    },
  );

  fastify.post(
    "/api/mcp-gateways/tools/bulk-assign",
    {
      schema: {
        operationId: RouteId.BulkAssignTools,
        description: "Assign multiple tools to multiple MCP gateways in bulk",
        tags: ["MCP Gateway Tools"],
        body: z.object({
          assignments: z.array(
            z.object({
              mcpGatewayId: UuidIdSchema,
              toolId: UuidIdSchema,
              credentialSourceMcpServerId: UuidIdSchema.nullable().optional(),
              executionSourceMcpServerId: UuidIdSchema.nullable().optional(),
              useDynamicTeamCredential: z.boolean().optional(),
            }),
          ),
        }),
        response: constructResponseSchema(
          z.object({
            succeeded: z.array(
              z.object({
                mcpGatewayId: z.string(),
                toolId: z.string(),
              }),
            ),
            failed: z.array(
              z.object({
                mcpGatewayId: z.string(),
                toolId: z.string(),
                error: z.string(),
              }),
            ),
            duplicates: z.array(
              z.object({
                mcpGatewayId: z.string(),
                toolId: z.string(),
              }),
            ),
          }),
        ),
      },
    },
    async (request, reply) => {
      const { assignments } = request.body;

      // Extract unique IDs for batch fetching to avoid N+1 queries
      const uniqueMcpGatewayIds = [
        ...new Set(assignments.map((a) => a.mcpGatewayId)),
      ];
      const uniqueToolIds = [...new Set(assignments.map((a) => a.toolId))];

      // Batch fetch all required data in parallel
      const [existingMcpGatewayIds, tools] = await Promise.all([
        McpGatewayModel.existsBatch(uniqueMcpGatewayIds),
        ToolModel.getByIds(uniqueToolIds),
      ]);

      // Create maps for efficient lookup
      const toolsMap = new Map(tools.map((tool) => [tool.id, tool]));

      // Extract unique catalog IDs from tools that have them
      const uniqueCatalogIds = [
        ...new Set(
          tools.filter((t) => t.catalogId).map((t) => t.catalogId as string),
        ),
      ];

      // Batch fetch catalog items if needed
      const catalogItemsMap =
        uniqueCatalogIds.length > 0
          ? await InternalMcpCatalogModel.getByIds(uniqueCatalogIds)
          : new Map<string, InternalMcpCatalog>();

      // Prepare pre-fetched data to pass to assignToolToMcpGateway
      const preFetchedData = {
        existingMcpGatewayIds,
        toolsMap,
        catalogItemsMap,
      };

      const results = await Promise.allSettled(
        assignments.map((assignment) =>
          assignToolToMcpGateway(
            assignment.mcpGatewayId,
            assignment.toolId,
            assignment.credentialSourceMcpServerId,
            assignment.executionSourceMcpServerId,
            preFetchedData,
            assignment.useDynamicTeamCredential,
          ),
        ),
      );

      const succeeded: { mcpGatewayId: string; toolId: string }[] = [];
      const failed: { mcpGatewayId: string; toolId: string; error: string }[] =
        [];
      const duplicates: { mcpGatewayId: string; toolId: string }[] = [];

      results.forEach((result, index) => {
        const { mcpGatewayId, toolId } = assignments[index];
        if (result.status === "fulfilled") {
          if (result.value === null || result.value === "updated") {
            succeeded.push({ mcpGatewayId, toolId });
          } else if (result.value === "duplicate") {
            duplicates.push({ mcpGatewayId, toolId });
          } else {
            const error = result.value.error.message || "Unknown error";
            failed.push({ mcpGatewayId, toolId, error });
          }
        } else if (result.status === "rejected") {
          const error =
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error";
          failed.push({ mcpGatewayId, toolId, error });
        }
      });

      // Clear chat MCP client cache for all affected gateways
      const affectedMcpGatewayIds = new Set([
        ...succeeded.map((s) => s.mcpGatewayId),
        ...duplicates.map((d) => d.mcpGatewayId),
      ]);
      for (const mcpGatewayId of affectedMcpGatewayIds) {
        clearChatMcpClient(mcpGatewayId);
      }

      return reply.send({ succeeded, failed, duplicates });
    },
  );

  fastify.post(
    "/api/mcp-gateway-tools/auto-configure-policies",
    {
      schema: {
        operationId: RouteId.AutoConfigureAgentToolPolicies,
        description:
          "Automatically configure security policies for tools using Anthropic LLM analysis",
        tags: ["MCP Gateway Tools"],
        body: z.object({
          toolIds: z.array(z.string().uuid()).min(1),
        }),
        response: constructResponseSchema(
          z.object({
            success: z.boolean(),
            results: z.array(
              z.object({
                toolId: z.string().uuid(),
                success: z.boolean(),
                config: z
                  .object({
                    toolResultTreatment: z.enum([
                      "trusted",
                      "sanitize_with_dual_llm",
                      "untrusted",
                    ]),
                    reasoning: z.string(),
                  })
                  .optional(),
                error: z.string().optional(),
              }),
            ),
          }),
        ),
      },
    },
    async ({ body, organizationId, user }, reply) => {
      const { toolIds } = body;

      logger.info(
        { organizationId, userId: user.id, count: toolIds.length },
        "POST /api/mcp-gateway-tools/auto-configure-policies: request received",
      );

      const available = await toolAutoPolicyService.isAvailable(organizationId);
      if (!available) {
        logger.warn(
          { organizationId, userId: user.id },
          "POST /api/mcp-gateway-tools/auto-configure-policies: service not available",
        );
        throw new ApiError(
          503,
          "Auto-policy requires an organization-wide Anthropic API key to be configured in LLM API Keys settings",
        );
      }

      const result = await toolAutoPolicyService.configurePoliciesForTools(
        toolIds,
        organizationId,
      );

      logger.info(
        {
          organizationId,
          userId: user.id,
          success: result.success,
          resultsCount: result.results.length,
        },
        "POST /api/mcp-gateway-tools/auto-configure-policies: completed",
      );

      return reply.send(result);
    },
  );

  fastify.delete(
    "/api/mcp-gateways/:mcpGatewayId/tools/:toolId",
    {
      schema: {
        operationId: RouteId.UnassignToolFromAgent,
        description: "Unassign a tool from an MCP gateway",
        tags: ["MCP Gateway Tools"],
        params: z.object({
          mcpGatewayId: UuidIdSchema,
          toolId: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { mcpGatewayId, toolId } }, reply) => {
      const success = await McpGatewayToolModel.delete(mcpGatewayId, toolId);

      if (!success) {
        throw new ApiError(404, "MCP gateway tool not found");
      }

      clearChatMcpClient(mcpGatewayId);

      return reply.send({ success });
    },
  );

  fastify.get(
    "/api/mcp-gateways/:mcpGatewayId/tools",
    {
      schema: {
        operationId: RouteId.GetAgentTools,
        description:
          "Get all tools for an MCP gateway (both proxy-sniffed and MCP tools)",
        tags: ["MCP Gateway Tools"],
        params: z.object({
          mcpGatewayId: UuidIdSchema,
        }),
        querystring: z.object({
          excludeLlmProxyOrigin: z.coerce.boolean().optional().default(false),
        }),
        response: constructResponseSchema(z.array(SelectToolSchema)),
      },
    },
    async ({ params: { mcpGatewayId }, query }, reply) => {
      const mcpGateway = await McpGatewayModel.findById(mcpGatewayId);
      if (!mcpGateway) {
        throw new ApiError(
          404,
          `MCP gateway with ID ${mcpGatewayId} not found`,
        );
      }

      const tools = query.excludeLlmProxyOrigin
        ? await ToolModel.getMcpToolsByMcpGateway(mcpGatewayId)
        : await ToolModel.getToolsByMcpGateway(mcpGatewayId);

      return reply.send(tools);
    },
  );

  fastify.patch(
    "/api/mcp-gateway-tools/:id",
    {
      schema: {
        operationId: RouteId.UpdateAgentTool,
        description: "Update an MCP gateway-tool relationship",
        tags: ["MCP Gateway Tools"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: UpdateMcpGatewayToolSchema.pick({
          responseModifierTemplate: true,
          credentialSourceMcpServerId: true,
          executionSourceMcpServerId: true,
          useDynamicTeamCredential: true,
        }).partial(),
        response: constructResponseSchema(UpdateMcpGatewayToolSchema),
      },
    },
    async ({ params: { id }, body }, reply) => {
      const {
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        useDynamicTeamCredential,
      } = body;

      let mcpGatewayToolForValidation:
        | Awaited<
            ReturnType<typeof McpGatewayToolModel.findAll>
          >["data"][number]
        | undefined;

      if (credentialSourceMcpServerId || executionSourceMcpServerId) {
        const mcpGatewayTools = await McpGatewayToolModel.findAll({
          skipPagination: true,
        });
        mcpGatewayToolForValidation = mcpGatewayTools.data.find(
          (at) => at.id === id,
        );

        if (!mcpGatewayToolForValidation) {
          throw new ApiError(
            404,
            `MCP gateway-tool relationship with ID ${id} not found`,
          );
        }
      }

      if (credentialSourceMcpServerId && mcpGatewayToolForValidation) {
        const validationError = await validateCredentialSource(
          mcpGatewayToolForValidation.mcpGateway.id,
          credentialSourceMcpServerId,
        );

        if (validationError) {
          throw new ApiError(
            validationError.status,
            validationError.error.message,
          );
        }
      }

      if (executionSourceMcpServerId && mcpGatewayToolForValidation) {
        const validationError = await validateExecutionSource(
          mcpGatewayToolForValidation.tool.id,
          executionSourceMcpServerId,
        );

        if (validationError) {
          throw new ApiError(
            validationError.status,
            validationError.error.message,
          );
        }
      }

      if (
        executionSourceMcpServerId === null &&
        mcpGatewayToolForValidation &&
        mcpGatewayToolForValidation.tool.catalogId
      ) {
        const catalogItem = await InternalMcpCatalogModel.findById(
          mcpGatewayToolForValidation.tool.catalogId,
          { expandSecrets: false },
        );
        if (
          catalogItem?.serverType === "local" &&
          !executionSourceMcpServerId &&
          !useDynamicTeamCredential
        ) {
          throw new ApiError(
            400,
            "Execution source installation or dynamic team credential is required for local MCP server tools",
          );
        }
        if (
          catalogItem?.serverType === "remote" &&
          !credentialSourceMcpServerId &&
          !useDynamicTeamCredential
        ) {
          throw new ApiError(
            400,
            "Credential source or dynamic team credential is required for remote MCP server tools",
          );
        }
      }

      const mcpGatewayTool = await McpGatewayToolModel.update(id, body);

      if (!mcpGatewayTool) {
        throw new ApiError(
          404,
          `MCP gateway-tool relationship with ID ${id} not found`,
        );
      }

      clearChatMcpClient(mcpGatewayTool.mcpGatewayId);

      return reply.send(mcpGatewayTool);
    },
  );
};

/**
 * Assigns a single tool to a single MCP Gateway with validation.
 * Returns null on success/update, "duplicate" if already exists with same credentials, or an error object if validation fails.
 */
export async function assignToolToMcpGateway(
  mcpGatewayId: string,
  toolId: string,
  credentialSourceMcpServerId: string | null | undefined,
  executionSourceMcpServerId: string | null | undefined,
  preFetchedData?: {
    existingMcpGatewayIds?: Set<string>;
    toolsMap?: Map<string, Tool>;
    catalogItemsMap?: Map<string, InternalMcpCatalog>;
  },
  useDynamicTeamCredential?: boolean,
): Promise<
  | {
      status: 400 | 404;
      error: { message: string; type: string };
    }
  | "duplicate"
  | "updated"
  | null
> {
  let mcpGatewayExists: boolean;
  if (preFetchedData?.existingMcpGatewayIds) {
    mcpGatewayExists = preFetchedData.existingMcpGatewayIds.has(mcpGatewayId);
  } else {
    mcpGatewayExists = await McpGatewayModel.exists(mcpGatewayId);
  }

  if (!mcpGatewayExists) {
    return {
      status: 404,
      error: {
        message: `MCP gateway with ID ${mcpGatewayId} not found`,
        type: "not_found",
      },
    };
  }

  let tool: Tool | null;
  if (preFetchedData?.toolsMap) {
    tool = preFetchedData.toolsMap.get(toolId) || null;
  } else {
    tool = await ToolModel.findById(toolId);
  }

  if (!tool) {
    return {
      status: 404,
      error: {
        message: `Tool with ID ${toolId} not found`,
        type: "not_found",
      },
    };
  }

  if (tool.catalogId) {
    let catalogItem: InternalMcpCatalog | null;
    if (preFetchedData?.catalogItemsMap) {
      catalogItem = preFetchedData.catalogItemsMap.get(tool.catalogId) || null;
    } else {
      catalogItem = await InternalMcpCatalogModel.findById(tool.catalogId, {
        expandSecrets: false,
      });
    }

    if (catalogItem?.serverType === "local") {
      if (!executionSourceMcpServerId && !useDynamicTeamCredential) {
        return {
          status: 400,
          error: {
            message:
              "Execution source installation or dynamic team credential is required for local MCP server tools",
            type: "validation_error",
          },
        };
      }
    }
    if (catalogItem?.serverType === "remote") {
      if (!credentialSourceMcpServerId && !useDynamicTeamCredential) {
        return {
          status: 400,
          error: {
            message:
              "Credential source or dynamic team credential is required for remote MCP server tools",
            type: "validation_error",
          },
        };
      }
    }
  }

  if (credentialSourceMcpServerId) {
    const validationError = await validateCredentialSource(
      mcpGatewayId,
      credentialSourceMcpServerId,
    );

    if (validationError) {
      return validationError;
    }
  }

  if (executionSourceMcpServerId) {
    const validationError = await validateExecutionSource(
      toolId,
      executionSourceMcpServerId,
    );

    if (validationError) {
      return validationError;
    }
  }

  const result = await McpGatewayToolModel.createOrUpdateCredentials(
    mcpGatewayId,
    toolId,
    credentialSourceMcpServerId,
    executionSourceMcpServerId,
    useDynamicTeamCredential,
  );

  if (result.status === "unchanged") {
    return "duplicate";
  }

  if (result.status === "updated") {
    return "updated";
  }

  return null;
}

async function validateCredentialSource(
  mcpGatewayId: string,
  credentialSourceMcpServerId: string,
): Promise<{
  status: 400 | 404;
  error: { message: string; type: string };
} | null> {
  const mcpServer = await McpServerModel.findById(credentialSourceMcpServerId);

  if (!mcpServer) {
    return {
      status: 404,
      error: {
        message: `MCP server with ID ${credentialSourceMcpServerId} not found`,
        type: "not_found",
      },
    };
  }

  const owner = mcpServer.ownerId
    ? await UserModel.getById(mcpServer.ownerId)
    : null;
  if (!owner) {
    return {
      status: 400,
      error: {
        message: "Personal token owner not found",
        type: "validation_error",
      },
    };
  }

  const hasAccess = await McpGatewayTeamModel.userHasMcpGatewayAccess(
    owner.id,
    mcpGatewayId,
    true,
  );

  if (!hasAccess) {
    return {
      status: 400,
      error: {
        message:
          "The credential owner must be a member of a team that this MCP gateway is assigned to",
        type: "validation_error",
      },
    };
  }

  return null;
}

async function validateExecutionSource(
  toolId: string,
  executionSourceMcpServerId: string,
): Promise<{
  status: 400 | 404;
  error: { message: string; type: string };
} | null> {
  const mcpServer = await McpServerModel.findById(executionSourceMcpServerId);
  if (!mcpServer) {
    return {
      status: 404,
      error: { message: "MCP server not found", type: "not_found" },
    };
  }

  const tool = await ToolModel.findById(toolId);
  if (!tool) {
    return {
      status: 404,
      error: { message: "Tool not found", type: "not_found" },
    };
  }

  if (tool.catalogId !== mcpServer.catalogId) {
    return {
      status: 400,
      error: {
        message: "Execution source must be from the same catalog as the tool",
        type: "validation_error",
      },
    };
  }

  return null;
}

export default mcpGatewayToolRoutes;
