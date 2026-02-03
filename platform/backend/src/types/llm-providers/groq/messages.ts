/**
 * Groq Message schemas
 *
 * Groq uses OpenAI-compatible message formats.
 *
 * @see https://console.groq.com/docs/api-reference#chat-create
 */

// Re-export OpenAI message schemas since Groq is OpenAI-compatible
export {
  MessageParamSchema,
  ToolCallSchema,
  UserMessageParamSchema,
  AssistantMessageParamSchema,
  ToolMessageParamSchema,
  SystemMessageParamSchema,
} from "../openai/messages";
