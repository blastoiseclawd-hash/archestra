import { archestraApiSdk, type archestraApiTypes } from "@shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const {
  assignToolToProfile,
  autoConfigureProfileToolPolicies,
  bulkAssignTools,
  getAllProfileTools,
  unassignToolFromProfile,
  updateProfileTool,
} = archestraApiSdk;

type GetAllProfileToolsQueryParams = NonNullable<
  archestraApiTypes.GetAllProfileToolsData["query"]
>;

export function useAllProfileTools({
  initialData,
  pagination,
  sorting,
  filters,
  skipPagination,
}: {
  initialData?: archestraApiTypes.GetAllProfileToolsResponses["200"];
  pagination?: {
    limit?: number;
    offset?: number;
  };
  sorting?: {
    sortBy?: NonNullable<GetAllProfileToolsQueryParams["sortBy"]>;
    sortDirection?: NonNullable<GetAllProfileToolsQueryParams["sortDirection"]>;
  };
  filters?: {
    search?: string;
    profileId?: string;
    origin?: string;
    credentialSourceMcpServerId?: string;
    mcpServerOwnerId?: string;
  };
  skipPagination?: boolean;
}) {
  return useQuery({
    queryKey: [
      "profile-tools",
      {
        limit: pagination?.limit,
        offset: pagination?.offset,
        sortBy: sorting?.sortBy,
        sortDirection: sorting?.sortDirection,
        search: filters?.search,
        profileId: filters?.profileId,
        origin: filters?.origin,
        credentialSourceMcpServerId: filters?.credentialSourceMcpServerId,
        mcpServerOwnerId: filters?.mcpServerOwnerId,
        skipPagination,
      },
    ],
    queryFn: async () => {
      const result = await getAllProfileTools({
        query: {
          limit: pagination?.limit,
          offset: pagination?.offset,
          sortBy: sorting?.sortBy,
          sortDirection: sorting?.sortDirection,
          search: filters?.search,
          profileId: filters?.profileId,
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

export function useAssignTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      profileId,
      toolId,
      credentialSourceMcpServerId,
      executionSourceMcpServerId,
      useDynamicTeamCredential,
    }: {
      profileId: string;
      toolId: string;
      credentialSourceMcpServerId?: string | null;
      executionSourceMcpServerId?: string | null;
      useDynamicTeamCredential?: boolean;
    }) => {
      const { data } = await assignToolToProfile({
        path: { profileId, toolId },
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
    onSuccess: (_, { profileId }) => {
      // Invalidate queries to refetch data
      queryClient.invalidateQueries({
        queryKey: ["profiles", profileId, "tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["profile-tools"] });
      // Invalidate all MCP server tools queries to update assigned profile counts
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      // Invalidate chat MCP tools for this profile
      queryClient.invalidateQueries({
        queryKey: ["chat", "profiles", profileId, "mcp-tools"],
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
        profileId: string;
        toolId: string;
        credentialSourceMcpServerId?: string | null;
        executionSourceMcpServerId?: string | null;
      }>;
      mcpServerId?: string | null;
    }) => {
      const { data } = await bulkAssignTools({
        body: {
          assignments: assignments.map((a) => ({
            profileId: a.profileId,
            toolId: a.toolId,
            credentialSourceMcpServerId: a.credentialSourceMcpServerId,
            executionSourceMcpServerId: a.executionSourceMcpServerId,
          })),
        },
      });
      if (!data) return null;
      return { ...data, mcpServerId };
    },
    onSuccess: (result) => {
      if (!result) return;

      // Invalidate specific profile tools queries for profiles that had successful assignments
      const profileIds = result.succeeded.map((a) => a.profileId);
      const uniqueProfileIds = new Set(profileIds);
      for (const profileId of uniqueProfileIds) {
        queryClient.invalidateQueries({
          queryKey: ["profiles", profileId, "tools"],
        });
        // Invalidate chat MCP tools for each affected profile
        queryClient.invalidateQueries({
          queryKey: ["chat", "profiles", profileId, "mcp-tools"],
        });
      }

      // Invalidate global queries (only once, exact match to prevent nested invalidation)
      queryClient.invalidateQueries({ queryKey: ["tools"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["tools-with-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["profile-tools"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });

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
      profileId,
      toolId,
    }: {
      profileId: string;
      toolId: string;
    }) => {
      const { data } = await unassignToolFromProfile({
        path: { profileId, toolId },
      });
      return data?.success ?? false;
    },
    onSuccess: (_, { profileId }) => {
      queryClient.invalidateQueries({
        queryKey: ["profiles", profileId, "tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["profile-tools"] });
      // Invalidate all MCP server tools queries to update assigned profile counts
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      // Invalidate chat MCP tools for this profile
      queryClient.invalidateQueries({
        queryKey: ["chat", "profiles", profileId, "mcp-tools"],
      });
    },
  });
}

export function useProfileToolPatchMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      updatedProfileTool: archestraApiTypes.UpdateProfileToolData["body"] & {
        id: string;
      },
    ) => {
      const result = await updateProfileTool({
        body: updatedProfileTool,
        path: { id: updatedProfileTool.id },
      });
      return result.data ?? null;
    },
    onSuccess: () => {
      // Invalidate all profile-tools queries to refetch updated data
      queryClient.invalidateQueries({
        queryKey: ["profile-tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
}

export function useAutoConfigurePolicies() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (toolIds: string[]) => {
      const result = await autoConfigureProfileToolPolicies({
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
        queryKey: ["profile-tools"],
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
