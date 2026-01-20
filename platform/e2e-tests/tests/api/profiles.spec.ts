import { expect, test } from "./fixtures";

test.describe("Profiles API CRUD", () => {
  test("should get all profiles", async ({ request, makeApiRequest }) => {
    const response = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: "/api/profiles/all",
    });
    const profiles = await response.json();
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBeGreaterThan(0);
  });

  test("should create a new profile", async ({ request, createProfile }) => {
    const newProfile = {
      name: "Test Profile for Integration",
      isDemo: false,
      teams: [],
    };

    const response = await createProfile(request, newProfile.name);
    const profile = await response.json();

    expect(profile).toHaveProperty("id");
    expect(profile.name).toBe(newProfile.name);
    expect(profile.isDemo).toBe(newProfile.isDemo);
    expect(Array.isArray(profile.tools)).toBe(true);
    expect(Array.isArray(profile.teams)).toBe(true);
  });

  test("should get profile by ID", async ({
    request,
    createProfile,
    makeApiRequest,
  }) => {
    // Create a profile first
    const createResponse = await createProfile(
      request,
      "Profile for Get By ID Test",
    );
    const createdProfile = await createResponse.json();

    const response = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/profiles/${createdProfile.id}`,
    });
    const profile = await response.json();

    expect(profile.id).toBe(createdProfile.id);
    expect(profile.name).toBe("Profile for Get By ID Test");
    expect(profile).toHaveProperty("tools");
    expect(profile).toHaveProperty("teams");
  });

  test("should update a profile", async ({
    request,
    createProfile,
    makeApiRequest,
  }) => {
    // Create a profile first
    const createResponse = await createProfile(
      request,
      "Profile for Update Test",
    );
    const createdProfile = await createResponse.json();

    const updateData = {
      name: "Updated Test Profile",
      isDemo: true,
    };

    const updateResponse = await makeApiRequest({
      request,
      method: "put",
      urlSuffix: `/api/profiles/${createdProfile.id}`,
      data: updateData,
    });
    const updatedProfile = await updateResponse.json();

    expect(updatedProfile).toHaveProperty("id");
    expect(updatedProfile.name).toBe(updateData.name);
    expect(updatedProfile.isDemo).toBe(updateData.isDemo);
  });

  test("should delete a profile", async ({
    request,
    createProfile,
    makeApiRequest,
  }) => {
    // Create a profile first
    const createResponse = await createProfile(
      request,
      "Profile for Delete Test",
    );
    const createdProfile = await createResponse.json();

    const deleteResponse = await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/profiles/${createdProfile.id}`,
    });
    const deletedProfile = await deleteResponse.json();

    expect(deletedProfile).toHaveProperty("success");
    expect(deletedProfile.success).toBe(true);

    // Verify profile is deleted by trying to get it
    const getResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/profiles/${createdProfile.id}`,
      ignoreStatusCheck: true,
    });
    expect(getResponse.status()).toBe(404);
  });

  test("should get default profile", async ({ request, makeApiRequest }) => {
    const response = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: "/api/profiles/default",
    });
    const profile = await response.json();

    expect(profile).toHaveProperty("id");
    expect(profile).toHaveProperty("name");
    expect(profile.isDefault).toBe(true);
    expect(Array.isArray(profile.tools)).toBe(true);
    expect(Array.isArray(profile.teams)).toBe(true);
  });
});
