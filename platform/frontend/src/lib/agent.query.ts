import { archestraApiSdk, type archestraApiTypes } from "@shared";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  DEFAULT_AGENTS_PAGE_SIZE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_DIRECTION,
} from "./utils";

const {
  createLlmProxy,
  deleteLlmProxy,
  getLlmProxies,
  getAllLlmProxies,
  getDefaultLlmProxy,
  getLlmProxy,
  updateLlmProxy,
  getLlmProxyLabelKeys,
  getLlmProxyLabelValues,
} = archestraApiSdk;

// For backward compatibility - returns all agents as an array
export function useProfiles(
  params: {
    initialData?: archestraApiTypes.GetAllLlmProxiesResponses["200"];
    filters?: archestraApiTypes.GetAllLlmProxiesData["query"];
  } = {},
) {
  return useSuspenseQuery({
    queryKey: ["agents", "all", params?.filters],
    queryFn: async () => {
      const response = await getAllLlmProxies({ query: params?.filters });
      return response.data ?? [];
    },
    initialData: params?.initialData,
  });
}

// New paginated hook for the agents page
export function useProfilesPaginated(params?: {
  initialData?: archestraApiTypes.GetLlmProxiesResponses["200"];
  limit?: number;
  offset?: number;
  sortBy?: "name" | "createdAt" | "toolsCount" | "team";
  sortDirection?: "asc" | "desc";
  name?: string;
}) {
  const { initialData, limit, offset, sortBy, sortDirection, name } =
    params || {};

  // Check if we can use initialData (server-side fetched data)
  // Only use it for the first page (offset 0), default sorting, no search filter,
  // AND matching default page size (20)
  const useInitialData =
    offset === 0 &&
    (sortBy === undefined || sortBy === DEFAULT_SORT_BY) &&
    (sortDirection === undefined || sortDirection === DEFAULT_SORT_DIRECTION) &&
    name === undefined &&
    (limit === undefined || limit === DEFAULT_AGENTS_PAGE_SIZE);

  return useSuspenseQuery({
    queryKey: ["agents", { limit, offset, sortBy, sortDirection, name }],
    queryFn: async () =>
      (
        await getLlmProxies({
          query: {
            limit,
            offset,
            sortBy,
            sortDirection,
            name,
          },
        })
      ).data ?? null,
    initialData: useInitialData ? initialData : undefined,
  });
}

export function useDefaultProfile(params?: {
  initialData?: archestraApiTypes.GetDefaultLlmProxyResponses["200"];
}) {
  return useQuery({
    queryKey: ["agents", "default"],
    queryFn: async () => (await getDefaultLlmProxy()).data ?? null,
    initialData: params?.initialData,
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["agents", id],
    queryFn: async () => {
      if (!id) return null;
      const response = await getLlmProxy({ path: { id } });
      return response.data ?? null;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: archestraApiTypes.CreateLlmProxyData["body"]) => {
      const response = await createLlmProxy({ body: data });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      // Invalidate profile tokens for the new profile
      if (data?.id) {
        queryClient.invalidateQueries({
          queryKey: ["profileTokens", data.id],
        });
      }
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: archestraApiTypes.UpdateLlmProxyData["body"];
    }) => {
      const response = await updateLlmProxy({ path: { id }, body: data });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      // Invalidate profile tokens when teams change (tokens are auto-created/deleted)
      queryClient.invalidateQueries({
        queryKey: ["profileTokens", variables.id],
      });
      // Invalidate tokens queries since team changes affect which tokens are visible for a profile
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await deleteLlmProxy({ path: { id } });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useLabelKeys() {
  return useQuery({
    queryKey: ["agents", "labels", "keys"],
    queryFn: async () => (await getLlmProxyLabelKeys()).data ?? [],
  });
}

export function useLabelValues(params?: { key?: string }) {
  const { key } = params || {};
  return useQuery({
    queryKey: ["agents", "labels", "values", key],
    queryFn: async () =>
      (await getLlmProxyLabelValues({ query: key ? { key } : {} })).data ?? [],
    enabled: key !== undefined,
  });
}
