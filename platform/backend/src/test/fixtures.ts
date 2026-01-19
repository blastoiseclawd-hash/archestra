/**
 * biome-ignore-all lint/correctness/noEmptyPattern: oddly enough in extend below this is required
 * see https://vitest.dev/guide/test-context.html#extend-test-context
 */
import {
  AGENT_DELEGATION_MCP_CATALOG_ID,
  ARCHESTRA_MCP_CATALOG_ID,
  MEMBER_ROLE_NAME,
} from "@shared";
import { beforeEach as baseBeforeEach, test as baseTest } from "vitest";
import db, { schema } from "@/database";
import {
  InternalMcpCatalogModel,
  SessionModel,
  TeamModel,
  ToolInvocationPolicyModel,
  ToolModel,
  TrustedDataPolicyModel,
} from "@/models";
import type {
  InsertAccount,
  InsertConversation,
  InsertInteraction,
  InsertInternalMcpCatalog,
  InsertInvitation,
  InsertLlmProxy,
  InsertMcpServer,
  InsertMember,
  InsertOrganization,
  InsertOrganizationRole,
  InsertSession,
  InsertTeam,
  InsertUser,
  LlmProxy,
  OrganizationRole,
  TeamMember,
  Tool,
  ToolInvocation,
  TrustedData,
} from "@/types";

type MakeUserOverrides = Partial<
  Pick<InsertUser, "email" | "name" | "emailVerified">
>;

/**
 * Vitest test extension with fixtures
 * https://vitest.dev/guide/test-context.html#extend-test-context
 */
interface TestFixtures {
  makeUser: typeof makeUser;
  makeAdmin: typeof makeAdmin;
  makeOrganization: typeof makeOrganization;
  makeTeam: typeof makeTeam;
  makeTeamMember: typeof makeTeamMember;
  makeAgent: typeof makeAgent;
  makeTool: typeof makeTool;
  makeAgentTool: typeof makeAgentTool;
  makeMcpGateway: typeof makeMcpGateway;
  makeMcpGatewayTool: typeof makeMcpGatewayTool;
  makePrompt: typeof makePrompt;
  makePromptTool: typeof makePromptTool;
  makeToolPolicy: typeof makeToolPolicy;
  makeTrustedDataPolicy: typeof makeTrustedDataPolicy;
  makeCustomRole: typeof makeCustomRole;
  makeMember: typeof makeMember;
  makeMcpServer: typeof makeMcpServer;
  makeInternalMcpCatalog: typeof makeInternalMcpCatalog;
  makeInvitation: typeof makeInvitation;
  makeAccount: typeof makeAccount;
  makeSession: typeof makeSession;
  makeAuthHeaders: typeof makeAuthHeaders;
  makeConversation: typeof makeConversation;
  makeInteraction: typeof makeInteraction;
  makeSecret: typeof makeSecret;
  makeSsoProvider: typeof makeSsoProvider;
  seedArchestraCatalog: typeof seedArchestraCatalog;
  seedAndAssignArchestraTools: typeof seedAndAssignArchestraTools;
}

async function _makeUser(
  namePrefix: string,
  overrides: MakeUserOverrides = {},
) {
  const userId = crypto.randomUUID();
  const [user] = await db
    .insert(schema.usersTable)
    .values({
      id: userId,
      name: `${namePrefix} ${userId.substring(0, 8)}`,
      email: `${userId}@test.com`,
      emailVerified: true,
      ...overrides,
    })
    .returning();
  return user;
}

/**
 * Creates a test user in the database (without organization membership)
 * Use makeMember() to create the user-organization-role relationship
 */
async function makeUser(overrides: MakeUserOverrides = {}) {
  return await _makeUser("Test User", overrides);
}

/**
 * Creates a test admin user in the database (without organization membership)
 * Use makeMember() with role override to create the user-organization-role relationship
 */
async function makeAdmin(overrides: MakeUserOverrides = {}) {
  return await _makeUser("Admin User", overrides);
}

/**
 * Creates a test organization in the database
 */
async function makeOrganization(
  overrides: Partial<Pick<InsertOrganization, "name" | "slug">> = {},
) {
  const orgId = crypto.randomUUID();
  const [org] = await db
    .insert(schema.organizationsTable)
    .values({
      id: orgId,
      name: `Test Org ${orgId.substring(0, 8)}`,
      slug: `test-org-${orgId.substring(0, 8)}`,
      createdAt: new Date(),
      limitCleanupInterval: null,
      theme: "cosmic-night",
      customFont: "lato",
      ...overrides,
    })
    .returning();
  return org;
}

/**
 * Creates a test team using the Team model
 */
async function makeTeam(
  organizationId: string,
  createdBy: string,
  overrides: Partial<Pick<InsertTeam, "name" | "description">> = {},
) {
  const [team] = await db
    .insert(schema.teamsTable)
    .values({
      id: crypto.randomUUID(),
      name: `Test Team ${crypto.randomUUID().substring(0, 8)}`,
      organizationId,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning();
  return team;
}

/**
 * Creates a test team member using the TeamModel
 */
async function makeTeamMember(
  teamId: string,
  userId: string,
  overrides: { role?: string; syncedFromSso?: boolean } = {},
): Promise<TeamMember> {
  return await TeamModel.addMember(
    teamId,
    userId,
    overrides.role ?? MEMBER_ROLE_NAME,
    overrides.syncedFromSso ?? false,
  );
}

/**
 * Creates a test profile.
 * Creates entries in llm_proxies and mcp_gateways tables with the same ID.
 * @deprecated Use makeLlmProxy instead for clarity
 */
async function makeAgent(
  overrides: Partial<Omit<InsertLlmProxy, "organizationId">> = {},
): Promise<LlmProxy> {
  const id = crypto.randomUUID();
  const name = overrides.name ?? `Test Agent ${id.substring(0, 8)}`;
  const teamIds = overrides.teams ?? [];
  const organizationId = "default-org-id";
  const now = new Date();

  // Create LLM Proxy record
  const [createdProxy] = await db
    .insert(schema.llmProxiesTable)
    .values({
      id,
      name,
      organizationId,
      isDefault: overrides.isDefault ?? false,
      considerContextUntrusted: overrides.considerContextUntrusted ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Create MCP Gateway record with same ID
  await db
    .insert(schema.mcpGatewaysTable)
    .values({
      id,
      name,
      organizationId,
      isDefault: overrides.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  // Assign teams
  if (teamIds.length > 0) {
    // Insert into llm_proxy_team
    await db
      .insert(schema.llmProxyTeamsTable)
      .values(
        teamIds.map((teamId) => ({
          llmProxyId: id,
          teamId,
        })),
      )
      .onConflictDoNothing();

    // Insert into mcp_gateway_team
    await db
      .insert(schema.mcpGatewayTeamsTable)
      .values(
        teamIds.map((teamId) => ({
          mcpGatewayId: id,
          teamId,
        })),
      )
      .onConflictDoNothing();
  }

  // Return proxy with expected shape
  return {
    ...createdProxy,
    tools: [],
    teams: [], // Teams not fetched for simplicity - tests can query if needed
    labels: [],
  };
}

/**
 * Creates a test tool using the Tool model
 */
async function makeTool(
  overrides: Partial<
    Pick<
      Tool,
      | "name"
      | "description"
      | "parameters"
      | "catalogId"
      | "mcpServerId"
      | "agentId"
      | "llmProxyId"
    >
  > = {},
): Promise<Tool> {
  const toolData = {
    name: `test-tool-${crypto.randomUUID().substring(0, 8)}`,
    description: "Test tool description",
    parameters: {},
    ...overrides,
    // For proxy-sniffed tools, set llmProxyId = agentId since they share the same ID
    // This ensures access control works correctly after the profile split migration
    llmProxyId: overrides.llmProxyId ?? overrides.agentId ?? null,
  };

  await ToolModel.createToolIfNotExists(toolData);
  const tool = await ToolModel.findByName(toolData.name);

  if (!tool) {
    throw new Error(`Failed to create tool: ${toolData.name}`);
  }

  return tool;
}

/**
 * @deprecated Use makeMcpGatewayTool instead
 * Creates a test agent-tool relationship (actually creates in mcp_gateway_tools table)
 */
async function makeAgentTool(
  agentId: string,
  toolId: string,
  overrides: Partial<{
    credentialSourceMcpServerId: string;
    executionSourceMcpServerId: string;
  }> = {},
) {
  // Agent IDs are the same as MCP Gateway IDs after the profile split
  return makeMcpGatewayTool(agentId, toolId, overrides);
}

/**
 * Creates a test MCP Gateway in the database
 */
async function makeMcpGateway(
  organizationId: string,
  overrides: Partial<{ name: string; isDefault: boolean }> = {},
) {
  const [gateway] = await db
    .insert(schema.mcpGatewaysTable)
    .values({
      id: crypto.randomUUID(),
      name: `Test Gateway ${crypto.randomUUID().substring(0, 8)}`,
      organizationId,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning();
  return gateway;
}

/**
 * Creates a test MCP Gateway-tool relationship
 */
async function makeMcpGatewayTool(
  mcpGatewayId: string,
  toolId: string,
  overrides: Partial<{
    responseModifierTemplate: string;
    credentialSourceMcpServerId: string;
    executionSourceMcpServerId: string;
    useDynamicTeamCredential: boolean;
  }> = {},
) {
  const [gatewayTool] = await db
    .insert(schema.mcpGatewayToolsTable)
    .values({
      mcpGatewayId,
      toolId,
      ...overrides,
    })
    .returning();
  return gatewayTool;
}

/**
 * Creates a test prompt in the database
 */
async function makePrompt(
  llmProxyId: string,
  organizationId: string,
  overrides: Partial<{
    name: string;
    agentId: string;
    mcpGatewayId: string;
    userPrompt: string;
    systemPrompt: string;
  }> = {},
) {
  const [prompt] = await db
    .insert(schema.promptsTable)
    .values({
      id: crypto.randomUUID(),
      name: `Test Prompt ${crypto.randomUUID().substring(0, 8)}`,
      organizationId,
      llmProxyId,
      agentId: overrides.agentId ?? llmProxyId,
      mcpGatewayId: overrides.mcpGatewayId ?? llmProxyId,
      userPrompt: overrides.userPrompt ?? null,
      systemPrompt: overrides.systemPrompt ?? null,
      version: 1,
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning();
  return prompt;
}

/**
 * Creates a test prompt-tool relationship
 */
async function makePromptTool(
  promptId: string,
  toolId: string,
  overrides: Partial<{
    responseModifierTemplate: string;
    credentialSourceMcpServerId: string;
    executionSourceMcpServerId: string;
    useDynamicTeamCredential: boolean;
  }> = {},
) {
  const [promptTool] = await db
    .insert(schema.promptToolsTable)
    .values({
      promptId,
      toolId,
      ...overrides,
    })
    .returning();
  return promptTool;
}

/**
 * Creates a test tool invocation policy using the ToolInvocationPolicy model
 */
async function makeToolPolicy(
  toolId: string,
  overrides: Partial<
    Pick<
      ToolInvocation.ToolInvocationPolicy,
      "conditions" | "action" | "reason"
    >
  > = {},
): Promise<ToolInvocation.ToolInvocationPolicy> {
  return await ToolInvocationPolicyModel.create({
    toolId,
    conditions: [{ key: "test-arg", operator: "equal", value: "test-value" }],
    action: "block_always",
    reason: "Test policy reason",
    ...overrides,
  });
}

/**
 * Creates a test trusted data policy using the TrustedDataPolicy model
 * Returns the created policy
 */
async function makeTrustedDataPolicy(
  toolId: string,
  overrides: Partial<
    Pick<TrustedData.TrustedDataPolicy, "description" | "conditions" | "action">
  > = {},
): Promise<TrustedData.TrustedDataPolicy> {
  return await TrustedDataPolicyModel.create({
    toolId,
    description: overrides.description ?? "Test trusted data policy",
    conditions: overrides.conditions ?? [
      { key: "test.path", operator: "equal", value: "test-value" },
    ],
    action: overrides.action ?? "mark_as_trusted",
  });
}

/**
 * Creates a test custom organization role via direct DB insert
 * (bypasses Better Auth API for test simplicity)
 */
async function makeCustomRole(
  organizationId: string,
  overrides: Partial<
    Pick<InsertOrganizationRole, "role" | "name" | "permission">
  > = {},
): Promise<OrganizationRole> {
  const roleName = `test_role_${crypto.randomUUID().substring(0, 8)}`;
  const roleData = {
    role: roleName,
    name: `Test Role ${crypto.randomUUID().substring(0, 8)}`,
    organizationId,
    permission: { profile: ["read"] },
    ...overrides,
  };

  const id = crypto.randomUUID();
  const [result] = await db
    .insert(schema.organizationRolesTable)
    .values({
      id,
      ...roleData,
      permission: JSON.stringify(roleData.permission),
    })
    .returning();

  return {
    ...result,
    predefined: false,
    permission: JSON.parse(result.permission),
  };
}

/**
 * Creates a test member relationship between user and organization
 */
async function makeMember(
  userId: string,
  organizationId: string,
  overrides: Partial<Pick<InsertMember, "role">> = {},
) {
  const [member] = await db
    .insert(schema.membersTable)
    .values({
      id: crypto.randomUUID(),
      userId,
      organizationId,
      role: MEMBER_ROLE_NAME,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  return member;
}

/**
 * Creates a test MCP server in the database
 */
async function makeMcpServer(
  overrides: Partial<
    Pick<InsertMcpServer, "name" | "catalogId" | "ownerId">
  > = {},
) {
  // Create a catalog if catalogId is not provided
  let catalogId = overrides.catalogId;
  if (!catalogId) {
    const catalog = await makeInternalMcpCatalog();
    catalogId = catalog.id;
  }

  const [mcpServer] = await db
    .insert(schema.mcpServersTable)
    .values({
      name: `test-server-${crypto.randomUUID().substring(0, 8)}`,
      serverType: "local",
      catalogId,
      secretId: null,
      ownerId: null,
      reinstallRequired: false,
      localInstallationStatus: "idle",
      localInstallationError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning();
  return mcpServer;
}

/**
 * Creates a test internal MCP catalog item
 */
async function makeInternalMcpCatalog(
  overrides: Partial<
    Pick<
      InsertInternalMcpCatalog,
      | "name"
      | "serverType"
      | "serverUrl"
      | "description"
      | "version"
      | "repository"
      | "installationCommand"
      | "requiresAuth"
      | "authDescription"
      | "authFields"
      | "localConfig"
      | "userConfig"
      | "oauthConfig"
    >
  > = {},
) {
  return await InternalMcpCatalogModel.create({
    name: `test-catalog-${crypto.randomUUID().substring(0, 8)}`,
    serverType: "remote",
    serverUrl: "https://api.example.com/mcp/",
    ...overrides,
  });
}

/**
 * Creates a test invitation
 */
async function makeInvitation(
  organizationId: string,
  inviterId: string,
  overrides: Partial<
    Pick<InsertInvitation, "email" | "role" | "status" | "expiresAt">
  > = {},
) {
  const [invitation] = await db
    .insert(schema.invitationsTable)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      email: `test-${crypto.randomUUID().substring(0, 8)}@example.com`,
      role: MEMBER_ROLE_NAME,
      status: "pending",
      expiresAt: new Date(Date.now() + 86400000),
      inviterId,
      ...overrides,
    })
    .returning();
  return invitation;
}

/**
 * Creates a test account
 */
async function makeAccount(
  userId: string,
  overrides: Partial<
    Pick<InsertAccount, "accountId" | "providerId" | "accessToken" | "idToken">
  > = {},
) {
  const [account] = await db
    .insert(schema.accountsTable)
    .values({
      id: crypto.randomUUID(),
      accountId: `oauth-account-${crypto.randomUUID().substring(0, 8)}`,
      providerId: "google",
      userId,
      accessToken: `access-token-${crypto.randomUUID().substring(0, 8)}`,
      refreshToken: `refresh-token-${crypto.randomUUID().substring(0, 8)}`,
      idToken: `id-token-${crypto.randomUUID().substring(0, 8)}`,
      accessTokenExpiresAt: new Date(Date.now() + 3600000),
      refreshTokenExpiresAt: new Date(Date.now() + 86400000),
      scope: "email profile",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning();
  return account;
}

async function makeSession(
  userId: string,
  overrides: Partial<
    Pick<
      InsertSession,
      | "token"
      | "expiresAt"
      | "ipAddress"
      | "userAgent"
      | "activeOrganizationId"
      | "impersonatedBy"
    >
  > = {},
) {
  return await SessionModel.create({
    id: crypto.randomUUID(),
    userId,
    token: `test-token-${crypto.randomUUID().substring(0, 8)}`,
    expiresAt: new Date(Date.now() + 86400000),
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0 Test Agent",
    ...overrides,
  });
}

/**
 * Creates authenticated headers from a session token for Better Auth API calls
 */
function makeAuthHeaders(sessionToken: string): HeadersInit {
  return {
    cookie: `archestra.session_token=${sessionToken}`,
  };
}

/**
 * Creates a test conversation in the database
 */
async function makeConversation(
  agentId: string,
  overrides: Partial<
    Pick<
      InsertConversation,
      "userId" | "organizationId" | "title" | "selectedModel" | "chatApiKeyId"
    >
  > = {},
) {
  const [conversation] = await db
    .insert(schema.conversationsTable)
    .values({
      id: crypto.randomUUID(),
      userId: `user-${crypto.randomUUID().substring(0, 8)}`,
      organizationId: `org-${crypto.randomUUID().substring(0, 8)}`,
      agentId,
      title: `Test Conversation ${crypto.randomUUID().substring(0, 8)}`,
      selectedModel: "gpt-4o",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning();
  return conversation;
}

/**
 * Creates a test interaction in the database
 */
async function makeInteraction(
  profileId: string,
  overrides: Partial<
    Pick<
      InsertInteraction,
      "request" | "response" | "type" | "model" | "inputTokens" | "outputTokens"
    >
  > = {},
) {
  const [interaction] = await db
    .insert(schema.interactionsTable)
    .values({
      profileId,
      request: {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: "Read the file at /etc/passwd",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "read_file",
              description: "Read a file from the filesystem",
              parameters: {
                type: "object",
                properties: {
                  file_path: {
                    type: "string",
                    description: "The path to the file to read",
                  },
                },
                required: ["file_path"],
              },
            },
          },
        ],
      },
      response: {
        id: "chatcmpl-test-123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: "call_test_123",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"file_path":"/etc/passwd"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        },
      },
      type: "openai:chatCompletions",
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 200,
      ...overrides,
    })
    .returning();
  return interaction;
}

/**
 * Creates a test secret in the database
 */
async function makeSecret(
  overrides: Partial<{ name: string; secret: Record<string, unknown> }> = {},
) {
  const [secret] = await db
    .insert(schema.secretsTable)
    .values({
      name: `testsecret`,
      secret: {
        access_token: `test-token-${crypto.randomUUID().substring(0, 8)}`,
      },
      ...overrides,
    })
    .returning();
  return secret;
}

/**
 * Creates a test SSO provider in the database.
 * Bypasses Better Auth API for test simplicity.
 */
async function makeSsoProvider(
  organizationId: string,
  overrides: {
    providerId?: string;
    issuer?: string;
    domain?: string;
    oidcConfig?: Record<string, unknown>;
    samlConfig?: Record<string, unknown>;
    roleMapping?: Record<string, unknown>;
    userId?: string | null;
  } = {},
) {
  const id = crypto.randomUUID().replace(/-/g, "").substring(0, 32);
  const providerId =
    overrides.providerId ?? `TestProvider-${id.substring(0, 8)}`;

  const [provider] = await db
    .insert(schema.ssoProvidersTable)
    .values({
      id,
      providerId,
      issuer:
        overrides.issuer ?? `https://issuer-${id.substring(0, 8)}.example.com`,
      domain: overrides.domain ?? `domain-${id.substring(0, 8)}.example.com`,
      organizationId,
      oidcConfig: overrides.oidcConfig
        ? (JSON.stringify(overrides.oidcConfig) as unknown as undefined)
        : undefined,
      samlConfig: overrides.samlConfig
        ? (JSON.stringify(overrides.samlConfig) as unknown as undefined)
        : undefined,
      roleMapping: overrides.roleMapping
        ? (JSON.stringify(overrides.roleMapping) as unknown as undefined)
        : undefined,
      userId: overrides.userId ?? null,
      // WORKAROUND: With domainVerification enabled, all SSO providers need domainVerified: true
      // See: https://github.com/better-auth/better-auth/issues/6481
      domainVerified: true,
    })
    .returning();

  return provider;
}

/**
 * Seeds just the Archestra catalog entries without creating any tools.
 * This includes both the main Archestra catalog and the Agent Delegation catalog.
 * This is useful for tests that need to create agent delegation tools
 * (via PromptAgentModel.create) but don't need the full Archestra toolset.
 */
async function seedArchestraCatalog(): Promise<void> {
  // Seed main Archestra catalog
  const existingArchestra = await InternalMcpCatalogModel.findById(
    ARCHESTRA_MCP_CATALOG_ID,
  );
  if (!existingArchestra) {
    await db.insert(schema.internalMcpCatalogTable).values({
      id: ARCHESTRA_MCP_CATALOG_ID,
      name: "Archestra",
      description:
        "Built-in Archestra tools for managing profiles, limits, policies, and MCP servers.",
      serverType: "builtin",
    });
  }

  // Seed Agent Delegation catalog (used for agent delegation tools)
  const existingAgentDelegation = await InternalMcpCatalogModel.findById(
    AGENT_DELEGATION_MCP_CATALOG_ID,
  );
  if (!existingAgentDelegation) {
    await db.insert(schema.internalMcpCatalogTable).values({
      id: AGENT_DELEGATION_MCP_CATALOG_ID,
      name: "Agent Delegation",
      description: "Tools for delegating tasks to other agents.",
      serverType: "builtin",
    });
  }
}

/**
 * Seeds and assigns Archestra tools to an agent.
 * Creates the Archestra catalog entry if it doesn't exist, then seeds tools.
 * This is useful for tests that need Archestra tools to be available.
 */
async function seedAndAssignArchestraTools(
  mcpGatewayId: string,
): Promise<void> {
  // Create Archestra catalog entry if it doesn't exist
  const existing = await InternalMcpCatalogModel.findById(
    ARCHESTRA_MCP_CATALOG_ID,
  );
  if (!existing) {
    await db.insert(schema.internalMcpCatalogTable).values({
      id: ARCHESTRA_MCP_CATALOG_ID,
      name: "Archestra",
      description:
        "Built-in Archestra tools for managing profiles, limits, policies, and MCP servers.",
      serverType: "builtin",
    });
  }

  // Seed and assign Archestra tools
  await ToolModel.seedArchestraTools(ARCHESTRA_MCP_CATALOG_ID);
  await ToolModel.assignArchestraToolsToMcpGateway(
    mcpGatewayId,
    ARCHESTRA_MCP_CATALOG_ID,
  );
}

export const beforeEach = baseBeforeEach<TestFixtures>;
export const test = baseTest.extend<TestFixtures>({
  makeUser: async ({}, use) => {
    await use(makeUser);
  },
  makeAdmin: async ({}, use) => {
    await use(makeAdmin);
  },
  makeOrganization: async ({}, use) => {
    await use(makeOrganization);
  },
  makeTeam: async ({}, use) => {
    await use(makeTeam);
  },
  makeTeamMember: async ({}, use) => {
    await use(makeTeamMember);
  },
  makeAgent: async ({}, use) => {
    await use(makeAgent);
  },
  makeTool: async ({}, use) => {
    await use(makeTool);
  },
  makeAgentTool: async ({}, use) => {
    await use(makeAgentTool);
  },
  makeMcpGateway: async ({}, use) => {
    await use(makeMcpGateway);
  },
  makeMcpGatewayTool: async ({}, use) => {
    await use(makeMcpGatewayTool);
  },
  makePrompt: async ({}, use) => {
    await use(makePrompt);
  },
  makePromptTool: async ({}, use) => {
    await use(makePromptTool);
  },
  makeToolPolicy: async ({}, use) => {
    await use(makeToolPolicy);
  },
  makeTrustedDataPolicy: async ({}, use) => {
    await use(makeTrustedDataPolicy);
  },
  makeCustomRole: async ({}, use) => {
    await use(makeCustomRole);
  },
  makeMember: async ({}, use) => {
    await use(makeMember);
  },
  makeMcpServer: async ({}, use) => {
    await use(makeMcpServer);
  },
  makeInternalMcpCatalog: async ({}, use) => {
    await use(makeInternalMcpCatalog);
  },
  makeInvitation: async ({}, use) => {
    await use(makeInvitation);
  },
  makeAccount: async ({}, use) => {
    await use(makeAccount);
  },
  makeSession: async ({}, use) => {
    await use(makeSession);
  },
  makeAuthHeaders: async ({}, use) => {
    await use(makeAuthHeaders);
  },
  makeConversation: async ({}, use) => {
    await use(makeConversation);
  },
  makeInteraction: async ({}, use) => {
    await use(makeInteraction);
  },
  makeSecret: async ({}, use) => {
    await use(makeSecret);
  },
  makeSsoProvider: async ({}, use) => {
    await use(makeSsoProvider);
  },
  seedArchestraCatalog: async ({}, use) => {
    await use(seedArchestraCatalog);
  },
  seedAndAssignArchestraTools: async ({}, use) => {
    await use(seedAndAssignArchestraTools);
  },
});
