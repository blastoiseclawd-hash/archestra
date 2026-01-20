import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasPermission } from "@/auth";
import { clearChatMcpClient } from "@/clients/chat-mcp-client";
import logger from "@/logging";
import {
  InternalMcpCatalogModel,
  McpServerModel,
  ProfileModel,
  ProfileTeamModel,
  ProfileToolModel,
  ToolModel,
  UserModel,
} from "@/models";
import { toolAutoPolicyService } from "@/models/profile-tool-auto-policy";
import type { InternalMcpCatalog, Tool } from "@/types";
import {
  ApiError,
  constructResponseSchema,
  createPaginatedResponseSchema,
  DeleteObjectResponseSchema,
  PaginationQuerySchema,
  ProfileToolFilterSchema,
  ProfileToolSortBySchema,
  ProfileToolSortDirectionSchema,
  SelectProfileToolSchema,
  SelectToolSchema,
  UpdateProfileToolSchema,
  UuidIdSchema,
} from "@/types";

const profileToolRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/profile-tools",
    {
      schema: {
        operationId: RouteId.GetAllProfileTools,
        description:
          "Get all profile-tool relationships with pagination, sorting, and filtering",
        tags: ["Profile Tools"],
        querystring: ProfileToolFilterSchema.extend({
          sortBy: ProfileToolSortBySchema.optional(),
          sortDirection: ProfileToolSortDirectionSchema.optional(),
          skipPagination: z.coerce.boolean().optional(),
        }).merge(PaginationQuerySchema),
        response: constructResponseSchema(
          createPaginatedResponseSchema(SelectProfileToolSchema),
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
          profileId,
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
      const { success: isProfileAdmin } = await hasPermission(
        { profile: ["admin"] },
        headers,
      );

      const result = await ProfileToolModel.findAll({
        pagination: { limit, offset },
        sorting: { sortBy, sortDirection },
        filters: {
          search,
          profileId,
          origin,
          mcpServerOwnerId,
          excludeArchestraTools,
        },
        userId: user.id,
        isProfileAdmin,
        skipPagination,
      });

      return reply.send(result);
    },
  );

  fastify.post(
    "/api/profiles/:profileId/tools/:toolId",
    {
      schema: {
        operationId: RouteId.AssignToolToProfile,
        description: "Assign a tool to a profile",
        tags: ["Profile Tools"],
        params: z.object({
          profileId: UuidIdSchema,
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
      const { profileId, toolId } = request.params;
      const {
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        useDynamicTeamCredential,
      } = request.body || {};

      const result = await assignToolToProfile(
        profileId,
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
      clearChatMcpClient(profileId);

      // Return success for new assignments, duplicates, and updates
      return reply.send({ success: true });
    },
  );

  fastify.post(
    "/api/profiles/tools/bulk-assign",
    {
      schema: {
        operationId: RouteId.BulkAssignTools,
        description: "Assign multiple tools to multiple profiles in bulk",
        tags: ["Profile Tools"],
        body: z.object({
          assignments: z.array(
            z.object({
              profileId: UuidIdSchema,
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
                profileId: z.string(),
                toolId: z.string(),
              }),
            ),
            failed: z.array(
              z.object({
                profileId: z.string(),
                toolId: z.string(),
                error: z.string(),
              }),
            ),
            duplicates: z.array(
              z.object({
                profileId: z.string(),
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
      const uniqueProfileIds = [
        ...new Set(assignments.map((a) => a.profileId)),
      ];
      const uniqueToolIds = [...new Set(assignments.map((a) => a.toolId))];

      // Batch fetch all required data in parallel
      const [existingProfileIds, tools] = await Promise.all([
        ProfileModel.existsBatch(uniqueProfileIds),
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

      // Prepare pre-fetched data to pass to assignToolToProfile
      const preFetchedData = {
        existingProfileIds,
        toolsMap,
        catalogItemsMap,
      };

      const results = await Promise.allSettled(
        assignments.map((assignment) =>
          assignToolToProfile(
            assignment.profileId,
            assignment.toolId,
            assignment.credentialSourceMcpServerId,
            assignment.executionSourceMcpServerId,
            preFetchedData,
            assignment.useDynamicTeamCredential,
          ),
        ),
      );

      const succeeded: { profileId: string; toolId: string }[] = [];
      const failed: { profileId: string; toolId: string; error: string }[] = [];
      const duplicates: { profileId: string; toolId: string }[] = [];

      results.forEach((result, index) => {
        const { profileId, toolId } = assignments[index];
        if (result.status === "fulfilled") {
          if (result.value === null || result.value === "updated") {
            // Success (created or updated credentials)
            succeeded.push({ profileId, toolId });
          } else if (result.value === "duplicate") {
            // Already assigned with same credentials
            duplicates.push({ profileId, toolId });
          } else {
            // Validation error
            const error = result.value.error.message || "Unknown error";
            failed.push({ profileId, toolId, error });
          }
        } else if (result.status === "rejected") {
          // Runtime error
          const error =
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error";
          failed.push({ profileId, toolId, error });
        }
      });

      // Clear chat MCP client cache for all affected profiles
      const affectedProfileIds = new Set([
        ...succeeded.map((s) => s.profileId),
        ...duplicates.map((d) => d.profileId),
      ]);
      for (const profileId of affectedProfileIds) {
        clearChatMcpClient(profileId);
      }

      return reply.send({ succeeded, failed, duplicates });
    },
  );

  fastify.post(
    "/api/profile-tools/auto-configure-policies",
    {
      schema: {
        operationId: RouteId.AutoConfigureProfileToolPolicies,
        description:
          "Automatically configure security policies for tools using Anthropic LLM analysis",
        tags: ["Profile Tools"],
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
        "POST /api/profile-tools/auto-configure-policies: request received",
      );

      // Check if service is available for this organization
      const available = await toolAutoPolicyService.isAvailable(organizationId);
      if (!available) {
        logger.warn(
          { organizationId, userId: user.id },
          "POST /api/profile-tools/auto-configure-policies: service not available",
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
        "POST /api/profile-tools/auto-configure-policies: completed",
      );

      return reply.send(result);
    },
  );

  fastify.delete(
    "/api/profiles/:profileId/tools/:toolId",
    {
      schema: {
        operationId: RouteId.UnassignToolFromProfile,
        description: "Unassign a tool from a profile",
        tags: ["Profile Tools"],
        params: z.object({
          profileId: UuidIdSchema,
          toolId: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { profileId, toolId } }, reply) => {
      const success = await ProfileToolModel.delete(profileId, toolId);

      if (!success) {
        throw new ApiError(404, "Profile tool not found");
      }

      // Clear chat MCP client cache to ensure fresh tools are fetched
      clearChatMcpClient(profileId);

      return reply.send({ success });
    },
  );

  fastify.get(
    "/api/profiles/:profileId/tools",
    {
      schema: {
        operationId: RouteId.GetProfileTools,
        description:
          "Get all tools for a profile (both proxy-sniffed and MCP tools)",
        tags: ["Profile Tools"],
        params: z.object({
          profileId: UuidIdSchema,
        }),
        querystring: z.object({
          excludeLlmProxyOrigin: z.coerce.boolean().optional().default(false),
        }),
        response: constructResponseSchema(z.array(SelectToolSchema)),
      },
    },
    async ({ params: { profileId }, query }, reply) => {
      // Validate that profile exists
      const profile = await ProfileModel.findById(profileId);
      if (!profile) {
        throw new ApiError(404, `Profile with ID ${profileId} not found`);
      }

      const tools = query.excludeLlmProxyOrigin
        ? await ToolModel.getMcpToolsByProfile(profileId)
        : await ToolModel.getToolsByProfile(profileId);

      return reply.send(tools);
    },
  );

  fastify.patch(
    "/api/profile-tools/:id",
    {
      schema: {
        operationId: RouteId.UpdateProfileTool,
        description: "Update a profile-tool relationship",
        tags: ["Profile Tools"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: UpdateProfileToolSchema.pick({
          responseModifierTemplate: true,
          credentialSourceMcpServerId: true,
          executionSourceMcpServerId: true,
          useDynamicTeamCredential: true,
        }).partial(),
        response: constructResponseSchema(UpdateProfileToolSchema),
      },
    },
    async ({ params: { id }, body }, reply) => {
      const {
        credentialSourceMcpServerId,
        executionSourceMcpServerId,
        useDynamicTeamCredential,
      } = body;

      // Get the profile-tool relationship for validation (needed for both credential and execution source)
      let profileToolForValidation:
        | Awaited<ReturnType<typeof ProfileToolModel.findAll>>["data"][number]
        | undefined;

      if (credentialSourceMcpServerId || executionSourceMcpServerId) {
        const profileTools = await ProfileToolModel.findAll({
          skipPagination: true,
        });
        profileToolForValidation = profileTools.data.find((pt) => pt.id === id);

        if (!profileToolForValidation) {
          throw new ApiError(
            404,
            `Profile-tool relationship with ID ${id} not found`,
          );
        }
      }

      // If credentialSourceMcpServerId is being updated, validate it
      if (credentialSourceMcpServerId && profileToolForValidation) {
        const validationError = await validateCredentialSource(
          profileToolForValidation.profile.id,
          credentialSourceMcpServerId,
        );

        if (validationError) {
          throw new ApiError(
            validationError.status,
            validationError.error.message,
          );
        }
      }

      // If executionSourceMcpServerId is being updated, validate it
      if (executionSourceMcpServerId && profileToolForValidation) {
        const validationError = await validateExecutionSource(
          profileToolForValidation.tool.id,
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
        profileToolForValidation &&
        profileToolForValidation.tool.catalogId
      ) {
        // Only need serverType for validation, no secrets needed
        const catalogItem = await InternalMcpCatalogModel.findById(
          profileToolForValidation.tool.catalogId,
          { expandSecrets: false },
        );
        // Check if tool is from local server and executionSourceMcpServerId is being set to null
        // (allowed if useDynamicTeamCredential is being set to true)
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
        // Check if tool is from remote server and credentialSourceMcpServerId is being set to null
        // (allowed if useDynamicTeamCredential is being set to true)
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

      const profileTool = await ProfileToolModel.update(id, body);

      if (!profileTool) {
        throw new ApiError(
          404,
          `Profile-tool relationship with ID ${id} not found`,
        );
      }

      // Clear chat MCP client cache to ensure fresh tools are fetched
      clearChatMcpClient(profileTool.profileId);

      return reply.send(profileTool);
    },
  );
};

/**
 * Assigns a single tool to a single profile with validation.
 * Returns null on success/update, "duplicate" if already exists with same credentials, or an error object if validation fails.
 *
 * @param preFetchedData - Optional pre-fetched data to avoid N+1 queries in bulk operations
 */
export async function assignToolToProfile(
  profileId: string,
  toolId: string,
  credentialSourceMcpServerId: string | null | undefined,
  executionSourceMcpServerId: string | null | undefined,
  preFetchedData?: {
    existingProfileIds?: Set<string>;
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
  // Validate that profile exists (using pre-fetched data or lightweight exists() to avoid N+1 queries)
  let profileExists: boolean;
  if (preFetchedData?.existingProfileIds) {
    profileExists = preFetchedData.existingProfileIds.has(profileId);
  } else {
    profileExists = await ProfileModel.exists(profileId);
  }

  if (!profileExists) {
    return {
      status: 404,
      error: {
        message: `Profile with ID ${profileId} not found`,
        type: "not_found",
      },
    };
  }

  // Validate that tool exists (using pre-fetched data to avoid N+1 queries)
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

  // Check if tool is from local server (requires executionSourceMcpServerId)
  if (tool.catalogId) {
    let catalogItem: InternalMcpCatalog | null;
    if (preFetchedData?.catalogItemsMap) {
      catalogItem = preFetchedData.catalogItemsMap.get(tool.catalogId) || null;
    } else {
      // Only need serverType for validation, no secrets needed
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
    // Check if tool is from remote server (requires credentialSourceMcpServerId OR useDynamicTeamCredential)
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

  // If a credential source is specified, validate it
  if (credentialSourceMcpServerId) {
    const validationError = await validateCredentialSource(
      profileId,
      credentialSourceMcpServerId,
    );

    if (validationError) {
      return validationError;
    }
  }

  // If an execution source is specified, validate it
  if (executionSourceMcpServerId) {
    const validationError = await validateExecutionSource(
      toolId,
      executionSourceMcpServerId,
    );

    if (validationError) {
      return validationError;
    }
  }

  // Create or update the assignment with credentials
  const result = await ProfileToolModel.createOrUpdateCredentials(
    profileId,
    toolId,
    credentialSourceMcpServerId,
    executionSourceMcpServerId,
    useDynamicTeamCredential,
  );

  // Return appropriate status
  if (result.status === "unchanged") {
    return "duplicate";
  }

  if (result.status === "updated") {
    return "updated";
  }

  return null; // created
}

/**
 * Validates that a credentialSourceMcpServerId is valid for the given profile.
 * Returns an error object if validation fails, or null if valid.
 *
 * Validation rules:
 * - (Admin): Admins can use their personal tokens with any profile
 * - Team token: Profile and MCP server must share at least one team
 * - Personal token (Member): Token owner must belong to a team that the profile is assigned to
 */
async function validateCredentialSource(
  profileId: string,
  credentialSourceMcpServerId: string,
): Promise<{
  status: 400 | 404;
  error: { message: string; type: string };
} | null> {
  // Check that the MCP server exists
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

  // Get the token owner's details
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

  // Check if the owner has access to the profile (either directly or through teams)
  const hasAccess = await ProfileTeamModel.userHasProfileAccess(
    owner.id,
    profileId,
    true,
  );

  if (!hasAccess) {
    return {
      status: 400,
      error: {
        message:
          "The credential owner must be a member of a team that this profile is assigned to",
        type: "validation_error",
      },
    };
  }

  return null;
}

/**
 * Validates that an executionSourceMcpServerId is valid for the given tool.
 * Returns an error object if validation fails, or null if valid.
 *
 * Validation rules:
 * - MCP server must exist
 * - Tool must exist
 * - Execution source must be from the same catalog as the tool (catalog compatibility)
 */
async function validateExecutionSource(
  toolId: string,
  executionSourceMcpServerId: string,
): Promise<{
  status: 400 | 404;
  error: { message: string; type: string };
} | null> {
  // 1. Check MCP server exists
  const mcpServer = await McpServerModel.findById(executionSourceMcpServerId);
  if (!mcpServer) {
    return {
      status: 404,
      error: { message: "MCP server not found", type: "not_found" },
    };
  }

  // 2. Get tool and verify catalog compatibility
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

export default profileToolRoutes;
