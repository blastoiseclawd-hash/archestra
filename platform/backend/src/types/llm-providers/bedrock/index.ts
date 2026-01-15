/**
 * Bedrock LLM Provider Types - OpenAI-compatible
 *
 * Bedrock uses an OpenAI-compatible API at https://bedrock-mantle.us-east-1.api.aws/v1
 * We re-export OpenAI schemas with Bedrock-specific namespace for type safety.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
 */
import type OpenAIProvider from "openai";
import type { z } from "zod";
import * as BedrockAPI from "./api";
import * as BedrockMessages from "./messages";
import * as BedrockTools from "./tools";

namespace Bedrock {
  export const API = BedrockAPI;
  export const Messages = BedrockMessages;
  export const Tools = BedrockTools;

  export namespace Types {
    export type ChatCompletionsHeaders = z.infer<
      typeof BedrockAPI.ChatCompletionsHeadersSchema
    >;
    export type ChatCompletionsRequest = z.infer<
      typeof BedrockAPI.ChatCompletionRequestSchema
    >;
    export type ChatCompletionsResponse = z.infer<
      typeof BedrockAPI.ChatCompletionResponseSchema
    >;
    export type Usage = z.infer<typeof BedrockAPI.ChatCompletionUsageSchema>;

    export type FinishReason = z.infer<typeof BedrockAPI.FinishReasonSchema>;
    export type Message = z.infer<typeof BedrockMessages.MessageParamSchema>;
    export type Role = Message["role"];

    // Use OpenAI's stream chunk type since Bedrock is OpenAI-compatible
    export type ChatCompletionChunk =
      OpenAIProvider.Chat.Completions.ChatCompletionChunk;
  }
}

export default Bedrock;
