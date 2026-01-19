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
  InsertMcpGatewayTool,
  McpGatewayTool,
  McpGatewayToolFilters,
  McpGatewayToolSortBy,
  McpGatewayToolSortDirection,
  PaginationQuery,
  UpdateMcpGatewayTool,
} from "@/types";
import McpGatewayTeamModel from "./mcp-gateway-team";

class McpGatewayToolModel {
  static async create(
    mcpGatewayId: string,
    toolId: string,
    options?: Partial<
      Pick<
        InsertMcpGatewayTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
        | "useDynamicTeamCredential"
      >
    >,
  ) {
    const [mcpGatewayTool] = await db
      .insert(schema.mcpGatewayToolsTable)
      .values({
        mcpGatewayId,
        toolId,
        ...options,
      })
      .returning();

    // Auto-configure policies if enabled (run in background)
    const { toolAutoPolicyService } = await import("./agent-tool-auto-policy");
    const { default: OrganizationModel } = await import("./organization");

    // Get gateway's organization via team relationship and trigger auto-configure in background
    db.select({ organizationId: schema.teamsTable.organizationId })
      .from(schema.mcpGatewayTeamsTable)
      .innerJoin(
        schema.teamsTable,
        eq(schema.mcpGatewayTeamsTable.teamId, schema.teamsTable.id),
      )
      .where(eq(schema.mcpGatewayTeamsTable.mcpGatewayId, mcpGatewayId))
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
            mcpGatewayToolId: mcpGatewayTool.id,
            mcpGatewayId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to trigger auto-configure for new mcp-gateway-tool",
        );
      });

    return mcpGatewayTool;
  }

  static async delete(mcpGatewayId: string, toolId: string): Promise<boolean> {
    const result = await db
      .delete(schema.mcpGatewayToolsTable)
      .where(
        and(
          eq(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayId),
          eq(schema.mcpGatewayToolsTable.toolId, toolId),
        ),
      );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async findToolIdsByMcpGateway(
    mcpGatewayId: string,
  ): Promise<string[]> {
    const results = await db
      .select({ toolId: schema.mcpGatewayToolsTable.toolId })
      .from(schema.mcpGatewayToolsTable)
      .where(eq(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayId));
    return results.map((r) => r.toolId);
  }

  static async findMcpGatewayIdsByTool(toolId: string): Promise<string[]> {
    const results = await db
      .select({ mcpGatewayId: schema.mcpGatewayToolsTable.mcpGatewayId })
      .from(schema.mcpGatewayToolsTable)
      .where(eq(schema.mcpGatewayToolsTable.toolId, toolId));
    return results.map((r) => r.mcpGatewayId);
  }

  static async findAllAssignedToolIds(): Promise<string[]> {
    const results = await db
      .select({ toolId: schema.mcpGatewayToolsTable.toolId })
      .from(schema.mcpGatewayToolsTable);
    return [...new Set(results.map((r) => r.toolId))];
  }

  static async exists(mcpGatewayId: string, toolId: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(schema.mcpGatewayToolsTable)
      .where(
        and(
          eq(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayId),
          eq(schema.mcpGatewayToolsTable.toolId, toolId),
        ),
      )
      .limit(1);
    return !!result;
  }

  static async createIfNotExists(
    mcpGatewayId: string,
    toolId: string,
    credentialSourceMcpServerId?: string | null,
    executionSourceMcpServerId?: string | null,
  ) {
    const exists = await McpGatewayToolModel.exists(mcpGatewayId, toolId);
    if (!exists) {
      const options: Partial<
        Pick<
          InsertMcpGatewayTool,
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

      return await McpGatewayToolModel.create(mcpGatewayId, toolId, options);
    }
    return null;
  }

  /**
   * Bulk create mcp-gateway-tool relationships in one query to avoid N+1
   */
  static async createManyIfNotExists(
    mcpGatewayId: string,
    toolIds: string[],
  ): Promise<void> {
    if (toolIds.length === 0) return;

    // Check which tools are already assigned
    const existingAssignments = await db
      .select({ toolId: schema.mcpGatewayToolsTable.toolId })
      .from(schema.mcpGatewayToolsTable)
      .where(
        and(
          eq(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayId),
          inArray(schema.mcpGatewayToolsTable.toolId, toolIds),
        ),
      );

    const existingToolIds = new Set(existingAssignments.map((a) => a.toolId));
    const newToolIds = toolIds.filter((toolId) => !existingToolIds.has(toolId));

    if (newToolIds.length > 0) {
      await db.insert(schema.mcpGatewayToolsTable).values(
        newToolIds.map((toolId) => ({
          mcpGatewayId,
          toolId,
        })),
      );
    }
  }

  /**
   * Bulk create mcp-gateway-tool relationships for multiple gateways and tools
   * Assigns all tools to all gateways in a single query to avoid N+1
   */
  static async bulkCreateForMcpGatewaysAndTools(
    mcpGatewayIds: string[],
    toolIds: string[],
    options?: Partial<
      Pick<
        InsertMcpGatewayTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
      >
    >,
  ): Promise<void> {
    if (mcpGatewayIds.length === 0 || toolIds.length === 0) return;

    // Build all possible combinations
    const assignments: Array<{
      mcpGatewayId: string;
      toolId: string;
      responseModifierTemplate?: string | null;
      credentialSourceMcpServerId?: string | null;
      executionSourceMcpServerId?: string | null;
    }> = [];

    for (const mcpGatewayId of mcpGatewayIds) {
      for (const toolId of toolIds) {
        assignments.push({
          mcpGatewayId,
          toolId,
          ...options,
        });
      }
    }

    // Check which assignments already exist
    const existingAssignments = await db
      .select({
        mcpGatewayId: schema.mcpGatewayToolsTable.mcpGatewayId,
        toolId: schema.mcpGatewayToolsTable.toolId,
      })
      .from(schema.mcpGatewayToolsTable)
      .where(
        and(
          inArray(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayIds),
          inArray(schema.mcpGatewayToolsTable.toolId, toolIds),
        ),
      );

    const existingSet = new Set(
      existingAssignments.map((a) => `${a.mcpGatewayId}:${a.toolId}`),
    );

    // Filter out existing assignments
    const newAssignments = assignments.filter(
      (a) => !existingSet.has(`${a.mcpGatewayId}:${a.toolId}`),
    );

    if (newAssignments.length > 0) {
      await db
        .insert(schema.mcpGatewayToolsTable)
        .values(newAssignments)
        .onConflictDoNothing();
    }
  }

  /**
   * Creates a new mcp-gateway-tool assignment or updates credentials if it already exists.
   * Returns the status: "created", "updated", or "unchanged".
   */
  static async createOrUpdateCredentials(
    mcpGatewayId: string,
    toolId: string,
    credentialSourceMcpServerId?: string | null,
    executionSourceMcpServerId?: string | null,
    useDynamicTeamCredential?: boolean,
  ): Promise<{ status: "created" | "updated" | "unchanged" }> {
    // Check if assignment already exists
    const [existing] = await db
      .select()
      .from(schema.mcpGatewayToolsTable)
      .where(
        and(
          eq(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayId),
          eq(schema.mcpGatewayToolsTable.toolId, toolId),
        ),
      )
      .limit(1);

    if (!existing) {
      // Create new assignment
      const options: Partial<
        Pick<
          InsertMcpGatewayTool,
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

      await McpGatewayToolModel.create(mcpGatewayId, toolId, options);
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
          UpdateMcpGatewayTool,
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

      await McpGatewayToolModel.update(existing.id, updateData);
      return { status: "updated" };
    }

    return { status: "unchanged" };
  }

  static async update(
    id: string,
    data: Partial<
      Pick<
        UpdateMcpGatewayTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
        | "useDynamicTeamCredential"
      >
    >,
  ) {
    const [mcpGatewayTool] = await db
      .update(schema.mcpGatewayToolsTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.mcpGatewayToolsTable.id, id))
      .returning();
    return mcpGatewayTool;
  }

  /**
   * Find all mcp-gateway-tool relationships with pagination, sorting, and filtering support.
   * When skipPagination is true, returns all matching records without applying limit/offset.
   */
  static async findAll(params: {
    pagination?: PaginationQuery;
    sorting?: {
      sortBy?: McpGatewayToolSortBy;
      sortDirection?: McpGatewayToolSortDirection;
    };
    filters?: McpGatewayToolFilters;
    userId?: string;
    isMcpGatewayAdmin?: boolean;
    skipPagination?: boolean;
  }): Promise<PaginatedResult<McpGatewayTool>> {
    const {
      pagination = { limit: 20, offset: 0 },
      sorting,
      filters,
      userId,
      isMcpGatewayAdmin,
      skipPagination = false,
    } = params;
    // Build WHERE conditions
    const whereConditions: SQL[] = [];

    // Apply access control filtering for users that are not admins
    if (userId && !isMcpGatewayAdmin) {
      const accessibleMcpGatewayIds =
        await McpGatewayTeamModel.getUserAccessibleMcpGatewayIds(userId, false);

      if (accessibleMcpGatewayIds.length === 0) {
        return createPaginatedResult([], 0, pagination);
      }

      whereConditions.push(
        inArray(
          schema.mcpGatewayToolsTable.mcpGatewayId,
          accessibleMcpGatewayIds,
        ),
      );
    }

    // Filter by search query (tool name)
    if (filters?.search) {
      whereConditions.push(
        sql`LOWER(${schema.toolsTable.name}) LIKE ${`%${filters.search.toLowerCase()}%`}`,
      );
    }

    // Filter by mcpGateway
    if (filters?.mcpGatewayId) {
      whereConditions.push(
        eq(schema.mcpGatewayToolsTable.mcpGatewayId, filters.mcpGatewayId),
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
            schema.mcpGatewayToolsTable.credentialSourceMcpServerId,
            mcpServerIds,
          ),
          inArray(
            schema.mcpGatewayToolsTable.executionSourceMcpServerId,
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
      case "mcpGateway":
        orderByClause = direction(schema.mcpGatewaysTable.name);
        break;
      case "origin":
        orderByClause = direction(
          sql`CASE WHEN ${schema.toolsTable.catalogId} IS NULL THEN '2-llm-proxy' ELSE '1-mcp' END`,
        );
        break;
      default:
        orderByClause = direction(schema.mcpGatewayToolsTable.createdAt);
        break;
    }

    // Build the base data query
    const baseDataQuery = db
      .select({
        ...getTableColumns(schema.mcpGatewayToolsTable),
        mcpGateway: {
          id: schema.mcpGatewaysTable.id,
          name: schema.mcpGatewaysTable.name,
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
      .from(schema.mcpGatewayToolsTable)
      .innerJoin(
        schema.mcpGatewaysTable,
        eq(
          schema.mcpGatewayToolsTable.mcpGatewayId,
          schema.mcpGatewaysTable.id,
        ),
      )
      .innerJoin(
        schema.toolsTable,
        eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
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
        .from(schema.mcpGatewayToolsTable)
        .innerJoin(
          schema.mcpGatewaysTable,
          eq(
            schema.mcpGatewayToolsTable.mcpGatewayId,
            schema.mcpGatewaysTable.id,
          ),
        )
        .innerJoin(
          schema.toolsTable,
          eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
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
   * Delete all mcp-gateway-tool assignments that use a specific MCP server as their execution source.
   * Used when a local MCP server is deleted/uninstalled.
   */
  static async deleteByExecutionSourceMcpServerId(
    mcpServerId: string,
  ): Promise<number> {
    const result = await db
      .delete(schema.mcpGatewayToolsTable)
      .where(
        eq(schema.mcpGatewayToolsTable.executionSourceMcpServerId, mcpServerId),
      );
    return result.rowCount ?? 0;
  }

  /**
   * Delete all mcp-gateway-tool assignments that use a specific MCP server as their credential source.
   * Used when a remote MCP server is deleted/uninstalled.
   */
  static async deleteByCredentialSourceMcpServerId(
    mcpServerId: string,
  ): Promise<number> {
    const result = await db
      .delete(schema.mcpGatewayToolsTable)
      .where(
        eq(
          schema.mcpGatewayToolsTable.credentialSourceMcpServerId,
          mcpServerId,
        ),
      );
    return result.rowCount ?? 0;
  }

  /**
   * Clean up invalid credential sources when a user is removed from a team.
   * Sets credentialSourceMcpServerId to null for mcp-gateway-tools where:
   * - The credential source is a personal token owned by the removed user
   * - The user no longer has access to the gateway through any team
   */
  static async cleanupInvalidCredentialSourcesForUser(
    userId: string,
    teamId: string,
    isMcpGatewayAdmin: boolean,
  ): Promise<number> {
    // Get all gateways assigned to this team
    const gatewaysInTeam = await db
      .select({ mcpGatewayId: schema.mcpGatewayTeamsTable.mcpGatewayId })
      .from(schema.mcpGatewayTeamsTable)
      .where(eq(schema.mcpGatewayTeamsTable.teamId, teamId));

    if (gatewaysInTeam.length === 0) {
      return 0;
    }

    const gatewayIds = gatewaysInTeam.map((g) => g.mcpGatewayId);

    // Get all MCP servers owned by this user
    const userServers = await db
      .select({ id: schema.mcpServersTable.id })
      .from(schema.mcpServersTable)
      .where(eq(schema.mcpServersTable.ownerId, userId));

    if (userServers.length === 0) {
      return 0;
    }

    const serverIds = userServers.map((s) => s.id);

    // For each gateway, check if user still has access through other teams
    let cleanedCount = 0;

    for (const gatewayId of gatewayIds) {
      const hasAccess = await McpGatewayTeamModel.userHasMcpGatewayAccess(
        userId,
        gatewayId,
        isMcpGatewayAdmin,
      );

      // If user no longer has access, clean up their personal tokens
      if (!hasAccess) {
        const result = await db
          .update(schema.mcpGatewayToolsTable)
          .set({ credentialSourceMcpServerId: null })
          .where(
            and(
              eq(schema.mcpGatewayToolsTable.mcpGatewayId, gatewayId),
              inArray(
                schema.mcpGatewayToolsTable.credentialSourceMcpServerId,
                serverIds,
              ),
            ),
          );

        cleanedCount += result.rowCount ?? 0;
      }
    }

    return cleanedCount;
  }
}

export default McpGatewayToolModel;
