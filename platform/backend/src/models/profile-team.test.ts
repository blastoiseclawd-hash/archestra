import { describe, expect, test } from "@/test";
import ProfileTeamModel from "./profile-team";

describe("ProfileTeamModel", () => {
  describe("getTeamsForProfile", () => {
    test("returns team IDs for a single profile", async ({
      makeProfile,
      makeTeam,
      makeOrganization,
      makeUser,
    }) => {
      const org = await makeOrganization();
      const user = await makeUser();
      const team1 = await makeTeam(org.id, user.id);
      const team2 = await makeTeam(org.id, user.id);
      const profile = await makeProfile();

      await ProfileTeamModel.assignTeamsToProfile(profile.id, [
        team1.id,
        team2.id,
      ]);

      const teams = await ProfileTeamModel.getTeamsForProfile(profile.id);

      expect(teams).toHaveLength(2);
      expect(teams).toContain(team1.id);
      expect(teams).toContain(team2.id);
    });

    test("returns empty array when profile has no teams", async ({
      makeProfile,
    }) => {
      const profile = await makeProfile();
      const teams = await ProfileTeamModel.getTeamsForProfile(profile.id);
      expect(teams).toHaveLength(0);
    });
  });

  describe("getTeamsForProfiles", () => {
    test("returns teams for multiple profiles in bulk", async ({
      makeProfile,
      makeTeam,
      makeOrganization,
      makeUser,
    }) => {
      const org = await makeOrganization();
      const user = await makeUser();
      const team1 = await makeTeam(org.id, user.id);
      const team2 = await makeTeam(org.id, user.id);
      const team3 = await makeTeam(org.id, user.id);

      const profile1 = await makeProfile();
      const profile2 = await makeProfile();
      const profile3 = await makeProfile();

      await ProfileTeamModel.assignTeamsToProfile(profile1.id, [
        team1.id,
        team2.id,
      ]);
      await ProfileTeamModel.assignTeamsToProfile(profile2.id, [team3.id]);
      // profile3 has no teams

      const teamsMap = await ProfileTeamModel.getTeamsForProfiles([
        profile1.id,
        profile2.id,
        profile3.id,
      ]);

      expect(teamsMap.size).toBe(3);

      const profile1Teams = teamsMap.get(profile1.id);
      expect(profile1Teams).toHaveLength(2);
      expect(profile1Teams).toContain(team1.id);
      expect(profile1Teams).toContain(team2.id);

      const profile2Teams = teamsMap.get(profile2.id);
      expect(profile2Teams).toHaveLength(1);
      expect(profile2Teams).toContain(team3.id);

      const profile3Teams = teamsMap.get(profile3.id);
      expect(profile3Teams).toHaveLength(0);
    });

    test("returns empty map for empty profile IDs array", async () => {
      const teamsMap = await ProfileTeamModel.getTeamsForProfiles([]);
      expect(teamsMap.size).toBe(0);
    });
  });

  describe("syncProfileTeams", () => {
    test("syncs team assignments for a profile", async ({
      makeProfile,
      makeTeam,
      makeOrganization,
      makeUser,
    }) => {
      const org = await makeOrganization();
      const user = await makeUser();
      const team1 = await makeTeam(org.id, user.id);
      const team2 = await makeTeam(org.id, user.id);
      const profile = await makeProfile();

      const assignedCount = await ProfileTeamModel.syncProfileTeams(
        profile.id,
        [team1.id, team2.id],
      );

      expect(assignedCount).toBe(2);

      const teams = await ProfileTeamModel.getTeamsForProfile(profile.id);
      expect(teams).toHaveLength(2);
      expect(teams).toContain(team1.id);
      expect(teams).toContain(team2.id);
    });

    test("replaces existing team assignments", async ({
      makeProfile,
      makeTeam,
      makeOrganization,
      makeUser,
    }) => {
      const org = await makeOrganization();
      const user = await makeUser();
      const team1 = await makeTeam(org.id, user.id);
      const team2 = await makeTeam(org.id, user.id);
      const team3 = await makeTeam(org.id, user.id);
      const profile = await makeProfile();

      await ProfileTeamModel.syncProfileTeams(profile.id, [team1.id, team2.id]);
      await ProfileTeamModel.syncProfileTeams(profile.id, [team3.id]);

      const teams = await ProfileTeamModel.getTeamsForProfile(profile.id);
      expect(teams).toHaveLength(1);
      expect(teams).toContain(team3.id);
      expect(teams).not.toContain(team1.id);
      expect(teams).not.toContain(team2.id);
    });

    test("clears all team assignments when syncing with empty array", async ({
      makeProfile,
      makeTeam,
      makeOrganization,
      makeUser,
    }) => {
      const org = await makeOrganization();
      const user = await makeUser();
      const team1 = await makeTeam(org.id, user.id);
      const profile = await makeProfile();

      await ProfileTeamModel.syncProfileTeams(profile.id, [team1.id]);
      await ProfileTeamModel.syncProfileTeams(profile.id, []);

      const teams = await ProfileTeamModel.getTeamsForProfile(profile.id);
      expect(teams).toHaveLength(0);
    });
  });
});
