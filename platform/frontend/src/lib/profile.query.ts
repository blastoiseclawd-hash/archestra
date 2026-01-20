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
  createProfile,
  deleteProfile,
  getProfiles,
  getAllProfiles,
  getDefaultProfile,
  getProfile,
  updateProfile,
  getLabelKeys,
  getLabelValues,
} = archestraApiSdk;

// For backward compatibility - returns all profiles as an array (suspense version)
export function useProfiles(
  params: {
    initialData?: archestraApiTypes.GetAllProfilesResponses["200"];
    filters?: archestraApiTypes.GetAllProfilesData["query"];
  } = {},
) {
  return useSuspenseQuery({
    queryKey: ["profiles", "all", params?.filters],
    queryFn: async () => {
      const response = await getAllProfiles({ query: params?.filters });
      return response.data ?? [];
    },
    initialData: params?.initialData,
  });
}

/**
 * Non-suspense version of useProfiles.
 * Use in components that need to show loading states instead of suspense boundaries.
 */
export function useProfilesQuery(
  params: { filters?: archestraApiTypes.GetAllProfilesData["query"] } = {},
) {
  return useQuery({
    queryKey: ["profiles", "all", params?.filters],
    queryFn: async () => {
      const response = await getAllProfiles({ query: params?.filters });
      return response.data ?? [];
    },
  });
}

// New paginated hook for the profiles page
export function useProfilesPaginated(params?: {
  initialData?: archestraApiTypes.GetProfilesResponses["200"];
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
    queryKey: ["profiles", { limit, offset, sortBy, sortDirection, name }],
    queryFn: async () =>
      (
        await getProfiles({
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
  initialData?: archestraApiTypes.GetDefaultProfileResponses["200"];
}) {
  return useQuery({
    queryKey: ["profiles", "default"],
    queryFn: async () => (await getDefaultProfile()).data ?? null,
    initialData: params?.initialData,
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["profiles", id],
    queryFn: async () => {
      if (!id) return null;
      const response = await getProfile({ path: { id } });
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
    mutationFn: async (data: archestraApiTypes.CreateProfileData["body"]) => {
      const response = await createProfile({ body: data });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
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
      data: archestraApiTypes.UpdateProfileData["body"];
    }) => {
      const response = await updateProfile({ path: { id }, body: data });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
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
      const response = await deleteProfile({ path: { id } });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
}

export function useLabelKeys() {
  return useQuery({
    queryKey: ["profiles", "labels", "keys"],
    queryFn: async () => (await getLabelKeys()).data ?? [],
  });
}

export function useLabelValues(params?: { key?: string }) {
  const { key } = params || {};
  return useQuery({
    queryKey: ["profiles", "labels", "values", key],
    queryFn: async () =>
      (await getLabelValues({ query: key ? { key } : {} })).data ?? [],
    enabled: key !== undefined,
  });
}
