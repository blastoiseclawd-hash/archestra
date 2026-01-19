import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { team } from "./team";

const agentTeamTable = pgTable(
  "agent_team",
  {
    // agentId kept for backward compatibility but no FK constraint
    agentId: uuid("agent_id").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.teamId] }),
  }),
);

export default agentTeamTable;
