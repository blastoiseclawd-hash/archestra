import { DEFAULT_PROFILE_NAME, isArchestraMcpServerTool } from "@shared";
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
  InsertProfile,
  PaginationQuery,
  Profile,
  SortingQuery,
  UpdateProfile,
} from "@/types";
import ProfileLabelModel from "./profile-label";
import ProfileTeamModel from "./profile-team";
import ToolModel from "./tool";

class ProfileModel {
  static async create({
    teams,
    labels,
    ...profile
  }: InsertProfile): Promise<Profile> {
    const [createdProfile] = await db
      .insert(schema.profilesTable)
      .values(profile)
      .returning();

    // Assign teams to the profile if provided
    if (teams && teams.length > 0) {
      await ProfileTeamModel.assignTeamsToProfile(createdProfile.id, teams);
    }

    // Assign labels to the profile if provided
    if (labels && labels.length > 0) {
      await ProfileLabelModel.syncProfileLabels(createdProfile.id, labels);
    }

    // Assign default Archestra tools (artifact_write, todo_write) to new profiles
    await ToolModel.assignDefaultArchestraToolsToProfile(createdProfile.id);

    // Get team details and tools for the created profile
    const [teamDetails, assignedTools] = await Promise.all([
      teams && teams.length > 0
        ? ProfileTeamModel.getTeamDetailsForProfile(createdProfile.id)
        : Promise.resolve([]),
      db
        .select({ tool: schema.toolsTable })
        .from(schema.profileToolsTable)
        .innerJoin(
          schema.toolsTable,
          eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
        )
        .where(eq(schema.profileToolsTable.profileId, createdProfile.id)),
    ]);

    return {
      ...createdProfile,
      tools: assignedTools.map((row) => row.tool),
      teams: teamDetails,
      labels: await ProfileLabelModel.getLabelsForProfile(createdProfile.id),
    };
  }

  static async findAll(
    userId?: string,
    isProfileAdmin?: boolean,
  ): Promise<Profile[]> {
    let query = db
      .select()
      .from(schema.profilesTable)
      .leftJoin(
        schema.profileToolsTable,
        eq(schema.profilesTable.id, schema.profileToolsTable.profileId),
      )
      .leftJoin(
        schema.toolsTable,
        eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
      )
      .$dynamic();

    // Build where conditions
    const whereConditions: SQL[] = [];

    // Apply access control filtering for non-profile admins
    if (userId && !isProfileAdmin) {
      const accessibleProfileIds =
        await ProfileTeamModel.getUserAccessibleProfileIds(userId, false);

      if (accessibleProfileIds.length === 0) {
        return [];
      }

      whereConditions.push(
        inArray(schema.profilesTable.id, accessibleProfileIds),
      );
    }

    // Apply all where conditions if any exist
    if (whereConditions.length > 0) {
      query = query.where(and(...whereConditions));
    }

    const rows = await query;

    // Group the flat join results by profile
    const profilesMap = new Map<string, Profile>();

    for (const row of rows) {
      const profile = row.profiles;
      const tool = row.tools;

      if (!profilesMap.has(profile.id)) {
        profilesMap.set(profile.id, {
          ...profile,
          tools: [],
          teams: [] as Array<{ id: string; name: string }>,
          labels: [],
        });
      }

      // Add tool if it exists (leftJoin returns null for profiles with no tools)
      if (tool) {
        profilesMap.get(profile.id)?.tools.push(tool);
      }
    }

    const profiles = Array.from(profilesMap.values());
    const profileIds = profiles.map((profile) => profile.id);

    // Populate teams and labels for all profiles with bulk queries to avoid N+1
    const [teamsMap, labelsMap] = await Promise.all([
      ProfileTeamModel.getTeamDetailsForProfiles(profileIds),
      ProfileLabelModel.getLabelsForProfiles(profileIds),
    ]);

    // Assign teams and labels to each profile
    for (const profile of profiles) {
      profile.teams = teamsMap.get(profile.id) || [];
      profile.labels = labelsMap.get(profile.id) || [];
    }

    return profiles;
  }

  /**
   * Find all profiles with pagination, sorting, and filtering support
   */
  static async findAllPaginated(
    pagination: PaginationQuery,
    sorting?: SortingQuery,
    filters?: { name?: string },
    userId?: string,
    isProfileAdmin?: boolean,
  ): Promise<PaginatedResult<Profile>> {
    // Determine the ORDER BY clause based on sorting params
    const orderByClause = ProfileModel.getOrderByClause(sorting);

    // Build where clause for filters and access control
    const whereConditions: SQL[] = [];

    // Add name filter if provided
    if (filters?.name) {
      whereConditions.push(
        ilike(schema.profilesTable.name, `%${filters.name}%`),
      );
    }

    // Apply access control filtering for non-profile admins
    if (userId && !isProfileAdmin) {
      const accessibleProfileIds =
        await ProfileTeamModel.getUserAccessibleProfileIds(userId, false);

      if (accessibleProfileIds.length === 0) {
        return createPaginatedResult([], 0, pagination);
      }

      whereConditions.push(
        inArray(schema.profilesTable.id, accessibleProfileIds),
      );
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Step 1: Get paginated profile IDs with proper sorting
    // This ensures LIMIT/OFFSET applies to profiles, not to joined rows with tools
    let query = db
      .select({ id: schema.profilesTable.id })
      .from(schema.profilesTable)
      .where(whereClause)
      .$dynamic();

    const direction = sorting?.sortDirection === "asc" ? asc : desc;

    // Add sorting-specific joins and order by
    if (sorting?.sortBy === "toolsCount") {
      const toolsCountSubquery = db
        .select({
          profileId: schema.profileToolsTable.profileId,
          toolsCount: count(schema.profileToolsTable.toolId).as("toolsCount"),
        })
        .from(schema.profileToolsTable)
        .innerJoin(
          schema.toolsTable,
          eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
        )
        // Double backslash needed: JS consumes one level, SQL gets the other
        .where(
          sql`NOT ${schema.toolsTable.name} LIKE 'archestra\\_\\_%' ESCAPE '\\'`,
        )
        .groupBy(schema.profileToolsTable.profileId)
        .as("toolsCounts");

      query = query
        .leftJoin(
          toolsCountSubquery,
          eq(schema.profilesTable.id, toolsCountSubquery.profileId),
        )
        .orderBy(direction(sql`COALESCE(${toolsCountSubquery.toolsCount}, 0)`));
    } else if (sorting?.sortBy === "team") {
      const teamNameSubquery = db
        .select({
          profileId: schema.profileTeamsTable.profileId,
          teamName: min(schema.teamsTable.name).as("teamName"),
        })
        .from(schema.profileTeamsTable)
        .leftJoin(
          schema.teamsTable,
          eq(schema.profileTeamsTable.teamId, schema.teamsTable.id),
        )
        .groupBy(schema.profileTeamsTable.profileId)
        .as("teamNames");

      query = query
        .leftJoin(
          teamNameSubquery,
          eq(schema.profilesTable.id, teamNameSubquery.profileId),
        )
        .orderBy(direction(sql`COALESCE(${teamNameSubquery.teamName}, '')`));
    } else {
      query = query.orderBy(orderByClause);
    }

    const sortedProfiles = await query
      .limit(pagination.limit)
      .offset(pagination.offset);

    const sortedProfileIds = sortedProfiles.map((a) => a.id);

    // If no profiles match, return early
    if (sortedProfileIds.length === 0) {
      const [{ total }] = await db
        .select({ total: count() })
        .from(schema.profilesTable)
        .where(whereClause);
      return createPaginatedResult([], Number(total), pagination);
    }

    // Step 2: Get full profile data with tools for the paginated profile IDs
    const [profilesData, [{ total: totalResult }]] = await Promise.all([
      db
        .select()
        .from(schema.profilesTable)
        .leftJoin(
          schema.profileToolsTable,
          eq(schema.profilesTable.id, schema.profileToolsTable.profileId),
        )
        .leftJoin(
          schema.toolsTable,
          eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
        )
        .where(inArray(schema.profilesTable.id, sortedProfileIds)),
      db
        .select({ total: count() })
        .from(schema.profilesTable)
        .where(whereClause),
    ]);

    // Sort in memory to maintain the order from the sorted query
    const orderMap = new Map(sortedProfileIds.map((id, index) => [id, index]));
    profilesData.sort(
      (a, b) =>
        (orderMap.get(a.profiles.id) ?? 0) - (orderMap.get(b.profiles.id) ?? 0),
    );

    // Group the flat join results by profile
    const profilesMap = new Map<string, Profile>();

    for (const row of profilesData) {
      const profile = row.profiles;
      const tool = row.tools;

      if (!profilesMap.has(profile.id)) {
        profilesMap.set(profile.id, {
          ...profile,
          tools: [],
          teams: [] as Array<{ id: string; name: string }>,
          labels: [],
        });
      }

      // Add tool if it exists and is not an Archestra MCP tool (leftJoin returns null for profiles with no tools)
      if (tool && !isArchestraMcpServerTool(tool.name)) {
        profilesMap.get(profile.id)?.tools.push(tool);
      }
    }

    const profiles = Array.from(profilesMap.values());
    const profileIds = profiles.map((profile) => profile.id);

    // Populate teams and labels for all profiles with bulk queries to avoid N+1
    const [teamsMap, labelsMap] = await Promise.all([
      ProfileTeamModel.getTeamDetailsForProfiles(profileIds),
      ProfileLabelModel.getLabelsForProfiles(profileIds),
    ]);

    // Assign teams and labels to each profile
    for (const profile of profiles) {
      profile.teams = teamsMap.get(profile.id) || [];
      profile.labels = labelsMap.get(profile.id) || [];
    }

    return createPaginatedResult(profiles, Number(totalResult), pagination);
  }

  /**
   * Helper to get the appropriate ORDER BY clause based on sorting params
   */
  private static getOrderByClause(sorting?: SortingQuery) {
    const direction = sorting?.sortDirection === "asc" ? asc : desc;

    switch (sorting?.sortBy) {
      case "name":
        return direction(schema.profilesTable.name);
      case "createdAt":
        return direction(schema.profilesTable.createdAt);
      case "toolsCount":
      case "team":
        // toolsCount and team sorting use a separate query path (see lines 168-267).
        // This fallback should never be reached for these sort types.
        return direction(schema.profilesTable.createdAt); // Fallback
      default:
        // Default: newest first
        return desc(schema.profilesTable.createdAt);
    }
  }

  /**
   * Check if a profile exists without loading related data (teams, labels, tools).
   * Use this for validation to avoid N+1 queries in bulk operations.
   */
  static async exists(id: string): Promise<boolean> {
    const [result] = await db
      .select({ id: schema.profilesTable.id })
      .from(schema.profilesTable)
      .where(eq(schema.profilesTable.id, id))
      .limit(1);

    return result !== undefined;
  }

  /**
   * Batch check if multiple profiles exist.
   * Returns a Set of profile IDs that exist.
   */
  static async existsBatch(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const results = await db
      .select({ id: schema.profilesTable.id })
      .from(schema.profilesTable)
      .where(inArray(schema.profilesTable.id, ids));

    return new Set(results.map((r) => r.id));
  }

  static async findById(
    id: string,
    userId?: string,
    isProfileAdmin?: boolean,
  ): Promise<Profile | null> {
    // Check access control for non-profile admins
    if (userId && !isProfileAdmin) {
      const hasAccess = await ProfileTeamModel.userHasProfileAccess(
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
      .from(schema.profilesTable)
      .leftJoin(
        schema.profileToolsTable,
        eq(schema.profilesTable.id, schema.profileToolsTable.profileId),
      )
      .leftJoin(
        schema.toolsTable,
        eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
      )
      .where(eq(schema.profilesTable.id, id));

    if (rows.length === 0) {
      return null;
    }

    const profile = rows[0].profiles;
    const tools = rows
      .map((row) => row.tools)
      .filter(
        (tool): tool is NonNullable<typeof tool> =>
          tool !== null && !isArchestraMcpServerTool(tool.name),
      );

    const teams = await ProfileTeamModel.getTeamDetailsForProfile(id);
    const labels = await ProfileLabelModel.getLabelsForProfile(id);

    return {
      ...profile,
      tools,
      teams,
      labels,
    };
  }

  static async getProfileOrCreateDefault(name?: string): Promise<Profile> {
    // First, try to find a profile with isDefault=true
    const rows = await db
      .select()
      .from(schema.profilesTable)
      .leftJoin(
        schema.profileToolsTable,
        eq(schema.profilesTable.id, schema.profileToolsTable.profileId),
      )
      .leftJoin(
        schema.toolsTable,
        eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
      )
      .where(eq(schema.profilesTable.isDefault, true));

    if (rows.length > 0) {
      // Default profile exists, return it
      const profile = rows[0].profiles;
      const tools = rows
        .map((row) => row.tools)
        .filter(
          (tool): tool is NonNullable<typeof tool> =>
            tool !== null && !isArchestraMcpServerTool(tool.name),
        );

      return {
        ...profile,
        tools,
        teams: await ProfileTeamModel.getTeamDetailsForProfile(profile.id),
        labels: await ProfileLabelModel.getLabelsForProfile(profile.id),
      };
    }

    // No default profile exists, create one
    return ProfileModel.create({
      name: name || DEFAULT_PROFILE_NAME,
      isDefault: true,
      teams: [],
      labels: [],
    });
  }

  static async update(
    id: string,
    { teams, labels, ...profile }: Partial<UpdateProfile>,
  ): Promise<Profile | null> {
    let updatedProfile: Omit<Profile, "tools" | "teams" | "labels"> | undefined;

    // If setting isDefault to true, unset all other profiles' isDefault first
    if (profile.isDefault === true) {
      await db
        .update(schema.profilesTable)
        .set({ isDefault: false })
        .where(eq(schema.profilesTable.isDefault, true));
    }

    // Only update profile table if there are fields to update
    if (Object.keys(profile).length > 0) {
      [updatedProfile] = await db
        .update(schema.profilesTable)
        .set(profile)
        .where(eq(schema.profilesTable.id, id))
        .returning();

      if (!updatedProfile) {
        return null;
      }
    } else {
      // If only updating teams, fetch the existing profile
      const [existingProfile] = await db
        .select()
        .from(schema.profilesTable)
        .where(eq(schema.profilesTable.id, id));

      if (!existingProfile) {
        return null;
      }

      updatedProfile = existingProfile;
    }

    // Sync team assignments if teams is provided
    if (teams !== undefined) {
      await ProfileTeamModel.syncProfileTeams(id, teams);
    }

    // Sync label assignments if labels is provided
    if (labels !== undefined) {
      await ProfileLabelModel.syncProfileLabels(id, labels);
    }

    // Fetch the tools for the updated profile
    const tools = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.profileId, updatedProfile.id));

    // Fetch current teams and labels
    const currentTeams = await ProfileTeamModel.getTeamDetailsForProfile(id);
    const currentLabels = await ProfileLabelModel.getLabelsForProfile(id);

    return {
      ...updatedProfile,
      tools,
      teams: currentTeams,
      labels: currentLabels,
    };
  }

  static async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(schema.profilesTable)
      .where(eq(schema.profilesTable.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }
}

export default ProfileModel;
