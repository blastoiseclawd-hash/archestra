import { archestraApiSdk, type archestraApiTypes } from "@shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const {
  assignToolToAgent,
  autoConfigureAgentToolPolicies,
  bulkAssignTools,
  getAllAgentTools,
  unassignToolFromAgent,
  updateAgentTool,
} = archestraApiSdk;

type GetAllMcpGatewayToolsQueryParams = NonNullable<
  archestraApiTypes.GetAllAgentToolsData["query"]
>;

export function useAllMcpGatewayTools({
  initialData,
  pagination,
  sorting,
  filters,
  skipPagination,
}: {
  initialData?: archestraApiTypes.GetAllAgentToolsResponses["200"];
  pagination?: {
    limit?: number;
    offset?: number;
  };
  sorting?: {
    sortBy?: NonNullable<GetAllMcpGatewayToolsQueryParams["sortBy"]>;
    sortDirection?: NonNullable<
      GetAllMcpGatewayToolsQueryParams["sortDirection"]
    >;
  };
  filters?: {
    search?: string;
    mcpGatewayId?: string;
    origin?: string;
    credentialSourceMcpServerId?: string;
    mcpServerOwnerId?: string;
  };
  skipPagination?: boolean;
}) {
  return useQuery({
    queryKey: [
      "mcp-gateway-tools",
      {
        limit: pagination?.limit,
        offset: pagination?.offset,
        sortBy: sorting?.sortBy,
        sortDirection: sorting?.sortDirection,
        search: filters?.search,
        mcpGatewayId: filters?.mcpGatewayId,
        origin: filters?.origin,
        credentialSourceMcpServerId: filters?.credentialSourceMcpServerId,
        mcpServerOwnerId: filters?.mcpServerOwnerId,
        skipPagination,
      },
    ],
    queryFn: async () => {
      const result = await getAllAgentTools({
        query: {
          limit: pagination?.limit,
          offset: pagination?.offset,
          sortBy: sorting?.sortBy,
          sortDirection: sorting?.sortDirection,
          search: filters?.search,
          mcpGatewayId: filters?.mcpGatewayId,
          origin: filters?.origin,
          mcpServerOwnerId: filters?.mcpServerOwnerId,
          skipPagination,
        },
      });
      return (
        result.data ?? {
          data: [],
          pagination: {
            currentPage: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false,
          },
        }
      );
    },
    initialData,
  });
}

// Keep backward compatible alias
export const useAllProfileTools = useAllMcpGatewayTools;

export function useAssignTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      mcpGatewayId,
      toolId,
      credentialSourceMcpServerId,
      executionSourceMcpServerId,
      useDynamicTeamCredential,
    }: {
      mcpGatewayId: string;
      toolId: string;
      credentialSourceMcpServerId?: string | null;
      executionSourceMcpServerId?: string | null;
      useDynamicTeamCredential?: boolean;
    }) => {
      const { data } = await assignToolToAgent({
        path: { mcpGatewayId, toolId },
        body:
          credentialSourceMcpServerId ||
          executionSourceMcpServerId ||
          useDynamicTeamCredential !== undefined
            ? {
                credentialSourceMcpServerId:
                  credentialSourceMcpServerId || undefined,
                executionSourceMcpServerId:
                  executionSourceMcpServerId || undefined,
                useDynamicTeamCredential,
              }
            : undefined,
      });
      return data?.success ?? false;
    },
    onSuccess: (_, { mcpGatewayId }) => {
      // Invalidate queries to refetch data
      queryClient.invalidateQueries({
        queryKey: ["mcp-gateways", mcpGatewayId, "tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["mcp-gateways"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["mcp-gateway-tools"] });
      // Invalidate all MCP server tools queries to update assigned gateway counts
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      // Invalidate chat MCP tools for this gateway
      queryClient.invalidateQueries({
        queryKey: ["chat", "mcp-gateways", mcpGatewayId, "mcp-tools"],
      });
    },
  });
}

export function useBulkAssignTools() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      assignments,
      mcpServerId,
    }: {
      assignments: Array<{
        mcpGatewayId: string;
        toolId: string;
        credentialSourceMcpServerId?: string | null;
        executionSourceMcpServerId?: string | null;
      }>;
      mcpServerId?: string | null;
    }) => {
      const { data } = await bulkAssignTools({
        body: { assignments },
      });
      if (!data) return null;
      return { ...data, mcpServerId };
    },
    onSuccess: (result) => {
      if (!result) return;

      // Invalidate specific gateway tools queries for gateways that had successful assignments
      const mcpGatewayIds = result.succeeded.map((a) => a.mcpGatewayId);
      const uniqueMcpGatewayIds = new Set(mcpGatewayIds);
      for (const mcpGatewayId of uniqueMcpGatewayIds) {
        queryClient.invalidateQueries({
          queryKey: ["mcp-gateways", mcpGatewayId, "tools"],
        });
        // Invalidate chat MCP tools for each affected gateway
        queryClient.invalidateQueries({
          queryKey: ["chat", "mcp-gateways", mcpGatewayId, "mcp-tools"],
        });
      }

      // Invalidate global queries (only once, exact match to prevent nested invalidation)
      queryClient.invalidateQueries({ queryKey: ["tools"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["tools-with-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["mcp-gateway-tools"] });
      queryClient.invalidateQueries({ queryKey: ["mcp-gateways"] });

      // Invalidate the MCP servers list
      queryClient.invalidateQueries({
        queryKey: ["mcp-servers"],
        exact: true,
      });

      // Invalidate the specific MCP server's tools if we know which server
      if (result.mcpServerId) {
        queryClient.invalidateQueries({
          queryKey: ["mcp-servers", result.mcpServerId, "tools"],
        });
      }
    },
  });
}

export function useUnassignTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      mcpGatewayId,
      toolId,
    }: {
      mcpGatewayId: string;
      toolId: string;
    }) => {
      const { data } = await unassignToolFromAgent({
        path: { mcpGatewayId, toolId },
      });
      return data?.success ?? false;
    },
    onSuccess: (_, { mcpGatewayId }) => {
      queryClient.invalidateQueries({
        queryKey: ["mcp-gateways", mcpGatewayId, "tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["mcp-gateways"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["mcp-gateway-tools"] });
      // Invalidate all MCP server tools queries to update assigned gateway counts
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      // Invalidate chat MCP tools for this gateway
      queryClient.invalidateQueries({
        queryKey: ["chat", "mcp-gateways", mcpGatewayId, "mcp-tools"],
      });
    },
  });
}

export function useMcpGatewayToolPatchMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      updatedMcpGatewayTool: archestraApiTypes.UpdateAgentToolData["body"] & {
        id: string;
      },
    ) => {
      const result = await updateAgentTool({
        body: updatedMcpGatewayTool,
        path: { id: updatedMcpGatewayTool.id },
      });
      return result.data ?? null;
    },
    onSuccess: () => {
      // Invalidate all mcp-gateway-tools queries to refetch updated data
      queryClient.invalidateQueries({
        queryKey: ["mcp-gateway-tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["mcp-gateways"] });
    },
  });
}

// Keep backward compatible alias
export const useProfileToolPatchMutation = useMcpGatewayToolPatchMutation;

export function useAutoConfigurePolicies() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (toolIds: string[]) => {
      const result = await autoConfigureAgentToolPolicies({
        body: { toolIds },
      });

      if (!result.data) {
        const errorMessage =
          typeof result.error?.error === "string"
            ? result.error.error
            : (result.error?.error as { message?: string })?.message ||
              "Failed to auto-configure policies";
        throw new Error(errorMessage);
      }

      return result.data;
    },
    onSuccess: () => {
      // Invalidate queries to refetch with new policies
      queryClient.invalidateQueries({
        queryKey: ["mcp-gateway-tools"],
      });
      queryClient.invalidateQueries({
        queryKey: ["tools"],
      });
      queryClient.invalidateQueries({
        queryKey: ["tool-invocation-policies"],
      });
      queryClient.invalidateQueries({
        queryKey: ["tool-result-policies"],
      });
    },
  });
}
