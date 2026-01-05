import { z } from "zod";

/**
 * Supported LLM providers
 */
export const SupportedProvidersSchema = z.enum([
  "openai",
  "openai-responses",
  "gemini",
  "anthropic",
]);

export const SupportedProvidersDiscriminatorSchema = z.enum([
  "openai:chatCompletions",
  "openai-responses:responses",
  "gemini:generateContent",
  "anthropic:messages",
]);

export const SupportedProviders = Object.values(SupportedProvidersSchema.enum);
export type SupportedProvider = z.infer<typeof SupportedProvidersSchema>;
export type SupportedProviderDiscriminator = z.infer<
  typeof SupportedProvidersDiscriminatorSchema
>;

export const providerDisplayNames: Record<SupportedProvider, string> = {
  openai: "OpenAI",
  "openai-responses": "OpenAI (Responses)",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

/**
 * Maps provider variants to their base provider.
 * Used for features that should be shared across API variants
 * (e.g., optimization rules, token prices).
 *
 * Example: "openai-responses" is a variant of "openai" - they use the same
 * models, API keys, and pricing, just with a different API format.
 */
export const providerBaseMap: Partial<
  Record<SupportedProvider, SupportedProvider>
> = {
  "openai-responses": "openai",
};

/**
 * Returns the base provider for a given provider.
 * Variant providers (like "openai-responses") are mapped to their base ("openai").
 * Base providers are returned unchanged.
 */
export function getBaseProvider(provider: SupportedProvider): SupportedProvider {
  return providerBaseMap[provider] ?? provider;
}
