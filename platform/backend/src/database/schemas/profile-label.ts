import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import labelKeyTable from "./label-key";
import labelValueTable from "./label-value";
import profilesTable from "./profile";

const profileLabelTable = pgTable(
  "profile_labels",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    keyId: uuid("key_id")
      .notNull()
      .references(() => labelKeyTable.id, { onDelete: "cascade" }),
    valueId: uuid("value_id")
      .notNull()
      .references(() => labelValueTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.keyId] }),
  }),
);

export default profileLabelTable;
