/**
 * Bedrock LLM Provider Interaction Handler
 *
 * Bedrock uses an OpenAI-compatible API, so we re-export the OpenAI interaction handler.
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
 */
import OpenAiChatCompletionInteraction from "./openai";

// Bedrock uses the same request/response format as OpenAI
class BedrockChatCompletionInteraction extends OpenAiChatCompletionInteraction {}

export default BedrockChatCompletionInteraction;
