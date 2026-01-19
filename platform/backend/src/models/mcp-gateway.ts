import { DEFAULT_PROFILE_NAME } from "@shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  min,
  type SQL,
  sql,
} from "drizzle-orm";
import db, { schema } from "@/database";
import {
  createPaginatedResult,
  type PaginatedResult,
} from "@/database/utils/pagination";
import type {
  InsertMcpGateway,
  McpGateway,
  PaginationQuery,
  SortingQuery,
  UpdateMcpGateway,
} from "@/types";
import McpGatewayLabelModel from "./mcp-gateway-label";
import McpGatewayTeamModel from "./mcp-gateway-team";
import ToolModel from "./tool";

class McpGatewayModel {
  static async create({
    teams,
    labels,
    ...mcpGateway
  }: InsertMcpGateway): Promise<McpGateway> {
    const [createdGateway] = await db
      .insert(schema.mcpGatewaysTable)
      .values(mcpGateway)
      .returning();

    // Assign teams to the MCP Gateway if provided
    if (teams && teams.length > 0) {
      await McpGatewayTeamModel.assignTeamsToMcpGateway(
        createdGateway.id,
        teams,
      );
    }

    // Assign labels to the MCP Gateway if provided
    if (labels && labels.length > 0) {
      await McpGatewayLabelModel.syncMcpGatewayLabels(
        createdGateway.id,
        labels,
      );
    }

    // Assign default Archestra tools (artifact_write, todo_write) to new MCP Gateways
    await ToolModel.assignDefaultArchestraToolsToMcpGateway(createdGateway.id);

    // Get team details and tools for the created MCP Gateway
    const [teamDetails, assignedTools] = await Promise.all([
      teams && teams.length > 0
        ? McpGatewayTeamModel.getTeamDetailsForMcpGateway(createdGateway.id)
        : Promise.resolve([]),
      db
        .select({ tool: schema.toolsTable })
        .from(schema.mcpGatewayToolsTable)
        .innerJoin(
          schema.toolsTable,
          eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
        )
        .where(eq(schema.mcpGatewayToolsTable.mcpGatewayId, createdGateway.id)),
    ]);

    return {
      ...createdGateway,
      tools: assignedTools.map((row) => row.tool),
      teams: teamDetails,
      labels: await McpGatewayLabelModel.getLabelsForMcpGateway(
        createdGateway.id,
      ),
    };
  }

  static async findAll(
    organizationId: string,
    userId?: string,
    isMcpGatewayAdmin?: boolean,
  ): Promise<McpGateway[]> {
    let query = db
      .select()
      .from(schema.mcpGatewaysTable)
      .leftJoin(
        schema.mcpGatewayToolsTable,
        eq(
          schema.mcpGatewaysTable.id,
          schema.mcpGatewayToolsTable.mcpGatewayId,
        ),
      )
      .leftJoin(
        schema.toolsTable,
        eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
      )
      .$dynamic();

    // Build where conditions
    const whereConditions: SQL[] = [
      eq(schema.mcpGatewaysTable.organizationId, organizationId),
    ];

    // Apply access control filtering for non-admins
    if (userId && !isMcpGatewayAdmin) {
      const accessibleIds =
        await McpGatewayTeamModel.getUserAccessibleMcpGatewayIds(userId, false);

      if (accessibleIds.length === 0) {
        return [];
      }

      whereConditions.push(inArray(schema.mcpGatewaysTable.id, accessibleIds));
    }

    // Apply all where conditions
    query = query.where(and(...whereConditions));

    const rows = await query;

    // Group the flat join results by MCP Gateway
    const gatewaysMap = new Map<string, McpGateway>();

    for (const row of rows) {
      const gateway = row.mcp_gateways;
      const tool = row.tools;

      if (!gatewaysMap.has(gateway.id)) {
        gatewaysMap.set(gateway.id, {
          ...gateway,
          tools: [],
          teams: [] as Array<{ id: string; name: string }>,
          labels: [],
        });
      }

      // Add tool if it exists (leftJoin returns null for gateways with no tools)
      if (tool) {
        gatewaysMap.get(gateway.id)?.tools.push(tool);
      }
    }

    const gateways = Array.from(gatewaysMap.values());
    const gatewayIds = gateways.map((gateway) => gateway.id);

    // Populate teams and labels for all gateways with bulk queries to avoid N+1
    const [teamsMap, labelsMap] = await Promise.all([
      McpGatewayTeamModel.getTeamDetailsForMcpGateways(gatewayIds),
      McpGatewayLabelModel.getLabelsForMcpGateways(gatewayIds),
    ]);

    // Assign teams and labels to each gateway
    for (const gateway of gateways) {
      gateway.teams = teamsMap.get(gateway.id) || [];
      gateway.labels = labelsMap.get(gateway.id) || [];
    }

    return gateways;
  }

  /**
   * Find all MCP Gateways with pagination, sorting, and filtering support
   */
  static async findAllPaginated(
    organizationId: string,
    pagination: PaginationQuery,
    sorting?: SortingQuery,
    filters?: { name?: string },
    userId?: string,
    isMcpGatewayAdmin?: boolean,
  ): Promise<PaginatedResult<McpGateway>> {
    // Determine the ORDER BY clause based on sorting params
    const orderByClause = McpGatewayModel.getOrderByClause(sorting);

    // Build where clause for filters and access control
    const whereConditions: SQL[] = [
      eq(schema.mcpGatewaysTable.organizationId, organizationId),
    ];

    // Add name filter if provided
    if (filters?.name) {
      whereConditions.push(
        ilike(schema.mcpGatewaysTable.name, `%${filters.name}%`),
      );
    }

    // Apply access control filtering for non-admins
    if (userId && !isMcpGatewayAdmin) {
      const accessibleIds =
        await McpGatewayTeamModel.getUserAccessibleMcpGatewayIds(userId, false);

      if (accessibleIds.length === 0) {
        return createPaginatedResult([], 0, pagination);
      }

      whereConditions.push(inArray(schema.mcpGatewaysTable.id, accessibleIds));
    }

    const whereClause = and(...whereConditions);

    // Step 1: Get paginated gateway IDs with proper sorting
    let query = db
      .select({ id: schema.mcpGatewaysTable.id })
      .from(schema.mcpGatewaysTable)
      .where(whereClause)
      .$dynamic();

    const direction = sorting?.sortDirection === "asc" ? asc : desc;

    // Add sorting-specific joins and order by
    if (sorting?.sortBy === "toolsCount") {
      const toolsCountSubquery = db
        .select({
          mcpGatewayId: schema.mcpGatewayToolsTable.mcpGatewayId,
          toolsCount: count(schema.mcpGatewayToolsTable.toolId).as(
            "toolsCount",
          ),
        })
        .from(schema.mcpGatewayToolsTable)
        .groupBy(schema.mcpGatewayToolsTable.mcpGatewayId)
        .as("toolsCounts");

      query = query
        .leftJoin(
          toolsCountSubquery,
          eq(schema.mcpGatewaysTable.id, toolsCountSubquery.mcpGatewayId),
        )
        .orderBy(direction(sql`COALESCE(${toolsCountSubquery.toolsCount}, 0)`));
    } else if (sorting?.sortBy === "team") {
      const teamNameSubquery = db
        .select({
          mcpGatewayId: schema.mcpGatewayTeamsTable.mcpGatewayId,
          teamName: min(schema.teamsTable.name).as("teamName"),
        })
        .from(schema.mcpGatewayTeamsTable)
        .leftJoin(
          schema.teamsTable,
          eq(schema.mcpGatewayTeamsTable.teamId, schema.teamsTable.id),
        )
        .groupBy(schema.mcpGatewayTeamsTable.mcpGatewayId)
        .as("teamNames");

      query = query
        .leftJoin(
          teamNameSubquery,
          eq(schema.mcpGatewaysTable.id, teamNameSubquery.mcpGatewayId),
        )
        .orderBy(direction(sql`COALESCE(${teamNameSubquery.teamName}, '')`));
    } else {
      query = query.orderBy(orderByClause);
    }

    const sortedGateways = await query
      .limit(pagination.limit)
      .offset(pagination.offset);

    const sortedGatewayIds = sortedGateways.map((g) => g.id);

    // If no gateways match, return early
    if (sortedGatewayIds.length === 0) {
      const [{ total }] = await db
        .select({ total: count() })
        .from(schema.mcpGatewaysTable)
        .where(whereClause);
      return createPaginatedResult([], Number(total), pagination);
    }

    // Step 2: Get full gateway data with tools for the paginated gateway IDs
    const [gatewaysData, [{ total: totalResult }]] = await Promise.all([
      db
        .select()
        .from(schema.mcpGatewaysTable)
        .leftJoin(
          schema.mcpGatewayToolsTable,
          eq(
            schema.mcpGatewaysTable.id,
            schema.mcpGatewayToolsTable.mcpGatewayId,
          ),
        )
        .leftJoin(
          schema.toolsTable,
          eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
        )
        .where(inArray(schema.mcpGatewaysTable.id, sortedGatewayIds)),
      db
        .select({ total: count() })
        .from(schema.mcpGatewaysTable)
        .where(whereClause),
    ]);

    // Sort in memory to maintain the order from the sorted query
    const orderMap = new Map(sortedGatewayIds.map((id, index) => [id, index]));
    gatewaysData.sort(
      (a, b) =>
        (orderMap.get(a.mcp_gateways.id) ?? 0) -
        (orderMap.get(b.mcp_gateways.id) ?? 0),
    );

    // Group the flat join results by gateway
    const gatewaysMap = new Map<string, McpGateway>();

    for (const row of gatewaysData) {
      const gateway = row.mcp_gateways;
      const tool = row.tools;

      if (!gatewaysMap.has(gateway.id)) {
        gatewaysMap.set(gateway.id, {
          ...gateway,
          tools: [],
          teams: [] as Array<{ id: string; name: string }>,
          labels: [],
        });
      }

      // Add tool if it exists
      if (tool) {
        gatewaysMap.get(gateway.id)?.tools.push(tool);
      }
    }

    const gateways = Array.from(gatewaysMap.values());
    const gatewayIds = gateways.map((gateway) => gateway.id);

    // Populate teams and labels for all gateways with bulk queries to avoid N+1
    const [teamsMap, labelsMap] = await Promise.all([
      McpGatewayTeamModel.getTeamDetailsForMcpGateways(gatewayIds),
      McpGatewayLabelModel.getLabelsForMcpGateways(gatewayIds),
    ]);

    // Assign teams and labels to each gateway
    for (const gateway of gateways) {
      gateway.teams = teamsMap.get(gateway.id) || [];
      gateway.labels = labelsMap.get(gateway.id) || [];
    }

    return createPaginatedResult(gateways, Number(totalResult), pagination);
  }

  /**
   * Helper to get the appropriate ORDER BY clause based on sorting params
   */
  private static getOrderByClause(sorting?: SortingQuery) {
    const direction = sorting?.sortDirection === "asc" ? asc : desc;

    switch (sorting?.sortBy) {
      case "name":
        return direction(schema.mcpGatewaysTable.name);
      case "createdAt":
        return direction(schema.mcpGatewaysTable.createdAt);
      case "toolsCount":
      case "team":
        // These use separate query paths
        return direction(schema.mcpGatewaysTable.createdAt); // Fallback
      default:
        // Default: newest first
        return desc(schema.mcpGatewaysTable.createdAt);
    }
  }

  /**
   * Check if an MCP Gateway exists without loading related data
   */
  static async exists(id: string): Promise<boolean> {
    const [result] = await db
      .select({ id: schema.mcpGatewaysTable.id })
      .from(schema.mcpGatewaysTable)
      .where(eq(schema.mcpGatewaysTable.id, id))
      .limit(1);

    return result !== undefined;
  }

  /**
   * Check which MCP Gateway IDs exist from a list of IDs
   * Returns a Set of IDs that exist
   */
  static async existsBatch(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const results = await db
      .select({ id: schema.mcpGatewaysTable.id })
      .from(schema.mcpGatewaysTable)
      .where(inArray(schema.mcpGatewaysTable.id, ids));

    return new Set(results.map((r) => r.id));
  }

  static async findById(
    id: string,
    userId?: string,
    isMcpGatewayAdmin?: boolean,
  ): Promise<McpGateway | null> {
    // Check access control for non-admins
    if (userId && !isMcpGatewayAdmin) {
      const hasAccess = await McpGatewayTeamModel.userHasMcpGatewayAccess(
        userId,
        id,
        false,
      );
      if (!hasAccess) {
        return null;
      }
    }

    const rows = await db
      .select()
      .from(schema.mcpGatewaysTable)
      .leftJoin(
        schema.mcpGatewayToolsTable,
        eq(
          schema.mcpGatewaysTable.id,
          schema.mcpGatewayToolsTable.mcpGatewayId,
        ),
      )
      .leftJoin(
        schema.toolsTable,
        eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
      )
      .where(eq(schema.mcpGatewaysTable.id, id));

    if (rows.length === 0) {
      return null;
    }

    const gateway = rows[0].mcp_gateways;
    const tools = rows
      .map((row) => row.tools)
      .filter((tool): tool is NonNullable<typeof tool> => tool !== null);

    const teams = await McpGatewayTeamModel.getTeamDetailsForMcpGateway(id);
    const labels = await McpGatewayLabelModel.getLabelsForMcpGateway(id);

    return {
      ...gateway,
      tools,
      teams,
      labels,
    };
  }

  static async getOrCreateDefault(
    organizationId: string,
    name?: string,
  ): Promise<McpGateway> {
    // First, try to find an MCP Gateway with isDefault=true
    const rows = await db
      .select()
      .from(schema.mcpGatewaysTable)
      .leftJoin(
        schema.mcpGatewayToolsTable,
        eq(
          schema.mcpGatewaysTable.id,
          schema.mcpGatewayToolsTable.mcpGatewayId,
        ),
      )
      .leftJoin(
        schema.toolsTable,
        eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
      )
      .where(
        and(
          eq(schema.mcpGatewaysTable.organizationId, organizationId),
          eq(schema.mcpGatewaysTable.isDefault, true),
        ),
      );

    if (rows.length > 0) {
      // Default gateway exists, return it
      const gateway = rows[0].mcp_gateways;
      const tools = rows
        .map((row) => row.tools)
        .filter((tool): tool is NonNullable<typeof tool> => tool !== null);

      return {
        ...gateway,
        tools,
        teams: await McpGatewayTeamModel.getTeamDetailsForMcpGateway(
          gateway.id,
        ),
        labels: await McpGatewayLabelModel.getLabelsForMcpGateway(gateway.id),
      };
    }

    // No default gateway exists, create one
    return McpGatewayModel.create({
      organizationId,
      name: name || DEFAULT_PROFILE_NAME,
      isDefault: true,
      teams: [],
      labels: [],
    });
  }

  static async update(
    id: string,
    { teams, labels, ...gateway }: Partial<UpdateMcpGateway>,
  ): Promise<McpGateway | null> {
    let updatedGateway:
      | Omit<McpGateway, "tools" | "teams" | "labels">
      | undefined;

    // If setting isDefault to true, unset all other gateways' isDefault first
    if (gateway.isDefault === true) {
      // Get the organization ID for this gateway
      const [existing] = await db
        .select({ organizationId: schema.mcpGatewaysTable.organizationId })
        .from(schema.mcpGatewaysTable)
        .where(eq(schema.mcpGatewaysTable.id, id));

      if (existing) {
        await db
          .update(schema.mcpGatewaysTable)
          .set({ isDefault: false })
          .where(
            and(
              eq(
                schema.mcpGatewaysTable.organizationId,
                existing.organizationId,
              ),
              eq(schema.mcpGatewaysTable.isDefault, true),
            ),
          );
      }
    }

    // Only update gateway table if there are fields to update
    if (Object.keys(gateway).length > 0) {
      [updatedGateway] = await db
        .update(schema.mcpGatewaysTable)
        .set(gateway)
        .where(eq(schema.mcpGatewaysTable.id, id))
        .returning();

      if (!updatedGateway) {
        return null;
      }
    } else {
      // If only updating teams/labels, fetch the existing gateway
      const [existingGateway] = await db
        .select()
        .from(schema.mcpGatewaysTable)
        .where(eq(schema.mcpGatewaysTable.id, id));

      if (!existingGateway) {
        return null;
      }

      updatedGateway = existingGateway;
    }

    // Sync team assignments if teams is provided
    if (teams !== undefined) {
      await McpGatewayTeamModel.syncMcpGatewayTeams(id, teams);
    }

    // Sync label assignments if labels is provided
    if (labels !== undefined) {
      await McpGatewayLabelModel.syncMcpGatewayLabels(id, labels);
    }

    // Fetch the tools for the updated gateway
    const tools = await db
      .select({ tool: schema.toolsTable })
      .from(schema.mcpGatewayToolsTable)
      .innerJoin(
        schema.toolsTable,
        eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
      )
      .where(eq(schema.mcpGatewayToolsTable.mcpGatewayId, id));

    // Fetch current teams and labels
    const currentTeams =
      await McpGatewayTeamModel.getTeamDetailsForMcpGateway(id);
    const currentLabels = await McpGatewayLabelModel.getLabelsForMcpGateway(id);

    return {
      ...updatedGateway,
      tools: tools.map((t) => t.tool),
      teams: currentTeams,
      labels: currentLabels,
    };
  }

  static async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(schema.mcpGatewaysTable)
      .where(eq(schema.mcpGatewaysTable.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }
}

export default McpGatewayModel;
