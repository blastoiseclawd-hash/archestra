import { pathToFileURL } from "node:url";
import { ADMIN_ROLE_NAME, MEMBER_ROLE_NAME } from "@shared";
import db, { schema } from "@/database";
import { seedDefaultUserAndOrg } from "@/database/seed";
import logger from "@/logging";
import { LlmProxyModel, OrganizationModel, TeamModel } from "@/models";
import {
  generateMockAgents,
  generateMockInteractions,
  generateMockTools,
} from "./mocks";

// Set to true to create tools and interactions
// Don't delete this const for development convenience
const CREATE_TOOLS_AND_INTERACTIONS = false;

async function seedMockData() {
  logger.info("\n🌱 Starting mock data seed...\n");

  // Step 0: Clean existing mock data (in correct order due to foreign keys)
  logger.info("Cleaning existing data...");
  for (const table of Object.values(schema)) {
    await db.delete(table);
  }
  logger.info("✅ Cleaned existing data");

  // Step 1: Create additional users
  const defaultAdmin = await seedDefaultUserAndOrg();
  const admin2User = await seedDefaultUserAndOrg({
    email: "admin-2@example.com",
    password: "password",
    role: ADMIN_ROLE_NAME,
    name: "Admin-2",
  });
  const member1User = await seedDefaultUserAndOrg({
    email: "member-1@example.com",
    password: "password",
    role: MEMBER_ROLE_NAME,
    name: "Member-1",
  });
  const member2User = await seedDefaultUserAndOrg({
    email: "member-2@example.com",
    password: "password",
    role: MEMBER_ROLE_NAME,
    name: "Member-2",
  });

  // Step 2: Create teams and add members
  const org = await OrganizationModel.getOrCreateDefaultOrganization();
  const managementTeam = await TeamModel.create({
    name: "Management Team",
    description:
      "Management department responsible for overseeing the platform",
    organizationId: org.id,
    createdBy: admin2User.id,
  });
  const marketingTeam = await TeamModel.create({
    name: "Marketing Team",
    description: "Marketing department responsible for promoting the platform",
    organizationId: org.id,
    createdBy: admin2User.id,
  });
  await TeamModel.addMember(
    managementTeam.id,
    defaultAdmin.id,
    ADMIN_ROLE_NAME,
  );
  await TeamModel.addMember(managementTeam.id, admin2User.id, ADMIN_ROLE_NAME);
  await TeamModel.addMember(marketingTeam.id, defaultAdmin.id, ADMIN_ROLE_NAME);
  await TeamModel.addMember(marketingTeam.id, member1User.id, MEMBER_ROLE_NAME);
  await TeamModel.addMember(marketingTeam.id, member2User.id, MEMBER_ROLE_NAME);

  // Step 2: Create profiles (LLM Proxies)
  logger.info("\nCreating profiles (LLM proxies)...");
  await LlmProxyModel.getOrCreateDefault(org.id); // always recreate default profile
  const proxyData = generateMockAgents();

  // Update organizationId to match the actual org
  const proxiesToInsert = proxyData.map((proxy) => ({
    ...proxy,
    organizationId: org.id,
  }));
  await db.insert(schema.llmProxiesTable).values(proxiesToInsert);
  logger.info(`✅ Created ${proxyData.length} profiles`);

  // Note: Archestra tools are no longer auto-assigned to agents.
  // They are now managed like any other MCP server tools and must be explicitly assigned.

  if (CREATE_TOOLS_AND_INTERACTIONS === false) return;

  // Step 3: Create tools linked to profiles
  logger.info("\nCreating tools...");
  const proxyIds = proxyData
    .map((proxy) => proxy.id)
    .filter((id): id is string => !!id);
  const toolData = generateMockTools(proxyIds);

  await db.insert(schema.toolsTable).values(toolData);
  logger.info(`✅ Created ${toolData.length} tools`);

  // Step 4: Create mcp-gateway-tool relationships
  logger.info("\nCreating mcp-gateway-tool relationships...");
  const mcpGatewayToolData = toolData.map((tool) => ({
    mcpGatewayId: tool.agentId, // agent ID is used as mcp gateway ID
    toolId: tool.id,
    allowUsageWhenUntrustedDataIsPresent:
      tool.allowUsageWhenUntrustedDataIsPresent || false,
    toolResultTreatment: (tool.dataIsTrustedByDefault
      ? "trusted"
      : "untrusted") as "trusted" | "untrusted" | "sanitize_with_dual_llm",
  }));

  await db.insert(schema.mcpGatewayToolsTable).values(mcpGatewayToolData);
  logger.info(
    `✅ Created ${mcpGatewayToolData.length} mcp-gateway-tool relationships`,
  );

  // Step 5: Create 200 mock interactions
  logger.info("\nCreating interactions...");

  // Group tools by profile for efficient lookup
  const toolsByProfile = new Map<string, typeof toolData>();
  for (const tool of toolData) {
    const existing = toolsByProfile.get(tool.agentId) || [];
    toolsByProfile.set(tool.agentId, [...existing, tool]);
  }

  const interactionData = generateMockInteractions(
    proxyIds,
    toolsByProfile,
    200, // number of interactions
    0.3, // 30% block probability
  );

  // biome-ignore lint/suspicious/noExplicitAny: Mock data generation requires flexible interaction structure
  await db.insert(schema.interactionsTable).values(interactionData as any);
  logger.info(`✅ Created ${interactionData.length} interactions`);

  // Show statistics
  const blockedCount = interactionData.filter((i) => {
    if ("choices" in i.response) {
      const message = i.response.choices[0]?.message;
      return message && "refusal" in message && message.refusal;
    }
    return false;
  }).length;
  logger.info(`   - ${blockedCount} blocked by policy`);
  logger.info(`   - ${interactionData.length - blockedCount} allowed`);
}

/**
 * CLI entry point for seeding the database
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedMockData()
    .then(() => {
      logger.info("\n✅ Mock data seeded successfully!\n");
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ err: error }, "\n❌ Error seeding database:");
      process.exit(1);
    });
}
