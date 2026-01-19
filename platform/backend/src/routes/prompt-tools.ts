import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasPermission } from "@/auth";
import {
  InternalMcpCatalogModel,
  LlmProxyTeamModel,
  McpServerModel,
  PromptModel,
  PromptToolModel,
  ToolModel,
  UserModel,
} from "@/models";
import type { InternalMcpCatalog, Tool } from "@/types";
import {
  ApiError,
  constructResponseSchema,
  createPaginatedResponseSchema,
  DeleteObjectResponseSchema,
  PaginationQuerySchema,
  PromptToolFilterSchema,
  PromptToolSortBySchema,
  PromptToolSortDirectionSchema,
  SelectPromptToolSchema,
  SelectToolSchema,
  UpdatePromptToolSchema,
  UuidIdSchema,
} from "@/types";

const promptToolRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/prompt-tools",
    {
      schema: {
        operationId: RouteId.GetAllPromptTools,
        description:
          "Get all prompt-tool relationships with pagination, sorting, and filtering",
        tags: ["Prompt Tools"],
        querystring: PromptToolFilterSchema.extend({
          sortBy: PromptToolSortBySchema.optional(),
          sortDirection: PromptToolSortDirectionSchema.optional(),
          skipPagination: z.coerce.boolean().optional(),
        }).merge(PaginationQuerySchema),
        response: constructResponseSchema(
          createPaginatedResponseSchema(SelectPromptToolSchema),
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
          promptId,
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
      const { success: isLlmProxyAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );

      const result = await PromptToolModel.findAll({
        pagination: { limit, offset },
        sorting: { sortBy, sortDirection },
        filters: {
          search,
          promptId,
          origin,
          mcpServerOwnerId,
          excludeArchestraTools,
        },
        userId: user.id,
        isLlmProxyAdmin,
        skipPagination,
      });

      return reply.send(result);
    },
  );

  fastify.get(
    "/api/prompts/:promptId/assigned-tools",
    {
      schema: {
        operationId: RouteId.GetPromptAssignedTools,
        description:
          "Get all tools directly assigned to a prompt (for A2A/Chat execution)",
        tags: ["Prompt Tools"],
        params: z.object({
          promptId: UuidIdSchema,
        }),
        querystring: z.object({
          excludeLlmProxyOrigin: z.coerce.boolean().optional().default(false),
        }),
        response: constructResponseSchema(z.array(SelectToolSchema)),
      },
    },
    async ({ params: { promptId }, query, organizationId }, reply) => {
      const prompt = await PromptModel.findByIdAndOrganizationId(
        promptId,
        organizationId,
      );
      if (!prompt) {
        throw new ApiError(404, `Prompt with ID ${promptId} not found`);
      }

      const tools = query.excludeLlmProxyOrigin
        ? await ToolModel.getMcpToolsByPrompt(promptId)
        : await ToolModel.getToolsByPrompt(promptId);

      return reply.send(tools);
    },
  );

  fastify.post(
    "/api/prompts/:promptId/tools/:toolId",
    {
      schema: {
        operationId: RouteId.AssignToolToPrompt,
        description: "Assign a tool to a prompt",
        tags: ["Prompt Tools"],
        params: z.object({
          promptId: UuidIdSchema,
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
      const { promptId, toolId } = request.params;
      const {
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        useDynamicTeamCredential,
      } = request.body || {};

      const result = await assignToolToPrompt(
        promptId,
        toolId,
        request.organizationId,
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        undefined,
        useDynamicTeamCredential,
      );

      if (result && result !== "duplicate" && result !== "updated") {
        throw new ApiError(result.status, result.error.message);
      }

      return reply.send({ success: true });
    },
  );

  fastify.post(
    "/api/prompts/tools/bulk-assign",
    {
      schema: {
        operationId: RouteId.BulkAssignToolsToPrompts,
        description: "Assign multiple tools to multiple prompts in bulk",
        tags: ["Prompt Tools"],
        body: z.object({
          assignments: z.array(
            z.object({
              promptId: UuidIdSchema,
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
                promptId: z.string(),
                toolId: z.string(),
              }),
            ),
            failed: z.array(
              z.object({
                promptId: z.string(),
                toolId: z.string(),
                error: z.string(),
              }),
            ),
            duplicates: z.array(
              z.object({
                promptId: z.string(),
                toolId: z.string(),
              }),
            ),
          }),
        ),
      },
    },
    async (request, reply) => {
      const { assignments } = request.body;
      const { organizationId } = request;

      // Extract unique IDs for batch fetching to avoid N+1 queries
      const uniquePromptIds = [...new Set(assignments.map((a) => a.promptId))];
      const uniqueToolIds = [...new Set(assignments.map((a) => a.toolId))];

      // Batch fetch all required data in parallel
      const [prompts, tools] = await Promise.all([
        Promise.all(
          uniquePromptIds.map((id) =>
            PromptModel.findByIdAndOrganizationId(id, organizationId),
          ),
        ),
        ToolModel.getByIds(uniqueToolIds),
      ]);

      // Create maps for efficient lookup
      const existingPromptIds = new Set(
        prompts
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .map((p) => p.id),
      );
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

      // Prepare pre-fetched data to pass to assignToolToPrompt
      const preFetchedData = {
        existingPromptIds,
        toolsMap,
        catalogItemsMap,
      };

      const results = await Promise.allSettled(
        assignments.map((assignment) =>
          assignToolToPrompt(
            assignment.promptId,
            assignment.toolId,
            organizationId,
            assignment.credentialSourceMcpServerId,
            assignment.executionSourceMcpServerId,
            preFetchedData,
            assignment.useDynamicTeamCredential,
          ),
        ),
      );

      const succeeded: { promptId: string; toolId: string }[] = [];
      const failed: { promptId: string; toolId: string; error: string }[] = [];
      const duplicates: { promptId: string; toolId: string }[] = [];

      results.forEach((result, index) => {
        const { promptId, toolId } = assignments[index];
        if (result.status === "fulfilled") {
          if (result.value === null || result.value === "updated") {
            succeeded.push({ promptId, toolId });
          } else if (result.value === "duplicate") {
            duplicates.push({ promptId, toolId });
          } else {
            const error = result.value.error.message || "Unknown error";
            failed.push({ promptId, toolId, error });
          }
        } else if (result.status === "rejected") {
          const error =
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error";
          failed.push({ promptId, toolId, error });
        }
      });

      return reply.send({ succeeded, failed, duplicates });
    },
  );

  fastify.delete(
    "/api/prompts/:promptId/tools/:toolId",
    {
      schema: {
        operationId: RouteId.UnassignToolFromPrompt,
        description: "Unassign a tool from a prompt",
        tags: ["Prompt Tools"],
        params: z.object({
          promptId: UuidIdSchema,
          toolId: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { promptId, toolId }, organizationId }, reply) => {
      // Verify prompt belongs to organization
      const prompt = await PromptModel.findByIdAndOrganizationId(
        promptId,
        organizationId,
      );
      if (!prompt) {
        throw new ApiError(404, "Prompt not found");
      }

      const success = await PromptToolModel.delete(promptId, toolId);

      if (!success) {
        throw new ApiError(404, "Prompt tool not found");
      }

      return reply.send({ success });
    },
  );

  fastify.patch(
    "/api/prompt-tools/:id",
    {
      schema: {
        operationId: RouteId.UpdatePromptTool,
        description: "Update a prompt-tool relationship",
        tags: ["Prompt Tools"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: UpdatePromptToolSchema.pick({
          responseModifierTemplate: true,
          credentialSourceMcpServerId: true,
          executionSourceMcpServerId: true,
          useDynamicTeamCredential: true,
        }).partial(),
        response: constructResponseSchema(UpdatePromptToolSchema),
      },
    },
    async ({ params: { id }, body, organizationId }, reply) => {
      const {
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        useDynamicTeamCredential,
      } = body;

      let promptToolForValidation:
        | Awaited<ReturnType<typeof PromptToolModel.findAll>>["data"][number]
        | undefined;

      if (credentialSourceMcpServerId || executionSourceMcpServerId) {
        const promptTools = await PromptToolModel.findAll({
          skipPagination: true,
        });
        promptToolForValidation = promptTools.data.find((pt) => pt.id === id);

        if (!promptToolForValidation) {
          throw new ApiError(
            404,
            `Prompt-tool relationship with ID ${id} not found`,
          );
        }

        // Verify prompt belongs to organization
        const prompt = await PromptModel.findByIdAndOrganizationId(
          promptToolForValidation.prompt.id,
          organizationId,
        );
        if (!prompt) {
          throw new ApiError(404, "Prompt not found");
        }
      }

      if (credentialSourceMcpServerId && promptToolForValidation) {
        const validationError = await validateCredentialSourceForPrompt(
          promptToolForValidation.prompt.id,
          credentialSourceMcpServerId,
        );

        if (validationError) {
          throw new ApiError(
            validationError.status,
            validationError.error.message,
          );
        }
      }

      if (executionSourceMcpServerId && promptToolForValidation) {
        const validationError = await validateExecutionSource(
          promptToolForValidation.tool.id,
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
        promptToolForValidation &&
        promptToolForValidation.tool.catalogId
      ) {
        const catalogItem = await InternalMcpCatalogModel.findById(
          promptToolForValidation.tool.catalogId,
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

      const promptTool = await PromptToolModel.update(id, body);

      if (!promptTool) {
        throw new ApiError(
          404,
          `Prompt-tool relationship with ID ${id} not found`,
        );
      }

      return reply.send(promptTool);
    },
  );

  fastify.post(
    "/api/prompts/:promptId/tools/sync",
    {
      schema: {
        operationId: RouteId.SyncPromptTools,
        description:
          "Sync tool assignments for a prompt (replaces all existing assignments)",
        tags: ["Prompt Tools"],
        params: z.object({
          promptId: UuidIdSchema,
        }),
        body: z.object({
          toolIds: z.array(UuidIdSchema),
        }),
        response: constructResponseSchema(
          z.object({
            added: z.number(),
            removed: z.number(),
          }),
        ),
      },
    },
    async (
      { params: { promptId }, body: { toolIds }, organizationId },
      reply,
    ) => {
      // Verify prompt belongs to organization
      const prompt = await PromptModel.findByIdAndOrganizationId(
        promptId,
        organizationId,
      );
      if (!prompt) {
        throw new ApiError(404, "Prompt not found");
      }

      const result = await PromptToolModel.syncToolsForPrompt(
        promptId,
        toolIds,
      );

      return reply.send(result);
    },
  );
};

/**
 * Assigns a single tool to a single prompt with validation.
 * Returns null on success/update, "duplicate" if already exists with same credentials, or an error object if validation fails.
 */
export async function assignToolToPrompt(
  promptId: string,
  toolId: string,
  organizationId: string,
  credentialSourceMcpServerId: string | null | undefined,
  executionSourceMcpServerId: string | null | undefined,
  preFetchedData?: {
    existingPromptIds?: Set<string>;
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
  let promptExists: boolean;
  if (preFetchedData?.existingPromptIds) {
    promptExists = preFetchedData.existingPromptIds.has(promptId);
  } else {
    const prompt = await PromptModel.findByIdAndOrganizationId(
      promptId,
      organizationId,
    );
    promptExists = prompt !== null;
  }

  if (!promptExists) {
    return {
      status: 404,
      error: {
        message: `Prompt with ID ${promptId} not found`,
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
    const validationError = await validateCredentialSourceForPrompt(
      promptId,
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

  const result = await PromptToolModel.createOrUpdateCredentials(
    promptId,
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

async function validateCredentialSourceForPrompt(
  promptId: string,
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

  // Get the prompt's LLM Proxy ID to check team access
  const prompt = await PromptModel.findById(promptId);
  if (!prompt?.llmProxyId) {
    return {
      status: 400,
      error: {
        message: "Prompt does not have an associated LLM Proxy",
        type: "validation_error",
      },
    };
  }

  // Check if the credential owner has access to the prompt's LLM Proxy
  const hasAccess = await LlmProxyTeamModel.userHasLlmProxyAccess(
    owner.id,
    prompt.llmProxyId,
    true,
  );

  if (!hasAccess) {
    return {
      status: 400,
      error: {
        message:
          "The credential owner must be a member of a team that has access to this prompt's LLM Proxy",
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

export default promptToolRoutes;
