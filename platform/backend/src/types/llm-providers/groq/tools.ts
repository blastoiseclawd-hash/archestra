/**
 * Groq Tool schemas
 *
 * Groq supports OpenAI-compatible tool calling.
 *
 * @see https://console.groq.com/docs/tool-use
 */

// Re-export OpenAI tool schemas since Groq is OpenAI-compatible
export {
  ToolSchema,
  ToolChoiceOptionSchema,
  FunctionDefinitionParametersSchema,
} from "../openai/tools";
