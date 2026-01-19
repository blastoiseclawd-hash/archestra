import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import db, { schema } from "@/database";
import {
  createPaginatedResult,
  type PaginatedResult,
} from "@/database/utils/pagination";
import logger from "@/logging";
import type {
  InsertPromptTool,
  PaginationQuery,
  PromptTool,
  PromptToolFilters,
  PromptToolSortBy,
  PromptToolSortDirection,
  UpdatePromptTool,
} from "@/types";
import LlmProxyTeamModel from "./llm-proxy-team";

/**
 * Model for managing prompt-tool assignments.
 * Used for direct tool assignment to prompts for A2A and Chat execution.
 *
 * Access control: Users can access prompt tools based on their access
 * to the prompt's associated LLM Proxy (via llmProxyId → team membership).
 */
class PromptToolModel {
  static async create(
    promptId: string,
    toolId: string,
    options?: Partial<
      Pick<
        InsertPromptTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
        | "useDynamicTeamCredential"
      >
    >,
  ) {
    const [promptTool] = await db
      .insert(schema.promptToolsTable)
      .values({
        promptId,
        toolId,
        ...options,
      })
      .returning();

    // Auto-configure policies if enabled (run in background)
    const { toolAutoPolicyService } = await import("./agent-tool-auto-policy");
    const { default: OrganizationModel } = await import("./organization");

    // Get prompt's organization via llmProxyId → team relationship and trigger auto-configure in background
    db.select({
      llmProxyId: schema.promptsTable.llmProxyId,
      organizationId: schema.promptsTable.organizationId,
    })
      .from(schema.promptsTable)
      .where(eq(schema.promptsTable.id, promptId))
      .limit(1)
      .then(async (rows) => {
        if (rows.length === 0) return;

        const organizationId = rows[0].organizationId;
        const organization = await OrganizationModel.getById(organizationId);

        if (organization?.autoConfigureNewTools) {
          await toolAutoPolicyService.configurePoliciesForToolWithTimeout(
            toolId,
            organizationId,
          );
        }
      })
      .catch((error) => {
        logger.error(
          {
            promptToolId: promptTool.id,
            promptId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to trigger auto-configure for new prompt-tool",
        );
      });

    return promptTool;
  }

  static async delete(promptId: string, toolId: string): Promise<boolean> {
    const result = await db
      .delete(schema.promptToolsTable)
      .where(
        and(
          eq(schema.promptToolsTable.promptId, promptId),
          eq(schema.promptToolsTable.toolId, toolId),
        ),
      );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async findToolIdsByPrompt(promptId: string): Promise<string[]> {
    const results = await db
      .select({ toolId: schema.promptToolsTable.toolId })
      .from(schema.promptToolsTable)
      .where(eq(schema.promptToolsTable.promptId, promptId));
    return results.map((r) => r.toolId);
  }

  static async findPromptIdsByTool(toolId: string): Promise<string[]> {
    const results = await db
      .select({ promptId: schema.promptToolsTable.promptId })
      .from(schema.promptToolsTable)
      .where(eq(schema.promptToolsTable.toolId, toolId));
    return results.map((r) => r.promptId);
  }

  static async findAllAssignedToolIds(): Promise<string[]> {
    const results = await db
      .select({ toolId: schema.promptToolsTable.toolId })
      .from(schema.promptToolsTable);
    return [...new Set(results.map((r) => r.toolId))];
  }

  static async exists(promptId: string, toolId: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(schema.promptToolsTable)
      .where(
        and(
          eq(schema.promptToolsTable.promptId, promptId),
          eq(schema.promptToolsTable.toolId, toolId),
        ),
      )
      .limit(1);
    return !!result;
  }

  static async createIfNotExists(
    promptId: string,
    toolId: string,
    credentialSourceMcpServerId?: string | null,
    executionSourceMcpServerId?: string | null,
  ) {
    const exists = await PromptToolModel.exists(promptId, toolId);
    if (!exists) {
      const options: Partial<
        Pick<
          InsertPromptTool,
          | "responseModifierTemplate"
          | "credentialSourceMcpServerId"
          | "executionSourceMcpServerId"
        >
      > = {};

      if (credentialSourceMcpServerId) {
        options.credentialSourceMcpServerId = credentialSourceMcpServerId;
      }

      if (executionSourceMcpServerId) {
        options.executionSourceMcpServerId = executionSourceMcpServerId;
      }

      return await PromptToolModel.create(promptId, toolId, options);
    }
    return null;
  }

  /**
   * Bulk create prompt-tool relationships in one query to avoid N+1
   */
  static async createManyIfNotExists(
    promptId: string,
    toolIds: string[],
  ): Promise<void> {
    if (toolIds.length === 0) return;

    // Check which tools are already assigned
    const existingAssignments = await db
      .select({ toolId: schema.promptToolsTable.toolId })
      .from(schema.promptToolsTable)
      .where(
        and(
          eq(schema.promptToolsTable.promptId, promptId),
          inArray(schema.promptToolsTable.toolId, toolIds),
        ),
      );

    const existingToolIds = new Set(existingAssignments.map((a) => a.toolId));
    const newToolIds = toolIds.filter((toolId) => !existingToolIds.has(toolId));

    if (newToolIds.length > 0) {
      await db.insert(schema.promptToolsTable).values(
        newToolIds.map((toolId) => ({
          promptId,
          toolId,
        })),
      );
    }
  }

  /**
   * Bulk create prompt-tool relationships for multiple prompts and tools
   * Assigns all tools to all prompts in a single query to avoid N+1
   */
  static async bulkCreateForPromptsAndTools(
    promptIds: string[],
    toolIds: string[],
    options?: Partial<
      Pick<
        InsertPromptTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
      >
    >,
  ): Promise<void> {
    if (promptIds.length === 0 || toolIds.length === 0) return;

    // Build all possible combinations
    const assignments: Array<{
      promptId: string;
      toolId: string;
      responseModifierTemplate?: string | null;
      credentialSourceMcpServerId?: string | null;
      executionSourceMcpServerId?: string | null;
    }> = [];

    for (const promptId of promptIds) {
      for (const toolId of toolIds) {
        assignments.push({
          promptId,
          toolId,
          ...options,
        });
      }
    }

    // Check which assignments already exist
    const existingAssignments = await db
      .select({
        promptId: schema.promptToolsTable.promptId,
        toolId: schema.promptToolsTable.toolId,
      })
      .from(schema.promptToolsTable)
      .where(
        and(
          inArray(schema.promptToolsTable.promptId, promptIds),
          inArray(schema.promptToolsTable.toolId, toolIds),
        ),
      );

    const existingSet = new Set(
      existingAssignments.map((a) => `${a.promptId}:${a.toolId}`),
    );

    // Filter out existing assignments
    const newAssignments = assignments.filter(
      (a) => !existingSet.has(`${a.promptId}:${a.toolId}`),
    );

    if (newAssignments.length > 0) {
      await db
        .insert(schema.promptToolsTable)
        .values(newAssignments)
        .onConflictDoNothing();
    }
  }

  /**
   * Creates a new prompt-tool assignment or updates credentials if it already exists.
   * Returns the status: "created", "updated", or "unchanged".
   */
  static async createOrUpdateCredentials(
    promptId: string,
    toolId: string,
    credentialSourceMcpServerId?: string | null,
    executionSourceMcpServerId?: string | null,
    useDynamicTeamCredential?: boolean,
  ): Promise<{ status: "created" | "updated" | "unchanged" }> {
    // Check if assignment already exists
    const [existing] = await db
      .select()
      .from(schema.promptToolsTable)
      .where(
        and(
          eq(schema.promptToolsTable.promptId, promptId),
          eq(schema.promptToolsTable.toolId, toolId),
        ),
      )
      .limit(1);

    if (!existing) {
      // Create new assignment
      const options: Partial<
        Pick<
          InsertPromptTool,
          | "responseModifierTemplate"
          | "credentialSourceMcpServerId"
          | "executionSourceMcpServerId"
          | "useDynamicTeamCredential"
        >
      > = {};

      if (credentialSourceMcpServerId) {
        options.credentialSourceMcpServerId = credentialSourceMcpServerId;
      }

      if (executionSourceMcpServerId) {
        options.executionSourceMcpServerId = executionSourceMcpServerId;
      }

      if (useDynamicTeamCredential !== undefined) {
        options.useDynamicTeamCredential = useDynamicTeamCredential;
      }

      await PromptToolModel.create(promptId, toolId, options);
      return { status: "created" };
    }

    // Check if credentials need updating
    const needsUpdate =
      existing.credentialSourceMcpServerId !==
        (credentialSourceMcpServerId ?? null) ||
      existing.executionSourceMcpServerId !==
        (executionSourceMcpServerId ?? null) ||
      (useDynamicTeamCredential !== undefined &&
        existing.useDynamicTeamCredential !== useDynamicTeamCredential);

    if (needsUpdate) {
      // Update credentials
      const updateData: Partial<
        Pick<
          UpdatePromptTool,
          | "credentialSourceMcpServerId"
          | "executionSourceMcpServerId"
          | "useDynamicTeamCredential"
        >
      > = {};

      updateData.credentialSourceMcpServerId =
        credentialSourceMcpServerId ?? null;
      updateData.executionSourceMcpServerId =
        executionSourceMcpServerId ?? null;

      if (useDynamicTeamCredential !== undefined) {
        updateData.useDynamicTeamCredential = useDynamicTeamCredential;
      }

      await PromptToolModel.update(existing.id, updateData);
      return { status: "updated" };
    }

    return { status: "unchanged" };
  }

  static async update(
    id: string,
    data: Partial<
      Pick<
        UpdatePromptTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
        | "useDynamicTeamCredential"
      >
    >,
  ) {
    const [promptTool] = await db
      .update(schema.promptToolsTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.promptToolsTable.id, id))
      .returning();
    return promptTool;
  }

  /**
   * Find a prompt tool assignment by prompt ID and tool ID
   */
  static async findByPromptAndTool(
    promptId: string,
    toolId: string,
  ): Promise<{
    id: string;
    promptId: string;
    toolId: string;
    responseModifierTemplate: string | null;
    credentialSourceMcpServerId: string | null;
    executionSourceMcpServerId: string | null;
    useDynamicTeamCredential: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const [result] = await db
      .select()
      .from(schema.promptToolsTable)
      .where(
        and(
          eq(schema.promptToolsTable.promptId, promptId),
          eq(schema.promptToolsTable.toolId, toolId),
        ),
      )
      .limit(1);
    return result || null;
  }

  /**
   * Find all prompt-tool relationships with pagination, sorting, and filtering support.
   * When skipPagination is true, returns all matching records without applying limit/offset.
   *
   * Access control is applied through the prompt's llmProxyId - users can only see
   * prompt tools for prompts whose LLM Proxy they have access to.
   */
  static async findAll(params: {
    pagination?: PaginationQuery;
    sorting?: {
      sortBy?: PromptToolSortBy;
      sortDirection?: PromptToolSortDirection;
    };
    filters?: PromptToolFilters;
    userId?: string;
    isLlmProxyAdmin?: boolean;
    skipPagination?: boolean;
  }): Promise<PaginatedResult<PromptTool>> {
    const {
      pagination = { limit: 20, offset: 0 },
      sorting,
      filters,
      userId,
      isLlmProxyAdmin,
      skipPagination = false,
    } = params;
    // Build WHERE conditions
    const whereConditions: SQL[] = [];

    // Apply access control filtering for users that are not admins
    // Access is determined through the prompt's llmProxyId
    if (userId && !isLlmProxyAdmin) {
      const accessibleLlmProxyIds =
        await LlmProxyTeamModel.getUserAccessibleLlmProxyIds(userId, false);

      if (accessibleLlmProxyIds.length === 0) {
        return createPaginatedResult([], 0, pagination);
      }

      whereConditions.push(
        inArray(schema.promptsTable.llmProxyId, accessibleLlmProxyIds),
      );
    }

    // Filter by search query (tool name)
    if (filters?.search) {
      whereConditions.push(
        sql`LOWER(${schema.toolsTable.name}) LIKE ${`%${filters.search.toLowerCase()}%`}`,
      );
    }

    // Filter by prompt
    if (filters?.promptId) {
      whereConditions.push(
        eq(schema.promptToolsTable.promptId, filters.promptId),
      );
    }

    // Filter by origin (either "llm-proxy" or a catalogId)
    if (filters?.origin) {
      if (filters.origin === "llm-proxy") {
        whereConditions.push(sql`${schema.toolsTable.catalogId} IS NULL`);
      } else {
        whereConditions.push(eq(schema.toolsTable.catalogId, filters.origin));
      }
    }

    // Filter by credential owner
    if (filters?.mcpServerOwnerId) {
      const mcpServerIds = await db
        .select({ id: schema.mcpServersTable.id })
        .from(schema.mcpServersTable)
        .where(eq(schema.mcpServersTable.ownerId, filters.mcpServerOwnerId))
        .then((rows) => rows.map((r) => r.id));

      if (mcpServerIds.length > 0) {
        const credentialCondition = or(
          inArray(
            schema.promptToolsTable.credentialSourceMcpServerId,
            mcpServerIds,
          ),
          inArray(
            schema.promptToolsTable.executionSourceMcpServerId,
            mcpServerIds,
          ),
        );
        if (credentialCondition) {
          whereConditions.push(credentialCondition);
        }
      }
    }

    // Exclude Archestra built-in tools
    if (filters?.excludeArchestraTools) {
      whereConditions.push(
        sql`${schema.toolsTable.name} NOT LIKE 'archestra\\_\\_%' ESCAPE '\\'`,
      );
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Determine the ORDER BY clause based on sorting params
    const direction = sorting?.sortDirection === "asc" ? asc : desc;
    let orderByClause: SQL;

    switch (sorting?.sortBy) {
      case "name":
        orderByClause = direction(schema.toolsTable.name);
        break;
      case "prompt":
        orderByClause = direction(schema.promptsTable.name);
        break;
      case "origin":
        orderByClause = direction(
          sql`CASE WHEN ${schema.toolsTable.catalogId} IS NULL THEN '2-llm-proxy' ELSE '1-mcp' END`,
        );
        break;
      default:
        orderByClause = direction(schema.promptToolsTable.createdAt);
        break;
    }

    // Build the base data query
    const baseDataQuery = db
      .select({
        ...getTableColumns(schema.promptToolsTable),
        prompt: {
          id: schema.promptsTable.id,
          name: schema.promptsTable.name,
        },
        tool: {
          id: schema.toolsTable.id,
          name: schema.toolsTable.name,
          description: schema.toolsTable.description,
          parameters: schema.toolsTable.parameters,
          createdAt: schema.toolsTable.createdAt,
          updatedAt: schema.toolsTable.updatedAt,
          catalogId: schema.toolsTable.catalogId,
          mcpServerId: schema.toolsTable.mcpServerId,
          mcpServerName: schema.mcpServersTable.name,
          mcpServerCatalogId: schema.mcpServersTable.catalogId,
        },
      })
      .from(schema.promptToolsTable)
      .innerJoin(
        schema.promptsTable,
        eq(schema.promptToolsTable.promptId, schema.promptsTable.id),
      )
      .innerJoin(
        schema.toolsTable,
        eq(schema.promptToolsTable.toolId, schema.toolsTable.id),
      )
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .where(whereClause)
      .orderBy(orderByClause)
      .$dynamic();

    const dataQuery = skipPagination
      ? baseDataQuery
      : baseDataQuery.limit(pagination.limit).offset(pagination.offset);

    const [data, [{ total }]] = await Promise.all([
      dataQuery,
      db
        .select({ total: count() })
        .from(schema.promptToolsTable)
        .innerJoin(
          schema.promptsTable,
          eq(schema.promptToolsTable.promptId, schema.promptsTable.id),
        )
        .innerJoin(
          schema.toolsTable,
          eq(schema.promptToolsTable.toolId, schema.toolsTable.id),
        )
        .leftJoin(
          schema.mcpServersTable,
          eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
        )
        .where(whereClause),
    ]);

    if (skipPagination) {
      return createPaginatedResult(data, data.length, {
        limit: Math.max(1, data.length),
        offset: 0,
      });
    }

    return createPaginatedResult(data, Number(total), pagination);
  }

  /**
   * Delete all prompt-tool assignments that use a specific MCP server as their execution source.
   * Used when a local MCP server is deleted/uninstalled.
   */
  static async deleteByExecutionSourceMcpServerId(
    mcpServerId: string,
  ): Promise<number> {
    const result = await db
      .delete(schema.promptToolsTable)
      .where(
        eq(schema.promptToolsTable.executionSourceMcpServerId, mcpServerId),
      );
    return result.rowCount ?? 0;
  }

  /**
   * Delete all prompt-tool assignments that use a specific MCP server as their credential source.
   * Used when a remote MCP server is deleted/uninstalled.
   */
  static async deleteByCredentialSourceMcpServerId(
    mcpServerId: string,
  ): Promise<number> {
    const result = await db
      .delete(schema.promptToolsTable)
      .where(
        eq(schema.promptToolsTable.credentialSourceMcpServerId, mcpServerId),
      );
    return result.rowCount ?? 0;
  }

  /**
   * Get tools for a prompt with full details (for chat/A2A execution)
   */
  static async getToolsForPrompt(promptId: string): Promise<
    Array<{
      id: string;
      toolId: string;
      toolName: string;
      toolDescription: string | null;
      toolParameters: unknown;
      catalogId: string | null;
      mcpServerId: string | null;
      responseModifierTemplate: string | null;
      credentialSourceMcpServerId: string | null;
      executionSourceMcpServerId: string | null;
      useDynamicTeamCredential: boolean;
    }>
  > {
    const results = await db
      .select({
        id: schema.promptToolsTable.id,
        toolId: schema.promptToolsTable.toolId,
        toolName: schema.toolsTable.name,
        toolDescription: schema.toolsTable.description,
        toolParameters: schema.toolsTable.parameters,
        catalogId: schema.toolsTable.catalogId,
        mcpServerId: schema.toolsTable.mcpServerId,
        responseModifierTemplate:
          schema.promptToolsTable.responseModifierTemplate,
        credentialSourceMcpServerId:
          schema.promptToolsTable.credentialSourceMcpServerId,
        executionSourceMcpServerId:
          schema.promptToolsTable.executionSourceMcpServerId,
        useDynamicTeamCredential:
          schema.promptToolsTable.useDynamicTeamCredential,
      })
      .from(schema.promptToolsTable)
      .innerJoin(
        schema.toolsTable,
        eq(schema.promptToolsTable.toolId, schema.toolsTable.id),
      )
      .where(eq(schema.promptToolsTable.promptId, promptId));

    return results;
  }

  /**
   * Sync tool assignments for a prompt (replaces all existing assignments)
   */
  static async syncToolsForPrompt(
    promptId: string,
    toolIds: string[],
  ): Promise<{ added: number; removed: number }> {
    // Get existing assignments
    const existingToolIds = await PromptToolModel.findToolIdsByPrompt(promptId);
    const existingSet = new Set(existingToolIds);
    const newSet = new Set(toolIds);

    // Find tools to add and remove
    const toAdd = toolIds.filter((id) => !existingSet.has(id));
    const toRemove = existingToolIds.filter((id) => !newSet.has(id));

    // Remove old assignments
    if (toRemove.length > 0) {
      await db
        .delete(schema.promptToolsTable)
        .where(
          and(
            eq(schema.promptToolsTable.promptId, promptId),
            inArray(schema.promptToolsTable.toolId, toRemove),
          ),
        );
    }

    // Add new assignments
    if (toAdd.length > 0) {
      await db.insert(schema.promptToolsTable).values(
        toAdd.map((toolId) => ({
          promptId,
          toolId,
        })),
      );
    }

    return { added: toAdd.length, removed: toRemove.length };
  }

  /**
   * Delete all prompt-tool assignments for a prompt
   */
  static async deleteAllForPrompt(promptId: string): Promise<number> {
    const result = await db
      .delete(schema.promptToolsTable)
      .where(eq(schema.promptToolsTable.promptId, promptId));
    return result.rowCount ?? 0;
  }
}

export default PromptToolModel;
