import {
  AGENT_DELEGATION_MCP_CATALOG_ID,
  AGENT_TOOL_PREFIX,
  MCP_SERVER_TOOL_NAME_SEPARATOR,
  slugify,
  TOOL_ARTIFACT_WRITE_FULL_NAME,
  TOOL_TODO_WRITE_FULL_NAME,
} from "@shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notIlike,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getArchestraMcpTools } from "@/archestra-mcp-server";
import db, { schema } from "@/database";
import {
  createPaginatedResult,
  type PaginatedResult,
} from "@/database/utils/pagination";
import type {
  ExtendedTool,
  InsertTool,
  Tool,
  ToolFilters,
  ToolSortBy,
  ToolSortDirection,
  ToolWithAssignments,
  UpdateTool,
} from "@/types";
import LlmProxyTeamModel from "./llm-proxy-team";
import McpGatewayTeamModel from "./mcp-gateway-team";
import McpGatewayToolModel from "./mcp-gateway-tool";
import McpServerModel from "./mcp-server";
import ToolInvocationPolicyModel from "./tool-invocation-policy";
import TrustedDataPolicyModel from "./trusted-data-policy";

class ToolModel {
  /**
   * Slugify a tool name to get a unique name for the MCP server's tool.
   * Ensures the result matches the pattern ^[a-zA-Z0-9_-]{1,128}$ required by LLM providers.
   */
  static slugifyName(mcpServerName: string, toolName: string): string {
    return `${mcpServerName}${MCP_SERVER_TOOL_NAME_SEPARATOR}${toolName}`
      .toLowerCase()
      .replace(/\s+/g, "_") // Replace whitespace with underscores
      .replace(/[^a-z0-9_-]/g, ""); // Remove any characters not allowed in tool names
  }

  /**
   * Unslugify a tool name to get the original tool name
   */
  static unslugifyName(slugifiedName: string): string {
    const parts = slugifiedName.split(MCP_SERVER_TOOL_NAME_SEPARATOR);
    return parts.length > 1
      ? parts.slice(1).join(MCP_SERVER_TOOL_NAME_SEPARATOR)
      : slugifiedName;
  }

  static async create(tool: InsertTool): Promise<Tool> {
    const [createdTool] = await db
      .insert(schema.toolsTable)
      .values(tool)
      .returning();
    return createdTool;
  }

  static async update(
    id: string,
    data: Partial<
      Pick<
        UpdateTool,
        | "policiesAutoConfiguredAt"
        | "policiesAutoConfiguringStartedAt"
        | "policiesAutoConfiguredReasoning"
      >
    >,
  ): Promise<Tool | null> {
    const [updatedTool] = await db
      .update(schema.toolsTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.toolsTable.id, id))
      .returning();
    return updatedTool || null;
  }

  static async createToolIfNotExists(tool: InsertTool): Promise<Tool> {
    // For Archestra built-in tools (both agentId and catalogId are null), check if tool already exists
    // This prevents duplicate Archestra tools since NULL != NULL in unique constraints
    if (!tool.agentId && !tool.catalogId) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          and(
            isNull(schema.toolsTable.agentId),
            isNull(schema.toolsTable.catalogId),
            eq(schema.toolsTable.name, tool.name),
          ),
        );

      if (existingTool) {
        return existingTool;
      }
    }

    // For proxy-sniffed tools (agentId is set, catalogId is null), check if tool already exists
    // This prevents duplicate proxy-sniffed tools for the same agent
    if (tool.agentId && !tool.catalogId) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          and(
            eq(schema.toolsTable.agentId, tool.agentId),
            eq(schema.toolsTable.name, tool.name),
            isNull(schema.toolsTable.catalogId),
          ),
        );

      if (existingTool) {
        return existingTool;
      }
    }

    // For MCP tools (agentId is null, catalogId is set), check if tool with same catalog and name already exists
    // This allows multiple installations of the same catalog to share tool definitions
    if (!tool.agentId && tool.catalogId) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          and(
            isNull(schema.toolsTable.agentId),
            eq(schema.toolsTable.catalogId, tool.catalogId),
            eq(schema.toolsTable.name, tool.name),
          ),
        );

      if (existingTool) {
        return existingTool;
      }
    }

    const [createdTool] = await db
      .insert(schema.toolsTable)
      .values(tool)
      .onConflictDoNothing()
      .returning();

    // If tool already exists (conflict), fetch it
    if (!createdTool) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          tool.agentId
            ? and(
                eq(schema.toolsTable.agentId, tool.agentId),
                eq(schema.toolsTable.name, tool.name),
              )
            : tool.catalogId
              ? and(
                  isNull(schema.toolsTable.agentId),
                  eq(schema.toolsTable.catalogId, tool.catalogId),
                  eq(schema.toolsTable.name, tool.name),
                )
              : and(
                  isNull(schema.toolsTable.agentId),
                  isNull(schema.toolsTable.catalogId),
                  eq(schema.toolsTable.name, tool.name),
                ),
        );
      return existingTool;
    }

    // Create default policies for new tools
    await ToolModel.createDefaultPolicies(createdTool.id);

    return createdTool;
  }

  /**
   * Create default policies for a newly created tool:
   * - Default invocation policy: block_when_context_is_untrusted (empty conditions)
   * - Default result policy: mark_as_untrusted (empty conditions)
   */
  static async createDefaultPolicies(toolId: string): Promise<void> {
    // Create default invocation policy
    await ToolInvocationPolicyModel.create({
      toolId,
      conditions: [],
      action: "block_when_context_is_untrusted",
      reason: null,
    });

    // Create default result policy
    await TrustedDataPolicyModel.create({
      toolId,
      conditions: [],
      action: "mark_as_untrusted",
      description: null,
    });
  }

  static async findById(
    id: string,
    userId?: string,
    isAgentAdmin?: boolean,
  ): Promise<Tool | null> {
    const [tool] = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.id, id));

    if (!tool) {
      return null;
    }

    // Check access control for non-agent admins
    if (tool.llmProxyId && userId && !isAgentAdmin) {
      const hasAccess = await LlmProxyTeamModel.userHasLlmProxyAccess(
        userId,
        tool.llmProxyId,
        false,
      );
      if (!hasAccess) {
        return null;
      }
    }

    return tool;
  }

  static async findAll(
    userId?: string,
    isAgentAdmin?: boolean,
  ): Promise<ExtendedTool[]> {
    // Get all tools
    let query = db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        catalogId: schema.toolsTable.catalogId,
        parameters: schema.toolsTable.parameters,
        description: schema.toolsTable.description,
        createdAt: schema.toolsTable.createdAt,
        updatedAt: schema.toolsTable.updatedAt,
        llmProxyId: schema.toolsTable.llmProxyId,
        promptAgentId: schema.toolsTable.promptAgentId,
        policiesAutoConfiguredAt: schema.toolsTable.policiesAutoConfiguredAt,
        policiesAutoConfiguringStartedAt:
          schema.toolsTable.policiesAutoConfiguringStartedAt,
        policiesAutoConfiguredReasoning:
          schema.toolsTable.policiesAutoConfiguredReasoning,
        llmProxy: {
          id: schema.llmProxiesTable.id,
          name: schema.llmProxiesTable.name,
        },
        mcpServer: {
          id: schema.mcpServersTable.id,
          name: schema.mcpServersTable.name,
        },
      })
      .from(schema.toolsTable)
      .leftJoin(
        schema.llmProxiesTable,
        eq(schema.toolsTable.llmProxyId, schema.llmProxiesTable.id),
      )
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .orderBy(desc(schema.toolsTable.createdAt))
      .$dynamic();

    /**
     * Apply access control filtering for users that are not agent admins
     *
     * If the user is not an admin, we basically allow them to see all tools that are assigned to LLM Proxies
     * they have access to, plus all "MCP tools" (tools that are not assigned to any LLM Proxy).
     */
    if (userId && !isAgentAdmin) {
      const accessibleLlmProxyIds =
        await LlmProxyTeamModel.getUserAccessibleLlmProxyIds(userId, false);

      const mcpServerSourceClause = isNotNull(schema.toolsTable.mcpServerId);

      if (accessibleLlmProxyIds.length === 0) {
        query = query.where(mcpServerSourceClause);
      } else {
        query = query.where(
          or(
            inArray(schema.toolsTable.llmProxyId, accessibleLlmProxyIds),
            mcpServerSourceClause,
          ),
        );
      }
    }

    return query;
  }

  static async findByName(
    name: string,
    userId?: string,
    isAgentAdmin?: boolean,
  ): Promise<Tool | null> {
    const [tool] = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.name, name));

    if (!tool) {
      return null;
    }

    // Check access control for non-admins
    if (tool.llmProxyId && userId && !isAgentAdmin) {
      const hasAccess = await LlmProxyTeamModel.userHasLlmProxyAccess(
        userId,
        tool.llmProxyId,
        false,
      );
      if (!hasAccess) {
        return null;
      }
    }

    return tool;
  }

  /**
   * @deprecated Use getToolsByMcpGateway instead
   * Get all tools for an agent (both proxy-sniffed and MCP tools)
   */
  static async getToolsByAgent(agentId: string): Promise<Tool[]> {
    return ToolModel.getToolsByMcpGateway(agentId);
  }

  /**
   * @deprecated Use getMcpToolsByMcpGateway instead
   * Get only MCP tools assigned to an agent
   */
  static async getMcpToolsByAgent(agentId: string): Promise<Tool[]> {
    return ToolModel.getMcpToolsByMcpGateway(agentId);
  }

  /**
   * Get all tools for an MCP Gateway (both proxy-sniffed and MCP tools)
   * Proxy-sniffed tools are those with llmProxyId set directly
   * MCP tools are those assigned via the mcp_gateway_tools junction table
   */
  static async getToolsByMcpGateway(mcpGatewayId: string): Promise<Tool[]> {
    // Get tool IDs assigned via junction table (MCP tools)
    const assignedToolIds =
      await McpGatewayToolModel.findToolIdsByMcpGateway(mcpGatewayId);

    // Query for tools that are either:
    // 1. Directly associated with the gateway via llmProxyId (proxy-sniffed)
    // 2. Assigned via junction table (MCP tools)
    const conditions = [eq(schema.toolsTable.llmProxyId, mcpGatewayId)];

    if (assignedToolIds.length > 0) {
      conditions.push(inArray(schema.toolsTable.id, assignedToolIds));
    }

    const tools = await db
      .select()
      .from(schema.toolsTable)
      .where(or(...conditions))
      .orderBy(desc(schema.toolsTable.createdAt));

    return tools;
  }

  /**
   * Get only MCP tools assigned to an MCP Gateway (those from connected MCP servers)
   * Includes:
   * - MCP server tools (catalogId set, including Archestra builtin tools)
   * - Agent delegation tools (promptAgentId set)
   * Excludes: proxy-discovered tools (llmProxyId set, catalogId null, promptAgentId null)
   */
  static async getMcpToolsByMcpGateway(mcpGatewayId: string): Promise<Tool[]> {
    // Get tool IDs assigned via junction table (MCP tools)
    const assignedToolIds =
      await McpGatewayToolModel.findToolIdsByMcpGateway(mcpGatewayId);

    if (assignedToolIds.length === 0) {
      return [];
    }

    // Return tools that are assigned via junction table AND either:
    // - Have catalogId set (MCP server tools and Archestra builtin tools)
    // - Have promptAgentId set (agent delegation tools)
    const tools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          inArray(schema.toolsTable.id, assignedToolIds),
          or(
            isNotNull(schema.toolsTable.catalogId),
            isNotNull(schema.toolsTable.promptAgentId),
          ),
        ),
      )
      .orderBy(desc(schema.toolsTable.createdAt));

    return tools;
  }

  /**
   * Bulk create tools for an MCP server (catalog-based tools)
   * Fetches existing tools in a single query, then bulk inserts only new tools
   * Returns all tools (existing + newly created) to avoid N+1 queries
   */
  static async bulkCreateToolsIfNotExists(
    tools: Array<{
      name: string;
      description: string | null;
      parameters: Record<string, unknown>;
      catalogId: string;
      mcpServerId: string;
    }>,
  ): Promise<Tool[]> {
    if (tools.length === 0) {
      return [];
    }

    // Group tools by catalogId (all tools should have the same catalogId in practice)
    const catalogId = tools[0].catalogId;
    const toolNames = tools.map((t) => t.name);

    // Fetch all existing tools for this catalog in a single query
    const existingTools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          isNull(schema.toolsTable.agentId),
          eq(schema.toolsTable.catalogId, catalogId),
          inArray(schema.toolsTable.name, toolNames),
        ),
      );

    const existingToolsByName = new Map(existingTools.map((t) => [t.name, t]));

    // Prepare tools to insert (only those that don't exist)
    const toolsToInsert: InsertTool[] = [];
    const resultTools: Tool[] = [];

    for (const tool of tools) {
      const existingTool = existingToolsByName.get(tool.name);
      if (existingTool) {
        resultTools.push(existingTool);
      } else {
        toolsToInsert.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          catalogId: tool.catalogId,
          mcpServerId: tool.mcpServerId,
          agentId: null,
        });
      }
    }

    // Bulk insert new tools if any
    if (toolsToInsert.length > 0) {
      const insertedTools = await db
        .insert(schema.toolsTable)
        .values(toolsToInsert)
        .onConflictDoNothing()
        .returning();

      // Create default policies for newly inserted tools
      for (const tool of insertedTools) {
        await ToolModel.createDefaultPolicies(tool.id);
      }

      // If some tools weren't inserted due to conflict, fetch them
      if (insertedTools.length < toolsToInsert.length) {
        const insertedNames = new Set(insertedTools.map((t) => t.name));
        const missingNames = toolsToInsert
          .filter((t) => !insertedNames.has(t.name))
          .map((t) => t.name);

        if (missingNames.length > 0) {
          const conflictTools = await db
            .select()
            .from(schema.toolsTable)
            .where(
              and(
                isNull(schema.toolsTable.agentId),
                eq(schema.toolsTable.catalogId, catalogId),
                inArray(schema.toolsTable.name, missingNames),
              ),
            );
          resultTools.push(...insertedTools, ...conflictTools);
        } else {
          resultTools.push(...insertedTools);
        }
      } else {
        resultTools.push(...insertedTools);
      }
    }

    // Return tools in the same order as input
    const resultToolsByName = new Map(resultTools.map((t) => [t.name, t]));
    return tools
      .map((t) => resultToolsByName.get(t.name))
      .filter((t): t is Tool => t !== undefined);
  }

  /**
   * Seed Archestra built-in tools in the database.
   * Creates the Archestra catalog entry if it doesn't exist (for FK constraint),
   * then creates/updates tools with the catalog ID.
   * Called during server startup to ensure Archestra tools exist.
   *
   * Also migrates any pre-existing "discovered" Archestra tools (catalog_id = NULL)
   * to use the proper catalog ID.
   */
  static async seedArchestraTools(catalogId: string): Promise<void> {
    // Ensure the Archestra catalog entry exists in the database for FK constraint
    // This is a no-op if the entry already exists
    await db
      .insert(schema.internalMcpCatalogTable)
      .values({
        id: catalogId,
        name: "Archestra",
        description:
          "Built-in Archestra tools for managing profiles, limits, policies, and MCP servers.",
        serverType: "builtin",
        requiresAuth: false,
      })
      .onConflictDoNothing();

    const archestraTools = getArchestraMcpTools();
    const archestraToolNames = archestraTools.map((t) => t.name);

    // Migrate pre-existing "discovered" Archestra tools (catalog_id = NULL) to use the catalog
    // This handles tools that were auto-discovered via proxy before the catalog was introduced
    await db
      .update(schema.toolsTable)
      .set({ catalogId })
      .where(
        and(
          isNull(schema.toolsTable.catalogId),
          isNull(schema.toolsTable.agentId),
          inArray(schema.toolsTable.name, archestraToolNames),
        ),
      );

    // Get all existing Archestra tools in a single query (now including migrated ones)
    const existingTools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          eq(schema.toolsTable.catalogId, catalogId),
          inArray(schema.toolsTable.name, archestraToolNames),
        ),
      );

    const existingToolsByName = new Map(existingTools.map((t) => [t.name, t]));

    // Prepare tools to insert (only those that don't exist)
    const toolsToInsert: InsertTool[] = [];

    for (const archestraTool of archestraTools) {
      const existingTool = existingToolsByName.get(archestraTool.name);
      if (!existingTool) {
        toolsToInsert.push({
          name: archestraTool.name,
          description: archestraTool.description || null,
          parameters: archestraTool.inputSchema,
          catalogId,
          agentId: null,
        });
      }
    }

    // Bulk insert new tools if any
    if (toolsToInsert.length > 0) {
      await db.insert(schema.toolsTable).values(toolsToInsert).returning();
    }
  }

  /**
   * Creates/ensures the Agent Delegation catalog entry exists.
   * Also migrates any existing agent delegation tools to use this catalog.
   * Called during server startup.
   */
  static async seedAgentDelegationCatalog(catalogId: string): Promise<void> {
    // Ensure the Agent Delegation catalog entry exists in the database
    await db
      .insert(schema.internalMcpCatalogTable)
      .values({
        id: catalogId,
        name: "Agent Delegation",
        description:
          "Agent delegation tools that allow prompts to delegate tasks to other agents.",
        serverType: "builtin",
        requiresAuth: false,
      })
      .onConflictDoNothing();

    // Migrate existing agent delegation tools to use this catalog
    // These are tools with promptAgentId set but no catalogId
    await db
      .update(schema.toolsTable)
      .set({ catalogId })
      .where(
        and(
          isNull(schema.toolsTable.catalogId),
          isNotNull(schema.toolsTable.promptAgentId),
        ),
      );
  }

  /**
   * Assign Archestra built-in tools to an MCP Gateway.
   * Assumes tools have already been seeded via seedArchestraTools().
   */
  static async assignArchestraToolsToMcpGateway(
    mcpGatewayId: string,
    catalogId: string,
  ): Promise<void> {
    // Get all Archestra tools from the catalog
    const archestraTools = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.catalogId, catalogId));

    const toolIds = archestraTools.map((t) => t.id);

    // Assign all tools to gateway in bulk to avoid N+1
    await McpGatewayToolModel.createManyIfNotExists(mcpGatewayId, toolIds);
  }

  /**
   * @deprecated Use assignArchestraToolsToMcpGateway instead
   */
  static async assignArchestraToolsToAgent(
    agentId: string,
    catalogId: string,
  ): Promise<void> {
    return ToolModel.assignArchestraToolsToMcpGateway(agentId, catalogId);
  }

  /**
   * Assign default Archestra tools (artifact_write, todo_write) to an MCP Gateway.
   * These tools are automatically assigned to new profiles for task tracking and artifact management.
   */
  static async assignDefaultArchestraToolsToMcpGateway(
    mcpGatewayId: string,
  ): Promise<void> {
    // Find the default tools by name
    const defaultToolNames = [
      TOOL_ARTIFACT_WRITE_FULL_NAME,
      TOOL_TODO_WRITE_FULL_NAME,
    ];

    const defaultTools = await db
      .select({ id: schema.toolsTable.id })
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.name, defaultToolNames));

    if (defaultTools.length === 0) {
      // Tools not yet seeded, skip assignment
      return;
    }

    const toolIds = defaultTools.map((t) => t.id);

    // Assign tools to gateway in bulk
    await McpGatewayToolModel.createManyIfNotExists(mcpGatewayId, toolIds);
  }

  /**
   * @deprecated Use assignDefaultArchestraToolsToMcpGateway instead
   */
  static async assignDefaultArchestraToolsToAgent(
    agentId: string,
  ): Promise<void> {
    return ToolModel.assignDefaultArchestraToolsToMcpGateway(agentId);
  }

  /**
   * Get names of all MCP tools assigned to an MCP Gateway
   * Used to prevent autodiscovery of tools already available via MCP servers
   */
  static async getMcpToolNamesByMcpGateway(
    mcpGatewayId: string,
  ): Promise<string[]> {
    const mcpTools = await db
      .select({
        name: schema.toolsTable.name,
      })
      .from(schema.toolsTable)
      .innerJoin(
        schema.mcpGatewayToolsTable,
        eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
      )
      .where(
        and(
          eq(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayId),
          isNotNull(schema.toolsTable.mcpServerId), // Only MCP tools
        ),
      );

    return mcpTools.map((tool) => tool.name);
  }

  /**
   * Get MCP tools assigned to an MCP Gateway
   */
  static async getMcpToolsAssignedToMcpGateway(
    toolNames: string[],
    mcpGatewayId: string,
  ): Promise<
    Array<{
      toolName: string;
      responseModifierTemplate: string | null;
      mcpServerSecretId: string | null;
      mcpServerName: string | null;
      mcpServerCatalogId: string | null;
      mcpServerId: string | null;
      credentialSourceMcpServerId: string | null;
      executionSourceMcpServerId: string | null;
      useDynamicTeamCredential: boolean;
      catalogId: string | null;
      catalogName: string | null;
    }>
  > {
    if (toolNames.length === 0) {
      return [];
    }

    const mcpTools = await db
      .select({
        toolName: schema.toolsTable.name,
        responseModifierTemplate:
          schema.mcpGatewayToolsTable.responseModifierTemplate,
        mcpServerSecretId: schema.mcpServersTable.secretId,
        mcpServerName: schema.mcpServersTable.name,
        mcpServerCatalogId: schema.mcpServersTable.catalogId,
        credentialSourceMcpServerId:
          schema.mcpGatewayToolsTable.credentialSourceMcpServerId,
        executionSourceMcpServerId:
          schema.mcpGatewayToolsTable.executionSourceMcpServerId,
        useDynamicTeamCredential:
          schema.mcpGatewayToolsTable.useDynamicTeamCredential,
        mcpServerId: schema.mcpServersTable.id,
        catalogId: schema.toolsTable.catalogId,
        catalogName: schema.internalMcpCatalogTable.name,
      })
      .from(schema.toolsTable)
      .innerJoin(
        schema.mcpGatewayToolsTable,
        eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
      )
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .leftJoin(
        schema.internalMcpCatalogTable,
        eq(schema.toolsTable.catalogId, schema.internalMcpCatalogTable.id),
      )
      .where(
        and(
          eq(schema.mcpGatewayToolsTable.mcpGatewayId, mcpGatewayId),
          inArray(schema.toolsTable.name, toolNames),
          isNotNull(schema.toolsTable.catalogId), // Only MCP tools (have catalogId)
        ),
      );

    return mcpTools;
  }

  /**
   * Get all tools for a specific MCP server with their assignment counts and assigned MCP Gateways
   */
  static async findByMcpServerId(mcpServerId: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      parameters: Record<string, unknown>;
      createdAt: Date;
      assignedMcpGatewayCount: number;
      assignedMcpGateways: Array<{ id: string; name: string }>;
    }>
  > {
    const tools = await db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        description: schema.toolsTable.description,
        parameters: schema.toolsTable.parameters,
        createdAt: schema.toolsTable.createdAt,
      })
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.mcpServerId, mcpServerId))
      .orderBy(desc(schema.toolsTable.createdAt));

    const toolIds = tools.map((tool) => tool.id);

    // Get all MCP Gateway assignments for these tools in one query to avoid N+1
    const assignments = await db
      .select({
        toolId: schema.mcpGatewayToolsTable.toolId,
        mcpGatewayId: schema.mcpGatewayToolsTable.mcpGatewayId,
        mcpGatewayName: schema.mcpGatewaysTable.name,
      })
      .from(schema.mcpGatewayToolsTable)
      .innerJoin(
        schema.mcpGatewaysTable,
        eq(
          schema.mcpGatewayToolsTable.mcpGatewayId,
          schema.mcpGatewaysTable.id,
        ),
      )
      .where(inArray(schema.mcpGatewayToolsTable.toolId, toolIds));

    // Group assignments by tool ID
    const assignmentsByTool = new Map<
      string,
      Array<{ id: string; name: string }>
    >();

    for (const toolId of toolIds) {
      assignmentsByTool.set(toolId, []);
    }

    for (const assignment of assignments) {
      const toolAssignments = assignmentsByTool.get(assignment.toolId) || [];
      toolAssignments.push({
        id: assignment.mcpGatewayId,
        name: assignment.mcpGatewayName,
      });
      assignmentsByTool.set(assignment.toolId, toolAssignments);
    }

    // Build tools with their assigned MCP Gateways
    const toolsWithGateways = tools.map((tool) => {
      const assignedMcpGateways = assignmentsByTool.get(tool.id) || [];

      return {
        ...tool,
        parameters: tool.parameters ?? {},
        assignedMcpGatewayCount: assignedMcpGateways.length,
        assignedMcpGateways,
      };
    });

    return toolsWithGateways;
  }

  /**
   * Get all tools for a specific catalog item with their assignment counts and assigned MCP Gateways
   * Used to show tools across all installations of the same catalog item
   */
  static async findByCatalogId(catalogId: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      parameters: Record<string, unknown>;
      createdAt: Date;
      assignedMcpGatewayCount: number;
      assignedMcpGateways: Array<{ id: string; name: string }>;
    }>
  > {
    const tools = await db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        description: schema.toolsTable.description,
        parameters: schema.toolsTable.parameters,
        createdAt: schema.toolsTable.createdAt,
      })
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.catalogId, catalogId))
      .orderBy(desc(schema.toolsTable.createdAt));

    const toolIds = tools.map((tool) => tool.id);

    // Get all MCP Gateway assignments for these tools in one query to avoid N+1
    const assignments = await db
      .select({
        toolId: schema.mcpGatewayToolsTable.toolId,
        mcpGatewayId: schema.mcpGatewayToolsTable.mcpGatewayId,
        mcpGatewayName: schema.mcpGatewaysTable.name,
      })
      .from(schema.mcpGatewayToolsTable)
      .innerJoin(
        schema.mcpGatewaysTable,
        eq(
          schema.mcpGatewayToolsTable.mcpGatewayId,
          schema.mcpGatewaysTable.id,
        ),
      )
      .where(inArray(schema.mcpGatewayToolsTable.toolId, toolIds));

    // Group assignments by tool ID
    const assignmentsByTool = new Map<
      string,
      Array<{ id: string; name: string }>
    >();

    for (const toolId of toolIds) {
      assignmentsByTool.set(toolId, []);
    }

    for (const assignment of assignments) {
      const toolAssignments = assignmentsByTool.get(assignment.toolId) || [];
      toolAssignments.push({
        id: assignment.mcpGatewayId,
        name: assignment.mcpGatewayName,
      });
      assignmentsByTool.set(assignment.toolId, toolAssignments);
    }

    // Build tools with their assigned MCP Gateways
    const toolsWithGateways = tools.map((tool) => {
      const assignedMcpGateways = assignmentsByTool.get(tool.id) || [];

      return {
        ...tool,
        parameters: tool.parameters ?? {},
        assignedMcpGatewayCount: assignedMcpGateways.length,
        assignedMcpGateways,
      };
    });

    return toolsWithGateways;
  }

  /**
   * Delete all tools for a specific catalog item
   * Used when the last MCP server installation for a catalog is removed
   * Returns the number of tools deleted
   */
  static async deleteByCatalogId(catalogId: string): Promise<number> {
    const result = await db
      .delete(schema.toolsTable)
      .where(eq(schema.toolsTable.catalogId, catalogId));

    return result.rowCount || 0;
  }

  /**
   * Delete a tool by ID.
   * Only allows deletion of auto-discovered tools (no mcpServerId).
   */
  static async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(schema.toolsTable)
      .where(
        and(
          eq(schema.toolsTable.id, id),
          isNull(schema.toolsTable.mcpServerId),
        ),
      );

    return (result.rowCount || 0) > 0;
  }

  static async getByIds(ids: string[]): Promise<Tool[]> {
    return db
      .select()
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.id, ids));
  }

  /**
   * Get tool names by IDs
   * Used to map tool IDs to names for filtering
   */
  static async getNamesByIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const tools = await db
      .select({ name: schema.toolsTable.name })
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.id, ids));

    return tools.map((t) => t.name);
  }

  /**
   * Bulk create proxy-sniffed tools for an LLM Proxy (tools discovered via LLM proxy)
   * Fetches existing tools in a single query, then bulk inserts only new tools
   * Returns all tools (existing + newly created) to avoid N+1 queries
   */
  static async bulkCreateProxyToolsIfNotExists(
    tools: Array<{
      name: string;
      description?: string | null;
      parameters?: Record<string, unknown>;
    }>,
    llmProxyId: string,
  ): Promise<Tool[]> {
    if (tools.length === 0) {
      return [];
    }

    const toolNames = tools.map((t) => t.name);

    // Fetch all existing tools for this LLM Proxy in a single query
    // Check both llmProxyId (new) and agentId (deprecated) for backward compatibility
    const existingTools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          or(
            eq(schema.toolsTable.llmProxyId, llmProxyId),
            eq(schema.toolsTable.agentId, llmProxyId),
          ),
          isNull(schema.toolsTable.catalogId),
          inArray(schema.toolsTable.name, toolNames),
        ),
      );

    const existingToolsByName = new Map(existingTools.map((t) => [t.name, t]));

    // Prepare tools to insert (only those that don't exist)
    const toolsToInsert: InsertTool[] = [];
    const resultTools: Tool[] = [];

    for (const tool of tools) {
      const existingTool = existingToolsByName.get(tool.name);
      if (existingTool) {
        resultTools.push(existingTool);
      } else {
        toolsToInsert.push({
          name: tool.name,
          description: tool.description ?? null,
          parameters: tool.parameters ?? {},
          catalogId: null,
          mcpServerId: null,
          // Set both agentId (deprecated) and llmProxyId for backward compatibility
          agentId: llmProxyId,
          llmProxyId,
        });
      }
    }

    // Bulk insert new tools if any
    if (toolsToInsert.length > 0) {
      const insertedTools = await db
        .insert(schema.toolsTable)
        .values(toolsToInsert)
        .onConflictDoNothing()
        .returning();

      // Create default policies for newly inserted tools
      for (const tool of insertedTools) {
        await ToolModel.createDefaultPolicies(tool.id);
      }

      // If some tools weren't inserted due to conflict, fetch them
      if (insertedTools.length < toolsToInsert.length) {
        const insertedNames = new Set(insertedTools.map((t) => t.name));
        const missingNames = toolsToInsert
          .filter((t) => !insertedNames.has(t.name))
          .map((t) => t.name);

        if (missingNames.length > 0) {
          const conflictTools = await db
            .select()
            .from(schema.toolsTable)
            .where(
              and(
                or(
                  eq(schema.toolsTable.llmProxyId, llmProxyId),
                  eq(schema.toolsTable.agentId, llmProxyId),
                ),
                isNull(schema.toolsTable.catalogId),
                inArray(schema.toolsTable.name, missingNames),
              ),
            );
          resultTools.push(...insertedTools, ...conflictTools);
        } else {
          resultTools.push(...insertedTools);
        }
      } else {
        resultTools.push(...insertedTools);
      }
    }

    // Return tools in the same order as input
    const resultToolsByName = new Map(resultTools.map((t) => [t.name, t]));
    return tools
      .map((t) => resultToolsByName.get(t.name))
      .filter((t): t is Tool => t !== undefined);
  }

  /**
   * Create or get an agent delegation tool for a prompt agent
   * These tools are NOT assigned to agents via agent_tools - they're prompt-specific
   * @param params.promptAgentId - The prompt_agents.id
   * @param params.agentName - The name of the delegated agent (used for tool name)
   * @param params.description - Description from the delegated prompt's systemPrompt
   */
  static async createAgentDelegationTool(params: {
    promptAgentId: string;
    agentName: string;
    description?: string | null;
  }): Promise<Tool> {
    const { promptAgentId, agentName, description } = params;

    // Check if tool already exists for this prompt agent
    const [existingTool] = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.promptAgentId, promptAgentId))
      .limit(1);

    if (existingTool) {
      return existingTool;
    }

    // Create the tool with catalogId for grouping in UI
    // NOT assigned to agent_tools - it's prompt-specific until explicitly assigned
    const [tool] = await db
      .insert(schema.toolsTable)
      .values({
        name: `${AGENT_TOOL_PREFIX}${slugify(agentName)}`,
        promptAgentId,
        agentId: null,
        catalogId: AGENT_DELEGATION_MCP_CATALOG_ID,
        mcpServerId: null,
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message to send to this agent",
            },
          },
          required: ["message"],
        },
        description: description || `Delegate to ${agentName}`,
      })
      .returning();

    return tool;
  }

  /**
   * Get agent delegation tools for a prompt
   * Fetches tools that are linked to prompt_agents for the given promptId
   */
  static async getAgentDelegationToolsByPrompt(
    promptId: string,
  ): Promise<Tool[]> {
    // Get prompt_agents for this prompt
    const promptAgents = await db
      .select({ id: schema.promptAgentsTable.id })
      .from(schema.promptAgentsTable)
      .where(eq(schema.promptAgentsTable.promptId, promptId));

    if (promptAgents.length === 0) {
      return [];
    }

    const promptAgentIds = promptAgents.map((pa) => pa.id);

    // Get tools with promptAgentId in that list
    const tools = await db
      .select()
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.promptAgentId, promptAgentIds));

    return tools;
  }

  /**
   * Get agent delegation tools with LLM Proxy info for user access filtering
   * Returns tools along with the LLM Proxy ID of the delegated-to prompt
   */
  static async getAgentDelegationToolsWithDetails(promptId: string): Promise<
    Array<{
      tool: Tool;
      llmProxyId: string;
      agentPromptId: string;
      agentPromptName: string;
      agentPromptSystemPrompt: string | null;
    }>
  > {
    // Join tools with prompt_agents and prompts to get LLM Proxy info
    const results = await db
      .select({
        tool: schema.toolsTable,
        llmProxyId: schema.llmProxiesTable.id,
        agentPromptId: schema.promptAgentsTable.agentPromptId,
        agentPromptName: schema.promptsTable.name,
        agentPromptSystemPrompt: schema.promptsTable.systemPrompt,
      })
      .from(schema.toolsTable)
      .innerJoin(
        schema.promptAgentsTable,
        eq(schema.toolsTable.promptAgentId, schema.promptAgentsTable.id),
      )
      .innerJoin(
        schema.promptsTable,
        eq(schema.promptAgentsTable.agentPromptId, schema.promptsTable.id),
      )
      .innerJoin(
        schema.llmProxiesTable,
        eq(schema.promptsTable.llmProxyId, schema.llmProxiesTable.id),
      )
      .where(eq(schema.promptAgentsTable.promptId, promptId));

    return results;
  }

  /**
   * Sync agent delegation tool names when a prompt is renamed
   * Updates the tool name for all tools that delegate to this prompt
   * @param agentPromptId - The prompt ID that was renamed (the delegated-to prompt)
   * @param newName - The new name of the prompt
   */
  static async syncAgentDelegationToolNames(
    agentPromptIds: string | string[],
    newName: string,
  ): Promise<void> {
    const idsArray = Array.isArray(agentPromptIds)
      ? agentPromptIds
      : [agentPromptIds];

    if (idsArray.length === 0) {
      return;
    }

    // Find all prompt_agents that point to any of these prompts (agentPromptId)
    const promptAgents = await db
      .select({ id: schema.promptAgentsTable.id })
      .from(schema.promptAgentsTable)
      .where(inArray(schema.promptAgentsTable.agentPromptId, idsArray));

    if (promptAgents.length === 0) {
      return;
    }

    const promptAgentIds = promptAgents.map((pa) => pa.id);
    const newToolName = `${AGENT_TOOL_PREFIX}${slugify(newName)}`;

    // Update all tools that reference these prompt_agents
    await db
      .update(schema.toolsTable)
      .set({ name: newToolName })
      .where(inArray(schema.toolsTable.promptAgentId, promptAgentIds));
  }

  /**
   * Find all tools with their profile assignments.
   * Returns one entry per tool (grouped by tool), with all assignments embedded.
   * Only returns tools that have at least one assignment.
   */
  static async findAllWithAssignments(params: {
    pagination?: { limit?: number; offset?: number };
    sorting?: {
      sortBy?: ToolSortBy;
      sortDirection?: ToolSortDirection;
    };
    filters?: ToolFilters;
    userId?: string;
    isAgentAdmin?: boolean;
  }): Promise<PaginatedResult<ToolWithAssignments>> {
    const {
      pagination = { limit: 20, offset: 0 },
      sorting,
      filters,
      userId,
      isAgentAdmin,
    } = params;

    // Build WHERE conditions for tools
    const toolWhereConditions: ReturnType<typeof sql>[] = [];

    // Filter by search query (tool name)
    if (filters?.search) {
      toolWhereConditions.push(
        ilike(schema.toolsTable.name, `%${filters.search}%`),
      );
    }

    // Filter by origin (either "llm-proxy" or a catalogId)
    if (filters?.origin) {
      if (filters.origin === "llm-proxy") {
        // LLM Proxy tools have null catalogId but agentId is set
        toolWhereConditions.push(isNull(schema.toolsTable.catalogId));
        toolWhereConditions.push(isNotNull(schema.toolsTable.agentId));
      } else {
        // MCP tools have a catalogId
        toolWhereConditions.push(
          eq(schema.toolsTable.catalogId, filters.origin),
        );
      }
    }

    // Exclude Archestra built-in tools
    if (filters?.excludeArchestraTools) {
      toolWhereConditions.push(
        notIlike(schema.toolsTable.name, "archestra__%"),
      );
    }

    // Apply access control filtering for users that are not MCP Gateway admins
    // Get accessible MCP Gateway IDs for filtering assignments
    let accessibleMcpGatewayIds: string[] | undefined;
    let accessibleMcpServerIds: Set<string> | undefined;
    if (userId && !isAgentAdmin) {
      const [mcpGatewayIds, mcpServers] = await Promise.all([
        McpGatewayTeamModel.getUserAccessibleMcpGatewayIds(userId, false),
        McpServerModel.findAll(userId, false),
      ]);
      accessibleMcpGatewayIds = mcpGatewayIds;
      accessibleMcpServerIds = new Set(mcpServers.map((s) => s.id));

      if (accessibleMcpGatewayIds.length === 0) {
        return createPaginatedResult([], 0, {
          limit: pagination.limit ?? 20,
          offset: pagination.offset ?? 0,
        });
      }
    }

    // Build the combined WHERE clause
    const toolWhereClause =
      toolWhereConditions.length > 0 ? and(...toolWhereConditions) : undefined;

    // Subquery to get tools that have at least one assignment (with access control)
    const assignmentConditions = accessibleMcpGatewayIds
      ? and(
          eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id),
          inArray(
            schema.mcpGatewayToolsTable.mcpGatewayId,
            accessibleMcpGatewayIds,
          ),
        )
      : eq(schema.mcpGatewayToolsTable.toolId, schema.toolsTable.id);

    // Count subquery for assignment count (with access control)
    const assignmentCountSubquery = sql<number>`(
      SELECT COUNT(*) FROM ${schema.mcpGatewayToolsTable}
      WHERE ${assignmentConditions}
    )`;

    // Determine the ORDER BY clause based on sorting params
    const direction = sorting?.sortDirection === "asc" ? asc : desc;
    let orderByClause: ReturnType<typeof asc>;

    switch (sorting?.sortBy) {
      case "name":
        orderByClause = direction(schema.toolsTable.name);
        break;
      case "origin":
        // Sort by catalogId (null values for LLM Proxy)
        orderByClause = direction(
          sql`CASE WHEN ${schema.toolsTable.catalogId} IS NULL THEN '2-llm-proxy' ELSE '1-mcp' END`,
        );
        break;
      case "assignmentCount":
        orderByClause = direction(assignmentCountSubquery);
        break;
      default:
        orderByClause = direction(schema.toolsTable.createdAt);
        break;
    }

    // Query for tools that have at least one assignment
    const toolsWithCount = await db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        description: schema.toolsTable.description,
        parameters: schema.toolsTable.parameters,
        catalogId: schema.toolsTable.catalogId,
        mcpServerId: schema.toolsTable.mcpServerId,
        mcpServerName: schema.mcpServersTable.name,
        mcpServerCatalogId: schema.mcpServersTable.catalogId,
        createdAt: schema.toolsTable.createdAt,
        updatedAt: schema.toolsTable.updatedAt,
        assignmentCount: assignmentCountSubquery,
      })
      .from(schema.toolsTable)
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .where(
        and(
          toolWhereClause,
          // Tools with at least one assignment OR agent delegation tools
          sql`(
            EXISTS (
              SELECT 1 FROM ${schema.mcpGatewayToolsTable}
              WHERE ${assignmentConditions}
            )
            OR ${schema.toolsTable.promptAgentId} IS NOT NULL
          )`,
        ),
      )
      .orderBy(orderByClause)
      .limit(pagination.limit ?? 20)
      .offset(pagination.offset ?? 0);

    // Get total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.toolsTable)
      .where(
        and(
          toolWhereClause,
          // Tools with at least one assignment OR agent delegation tools
          sql`(
            EXISTS (
              SELECT 1 FROM ${schema.mcpGatewayToolsTable}
              WHERE ${assignmentConditions}
            )
            OR ${schema.toolsTable.promptAgentId} IS NOT NULL
          )`,
        ),
      );

    if (toolsWithCount.length === 0) {
      return createPaginatedResult([], 0, {
        limit: pagination.limit ?? 20,
        offset: pagination.offset ?? 0,
      });
    }

    // Get all assignments for these tools in one query
    const toolIds = toolsWithCount.map((t) => t.id as string);
    const assignmentWhereConditions = [
      inArray(schema.mcpGatewayToolsTable.toolId, toolIds),
    ];

    // Apply access control to assignments
    if (accessibleMcpGatewayIds) {
      assignmentWhereConditions.push(
        inArray(
          schema.mcpGatewayToolsTable.mcpGatewayId,
          accessibleMcpGatewayIds,
        ),
      );
    }

    // Aliases for credential source and execution source MCP servers and their owners
    const credentialMcpServerAlias = alias(
      schema.mcpServersTable,
      "credentialMcpServer",
    );
    const credentialOwnerAlias = alias(schema.usersTable, "credentialOwner");
    const executionMcpServerAlias = alias(
      schema.mcpServersTable,
      "executionMcpServer",
    );
    const executionOwnerAlias = alias(schema.usersTable, "executionOwner");

    const assignments = await db
      .select({
        toolId: schema.mcpGatewayToolsTable.toolId,
        mcpGatewayToolId: schema.mcpGatewayToolsTable.id,
        mcpGatewayId: schema.mcpGatewaysTable.id,
        mcpGatewayName: schema.mcpGatewaysTable.name,
        credentialSourceMcpServerId:
          schema.mcpGatewayToolsTable.credentialSourceMcpServerId,
        credentialOwnerEmail: credentialOwnerAlias.email,
        executionSourceMcpServerId:
          schema.mcpGatewayToolsTable.executionSourceMcpServerId,
        executionOwnerEmail: executionOwnerAlias.email,
        useDynamicTeamCredential:
          schema.mcpGatewayToolsTable.useDynamicTeamCredential,
        responseModifierTemplate:
          schema.mcpGatewayToolsTable.responseModifierTemplate,
      })
      .from(schema.mcpGatewayToolsTable)
      .innerJoin(
        schema.mcpGatewaysTable,
        eq(
          schema.mcpGatewayToolsTable.mcpGatewayId,
          schema.mcpGatewaysTable.id,
        ),
      )
      .leftJoin(
        credentialMcpServerAlias,
        eq(
          schema.mcpGatewayToolsTable.credentialSourceMcpServerId,
          credentialMcpServerAlias.id,
        ),
      )
      .leftJoin(
        credentialOwnerAlias,
        eq(credentialMcpServerAlias.ownerId, credentialOwnerAlias.id),
      )
      .leftJoin(
        executionMcpServerAlias,
        eq(
          schema.mcpGatewayToolsTable.executionSourceMcpServerId,
          executionMcpServerAlias.id,
        ),
      )
      .leftJoin(
        executionOwnerAlias,
        eq(executionMcpServerAlias.ownerId, executionOwnerAlias.id),
      )
      .where(and(...assignmentWhereConditions));

    // Group assignments by tool ID
    const assignmentsByToolId = new Map<
      string,
      Array<{
        mcpGatewayToolId: string;
        mcpGateway: { id: string; name: string };
        credentialSourceMcpServerId: string | null;
        credentialOwnerEmail: string | null;
        executionSourceMcpServerId: string | null;
        executionOwnerEmail: string | null;
        useDynamicTeamCredential: boolean;
        responseModifierTemplate: string | null;
      }>
    >();

    for (const assignment of assignments) {
      const existing = assignmentsByToolId.get(assignment.toolId) || [];

      // Check if user has access to the credential MCP server
      // If not accessible, don't include the owner email (frontend will show "Owner outside your team")
      const credentialServerAccessible =
        !accessibleMcpServerIds ||
        !assignment.credentialSourceMcpServerId ||
        accessibleMcpServerIds.has(assignment.credentialSourceMcpServerId);
      const executionServerAccessible =
        !accessibleMcpServerIds ||
        !assignment.executionSourceMcpServerId ||
        accessibleMcpServerIds.has(assignment.executionSourceMcpServerId);

      existing.push({
        mcpGatewayToolId: assignment.mcpGatewayToolId,
        mcpGateway: {
          id: assignment.mcpGatewayId,
          name: assignment.mcpGatewayName,
        },
        credentialSourceMcpServerId: assignment.credentialSourceMcpServerId,
        credentialOwnerEmail: credentialServerAccessible
          ? assignment.credentialOwnerEmail
          : null,
        executionSourceMcpServerId: assignment.executionSourceMcpServerId,
        executionOwnerEmail: executionServerAccessible
          ? assignment.executionOwnerEmail
          : null,
        useDynamicTeamCredential: assignment.useDynamicTeamCredential,
        responseModifierTemplate: assignment.responseModifierTemplate,
      });
      assignmentsByToolId.set(assignment.toolId, existing);
    }

    // Build the final result
    const result: ToolWithAssignments[] = toolsWithCount.map((tool) => ({
      id: tool.id as string,
      name: tool.name as string,
      description: tool.description as string | null,
      parameters: (tool.parameters as Record<string, unknown>) ?? {},
      catalogId: tool.catalogId as string | null,
      mcpServerId: tool.mcpServerId as string | null,
      mcpServerName: tool.mcpServerName as string | null,
      mcpServerCatalogId: tool.mcpServerCatalogId as string | null,
      createdAt: tool.createdAt as Date,
      updatedAt: tool.updatedAt as Date,
      assignmentCount: Number(tool.assignmentCount),
      assignments: assignmentsByToolId.get(tool.id as string) || [],
    }));

    return createPaginatedResult(result, Number(total), {
      limit: pagination.limit ?? 20,
      offset: pagination.offset ?? 0,
    });
  }
}

export default ToolModel;
