import type { CreateClientConfig } from "./client.gen";

export const createClientConfig: CreateClientConfig = (config) => {
  return {
    ...config,
    baseUrl: "http://localhost:9000",
    credentials: "include",
    throwOnError: true,
  };
};
