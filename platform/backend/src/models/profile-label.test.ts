import { describe, expect, test } from "@/test";
import ProfileLabelModel from "./profile-label";

describe("ProfileLabelModel", () => {
  describe("getOrCreateKey", () => {
    test("creates a new key when it does not exist", async () => {
      const keyId = await ProfileLabelModel.getOrCreateKey("environment");

      expect(keyId).toBeDefined();

      const keys = await ProfileLabelModel.getAllKeys();
      expect(keys).toContain("environment");
    });

    test("returns existing key ID when key already exists", async () => {
      const keyId1 = await ProfileLabelModel.getOrCreateKey("region");
      const keyId2 = await ProfileLabelModel.getOrCreateKey("region");

      expect(keyId1).toBe(keyId2);

      const keys = await ProfileLabelModel.getAllKeys();
      expect(keys.filter((k) => k === "region")).toHaveLength(1);
    });
  });

  describe("getOrCreateValue", () => {
    test("creates a new value when it does not exist", async () => {
      const valueId = await ProfileLabelModel.getOrCreateValue("production");

      expect(valueId).toBeDefined();

      const values = await ProfileLabelModel.getAllValues();
      expect(values).toContain("production");
    });

    test("returns existing value ID when value already exists", async () => {
      const valueId1 = await ProfileLabelModel.getOrCreateValue("staging");
      const valueId2 = await ProfileLabelModel.getOrCreateValue("staging");

      expect(valueId1).toBe(valueId2);

      const values = await ProfileLabelModel.getAllValues();
      expect(values.filter((v) => v === "staging")).toHaveLength(1);
    });
  });

  describe("syncProfileLabels", () => {
    test("syncs labels for a profile", async ({ makeProfile }) => {
      const profile = await makeProfile();

      await ProfileLabelModel.syncProfileLabels(profile.id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
        { key: "region", value: "us-west-2", keyId: "", valueId: "" },
      ]);

      const labels = await ProfileLabelModel.getLabelsForProfile(profile.id);

      expect(labels).toHaveLength(2);
      expect(labels[0].key).toBe("environment");
      expect(labels[0].value).toBe("production");
      expect(labels[1].key).toBe("region");
      expect(labels[1].value).toBe("us-west-2");
    });

    test("replaces existing labels when syncing", async ({ makeProfile }) => {
      const profile = await makeProfile();

      await ProfileLabelModel.syncProfileLabels(profile.id, [
        { key: "environment", value: "staging", keyId: "", valueId: "" },
      ]);

      await ProfileLabelModel.syncProfileLabels(profile.id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
        { key: "team", value: "engineering", keyId: "", valueId: "" },
      ]);

      const labels = await ProfileLabelModel.getLabelsForProfile(profile.id);

      expect(labels).toHaveLength(2);
      expect(labels[0].key).toBe("environment");
      expect(labels[0].value).toBe("production");
      expect(labels[1].key).toBe("team");
      expect(labels[1].value).toBe("engineering");
    });

    test("clears all labels when syncing with empty array", async ({
      makeProfile,
    }) => {
      const profile = await makeProfile();

      await ProfileLabelModel.syncProfileLabels(profile.id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
      ]);

      await ProfileLabelModel.syncProfileLabels(profile.id, []);

      const labels = await ProfileLabelModel.getLabelsForProfile(profile.id);
      expect(labels).toHaveLength(0);
    });
  });

  describe("pruneKeysAndValues", () => {
    test("removes orphaned keys and values", async ({ makeProfile }) => {
      const profile = await makeProfile();

      // Create labels
      await ProfileLabelModel.syncProfileLabels(profile.id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
        { key: "region", value: "us-west-2", keyId: "", valueId: "" },
      ]);

      // Verify keys and values exist
      let keys = await ProfileLabelModel.getAllKeys();
      let values = await ProfileLabelModel.getAllValues();
      expect(keys).toContain("environment");
      expect(keys).toContain("region");
      expect(values).toContain("production");
      expect(values).toContain("us-west-2");

      // Remove all labels, which should make keys and values orphaned
      await ProfileLabelModel.syncProfileLabels(profile.id, []);

      // Verify orphaned keys and values were pruned
      keys = await ProfileLabelModel.getAllKeys();
      values = await ProfileLabelModel.getAllValues();
      expect(keys).not.toContain("environment");
      expect(keys).not.toContain("region");
      expect(values).not.toContain("production");
      expect(values).not.toContain("us-west-2");
    });

    test("keeps keys and values that are still in use", async ({
      makeProfile,
    }) => {
      const { id: profile1Id } = await makeProfile();
      const { id: profile2Id } = await makeProfile();

      // Create labels for two profiles with shared key/value
      await ProfileLabelModel.syncProfileLabels(profile1Id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
      ]);

      await ProfileLabelModel.syncProfileLabels(profile2Id, [
        { key: "environment", value: "staging", keyId: "", valueId: "" },
      ]);

      // Remove labels from profile1
      await ProfileLabelModel.syncProfileLabels(profile1Id, []);

      // Verify "environment" key is still present (used by profile2)
      const keys = await ProfileLabelModel.getAllKeys();
      expect(keys).toContain("environment");

      // Verify "staging" value is still present but "production" is removed
      const values = await ProfileLabelModel.getAllValues();
      expect(values).toContain("staging");
      expect(values).not.toContain("production");
    });
  });

  describe("getAllKeys", () => {
    test("returns all unique keys", async ({ makeProfile }) => {
      const { id: profile1Id } = await makeProfile();
      const { id: profile2Id } = await makeProfile();

      await ProfileLabelModel.syncProfileLabels(profile1Id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
      ]);

      await ProfileLabelModel.syncProfileLabels(profile2Id, [
        { key: "region", value: "us-west-2", keyId: "", valueId: "" },
      ]);

      const keys = await ProfileLabelModel.getAllKeys();

      expect(keys).toContain("environment");
      expect(keys).toContain("region");
    });
  });

  describe("getAllValues", () => {
    test("returns all unique values", async ({ makeProfile }) => {
      const { id: profile1Id } = await makeProfile();
      const { id: profile2Id } = await makeProfile();

      await ProfileLabelModel.syncProfileLabels(profile1Id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
      ]);

      await ProfileLabelModel.syncProfileLabels(profile2Id, [
        { key: "environment", value: "staging", keyId: "", valueId: "" },
      ]);

      const values = await ProfileLabelModel.getAllValues();

      expect(values).toContain("production");
      expect(values).toContain("staging");
    });
  });

  describe("getLabelsForProfiles", () => {
    test("returns labels for multiple profiles in bulk", async ({
      makeProfile,
    }) => {
      const { id: profile1Id } = await makeProfile();
      const { id: profile2Id } = await makeProfile();
      const { id: profile3Id } = await makeProfile();

      await ProfileLabelModel.syncProfileLabels(profile1Id, [
        { key: "environment", value: "production", keyId: "", valueId: "" },
        { key: "region", value: "us-west-2", keyId: "", valueId: "" },
      ]);

      await ProfileLabelModel.syncProfileLabels(profile2Id, [
        { key: "environment", value: "staging", keyId: "", valueId: "" },
      ]);

      // profile3 has no labels

      const labelsMap = await ProfileLabelModel.getLabelsForProfiles([
        profile1Id,
        profile2Id,
        profile3Id,
      ]);

      expect(labelsMap.size).toBe(3);

      const profile1Labels = labelsMap.get(profile1Id);
      expect(profile1Labels).toHaveLength(2);
      expect(profile1Labels?.[0].key).toBe("environment");
      expect(profile1Labels?.[0].value).toBe("production");
      expect(profile1Labels?.[1].key).toBe("region");
      expect(profile1Labels?.[1].value).toBe("us-west-2");

      const profile2Labels = labelsMap.get(profile2Id);
      expect(profile2Labels).toHaveLength(1);
      expect(profile2Labels?.[0].key).toBe("environment");
      expect(profile2Labels?.[0].value).toBe("staging");

      const profile3Labels = labelsMap.get(profile3Id);
      expect(profile3Labels).toHaveLength(0);
    });

    test("returns empty map for empty profile IDs array", async () => {
      const labelsMap = await ProfileLabelModel.getLabelsForProfiles([]);
      expect(labelsMap.size).toBe(0);
    });
  });
});
