import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import profilesTable from "./profile";
import { team } from "./team";

const profileTeamTable = pgTable(
  "profile_team",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.teamId] }),
  }),
);

export default profileTeamTable;
