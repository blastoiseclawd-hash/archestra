/**
 * Bedrock API schemas
 *
 * Bedrock uses an OpenAI-compatible API
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
 */
// Re-export schemas that are identical to OpenAI
export {
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
  ChatCompletionsHeadersSchema,
  ChatCompletionUsageSchema,
  FinishReasonSchema,
} from "../openai/api";
