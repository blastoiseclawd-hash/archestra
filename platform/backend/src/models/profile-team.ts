import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "@/database";
import logger from "@/logging";

class ProfileTeamModel {
  /**
   * Get all profile IDs that a user has access to (through team membership)
   */
  static async getUserAccessibleProfileIds(
    userId: string,
    isProfileAdmin: boolean,
  ): Promise<string[]> {
    logger.debug(
      { userId, isProfileAdmin },
      "ProfileTeamModel.getUserAccessibleProfileIds: starting",
    );
    // Profile admins have access to all profiles
    if (isProfileAdmin) {
      const allProfiles = await db
        .select({ id: schema.profilesTable.id })
        .from(schema.profilesTable);

      logger.debug(
        { userId, count: allProfiles.length },
        "ProfileTeamModel.getUserAccessibleProfileIds: admin access to all profiles",
      );
      return allProfiles.map((profile) => profile.id);
    }

    // Get all team IDs the user is a member of
    const userTeams = await db
      .select({ teamId: schema.teamMembersTable.teamId })
      .from(schema.teamMembersTable)
      .where(eq(schema.teamMembersTable.userId, userId));

    const teamIds = userTeams.map((t) => t.teamId);

    logger.debug(
      { userId, teamCount: teamIds.length },
      "ProfileTeamModel.getUserAccessibleProfileIds: found user teams",
    );

    if (teamIds.length === 0) {
      logger.debug(
        { userId },
        "ProfileTeamModel.getUserAccessibleProfileIds: user has no team memberships",
      );
      return [];
    }

    // Get all profiles assigned to these teams
    const profileTeams = await db
      .select({ profileId: schema.profileTeamsTable.profileId })
      .from(schema.profileTeamsTable)
      .where(inArray(schema.profileTeamsTable.teamId, teamIds));

    const accessibleProfileIds = profileTeams.map((at) => at.profileId);

    logger.debug(
      { userId, profileCount: accessibleProfileIds.length },
      "ProfileTeamModel.getUserAccessibleProfileIds: completed",
    );
    return accessibleProfileIds;
  }

  /**
   * Check if a user has access to a specific profile (through team membership)
   */
  static async userHasProfileAccess(
    userId: string,
    profileId: string,
    isProfileAdmin: boolean,
  ): Promise<boolean> {
    logger.debug(
      { userId, profileId, isProfileAdmin },
      "ProfileTeamModel.userHasProfileAccess: checking access",
    );
    // Profile admins have access to all profiles
    if (isProfileAdmin) {
      logger.debug(
        { userId, profileId },
        "ProfileTeamModel.userHasProfileAccess: admin has access",
      );
      return true;
    }

    // Get all team IDs the user is a member of
    const userTeams = await db
      .select({ teamId: schema.teamMembersTable.teamId })
      .from(schema.teamMembersTable)
      .where(eq(schema.teamMembersTable.userId, userId));

    const teamIds = userTeams.map((t) => t.teamId);

    if (teamIds.length === 0) {
      logger.debug(
        { userId, profileId },
        "ProfileTeamModel.userHasProfileAccess: user has no teams",
      );
      return false;
    }

    // Check if the profile is assigned to any of the user's teams
    const profileTeam = await db
      .select()
      .from(schema.profileTeamsTable)
      .where(
        and(
          eq(schema.profileTeamsTable.profileId, profileId),
          inArray(schema.profileTeamsTable.teamId, teamIds),
        ),
      )
      .limit(1);

    const hasAccess = profileTeam.length > 0;
    logger.debug(
      { userId, profileId, hasAccess },
      "ProfileTeamModel.userHasProfileAccess: completed",
    );
    return hasAccess;
  }

  /**
   * Get all team IDs assigned to a specific profile
   */
  static async getTeamsForProfile(profileId: string): Promise<string[]> {
    logger.debug(
      { profileId },
      "ProfileTeamModel.getTeamsForProfile: fetching teams",
    );
    const profileTeams = await db
      .select({ teamId: schema.profileTeamsTable.teamId })
      .from(schema.profileTeamsTable)
      .where(eq(schema.profileTeamsTable.profileId, profileId));

    const teamIds = profileTeams.map((at) => at.teamId);
    logger.debug(
      { profileId, count: teamIds.length },
      "ProfileTeamModel.getTeamsForProfile: completed",
    );
    return teamIds;
  }

  /**
   * Get team details (id and name) for a specific profile
   */
  static async getTeamDetailsForProfile(
    profileId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    logger.debug(
      { profileId },
      "ProfileTeamModel.getTeamDetailsForProfile: fetching team details",
    );
    const profileTeams = await db
      .select({
        teamId: schema.profileTeamsTable.teamId,
        teamName: schema.teamsTable.name,
      })
      .from(schema.profileTeamsTable)
      .innerJoin(
        schema.teamsTable,
        eq(schema.profileTeamsTable.teamId, schema.teamsTable.id),
      )
      .where(eq(schema.profileTeamsTable.profileId, profileId));

    const teams = profileTeams.map((at) => ({
      id: at.teamId,
      name: at.teamName,
    }));
    logger.debug(
      { profileId, count: teams.length },
      "ProfileTeamModel.getTeamDetailsForProfile: completed",
    );
    return teams;
  }

  /**
   * Sync team assignments for a profile (replaces all existing assignments)
   */
  static async syncProfileTeams(
    profileId: string,
    teamIds: string[],
  ): Promise<number> {
    logger.debug(
      { profileId, teamCount: teamIds.length },
      "ProfileTeamModel.syncProfileTeams: syncing teams",
    );
    await db.transaction(async (tx) => {
      // Delete all existing team assignments
      await tx
        .delete(schema.profileTeamsTable)
        .where(eq(schema.profileTeamsTable.profileId, profileId));

      // Insert new team assignments (if any teams provided)
      if (teamIds.length > 0) {
        await tx.insert(schema.profileTeamsTable).values(
          teamIds.map((teamId) => ({
            profileId,
            teamId,
          })),
        );
      }
    });

    logger.debug(
      { profileId, assignedCount: teamIds.length },
      "ProfileTeamModel.syncProfileTeams: completed",
    );
    return teamIds.length;
  }

  /**
   * Assign teams to a profile (idempotent)
   */
  static async assignTeamsToProfile(
    profileId: string,
    teamIds: string[],
  ): Promise<void> {
    logger.debug(
      { profileId, teamCount: teamIds.length },
      "ProfileTeamModel.assignTeamsToProfile: assigning teams",
    );
    if (teamIds.length === 0) {
      logger.debug(
        { profileId },
        "ProfileTeamModel.assignTeamsToProfile: no teams to assign",
      );
      return;
    }

    await db
      .insert(schema.profileTeamsTable)
      .values(
        teamIds.map((teamId) => ({
          profileId,
          teamId,
        })),
      )
      .onConflictDoNothing();

    logger.debug(
      { profileId },
      "ProfileTeamModel.assignTeamsToProfile: completed",
    );
  }

  /**
   * Remove a team assignment from a profile
   */
  static async removeTeamFromProfile(
    profileId: string,
    teamId: string,
  ): Promise<boolean> {
    logger.debug(
      { profileId, teamId },
      "ProfileTeamModel.removeTeamFromProfile: removing team",
    );
    const result = await db
      .delete(schema.profileTeamsTable)
      .where(
        and(
          eq(schema.profileTeamsTable.profileId, profileId),
          eq(schema.profileTeamsTable.teamId, teamId),
        ),
      );

    const removed = result.rowCount !== null && result.rowCount > 0;
    logger.debug(
      { profileId, teamId, removed },
      "ProfileTeamModel.removeTeamFromProfile: completed",
    );
    return removed;
  }

  /**
   * Get team IDs for multiple profiles in one query to avoid N+1
   */
  static async getTeamsForProfiles(
    profileIds: string[],
  ): Promise<Map<string, string[]>> {
    logger.debug(
      { profileCount: profileIds.length },
      "ProfileTeamModel.getTeamsForProfiles: fetching teams",
    );
    if (profileIds.length === 0) {
      logger.debug(
        "ProfileTeamModel.getTeamsForProfiles: no profiles provided",
      );
      return new Map();
    }

    const profileTeams = await db
      .select({
        profileId: schema.profileTeamsTable.profileId,
        teamId: schema.profileTeamsTable.teamId,
      })
      .from(schema.profileTeamsTable)
      .where(inArray(schema.profileTeamsTable.profileId, profileIds));

    const teamsMap = new Map<string, string[]>();

    // Initialize all profile IDs with empty arrays
    for (const profileId of profileIds) {
      teamsMap.set(profileId, []);
    }

    // Populate the map with teams
    for (const { profileId, teamId } of profileTeams) {
      const teams = teamsMap.get(profileId) || [];
      teams.push(teamId);
      teamsMap.set(profileId, teams);
    }

    logger.debug(
      { profileCount: profileIds.length, assignmentCount: profileTeams.length },
      "ProfileTeamModel.getTeamsForProfiles: completed",
    );
    return teamsMap;
  }

  /**
   * Get team details (id and name) for multiple profiles in one query to avoid N+1
   */
  static async getTeamDetailsForProfiles(
    profileIds: string[],
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    logger.debug(
      { profileCount: profileIds.length },
      "ProfileTeamModel.getTeamDetailsForProfiles: fetching team details",
    );
    if (profileIds.length === 0) {
      logger.debug(
        "ProfileTeamModel.getTeamDetailsForProfiles: no profiles provided",
      );
      return new Map();
    }

    const profileTeams = await db
      .select({
        profileId: schema.profileTeamsTable.profileId,
        teamId: schema.profileTeamsTable.teamId,
        teamName: schema.teamsTable.name,
      })
      .from(schema.profileTeamsTable)
      .innerJoin(
        schema.teamsTable,
        eq(schema.profileTeamsTable.teamId, schema.teamsTable.id),
      )
      .where(inArray(schema.profileTeamsTable.profileId, profileIds));

    const teamsMap = new Map<string, Array<{ id: string; name: string }>>();

    // Initialize all profile IDs with empty arrays
    for (const profileId of profileIds) {
      teamsMap.set(profileId, []);
    }

    // Populate the map with team details
    for (const { profileId, teamId, teamName } of profileTeams) {
      const teams = teamsMap.get(profileId) || [];
      teams.push({ id: teamId, name: teamName });
      teamsMap.set(profileId, teams);
    }

    logger.debug(
      { profileCount: profileIds.length, assignmentCount: profileTeams.length },
      "ProfileTeamModel.getTeamDetailsForProfiles: completed",
    );
    return teamsMap;
  }

  /**
   * Check if a profile and MCP server share any teams
   * Returns true if there's at least one team that both the profile and MCP server are assigned to
   */
  static async profileAndMcpServerShareTeam(
    profileId: string,
    mcpServerId: string,
  ): Promise<boolean> {
    logger.debug(
      { profileId, mcpServerId },
      "ProfileTeamModel.profileAndMcpServerShareTeam: checking shared teams",
    );
    const result = await db
      .select({ teamId: schema.profileTeamsTable.teamId })
      .from(schema.profileTeamsTable)
      .innerJoin(
        schema.mcpServersTable,
        eq(schema.profileTeamsTable.teamId, schema.mcpServersTable.teamId),
      )
      .where(
        and(
          eq(schema.profileTeamsTable.profileId, profileId),
          eq(schema.mcpServersTable.id, mcpServerId),
        ),
      )
      .limit(1);

    const shareTeam = result.length > 0;
    logger.debug(
      { profileId, mcpServerId, shareTeam },
      "ProfileTeamModel.profileAndMcpServerShareTeam: completed",
    );
    return shareTeam;
  }
}

export default ProfileTeamModel;
