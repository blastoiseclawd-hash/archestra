import { asc, eq, inArray, isNull } from "drizzle-orm";
import db, { schema } from "@/database";
import type { ProfileLabelWithDetails } from "@/types";

class ProfileLabelModel {
  /**
   * Get all labels for a specific profile with key and value details
   */
  static async getLabelsForProfile(
    profileId: string,
  ): Promise<ProfileLabelWithDetails[]> {
    const rows = await db
      .select({
        keyId: schema.profileLabelsTable.keyId,
        valueId: schema.profileLabelsTable.valueId,
        key: schema.labelKeysTable.key,
        value: schema.labelValuesTable.value,
      })
      .from(schema.profileLabelsTable)
      .leftJoin(
        schema.labelKeysTable,
        eq(schema.profileLabelsTable.keyId, schema.labelKeysTable.id),
      )
      .leftJoin(
        schema.labelValuesTable,
        eq(schema.profileLabelsTable.valueId, schema.labelValuesTable.id),
      )
      .where(eq(schema.profileLabelsTable.profileId, profileId))
      .orderBy(asc(schema.labelKeysTable.key));

    return rows.map((row) => ({
      keyId: row.keyId,
      valueId: row.valueId,
      key: row.key || "",
      value: row.value || "",
    }));
  }

  /**
   * Get or create a label key
   */
  static async getOrCreateKey(key: string): Promise<string> {
    // Try to find existing key
    const [existing] = await db
      .select()
      .from(schema.labelKeysTable)
      .where(eq(schema.labelKeysTable.key, key))
      .limit(1);

    if (existing) {
      return existing.id;
    }

    // Create new key
    const [created] = await db
      .insert(schema.labelKeysTable)
      .values({ key })
      .returning();

    return created.id;
  }

  /**
   * Get or create a label value
   */
  static async getOrCreateValue(value: string): Promise<string> {
    // Try to find existing value
    const [existing] = await db
      .select()
      .from(schema.labelValuesTable)
      .where(eq(schema.labelValuesTable.value, value))
      .limit(1);

    if (existing) {
      return existing.id;
    }

    // Create new value
    const [created] = await db
      .insert(schema.labelValuesTable)
      .values({ value })
      .returning();

    return created.id;
  }

  /**
   * Sync labels for a profile (replaces all existing labels)
   */
  static async syncProfileLabels(
    profileId: string,
    labels: ProfileLabelWithDetails[],
  ): Promise<void> {
    // Process labels outside of transaction to avoid deadlocks
    const labelInserts: {
      profileId: string;
      keyId: string;
      valueId: string;
    }[] = [];

    if (labels.length > 0) {
      // Process each label to get or create keys/values
      for (const label of labels) {
        const keyId = await ProfileLabelModel.getOrCreateKey(label.key);
        const valueId = await ProfileLabelModel.getOrCreateValue(label.value);
        labelInserts.push({ profileId, keyId, valueId });
      }
    }

    await db.transaction(async (tx) => {
      // Delete all existing labels for this profile
      await tx
        .delete(schema.profileLabelsTable)
        .where(eq(schema.profileLabelsTable.profileId, profileId));

      // Insert new labels (if any provided)
      if (labelInserts.length > 0) {
        await tx.insert(schema.profileLabelsTable).values(labelInserts);
      }
    });

    await ProfileLabelModel.pruneKeysAndValues();
  }

  /**
   * Prune orphaned label keys and values that are no longer referenced
   * by any profile labels
   */
  static async pruneKeysAndValues(): Promise<{
    deletedKeys: number;
    deletedValues: number;
  }> {
    return await db.transaction(async (tx) => {
      // Find orphaned keys (not referenced in profile_labels)
      const orphanedKeys = await tx
        .select({ id: schema.labelKeysTable.id })
        .from(schema.labelKeysTable)
        .leftJoin(
          schema.profileLabelsTable,
          eq(schema.labelKeysTable.id, schema.profileLabelsTable.keyId),
        )
        .where(isNull(schema.profileLabelsTable.keyId));

      // Find orphaned values (not referenced in profile_labels)
      const orphanedValues = await tx
        .select({ id: schema.labelValuesTable.id })
        .from(schema.labelValuesTable)
        .leftJoin(
          schema.profileLabelsTable,
          eq(schema.labelValuesTable.id, schema.profileLabelsTable.valueId),
        )
        .where(isNull(schema.profileLabelsTable.valueId));

      let deletedKeys = 0;
      let deletedValues = 0;

      // Delete orphaned keys
      if (orphanedKeys.length > 0) {
        const keyIds = orphanedKeys.map((k) => k.id);
        const result = await tx
          .delete(schema.labelKeysTable)
          .where(inArray(schema.labelKeysTable.id, keyIds));
        deletedKeys = result.rowCount || 0;
      }

      // Delete orphaned values
      if (orphanedValues.length > 0) {
        const valueIds = orphanedValues.map((v) => v.id);
        const result = await tx
          .delete(schema.labelValuesTable)
          .where(inArray(schema.labelValuesTable.id, valueIds));
        deletedValues = result.rowCount || 0;
      }

      return { deletedKeys, deletedValues };
    });
  }

  /**
   * Get all available label keys
   */
  static async getAllKeys(): Promise<string[]> {
    const keys = await db.select().from(schema.labelKeysTable);
    return keys.map((k) => k.key);
  }

  /**
   * Get all available label values
   */
  static async getAllValues(): Promise<string[]> {
    const values = await db.select().from(schema.labelValuesTable);
    return values.map((v) => v.value);
  }

  /**
   * Get labels for multiple profiles in one query to avoid N+1
   */
  static async getLabelsForProfiles(
    profileIds: string[],
  ): Promise<Map<string, ProfileLabelWithDetails[]>> {
    if (profileIds.length === 0) {
      return new Map();
    }

    const rows = await db
      .select({
        profileId: schema.profileLabelsTable.profileId,
        keyId: schema.profileLabelsTable.keyId,
        valueId: schema.profileLabelsTable.valueId,
        key: schema.labelKeysTable.key,
        value: schema.labelValuesTable.value,
      })
      .from(schema.profileLabelsTable)
      .leftJoin(
        schema.labelKeysTable,
        eq(schema.profileLabelsTable.keyId, schema.labelKeysTable.id),
      )
      .leftJoin(
        schema.labelValuesTable,
        eq(schema.profileLabelsTable.valueId, schema.labelValuesTable.id),
      )
      .where(inArray(schema.profileLabelsTable.profileId, profileIds))
      .orderBy(asc(schema.labelKeysTable.key));

    const labelsMap = new Map<string, ProfileLabelWithDetails[]>();

    // Initialize all profile IDs with empty arrays
    for (const profileId of profileIds) {
      labelsMap.set(profileId, []);
    }

    // Populate the map with labels
    for (const row of rows) {
      const labels = labelsMap.get(row.profileId) || [];
      labels.push({
        keyId: row.keyId,
        valueId: row.valueId,
        key: row.key || "",
        value: row.value || "",
      });
      labelsMap.set(row.profileId, labels);
    }

    return labelsMap;
  }

  /**
   * Get all available label values for a specific key
   */
  static async getValuesByKey(key: string): Promise<string[]> {
    // Find the key ID
    const [keyRecord] = await db
      .select()
      .from(schema.labelKeysTable)
      .where(eq(schema.labelKeysTable.key, key))
      .limit(1);

    if (!keyRecord) {
      return [];
    }

    // Get all values associated with this key
    const values = await db
      .select({
        value: schema.labelValuesTable.value,
      })
      .from(schema.profileLabelsTable)
      .innerJoin(
        schema.labelValuesTable,
        eq(schema.profileLabelsTable.valueId, schema.labelValuesTable.id),
      )
      .where(eq(schema.profileLabelsTable.keyId, keyRecord.id))
      .groupBy(schema.labelValuesTable.value)
      .orderBy(asc(schema.labelValuesTable.value));

    return values.map((v) => v.value);
  }
}

export default ProfileLabelModel;
