import {
  TOOL_ARTIFACT_WRITE_FULL_NAME,
  TOOL_TODO_WRITE_FULL_NAME,
} from "@shared";
import { describe, expect, test } from "@/test";
import ProfileModel from "./profile";
import TeamModel from "./team";

describe("ProfileModel", () => {
  test("can create a profile", async () => {
    await ProfileModel.create({ name: "Test Profile", teams: [] });
    await ProfileModel.create({ name: "Test Profile 2", teams: [] });

    // Expecting 3: 2 created + 1 default profile from migration
    expect(await ProfileModel.findAll()).toHaveLength(3);
  });

  describe("exists", () => {
    test("returns true for an existing profile", async () => {
      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
      });

      const exists = await ProfileModel.exists(profile.id);
      expect(exists).toBe(true);
    });

    test("returns false for a non-existent profile", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000000";
      const exists = await ProfileModel.exists(nonExistentId);
      expect(exists).toBe(false);
    });
  });

  describe("existsBatch", () => {
    test("returns Set of existing profile IDs", async () => {
      const profile1 = await ProfileModel.create({
        name: "Test Profile 1",
        teams: [],
      });
      const profile2 = await ProfileModel.create({
        name: "Test Profile 2",
        teams: [],
      });
      const nonExistentId = "00000000-0000-0000-0000-000000000000";

      const existingIds = await ProfileModel.existsBatch([
        profile1.id,
        profile2.id,
        nonExistentId,
      ]);

      expect(existingIds).toBeInstanceOf(Set);
      expect(existingIds.size).toBe(2);
      expect(existingIds.has(profile1.id)).toBe(true);
      expect(existingIds.has(profile2.id)).toBe(true);
      expect(existingIds.has(nonExistentId)).toBe(false);
    });

    test("returns empty Set for empty input", async () => {
      const existingIds = await ProfileModel.existsBatch([]);

      expect(existingIds).toBeInstanceOf(Set);
      expect(existingIds.size).toBe(0);
    });

    test("returns empty Set when no profiles exist", async () => {
      const nonExistentId1 = "00000000-0000-0000-0000-000000000000";
      const nonExistentId2 = "00000000-0000-4000-8000-000000000099";

      const existingIds = await ProfileModel.existsBatch([
        nonExistentId1,
        nonExistentId2,
      ]);

      expect(existingIds).toBeInstanceOf(Set);
      expect(existingIds.size).toBe(0);
    });

    test("handles duplicate IDs in input", async () => {
      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
      });

      const existingIds = await ProfileModel.existsBatch([
        profile.id,
        profile.id,
        profile.id,
      ]);

      expect(existingIds.size).toBe(1);
      expect(existingIds.has(profile.id)).toBe(true);
    });
  });

  describe("Access Control", () => {
    test("can create profile with team assignments", async ({
      makeUser,
      makeOrganization,
      makeTeam,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const team = await makeTeam(org.id, user.id);

      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [team.id],
      });

      expect(profile.teams).toHaveLength(1);
      expect(profile.teams[0]).toMatchObject({ id: team.id, name: team.name });
    });

    test("admin can see all profiles", async ({ makeAdmin }) => {
      const admin = await makeAdmin();

      await ProfileModel.create({ name: "Profile 1", teams: [] });
      await ProfileModel.create({ name: "Profile 2", teams: [] });
      await ProfileModel.create({ name: "Profile 3", teams: [] });

      const profiles = await ProfileModel.findAll(admin.id, true);
      // Expecting 4: 3 created + 1 default profile from migration
      expect(profiles).toHaveLength(4);
    });

    test("member only sees profiles in their teams", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user1 = await makeUser();
      const user2 = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      // Create two teams
      const team1 = await makeTeam(org.id, admin.id, { name: "Team 1" });
      const team2 = await makeTeam(org.id, admin.id, { name: "Team 2" });

      // Add user1 to team1, user2 to team2
      await TeamModel.addMember(team1.id, user1.id);
      await TeamModel.addMember(team2.id, user2.id);

      // Create profiles assigned to different teams
      const profile1 = await ProfileModel.create({
        name: "Profile 1",
        teams: [team1.id],
      });
      await ProfileModel.create({
        name: "Profile 2",
        teams: [team2.id],
      });
      await ProfileModel.create({
        name: "Profile 3",
        teams: [],
      });

      // user1 only has access to profile1 (via team1)
      const profiles = await ProfileModel.findAll(user1.id, false);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].id).toBe(profile1.id);
    });

    test("member with no team membership sees empty list", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user1 = await makeUser();
      const user2 = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team = await makeTeam(org.id, admin.id);
      await TeamModel.addMember(team.id, user1.id);

      await ProfileModel.create({
        name: "Profile 1",
        teams: [team.id],
      });

      // user2 is not in any team
      const profiles = await ProfileModel.findAll(user2.id, false);
      expect(profiles).toHaveLength(0);
    });

    test("findById returns profile for admin", async ({ makeAdmin }) => {
      const admin = await makeAdmin();

      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
      });

      const foundProfile = await ProfileModel.findById(
        profile.id,
        admin.id,
        true,
      );
      expect(foundProfile).not.toBeNull();
      expect(foundProfile?.id).toBe(profile.id);
    });

    test("findById returns profile for user in assigned team", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team = await makeTeam(org.id, admin.id);
      await TeamModel.addMember(team.id, user.id);

      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [team.id],
      });

      const foundProfile = await ProfileModel.findById(
        profile.id,
        user.id,
        false,
      );
      expect(foundProfile).not.toBeNull();
      expect(foundProfile?.id).toBe(profile.id);
    });

    test("findById returns null for user not in assigned teams", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user1 = await makeUser();
      const user2 = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team = await makeTeam(org.id, admin.id);
      await TeamModel.addMember(team.id, user1.id);

      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [team.id],
      });

      const foundProfile = await ProfileModel.findById(
        profile.id,
        user2.id,
        false,
      );
      expect(foundProfile).toBeNull();
    });

    test("update syncs team assignments correctly", async ({
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team1 = await makeTeam(org.id, admin.id, { name: "Team 1" });
      const team2 = await makeTeam(org.id, admin.id, { name: "Team 2" });

      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [team1.id],
      });

      expect(profile.teams).toHaveLength(1);
      expect(profile.teams[0]).toMatchObject({
        id: team1.id,
        name: team1.name,
      });

      // Update to only include team2
      const updatedProfile = await ProfileModel.update(profile.id, {
        teams: [team2.id],
      });

      expect(updatedProfile?.teams).toHaveLength(1);
      expect(updatedProfile?.teams[0]).toMatchObject({
        id: team2.id,
        name: team2.name,
      });
      expect(updatedProfile?.teams.some((t) => t.id === team1.id)).toBe(false);
    });

    test("update without teams keeps existing assignments", async ({
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team = await makeTeam(org.id, admin.id);

      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [team.id],
      });

      const initialTeams = profile.teams;

      // Update only the name
      const updatedProfile = await ProfileModel.update(profile.id, {
        name: "Updated Name",
      });

      expect(updatedProfile?.name).toBe("Updated Name");
      expect(updatedProfile?.teams).toEqual(initialTeams);
    });

    test("teams is always populated in responses", async ({
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team = await makeTeam(org.id, admin.id);

      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [team.id],
      });

      expect(profile.teams).toBeDefined();
      expect(Array.isArray(profile.teams)).toBe(true);
      expect(profile.teams).toHaveLength(1);

      const foundProfile = await ProfileModel.findById(profile.id);
      expect(foundProfile?.teams).toBeDefined();
      expect(Array.isArray(foundProfile?.teams)).toBe(true);
    });
  });

  describe("Team Assignment Validation", () => {
    test("admin can create profile without any team", async () => {
      const profile = await ProfileModel.create({
        name: "No Team Profile",
        teams: [],
      });

      expect(profile.teams).toHaveLength(0);

      // Verify profile is accessible (admins can see all profiles)
      const foundProfile = await ProfileModel.findById(profile.id);
      expect(foundProfile).not.toBeNull();
    });

    test("admin can create profile with any team regardless of membership", async ({
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const admin = await makeAdmin();
      const org = await makeOrganization();

      // Create a team where admin is NOT a member
      const team = await makeTeam(org.id, admin.id, {
        name: "Team Admin Not In",
      });
      // Note: makeTeam creates team but doesn't automatically add the creator as member

      const profile = await ProfileModel.create({
        name: "Admin Created Profile",
        teams: [team.id],
      });

      expect(profile.teams).toHaveLength(1);
      expect(profile.teams[0].id).toBe(team.id);
    });

    test("non-admin user can only see profiles in teams they belong to", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const userTeam = await makeTeam(org.id, admin.id, { name: "User Team" });
      const otherTeam = await makeTeam(org.id, admin.id, {
        name: "Other Team",
      });

      // Add user to userTeam only
      await TeamModel.addMember(userTeam.id, user.id);

      // Create profiles in different teams
      const userTeamProfile = await ProfileModel.create({
        name: "User Team Profile",
        teams: [userTeam.id],
      });
      await ProfileModel.create({
        name: "Other Team Profile",
        teams: [otherTeam.id],
      });
      await ProfileModel.create({
        name: "No Team Profile",
        teams: [],
      });

      // Non-admin user should only see profile in their team
      const profiles = await ProfileModel.findAll(user.id, false);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].id).toBe(userTeamProfile.id);
    });

    test("non-admin user cannot see profiles with no team", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const userTeam = await makeTeam(org.id, admin.id);
      await TeamModel.addMember(userTeam.id, user.id);

      // Create profile with no teams
      await ProfileModel.create({
        name: "No Team Profile",
        teams: [],
      });

      // Non-admin user should not see profile with no teams
      const profiles = await ProfileModel.findAll(user.id, false);
      // Only profiles in user's team should be visible
      expect(profiles.every((a) => a.teams.length > 0)).toBe(true);
    });

    test("user with no team membership sees empty list", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const userWithNoTeam = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team = await makeTeam(org.id, admin.id);

      // Create profiles with and without teams
      await ProfileModel.create({
        name: "Profile in Team",
        teams: [team.id],
      });
      await ProfileModel.create({
        name: "Profile without Team",
        teams: [],
      });

      // User with no team membership should see nothing
      const profiles = await ProfileModel.findAll(userWithNoTeam.id, false);
      expect(profiles).toHaveLength(0);
    });

    test("getUserTeamIds returns correct teams for validation", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team1 = await makeTeam(org.id, admin.id, { name: "Team 1" });
      const team2 = await makeTeam(org.id, admin.id, { name: "Team 2" });
      const team3 = await makeTeam(org.id, admin.id, { name: "Team 3" });

      // Add user to team1 and team2 only
      await TeamModel.addMember(team1.id, user.id);
      await TeamModel.addMember(team2.id, user.id);

      const userTeamIds = await TeamModel.getUserTeamIds(user.id);

      // User should be in exactly 2 teams
      expect(userTeamIds).toHaveLength(2);
      expect(userTeamIds).toContain(team1.id);
      expect(userTeamIds).toContain(team2.id);
      expect(userTeamIds).not.toContain(team3.id);

      // Creating a profile with team1 should work (user is member)
      const profile = await ProfileModel.create({
        name: "Valid Profile",
        teams: [team1.id],
      });
      expect(profile.teams).toHaveLength(1);
      expect(profile.teams[0].id).toBe(team1.id);
    });
  });

  describe("Label Ordering", () => {
    test("labels are returned in alphabetical order by key", async () => {
      // Create a profile with labels in non-alphabetical order
      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
        labels: [
          { key: "region", value: "us-west-2" },
          { key: "environment", value: "production" },
          { key: "team", value: "engineering" },
        ],
      });

      // Verify labels are returned in alphabetical order
      expect(profile.labels).toHaveLength(3);
      expect(profile.labels[0].key).toBe("environment");
      expect(profile.labels[0].value).toBe("production");
      expect(profile.labels[1].key).toBe("region");
      expect(profile.labels[1].value).toBe("us-west-2");
      expect(profile.labels[2].key).toBe("team");
      expect(profile.labels[2].value).toBe("engineering");
    });

    test("findById returns labels in alphabetical order", async () => {
      // Create a profile with labels
      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
        labels: [
          { key: "zebra", value: "last" },
          { key: "alpha", value: "first" },
          { key: "beta", value: "second" },
        ],
      });

      // Retrieve the profile by ID
      const foundProfile = await ProfileModel.findById(profile.id);

      if (!foundProfile) {
        throw new Error("Profile not found");
      }

      expect(foundProfile.labels).toHaveLength(3);
      expect(foundProfile.labels[0].key).toBe("alpha");
      expect(foundProfile.labels[1].key).toBe("beta");
      expect(foundProfile.labels[2].key).toBe("zebra");
    });

    test("findAll returns labels in alphabetical order for all profiles", async () => {
      // Create multiple profiles with labels
      await ProfileModel.create({
        name: "Profile 1",
        teams: [],
        labels: [
          { key: "environment", value: "prod" },
          { key: "application", value: "web" },
        ],
      });

      await ProfileModel.create({
        name: "Profile 2",
        teams: [],
        labels: [
          { key: "zone", value: "us-east" },
          { key: "deployment", value: "blue" },
        ],
      });

      const profiles = await ProfileModel.findAll();

      // Expecting 3: 2 created + 1 default profile from migration
      expect(profiles).toHaveLength(3);

      // Check first profile's labels are sorted
      const profile1 = profiles.find((a) => a.name === "Profile 1");
      if (!profile1) {
        throw new Error("Profile 1 not found");
      }

      expect(profile1.labels[0].key).toBe("application");
      expect(profile1.labels[1].key).toBe("environment");

      // Check second profile's labels are sorted
      const profile2 = profiles.find((a) => a.name === "Profile 2");
      if (!profile2) {
        throw new Error("Profile 2 not found");
      }

      expect(profile2.labels[0].key).toBe("deployment");
      expect(profile2.labels[1].key).toBe("zone");
    });
  });

  describe("Pagination", () => {
    test("pagination count matches filtered results for non-admin user", async ({
      makeUser,
      makeAdmin,
      makeOrganization,
      makeTeam,
    }) => {
      const user = await makeUser();
      const admin = await makeAdmin();
      const org = await makeOrganization();

      // Create team and add user to it
      const team = await makeTeam(org.id, admin.id, { name: "Team 1" });
      await TeamModel.addMember(team.id, user.id);

      // Create 4 profiles: 1 with team assignment, 3 without
      await ProfileModel.create({
        name: "Profile 1",
        teams: [team.id],
      });
      await ProfileModel.create({
        name: "Profile 2",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile 3",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile 4",
        teams: [],
      });

      // Query as non-admin user (should only see Profile 1)
      const result = await ProfileModel.findAllPaginated(
        { limit: 20, offset: 0 },
        { sortBy: "createdAt", sortDirection: "desc" },
        {},
        user.id,
        false, // not admin
      );

      // The bug: total count should match the actual number of accessible profiles
      expect(result.data).toHaveLength(1); // Only Profile 1 is accessible
      expect(result.pagination.total).toBe(1); // Total should also be 1, not 5 (including default profile)
      expect(result.data[0].name).toBe("Profile 1");
    });

    test("pagination count includes all profiles for admin", async ({
      makeAdmin,
    }) => {
      const admin = await makeAdmin();

      // Create 3 profiles (+ 1 default from migration = 4 total)
      await ProfileModel.create({
        name: "Profile 1",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile 2",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile 3",
        teams: [],
      });

      // Query as admin (should see all profiles)
      const result = await ProfileModel.findAllPaginated(
        { limit: 20, offset: 0 },
        { sortBy: "createdAt", sortDirection: "desc" },
        {},
        admin.id,
        true, // is admin
      );

      expect(result.data.length).toBe(result.pagination.total);
      expect(result.pagination.total).toBe(4); // 3 + 1 default
    });

    test("pagination works correctly when profiles have many tools", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create 5 profiles with varying numbers of tools
      const profile1 = await ProfileModel.create({
        name: "Profile 1",
        teams: [],
      });
      const profile2 = await ProfileModel.create({
        name: "Profile 2",
        teams: [],
      });
      const profile3 = await ProfileModel.create({
        name: "Profile 3",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile 4",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile 5",
        teams: [],
      });

      // Give profile1 and profile2 many tools (50+ each) via junction table
      for (let i = 0; i < 50; i++) {
        const tool = await makeTool({
          name: `tool_profile1_${i}`,
          description: `Tool ${i} for profile 1`,
          parameters: {},
        });
        await makeProfileTool(profile1.id, tool.id);
      }

      for (let i = 0; i < 50; i++) {
        const tool = await makeTool({
          name: `tool_profile2_${i}`,
          description: `Tool ${i} for profile 2`,
          parameters: {},
        });
        await makeProfileTool(profile2.id, tool.id);
      }

      // Give profile3 a few tools via junction table
      for (let i = 0; i < 5; i++) {
        const tool = await makeTool({
          name: `tool_profile3_${i}`,
          description: `Tool ${i} for profile 3`,
          parameters: {},
        });
        await makeProfileTool(profile3.id, tool.id);
      }

      // profile4 and profile5 have no tools (just the default archestra tools)

      // Query with limit=20 - this should return all 6 profiles (5 + 1 default)
      // Bug scenario: if LIMIT was applied to joined rows, we'd only get 2 profiles
      const result = await ProfileModel.findAllPaginated(
        { limit: 20, offset: 0 },
        { sortBy: "createdAt", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );

      expect(result.data).toHaveLength(6); // 5 created + 1 default
      expect(result.pagination.total).toBe(6);

      // Verify all profiles are returned (not just the first 2 with many tools)
      const profileNames = result.data.map((a) => a.name).sort();
      expect(profileNames).toContain("Profile 1");
      expect(profileNames).toContain("Profile 2");
      expect(profileNames).toContain("Profile 3");
      expect(profileNames).toContain("Profile 4");
      expect(profileNames).toContain("Profile 5");
    });

    test("pagination limit applies to profiles, not tool rows", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create 3 profiles
      const profile1 = await ProfileModel.create({
        name: "Profile A",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile B",
        teams: [],
      });
      await ProfileModel.create({
        name: "Profile C",
        teams: [],
      });

      // Give profile1 many tools via junction table
      for (let i = 0; i < 30; i++) {
        const tool = await makeTool({
          name: `tool_${i}`,
          description: `Tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile1.id, tool.id);
      }

      // Query with limit=2 - should return exactly 2 profiles
      const result = await ProfileModel.findAllPaginated(
        { limit: 2, offset: 0 },
        { sortBy: "name", sortDirection: "asc" },
        {},
        admin.id,
        true,
      );

      expect(result.data).toHaveLength(2);
      // Default Profile comes first alphabetically ("D" < "P")
      expect(result.data[0].name).toBe("Default Profile");
      expect(result.data[1].name).toBe("Profile A");

      // Verify Profile A has all their regular tools loaded (excluding Archestra tools)
      expect(result.data[1].tools.length).toBe(30); // Only the 30 regular tools, Archestra tools excluded
    });

    test("pagination with different sort options returns correct profile count", async ({
      makeAdmin,
      makeOrganization,
      makeTeam,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();
      const org = await makeOrganization();

      const team1 = await makeTeam(org.id, admin.id, { name: "Team A" });
      const team2 = await makeTeam(org.id, admin.id, { name: "Team B" });

      // Create 4 profiles with varying tools and teams
      const profile1 = await ProfileModel.create({
        name: "Zebra",
        teams: [team1.id],
      });
      const profile2 = await ProfileModel.create({
        name: "Alpha",
        teams: [team2.id],
      });
      await ProfileModel.create({
        name: "Beta",
        teams: [team1.id],
      });
      await ProfileModel.create({
        name: "Gamma",
        teams: [],
      });

      // Give different numbers of tools via junction table
      for (let i = 0; i < 20; i++) {
        const tool = await makeTool({
          name: `tool_zebra_${i}`,
          description: `Tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile1.id, tool.id);
      }

      for (let i = 0; i < 5; i++) {
        const tool = await makeTool({
          name: `tool_alpha_${i}`,
          description: `Tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile2.id, tool.id);
      }

      // Test sortBy name
      const resultByName = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "name", sortDirection: "asc" },
        {},
        admin.id,
        true,
      );
      expect(resultByName.data).toHaveLength(5); // 4 + 1 default
      expect(resultByName.data[0].name).toBe("Alpha");

      // Test sortBy createdAt
      const resultByDate = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "createdAt", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );
      expect(resultByDate.data).toHaveLength(5);

      // Test sortBy toolsCount
      const resultByToolsCount = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "toolsCount", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );
      expect(resultByToolsCount.data).toHaveLength(5);
      // Profile with most tools should be first
      expect(resultByToolsCount.data[0].name).toBe("Zebra");

      // Test sortBy team
      const resultByTeam = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "team", sortDirection: "asc" },
        {},
        admin.id,
        true,
      );
      expect(resultByTeam.data).toHaveLength(5);
    });

    test("pagination offset works correctly with many tools", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create 5 profiles, each with many tools
      const profileIds: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const profile = await ProfileModel.create({
          name: `Profile ${i}`,
          teams: [],
        });
        profileIds.push(profile.id);

        // Give each profile 20 tools via junction table
        for (let j = 0; j < 20; j++) {
          const tool = await makeTool({
            name: `tool_${i}_${j}`,
            description: `Tool ${j}`,
            parameters: {},
          });
          await makeProfileTool(profile.id, tool.id);
        }
      }

      // First page (limit=2, offset=0)
      const page1 = await ProfileModel.findAllPaginated(
        { limit: 2, offset: 0 },
        { sortBy: "createdAt", sortDirection: "asc" },
        {},
        admin.id,
        true,
      );

      expect(page1.data).toHaveLength(2);
      expect(page1.pagination.total).toBe(6); // 5 + 1 default

      // Second page (limit=2, offset=2)
      const page2 = await ProfileModel.findAllPaginated(
        { limit: 2, offset: 2 },
        { sortBy: "createdAt", sortDirection: "asc" },
        {},
        admin.id,
        true,
      );

      expect(page2.data).toHaveLength(2);
      expect(page2.pagination.total).toBe(6);

      // Verify no overlap between pages
      const page1Ids = page1.data.map((a) => a.id);
      const page2Ids = page2.data.map((a) => a.id);
      const intersection = page1Ids.filter((id) => page2Ids.includes(id));
      expect(intersection).toHaveLength(0);
    });
  });

  describe("Archestra Tools Exclusion", () => {
    test("findAllPaginated excludes Archestra MCP tools from tools array", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create a profile
      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
      });

      // Add some regular tools
      for (let i = 0; i < 3; i++) {
        const tool = await makeTool({
          name: `regular_tool_${i}`,
          description: `Regular tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile.id, tool.id);
      }

      // Add some Archestra MCP tools (these should be excluded)
      for (let i = 0; i < 5; i++) {
        const tool = await makeTool({
          name: `archestra__archestra_tool_${i}`,
          description: `Archestra tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile.id, tool.id);
      }

      // Query the profile
      const result = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "createdAt", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );

      // Find our test profile
      const testProfile = result.data.find((a) => a.name === "Test Profile");
      expect(testProfile).toBeDefined();

      // Should only include the 3 regular tools, not the 5 Archestra tools
      expect(testProfile?.tools).toHaveLength(3);

      // Verify all tools in the array are regular tools (not Archestra)
      for (const tool of testProfile?.tools ?? []) {
        expect(tool.name).not.toMatch(/^archestra__/);
      }

      // Verify the regular tools are there
      const toolNames = testProfile?.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "regular_tool_0",
        "regular_tool_1",
        "regular_tool_2",
      ]);
    });

    test("sorting by toolsCount excludes Archestra tools from count", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create two profiles
      const profile1 = await ProfileModel.create({
        name: "Profile with 5 regular tools",
        teams: [],
      });

      const profile2 = await ProfileModel.create({
        name: "Profile with 2 regular tools",
        teams: [],
      });

      // Give profile1 5 regular tools + 10 Archestra tools
      for (let i = 0; i < 5; i++) {
        const tool = await makeTool({
          name: `regular_tool_profile1_${i}`,
          description: `Regular tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile1.id, tool.id);
      }

      for (let i = 0; i < 10; i++) {
        const tool = await makeTool({
          name: `archestra__tool_profile1_${i}`,
          description: `Archestra tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile1.id, tool.id);
      }

      // Give profile2 2 regular tools + 20 Archestra tools
      for (let i = 0; i < 2; i++) {
        const tool = await makeTool({
          name: `regular_tool_profile2_${i}`,
          description: `Regular tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile2.id, tool.id);
      }

      for (let i = 0; i < 20; i++) {
        const tool = await makeTool({
          name: `archestra__tool_profile2_${i}`,
          description: `Archestra tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile2.id, tool.id);
      }

      // Sort by toolsCount descending - profile1 should come first (5 > 2 regular tools)
      const result = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "toolsCount", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );

      // Find our test profiles
      const testProfile1 = result.data.find(
        (a) => a.name === "Profile with 5 regular tools",
      );
      const testProfile2 = result.data.find(
        (a) => a.name === "Profile with 2 regular tools",
      );

      expect(testProfile1).toBeDefined();
      expect(testProfile2).toBeDefined();

      // Verify the tools count excludes Archestra tools
      expect(testProfile1?.tools).toHaveLength(5); // Only regular tools
      expect(testProfile2?.tools).toHaveLength(2); // Only regular tools

      // Verify sorting order based on regular tools count (not total tools including Archestra)
      const profile1Index = result.data.findIndex(
        (a) => a.name === "Profile with 5 regular tools",
      );
      const profile2Index = result.data.findIndex(
        (a) => a.name === "Profile with 2 regular tools",
      );

      // profile1 should come before profile2 when sorted by toolsCount desc
      expect(profile1Index).toBeLessThan(profile2Index);
    });

    test("profiles with only Archestra tools show 0 tools", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create a profile with only Archestra tools
      const profile = await ProfileModel.create({
        name: "Archestra Only Profile",
        teams: [],
      });

      // Add only Archestra MCP tools
      for (let i = 0; i < 3; i++) {
        const tool = await makeTool({
          name: `archestra__only_archestra_${i}`,
          description: `Archestra tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile.id, tool.id);
      }

      // Query the profile
      const result = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "createdAt", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );

      // Find our test profile
      const testProfile = result.data.find(
        (a) => a.name === "Archestra Only Profile",
      );
      expect(testProfile).toBeDefined();

      // Should show 0 tools since all were Archestra tools
      expect(testProfile?.tools).toHaveLength(0);
    });

    test("exclusion pattern only matches double underscore prefix", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create a profile
      const profile = await ProfileModel.create({
        name: "Pattern Test Profile",
        teams: [],
      });

      // Create tools with double underscore (should be excluded)
      const doubleUnderscoreTool = await makeTool({
        name: "archestra__pattern_test_tool",
        description: "Archestra tool",
        parameters: {},
      });

      // Create tools with similar names that should NOT be excluded
      const singleUnderscoreTool = await makeTool({
        name: "archestra_pattern_single",
        description: "Single underscore tool",
        parameters: {},
      });
      const noUnderscoreTool = await makeTool({
        name: "archestrapatterntest",
        description: "No underscore tool",
        parameters: {},
      });
      const regularTool = await makeTool({
        name: "regular_pattern_tool",
        description: "Regular tool",
        parameters: {},
      });

      await makeProfileTool(profile.id, doubleUnderscoreTool.id);
      await makeProfileTool(profile.id, singleUnderscoreTool.id);
      await makeProfileTool(profile.id, noUnderscoreTool.id);
      await makeProfileTool(profile.id, regularTool.id);

      // Query the profile
      const result = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "createdAt", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );

      // Find our test profile
      const testProfile = result.data.find(
        (a) => a.name === "Pattern Test Profile",
      );
      expect(testProfile).toBeDefined();

      // Should have 3 tools (excludes only archestra__pattern_test_tool)
      expect(testProfile?.tools).toHaveLength(3);

      const toolNames = testProfile?.tools.map((t) => t.name) ?? [];
      expect(toolNames).toContain("archestra_pattern_single");
      expect(toolNames).toContain("archestrapatterntest");
      expect(toolNames).toContain("regular_pattern_tool");
      expect(toolNames).not.toContain("archestra__pattern_test_tool");
    });

    test("sortBy toolsCount correctly excludes only double underscore prefix", async ({
      makeAdmin,
      makeTool,
      makeProfileTool,
    }) => {
      const admin = await makeAdmin();

      // Create two profiles
      const profile1 = await ProfileModel.create({
        name: "Profile with mixed tools",
        teams: [],
      });

      const profile2 = await ProfileModel.create({
        name: "Profile with single underscore",
        teams: [],
      });

      // Give profile1: 1 regular + 5 archestra__ tools = 1 counted
      const regularTool = await makeTool({
        name: "toolscount_regular_tool",
        description: "Regular tool",
        parameters: {},
      });
      await makeProfileTool(profile1.id, regularTool.id);

      for (let i = 0; i < 5; i++) {
        const tool = await makeTool({
          name: `archestra__toolscount_${i}`,
          description: `Archestra tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile1.id, tool.id);
      }

      // Give profile2: 3 archestra_ (single underscore) tools = 3 counted
      for (let i = 0; i < 3; i++) {
        const tool = await makeTool({
          name: `archestra_single_${i}`,
          description: `Single underscore tool ${i}`,
          parameters: {},
        });
        await makeProfileTool(profile2.id, tool.id);
      }

      // Sort by toolsCount descending
      const result = await ProfileModel.findAllPaginated(
        { limit: 10, offset: 0 },
        { sortBy: "toolsCount", sortDirection: "desc" },
        {},
        admin.id,
        true,
      );

      const profile1Result = result.data.find(
        (a) => a.name === "Profile with mixed tools",
      );
      const profile2Result = result.data.find(
        (a) => a.name === "Profile with single underscore",
      );

      expect(profile1Result).toBeDefined();
      expect(profile2Result).toBeDefined();

      // profile1 should have 1 tool counted (archestra__ excluded)
      expect(profile1Result?.tools).toHaveLength(1);

      // profile2 should have 3 tools counted (archestra_ NOT excluded)
      expect(profile2Result?.tools).toHaveLength(3);

      // profile2 should come before profile1 in sort order (3 > 1)
      const profile1Index = result.data.findIndex(
        (a) => a.name === "Profile with mixed tools",
      );
      const profile2Index = result.data.findIndex(
        (a) => a.name === "Profile with single underscore",
      );

      expect(profile2Index).toBeLessThan(profile1Index);
    });
  });

  describe("findById Junction Table", () => {
    test("findById returns tools from junction table", async ({
      makeTool,
      makeProfileTool,
    }) => {
      // Create a profile
      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
      });

      // Add tools via the junction table (profile_tools)
      const tool1 = await makeTool({
        name: "junction_tool_1",
        description: "Tool 1",
        parameters: {},
      });
      const tool2 = await makeTool({
        name: "junction_tool_2",
        description: "Tool 2",
        parameters: {},
      });
      const tool3 = await makeTool({
        name: "junction_tool_3",
        description: "Tool 3",
        parameters: {},
      });

      await makeProfileTool(profile.id, tool1.id);
      await makeProfileTool(profile.id, tool2.id);
      await makeProfileTool(profile.id, tool3.id);

      // Retrieve the profile by ID
      const foundProfile = await ProfileModel.findById(profile.id);

      expect(foundProfile).not.toBeNull();
      expect(foundProfile?.tools).toHaveLength(3);

      const toolNames = foundProfile?.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "junction_tool_1",
        "junction_tool_2",
        "junction_tool_3",
      ]);
    });

    test("findById excludes Archestra MCP tools", async ({
      makeTool,
      makeProfileTool,
    }) => {
      // Create a profile
      const profile = await ProfileModel.create({
        name: "Test Profile",
        teams: [],
      });

      // Add regular tools
      const regularTool1 = await makeTool({
        name: "findbyid_regular_tool_1",
        description: "Regular tool 1",
        parameters: {},
      });
      const regularTool2 = await makeTool({
        name: "findbyid_regular_tool_2",
        description: "Regular tool 2",
        parameters: {},
      });

      // Add Archestra tools (should be excluded)
      const archestraTool1 = await makeTool({
        name: "archestra__findbyid_tool_1",
        description: "Archestra tool 1",
        parameters: {},
      });
      const archestraTool2 = await makeTool({
        name: "archestra__findbyid_tool_2",
        description: "Archestra tool 2",
        parameters: {},
      });

      await makeProfileTool(profile.id, regularTool1.id);
      await makeProfileTool(profile.id, regularTool2.id);
      await makeProfileTool(profile.id, archestraTool1.id);
      await makeProfileTool(profile.id, archestraTool2.id);

      // Retrieve the profile by ID
      const foundProfile = await ProfileModel.findById(profile.id);

      expect(foundProfile).not.toBeNull();
      // Should only include 2 regular tools, not the Archestra tools
      expect(foundProfile?.tools).toHaveLength(2);

      // Verify all returned tools are regular tools
      for (const tool of foundProfile?.tools ?? []) {
        expect(tool.name).not.toMatch(/^archestra__/);
      }

      const toolNames = foundProfile?.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "findbyid_regular_tool_1",
        "findbyid_regular_tool_2",
      ]);
    });

    test("findById returns empty tools array when profile has no tools", async () => {
      // Create a profile with no tools
      const profile = await ProfileModel.create({
        name: "No Tools Profile",
        teams: [],
      });

      const foundProfile = await ProfileModel.findById(profile.id);

      expect(foundProfile).not.toBeNull();
      expect(foundProfile?.tools).toHaveLength(0);
    });

    test("findById returns empty tools array when profile has only Archestra tools", async ({
      makeTool,
      makeProfileTool,
    }) => {
      // Create a profile
      const profile = await ProfileModel.create({
        name: "Archestra Only Profile",
        teams: [],
      });

      // Add only Archestra tools
      const archestraTool = await makeTool({
        name: "archestra__some_tool",
        description: "Archestra tool",
        parameters: {},
      });
      await makeProfileTool(profile.id, archestraTool.id);

      const foundProfile = await ProfileModel.findById(profile.id);

      expect(foundProfile).not.toBeNull();
      expect(foundProfile?.tools).toHaveLength(0);
    });
  });

  describe("Default Archestra Tools Assignment", () => {
    test("new profile has artifact_write and todo_write tools assigned by default", async ({
      seedAndAssignArchestraTools,
      makeProfile,
    }) => {
      // First seed Archestra tools (simulates app startup)
      const existingProfile = await makeProfile();
      await seedAndAssignArchestraTools(existingProfile.id);

      // Create a new profile - should have default tools assigned
      const profile = await ProfileModel.create({
        name: "Profile with Default Tools",
        teams: [],
      });

      // Verify the profile has the default Archestra tools assigned
      const toolNames = profile.tools.map((t) => t.name);
      expect(toolNames).toContain(TOOL_ARTIFACT_WRITE_FULL_NAME);
      expect(toolNames).toContain(TOOL_TODO_WRITE_FULL_NAME);
    });

    test("new profile returns assigned tools without Archestra prefix filtering", async ({
      seedAndAssignArchestraTools,
      makeProfile,
    }) => {
      // First seed Archestra tools
      const existingProfile = await makeProfile();
      await seedAndAssignArchestraTools(existingProfile.id);

      // Create a new profile
      const profile = await ProfileModel.create({
        name: "Test Default Tools Profile",
        teams: [],
      });

      // The create method should return the assigned tools
      expect(profile.tools.length).toBeGreaterThanOrEqual(2);

      // Verify artifact_write and todo_write are present
      const hasArtifactWrite = profile.tools.some(
        (t) => t.name === TOOL_ARTIFACT_WRITE_FULL_NAME,
      );
      const hasTodoWrite = profile.tools.some(
        (t) => t.name === TOOL_TODO_WRITE_FULL_NAME,
      );

      expect(hasArtifactWrite).toBe(true);
      expect(hasTodoWrite).toBe(true);
    });
  });

  describe("getProfileOrCreateDefault Junction Table", () => {
    test("getProfileOrCreateDefault returns tools from junction table", async ({
      makeTool,
      makeProfileTool,
    }) => {
      // Get the default profile
      const defaultProfile = await ProfileModel.getProfileOrCreateDefault();

      // Add tools to the default profile via junction table
      const tool1 = await makeTool({
        name: "default_profile_tool_1",
        description: "Tool 1",
        parameters: {},
      });
      const tool2 = await makeTool({
        name: "default_profile_tool_2",
        description: "Tool 2",
        parameters: {},
      });

      await makeProfileTool(defaultProfile.id, tool1.id);
      await makeProfileTool(defaultProfile.id, tool2.id);

      // Get the default profile again - should include the tools
      const foundProfile = await ProfileModel.getProfileOrCreateDefault();

      expect(foundProfile).not.toBeNull();
      expect(foundProfile.tools.length).toBeGreaterThanOrEqual(2);

      const toolNames = foundProfile.tools.map((t) => t.name);
      expect(toolNames).toContain("default_profile_tool_1");
      expect(toolNames).toContain("default_profile_tool_2");
    });

    test("getProfileOrCreateDefault excludes Archestra MCP tools", async ({
      makeTool,
      makeProfileTool,
    }) => {
      // Get the default profile
      const defaultProfile = await ProfileModel.getProfileOrCreateDefault();

      // Add regular tools
      const regularTool = await makeTool({
        name: "default_regular_tool",
        description: "Regular tool",
        parameters: {},
      });

      // Add Archestra tools (should be excluded)
      const archestraTool = await makeTool({
        name: "archestra__default_tool",
        description: "Archestra tool",
        parameters: {},
      });

      await makeProfileTool(defaultProfile.id, regularTool.id);
      await makeProfileTool(defaultProfile.id, archestraTool.id);

      // Get the default profile again
      const foundProfile = await ProfileModel.getProfileOrCreateDefault();

      // Verify Archestra tools are excluded
      for (const tool of foundProfile.tools) {
        expect(tool.name).not.toMatch(/^archestra__/);
      }

      // Verify regular tool is included
      const toolNames = foundProfile.tools.map((t) => t.name);
      expect(toolNames).toContain("default_regular_tool");
    });
  });
});
