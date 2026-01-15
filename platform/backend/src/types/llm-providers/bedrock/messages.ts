/**
 * Bedrock message schemas - OpenAI-compatible
 *
 * Bedrock uses an OpenAI-compatible API, so we re-export OpenAI schemas.
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
 */
export { MessageParamSchema, ToolCallSchema } from "../openai/messages";
