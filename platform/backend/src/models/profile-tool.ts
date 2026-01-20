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
  InsertProfileTool,
  PaginationQuery,
  ProfileTool,
  ProfileToolFilters,
  ProfileToolSortBy,
  ProfileToolSortDirection,
  UpdateProfileTool,
} from "@/types";
import ProfileTeamModel from "./profile-team";

class ProfileToolModel {
  static async create(
    profileId: string,
    toolId: string,
    options?: Partial<
      Pick<
        InsertProfileTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
      >
    >,
  ) {
    const [profileTool] = await db
      .insert(schema.profileToolsTable)
      .values({
        profileId,
        toolId,
        ...options,
      })
      .returning();

    // Auto-configure policies if enabled (run in background)
    // Import at top of method to avoid circular dependency
    const { toolAutoPolicyService } = await import(
      "./profile-tool-auto-policy"
    );
    const { default: OrganizationModel } = await import("./organization");

    // Get profile's organization via team relationship and trigger auto-configure in background
    db.select({ organizationId: schema.teamsTable.organizationId })
      .from(schema.profileTeamsTable)
      .innerJoin(
        schema.teamsTable,
        eq(schema.profileTeamsTable.teamId, schema.teamsTable.id),
      )
      .where(eq(schema.profileTeamsTable.profileId, profileId))
      .limit(1)
      .then(async (rows) => {
        if (rows.length === 0) return;

        const organizationId = rows[0].organizationId;
        const organization = await OrganizationModel.getById(organizationId);

        if (organization?.autoConfigureNewTools) {
          // Use the unified method with timeout and loading state management
          await toolAutoPolicyService.configurePoliciesForToolWithTimeout(
            toolId,
            organizationId,
          );
        }
      })
      .catch((error) => {
        logger.error(
          {
            profileToolId: profileTool.id,
            profileId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to trigger auto-configure for new profile-tool",
        );
      });

    return profileTool;
  }

  static async delete(profileId: string, toolId: string): Promise<boolean> {
    const result = await db
      .delete(schema.profileToolsTable)
      .where(
        and(
          eq(schema.profileToolsTable.profileId, profileId),
          eq(schema.profileToolsTable.toolId, toolId),
        ),
      );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async findToolIdsByProfile(profileId: string): Promise<string[]> {
    const results = await db
      .select({ toolId: schema.profileToolsTable.toolId })
      .from(schema.profileToolsTable)
      .where(eq(schema.profileToolsTable.profileId, profileId));
    return results.map((r) => r.toolId);
  }

  static async findProfileIdsByTool(toolId: string): Promise<string[]> {
    const results = await db
      .select({ profileId: schema.profileToolsTable.profileId })
      .from(schema.profileToolsTable)
      .where(eq(schema.profileToolsTable.toolId, toolId));
    return results.map((r) => r.profileId);
  }

  static async findAllAssignedToolIds(): Promise<string[]> {
    const results = await db
      .select({ toolId: schema.profileToolsTable.toolId })
      .from(schema.profileToolsTable);
    return [...new Set(results.map((r) => r.toolId))];
  }

  static async exists(profileId: string, toolId: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(schema.profileToolsTable)
      .where(
        and(
          eq(schema.profileToolsTable.profileId, profileId),
          eq(schema.profileToolsTable.toolId, toolId),
        ),
      )
      .limit(1);
    return !!result;
  }

  static async createIfNotExists(
    profileId: string,
    toolId: string,
    credentialSourceMcpServerId?: string | null,
    executionSourceMcpServerId?: string | null,
  ) {
    const exists = await ProfileToolModel.exists(profileId, toolId);
    if (!exists) {
      const options: Partial<
        Pick<
          InsertProfileTool,
          | "responseModifierTemplate"
          | "credentialSourceMcpServerId"
          | "executionSourceMcpServerId"
        >
      > = {};

      // Only include credentialSourceMcpServerId if it has a real value
      if (credentialSourceMcpServerId) {
        options.credentialSourceMcpServerId = credentialSourceMcpServerId;
      }

      // Only include executionSourceMcpServerId if it has a real value
      if (executionSourceMcpServerId) {
        options.executionSourceMcpServerId = executionSourceMcpServerId;
      }

      return await ProfileToolModel.create(profileId, toolId, options);
    }
    return null;
  }

  /**
   * Bulk create profile-tool relationships in one query to avoid N+1
   */
  static async createManyIfNotExists(
    profileId: string,
    toolIds: string[],
  ): Promise<void> {
    if (toolIds.length === 0) return;

    // Check which tools are already assigned
    const existingAssignments = await db
      .select({ toolId: schema.profileToolsTable.toolId })
      .from(schema.profileToolsTable)
      .where(
        and(
          eq(schema.profileToolsTable.profileId, profileId),
          inArray(schema.profileToolsTable.toolId, toolIds),
        ),
      );

    const existingToolIds = new Set(existingAssignments.map((a) => a.toolId));
    const newToolIds = toolIds.filter((toolId) => !existingToolIds.has(toolId));

    if (newToolIds.length > 0) {
      await db.insert(schema.profileToolsTable).values(
        newToolIds.map((toolId) => ({
          profileId,
          toolId,
        })),
      );
    }
  }

  /**
   * Bulk create profile-tool relationships for multiple profiles and tools
   * Assigns all tools to all profiles in a single query to avoid N+1
   */
  static async bulkCreateForProfilesAndTools(
    profileIds: string[],
    toolIds: string[],
    options?: Partial<
      Pick<
        InsertProfileTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
      >
    >,
  ): Promise<void> {
    if (profileIds.length === 0 || toolIds.length === 0) return;

    // Build all possible combinations
    const assignments: Array<{
      profileId: string;
      toolId: string;
      responseModifierTemplate?: string | null;
      credentialSourceMcpServerId?: string | null;
      executionSourceMcpServerId?: string | null;
    }> = [];

    for (const profileId of profileIds) {
      for (const toolId of toolIds) {
        assignments.push({
          profileId,
          toolId,
          ...options,
        });
      }
    }

    // Check which assignments already exist
    const existingAssignments = await db
      .select({
        profileId: schema.profileToolsTable.profileId,
        toolId: schema.profileToolsTable.toolId,
      })
      .from(schema.profileToolsTable)
      .where(
        and(
          inArray(schema.profileToolsTable.profileId, profileIds),
          inArray(schema.profileToolsTable.toolId, toolIds),
        ),
      );

    const existingSet = new Set(
      existingAssignments.map((a) => `${a.profileId}:${a.toolId}`),
    );

    // Filter out existing assignments
    const newAssignments = assignments.filter(
      (a) => !existingSet.has(`${a.profileId}:${a.toolId}`),
    );

    if (newAssignments.length > 0) {
      await db
        .insert(schema.profileToolsTable)
        .values(newAssignments)
        .onConflictDoNothing();
    }
  }

  /**
   * Creates a new profile-tool assignment or updates credentials if it already exists.
   * Returns the status: "created", "updated", or "unchanged".
   */
  static async createOrUpdateCredentials(
    profileId: string,
    toolId: string,
    credentialSourceMcpServerId?: string | null,
    executionSourceMcpServerId?: string | null,
    useDynamicTeamCredential?: boolean,
  ): Promise<{ status: "created" | "updated" | "unchanged" }> {
    // Check if assignment already exists
    const [existing] = await db
      .select()
      .from(schema.profileToolsTable)
      .where(
        and(
          eq(schema.profileToolsTable.profileId, profileId),
          eq(schema.profileToolsTable.toolId, toolId),
        ),
      )
      .limit(1);

    if (!existing) {
      // Create new assignment
      const options: Partial<
        Pick<
          InsertProfileTool,
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

      await ProfileToolModel.create(profileId, toolId, options);
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
          UpdateProfileTool,
          | "credentialSourceMcpServerId"
          | "executionSourceMcpServerId"
          | "useDynamicTeamCredential"
        >
      > = {};

      // Always set credential fields to ensure they're updated correctly
      updateData.credentialSourceMcpServerId =
        credentialSourceMcpServerId ?? null;
      updateData.executionSourceMcpServerId =
        executionSourceMcpServerId ?? null;

      if (useDynamicTeamCredential !== undefined) {
        updateData.useDynamicTeamCredential = useDynamicTeamCredential;
      }

      await ProfileToolModel.update(existing.id, updateData);
      return { status: "updated" };
    }

    return { status: "unchanged" };
  }

  static async update(
    id: string,
    data: Partial<
      Pick<
        UpdateProfileTool,
        | "responseModifierTemplate"
        | "credentialSourceMcpServerId"
        | "executionSourceMcpServerId"
        | "useDynamicTeamCredential"
      >
    >,
  ) {
    const [profileTool] = await db
      .update(schema.profileToolsTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.profileToolsTable.id, id))
      .returning();
    return profileTool;
  }

  /**
   * Find all profile-tool relationships with pagination, sorting, and filtering support.
   * When skipPagination is true, returns all matching records without applying limit/offset.
   */
  static async findAll(params: {
    pagination?: PaginationQuery;
    sorting?: {
      sortBy?: ProfileToolSortBy;
      sortDirection?: ProfileToolSortDirection;
    };
    filters?: ProfileToolFilters;
    userId?: string;
    isProfileAdmin?: boolean;
    skipPagination?: boolean;
  }): Promise<PaginatedResult<ProfileTool>> {
    const {
      pagination = { limit: 20, offset: 0 },
      sorting,
      filters,
      userId,
      isProfileAdmin,
      skipPagination = false,
    } = params;
    // Build WHERE conditions
    const whereConditions: SQL[] = [];

    // Apply access control filtering for users that are not profile admins
    if (userId && !isProfileAdmin) {
      const accessibleProfileIds =
        await ProfileTeamModel.getUserAccessibleProfileIds(userId, false);

      if (accessibleProfileIds.length === 0) {
        return createPaginatedResult([], 0, pagination);
      }

      whereConditions.push(
        inArray(schema.profileToolsTable.profileId, accessibleProfileIds),
      );
    }

    // Filter by search query (tool name)
    if (filters?.search) {
      whereConditions.push(
        sql`LOWER(${schema.toolsTable.name}) LIKE ${`%${filters.search.toLowerCase()}%`}`,
      );
    }

    // Filter by profile
    if (filters?.profileId) {
      whereConditions.push(
        eq(schema.profileToolsTable.profileId, filters.profileId),
      );
    }

    // Filter by origin (either "llm-proxy" or a catalogId)
    if (filters?.origin) {
      if (filters.origin === "llm-proxy") {
        // LLM Proxy tools have null catalogId
        whereConditions.push(sql`${schema.toolsTable.catalogId} IS NULL`);
      } else {
        // MCP tools have a catalogId
        whereConditions.push(eq(schema.toolsTable.catalogId, filters.origin));
      }
    }

    // Filter by credential owner (check both credential source and execution source)
    if (filters?.mcpServerOwnerId) {
      // First, get all MCP server IDs owned by this user
      const mcpServerIds = await db
        .select({ id: schema.mcpServersTable.id })
        .from(schema.mcpServersTable)
        .where(eq(schema.mcpServersTable.ownerId, filters.mcpServerOwnerId))
        .then((rows) => rows.map((r) => r.id));

      if (mcpServerIds.length > 0) {
        const credentialCondition = or(
          inArray(
            schema.profileToolsTable.credentialSourceMcpServerId,
            mcpServerIds,
          ),
          inArray(
            schema.profileToolsTable.executionSourceMcpServerId,
            mcpServerIds,
          ),
        );
        if (credentialCondition) {
          whereConditions.push(credentialCondition);
        }
      }
    }

    // Exclude Archestra built-in tools for test isolation
    // Note: Use escape character to treat underscores literally (not as wildcards)
    // Double backslash needed: JS consumes one level, SQL gets the other
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
      case "profile":
        orderByClause = direction(schema.profilesTable.name);
        break;
      case "origin":
        // Sort by catalogId (null values last for LLM Proxy)
        orderByClause = direction(
          sql`CASE WHEN ${schema.toolsTable.catalogId} IS NULL THEN '2-llm-proxy' ELSE '1-mcp' END`,
        );
        break;
      default:
        orderByClause = direction(schema.profileToolsTable.createdAt);
        break;
    }

    // Build the base data query
    const baseDataQuery = db
      .select({
        ...getTableColumns(schema.profileToolsTable),
        profile: {
          id: schema.profilesTable.id,
          name: schema.profilesTable.name,
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
      .from(schema.profileToolsTable)
      .innerJoin(
        schema.profilesTable,
        eq(schema.profileToolsTable.profileId, schema.profilesTable.id),
      )
      .innerJoin(
        schema.toolsTable,
        eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
      )
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .where(whereClause)
      .orderBy(orderByClause)
      .$dynamic();

    // Apply pagination only if not skipped
    const dataQuery = skipPagination
      ? baseDataQuery
      : baseDataQuery.limit(pagination.limit).offset(pagination.offset);

    // Run both queries in parallel
    const [data, [{ total }]] = await Promise.all([
      dataQuery,
      db
        .select({ total: count() })
        .from(schema.profileToolsTable)
        .innerJoin(
          schema.profilesTable,
          eq(schema.profileToolsTable.profileId, schema.profilesTable.id),
        )
        .innerJoin(
          schema.toolsTable,
          eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
        )
        .leftJoin(
          schema.mcpServersTable,
          eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
        )
        .where(whereClause),
    ]);

    // When skipping pagination, return all data with correct metadata
    // Use Math.max(1, data.length) to avoid division by zero when data is empty
    if (skipPagination) {
      return createPaginatedResult(data, data.length, {
        limit: Math.max(1, data.length),
        offset: 0,
      });
    }

    return createPaginatedResult(data, Number(total), pagination);
  }

  /**
   * Delete all profile-tool assignments that use a specific MCP server as their execution source.
   * Used when a local MCP server is deleted/uninstalled.
   */
  static async deleteByExecutionSourceMcpServerId(
    mcpServerId: string,
  ): Promise<number> {
    const result = await db
      .delete(schema.profileToolsTable)
      .where(
        eq(schema.profileToolsTable.executionSourceMcpServerId, mcpServerId),
      );
    return result.rowCount ?? 0;
  }

  /**
   * Delete all profile-tool assignments that use a specific MCP server as their credential source.
   * Used when a remote MCP server is deleted/uninstalled.
   */
  static async deleteByCredentialSourceMcpServerId(
    mcpServerId: string,
  ): Promise<number> {
    const result = await db
      .delete(schema.profileToolsTable)
      .where(
        eq(schema.profileToolsTable.credentialSourceMcpServerId, mcpServerId),
      );
    return result.rowCount ?? 0;
  }

  /**
   * Clean up invalid credential sources when a user is removed from a team.
   * Sets credentialSourceMcpServerId to null for profile-tools where:
   * - The credential source is a personal token owned by the removed user
   * - The user no longer has access to the profile through any team
   */
  static async cleanupInvalidCredentialSourcesForUser(
    userId: string,
    teamId: string,
    isProfileAdmin: boolean,
  ): Promise<number> {
    // Get all profiles assigned to this team
    const profilesInTeam = await db
      .select({ profileId: schema.profileTeamsTable.profileId })
      .from(schema.profileTeamsTable)
      .where(eq(schema.profileTeamsTable.teamId, teamId));

    if (profilesInTeam.length === 0) {
      return 0;
    }

    const profileIds = profilesInTeam.map((a) => a.profileId);

    // Get all MCP servers owned by this user
    const userServers = await db
      .select({ id: schema.mcpServersTable.id })
      .from(schema.mcpServersTable)
      .where(eq(schema.mcpServersTable.ownerId, userId));

    if (userServers.length === 0) {
      return 0;
    }

    const serverIds = userServers.map((s) => s.id);

    // For each profile, check if user still has access through other teams
    let cleanedCount = 0;

    for (const profileId of profileIds) {
      // Check if user still has access to this profile through other teams
      const hasAccess = await ProfileTeamModel.userHasProfileAccess(
        userId,
        profileId,
        isProfileAdmin,
      );

      // If user no longer has access, clean up their personal tokens
      if (!hasAccess) {
        const result = await db
          .update(schema.profileToolsTable)
          .set({ credentialSourceMcpServerId: null })
          .where(
            and(
              eq(schema.profileToolsTable.profileId, profileId),
              inArray(
                schema.profileToolsTable.credentialSourceMcpServerId,
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

export default ProfileToolModel;
