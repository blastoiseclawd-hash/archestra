import { archestraApiSdk, type archestraApiTypes } from "@shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const {
  assignToolToPrompt,
  bulkAssignToolsToPrompts,
  getAllPromptTools,
  getPromptAssignedTools,
  syncPromptTools,
  unassignToolFromPrompt,
  updatePromptTool,
} = archestraApiSdk;

type GetAllPromptToolsQueryParams = NonNullable<
  archestraApiTypes.GetAllPromptToolsData["query"]
>;

/**
 * Hook to fetch all prompt-tool relationships with pagination, sorting, and filtering
 */
export function useAllPromptTools({
  initialData,
  pagination,
  sorting,
  filters,
  skipPagination,
}: {
  initialData?: archestraApiTypes.GetAllPromptToolsResponses["200"];
  pagination?: {
    limit?: number;
    offset?: number;
  };
  sorting?: {
    sortBy?: NonNullable<GetAllPromptToolsQueryParams["sortBy"]>;
    sortDirection?: NonNullable<GetAllPromptToolsQueryParams["sortDirection"]>;
  };
  filters?: {
    search?: string;
    promptId?: string;
    origin?: string;
    credentialSourceMcpServerId?: string;
    mcpServerOwnerId?: string;
  };
  skipPagination?: boolean;
}) {
  return useQuery({
    queryKey: [
      "prompt-tools",
      {
        limit: pagination?.limit,
        offset: pagination?.offset,
        sortBy: sorting?.sortBy,
        sortDirection: sorting?.sortDirection,
        search: filters?.search,
        promptId: filters?.promptId,
        origin: filters?.origin,
        credentialSourceMcpServerId: filters?.credentialSourceMcpServerId,
        mcpServerOwnerId: filters?.mcpServerOwnerId,
        skipPagination,
      },
    ],
    queryFn: async () => {
      const result = await getAllPromptTools({
        query: {
          limit: pagination?.limit,
          offset: pagination?.offset,
          sortBy: sorting?.sortBy,
          sortDirection: sorting?.sortDirection,
          search: filters?.search,
          promptId: filters?.promptId,
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

/**
 * Hook to fetch tools assigned to a specific prompt
 */
export function usePromptAssignedTools(promptId: string | undefined) {
  return useQuery({
    queryKey: ["prompts", promptId, "assigned-tools"],
    queryFn: async () => {
      if (!promptId) return [];
      const result = await getPromptAssignedTools({
        path: { promptId },
      });
      return result.data ?? [];
    },
    enabled: !!promptId,
  });
}

/**
 * Hook to assign a tool to a prompt
 */
export function useAssignToolToPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      promptId,
      toolId,
      credentialSourceMcpServerId,
      executionSourceMcpServerId,
      useDynamicTeamCredential,
    }: {
      promptId: string;
      toolId: string;
      credentialSourceMcpServerId?: string | null;
      executionSourceMcpServerId?: string | null;
      useDynamicTeamCredential?: boolean;
    }) => {
      const { data } = await assignToolToPrompt({
        path: { promptId, toolId },
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
    onSuccess: (_, { promptId }) => {
      toast.success("Tool assigned to prompt");
      // Invalidate queries to refetch data
      queryClient.invalidateQueries({
        queryKey: ["prompts", promptId, "assigned-tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-tools"] });
      // Invalidate chat MCP tools for this prompt
      queryClient.invalidateQueries({
        queryKey: ["chat", "prompts", promptId, "mcp-tools"],
      });
    },
    onError: (error) => {
      toast.error(`Failed to assign tool: ${error.message}`);
    },
  });
}

/**
 * Hook to bulk assign tools to prompts
 */
export function useBulkAssignToolsToPrompts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      assignments,
      mcpServerId,
    }: {
      assignments: Array<{
        promptId: string;
        toolId: string;
        credentialSourceMcpServerId?: string | null;
        executionSourceMcpServerId?: string | null;
      }>;
      mcpServerId?: string | null;
    }) => {
      const { data } = await bulkAssignToolsToPrompts({
        body: { assignments },
      });
      if (!data) return null;
      return { ...data, mcpServerId };
    },
    onSuccess: (result) => {
      if (!result) return;

      const successCount = result.succeeded.length;
      const failedCount = result.failed.length;
      const duplicateCount = result.duplicates.length;

      if (successCount > 0) {
        toast.success(
          `Successfully assigned ${successCount} tool(s) to prompt(s)`,
        );
      }
      if (duplicateCount > 0) {
        toast.info(`${duplicateCount} tool(s) were already assigned`);
      }
      if (failedCount > 0) {
        toast.error(`Failed to assign ${failedCount} tool(s)`);
      }

      // Invalidate specific prompt tools queries for prompts that had successful assignments
      const promptIds = result.succeeded.map((a) => a.promptId);
      const uniquePromptIds = new Set(promptIds);
      for (const promptId of uniquePromptIds) {
        queryClient.invalidateQueries({
          queryKey: ["prompts", promptId, "assigned-tools"],
        });
        // Invalidate chat MCP tools for each affected prompt
        queryClient.invalidateQueries({
          queryKey: ["chat", "prompts", promptId, "mcp-tools"],
        });
      }

      // Invalidate global queries
      queryClient.invalidateQueries({ queryKey: ["tools"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["tools-with-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-tools"] });
      queryClient.invalidateQueries({ queryKey: ["prompts"] });

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
    onError: (error) => {
      toast.error(`Failed to bulk assign tools: ${error.message}`);
    },
  });
}

/**
 * Hook to unassign a tool from a prompt
 */
export function useUnassignToolFromPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      promptId,
      toolId,
    }: {
      promptId: string;
      toolId: string;
    }) => {
      const { data } = await unassignToolFromPrompt({
        path: { promptId, toolId },
      });
      return data?.success ?? false;
    },
    onSuccess: (_, { promptId }) => {
      toast.success("Tool unassigned from prompt");
      queryClient.invalidateQueries({
        queryKey: ["prompts", promptId, "assigned-tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["tools", "unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-tools"] });
      // Invalidate chat MCP tools for this prompt
      queryClient.invalidateQueries({
        queryKey: ["chat", "prompts", promptId, "mcp-tools"],
      });
    },
    onError: (error) => {
      toast.error(`Failed to unassign tool: ${error.message}`);
    },
  });
}

/**
 * Hook to update a prompt-tool relationship
 */
export function useUpdatePromptTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      updatedPromptTool: archestraApiTypes.UpdatePromptToolData["body"] & {
        id: string;
      },
    ) => {
      const result = await updatePromptTool({
        body: updatedPromptTool,
        path: { id: updatedPromptTool.id },
      });
      return result.data ?? null;
    },
    onSuccess: () => {
      toast.success("Prompt tool updated");
      // Invalidate all prompt-tools queries to refetch updated data
      queryClient.invalidateQueries({
        queryKey: ["prompt-tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (error) => {
      toast.error(`Failed to update prompt tool: ${error.message}`);
    },
  });
}

/**
 * Hook to sync tools for a prompt (bulk add/remove)
 */
export function useSyncPromptTools() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      promptId,
      toolIds,
    }: {
      promptId: string;
      toolIds: string[];
    }) => {
      const { data } = await syncPromptTools({
        path: { promptId },
        body: {
          toolIds,
        },
      });
      return data ?? null;
    },
    onSuccess: (result, { promptId }) => {
      if (result) {
        const { added, removed } = result;

        if (added > 0 || removed > 0) {
          toast.success(`Synced tools: ${added} added, ${removed} removed`);
        } else {
          toast.info("No changes needed - tools already in sync");
        }
      }

      queryClient.invalidateQueries({
        queryKey: ["prompts", promptId, "assigned-tools"],
      });
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-tools"] });
      // Invalidate chat MCP tools for this prompt
      queryClient.invalidateQueries({
        queryKey: ["chat", "prompts", promptId, "mcp-tools"],
      });
    },
    onError: (error) => {
      toast.error(`Failed to sync tools: ${error.message}`);
    },
  });
}
