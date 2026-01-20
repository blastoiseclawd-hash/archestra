import { expect, test } from "./fixtures";
import { assignArchestraToolsToProfile } from "./mcp-gateway-utils";

test.describe("Profile Tools API", () => {
  test.describe("GET /api/profile-tools", () => {
    test("returns paginated results by default", async ({
      request,
      makeApiRequest,
    }) => {
      const response = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: "/api/profile-tools?limit=5",
      });
      const result = await response.json();

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("pagination");
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toHaveProperty("limit", 5);
      expect(result.pagination).toHaveProperty("total");
      expect(result.pagination).toHaveProperty("currentPage");
      expect(result.pagination).toHaveProperty("totalPages");
      expect(result.pagination).toHaveProperty("hasNext");
      expect(result.pagination).toHaveProperty("hasPrev");
    });

    test("filters by profileId while respecting pagination", async ({
      request,
      createProfile,
      makeApiRequest,
    }) => {
      // Create a profile
      const profileResponse = await createProfile(
        request,
        "Test Profile for Filtering",
      );
      const profile = await profileResponse.json();

      // Query profile tools with profileId filter
      const response = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: `/api/profile-tools?profileId=${profile.id}&limit=10`,
      });
      const result = await response.json();

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("pagination");
      // All returned tools should belong to the filtered profile
      result.data.forEach(
        (at: { profile: { id: string }; tool: { name: string } }) => {
          expect(at.profile.id).toBe(profile.id);
        },
      );
      // Pagination should still work (not be skipped automatically)
      expect(result.pagination.limit).toBe(10);
    });

    test("skipPagination=true returns all results without pagination limits", async ({
      request,
      createProfile,
      makeApiRequest,
    }) => {
      // Create a profile
      const profileResponse = await createProfile(
        request,
        "Test Profile for Skip Pagination",
      );
      const profile = await profileResponse.json();

      // Assign Archestra tools to the profile so we have tools to test with
      const assignedTools = await assignArchestraToolsToProfile(
        request,
        profile.id,
      );
      expect(assignedTools.length).toBeGreaterThan(0);

      // Query profile tools with skipPagination=true
      const response = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: `/api/profile-tools?profileId=${profile.id}&skipPagination=true&limit=1`,
      });
      const result = await response.json();

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("pagination");
      // Even with limit=1, skipPagination should return all tools
      // The pagination metadata should reflect the full dataset
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
      // All data should be returned
      expect(result.pagination.total).toBe(result.data.length);
      // Verify we have the tools we assigned
      expect(result.data.length).toBe(assignedTools.length);
    });

    test("skipPagination respects other filters like profileId", async ({
      request,
      createProfile,
      makeApiRequest,
    }) => {
      // Create two profiles
      const profile1Response = await createProfile(request, "Test Profile 1");
      const profile1 = await profile1Response.json();

      const profile2Response = await createProfile(request, "Test Profile 2");
      const profile2 = await profile2Response.json();

      // Query with skipPagination for profile1 only
      const response = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: `/api/profile-tools?profileId=${profile1.id}&skipPagination=true`,
      });
      const result = await response.json();

      // All results should belong to profile1
      result.data.forEach(
        (at: { profile: { id: string }; tool: { name: string } }) => {
          expect(at.profile.id).toBe(profile1.id);
          expect(at.profile.id).not.toBe(profile2.id);
        },
      );
    });

    test("skipPagination=false (default) uses normal pagination", async ({
      request,
      makeApiRequest,
    }) => {
      // Query without skipPagination - should use normal pagination
      const response = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: "/api/profile-tools?limit=2&offset=0",
      });
      const result = await response.json();

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("pagination");
      expect(result.pagination.limit).toBe(2);
      // If there are more than 2 total records, hasNext should be true
      if (result.pagination.total > 2) {
        expect(result.pagination.hasNext).toBe(true);
      }
    });

    test("excludeArchestraTools filter works with skipPagination", async ({
      request,
      makeApiRequest,
    }) => {
      const response = await makeApiRequest({
        request,
        method: "get",
        urlSuffix:
          "/api/profile-tools?skipPagination=true&excludeArchestraTools=true",
      });
      const result = await response.json();

      // No tools should have names starting with "archestra__"
      result.data.forEach((at: { tool: { name: string } }) => {
        expect(at.tool.name.startsWith("archestra__")).toBe(false);
      });
    });
  });
});
