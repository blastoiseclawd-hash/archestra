import { encode as toonEncode } from "@toon-format/toon";
import { get } from "lodash-es";
import OpenAIProvider from "openai";
import config from "@/config";
import { getObservableFetch } from "@/llm-metrics";
import logger from "@/logging";
import { TokenPriceModel } from "@/models";
import { getTokenizer } from "@/tokenizers";
import type {
  ChunkProcessingResult,
  CommonMcpToolDefinition,
  CommonMessage,
  CommonToolCall,
  CommonToolResult,
  CreateClientOptions,
  LLMProvider,
  LLMRequestAdapter,
  LLMResponseAdapter,
  LLMStreamAdapter,
  OpenAiResponses,
  StreamAccumulatorState,
  ToonCompressionResult,
  UsageView,
} from "@/types";
import { MockOpenAIClient } from "../mock-openai-client";
import type { CompressionStats } from "../utils/toon-conversion";
import { unwrapToolContent } from "../utils/unwrap-tool-content";

// =============================================================================
// TYPE ALIASES
// =============================================================================

type OpenAiResponsesRequest = OpenAiResponses.Types.ResponsesRequest;
type OpenAiResponsesResponse = OpenAiResponses.Types.ResponsesResponse;
type OpenAiResponsesInput = OpenAiResponses.Types.Input;
type OpenAiResponsesHeaders = OpenAiResponses.Types.ResponsesHeaders;
type OpenAiResponsesStreamEvent = OpenAiResponses.Types.ResponseStreamEvent;

// Type guard for function_call_output items
interface FunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

function isFunctionCallOutput(item: unknown): item is FunctionCallOutputItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    (item as { type: unknown }).type === "function_call_output" &&
    "call_id" in item &&
    typeof (item as { call_id: unknown }).call_id === "string" &&
    "output" in item &&
    typeof (item as { output: unknown }).output === "string"
  );
}

// =============================================================================
// REQUEST ADAPTER
// =============================================================================

class OpenAIResponsesRequestAdapter
  implements LLMRequestAdapter<OpenAiResponsesRequest, OpenAiResponsesInput>
{
  readonly provider = "openai-responses" as const;
  private request: OpenAiResponsesRequest;
  private modifiedModel: string | null = null;
  private toolResultUpdates: Record<string, string> = {};

  constructor(request: OpenAiResponsesRequest) {
    this.request = request;
  }

  // ---------------------------------------------------------------------------
  // Read Access
  // ---------------------------------------------------------------------------

  getModel(): string {
    return this.modifiedModel ?? this.request.model;
  }

  isStreaming(): boolean {
    return this.request.stream === true;
  }

  getMessages(): CommonMessage[] {
    return this.toCommonFormat(this.request.input);
  }

  getToolResults(): CommonToolResult[] {
    const results: CommonToolResult[] = [];
    const input = this.request.input;

    if (typeof input === "string") {
      return results;
    }

    for (const item of input) {
      if (isFunctionCallOutput(item)) {
        // Find the function name from previous items or context
        const functionName = this.findFunctionName(input, item.call_id);

        let content: unknown;
        try {
          content = JSON.parse(item.output);
        } catch {
          content = item.output;
        }

        results.push({
          id: item.call_id,
          name: functionName ?? "unknown",
          content,
          isError: false,
        });
      }
    }

    return results;
  }

  getTools(): CommonMcpToolDefinition[] {
    if (!this.request.tools) return [];

    const result: CommonMcpToolDefinition[] = [];
    for (const tool of this.request.tools) {
      if (tool.type === "function") {
        result.push({
          name: tool.name,
          description: tool.description,
          inputSchema: (tool.parameters as Record<string, unknown>) ?? {},
        });
      }
      // Built-in tools like web_search, file_search, etc. are not converted
      // They are handled by OpenAI directly
    }
    return result;
  }

  hasTools(): boolean {
    return (this.request.tools?.length ?? 0) > 0;
  }

  getProviderMessages(): OpenAiResponsesInput {
    return this.request.input;
  }

  getOriginalRequest(): OpenAiResponsesRequest {
    return this.request;
  }

  // ---------------------------------------------------------------------------
  // Modify Access
  // ---------------------------------------------------------------------------

  setModel(model: string): void {
    this.modifiedModel = model;
  }

  updateToolResult(toolCallId: string, newContent: string): void {
    this.toolResultUpdates[toolCallId] = newContent;
  }

  applyToolResultUpdates(updates: Record<string, string>): void {
    Object.assign(this.toolResultUpdates, updates);
  }

  async applyToonCompression(model: string): Promise<ToonCompressionResult> {
    const { input: compressedInput, stats } = await convertToolResultsToToon(
      this.request.input,
      model,
    );
    this.request = {
      ...this.request,
      input: compressedInput,
    };
    return {
      tokensBefore: stats.toonTokensBefore,
      tokensAfter: stats.toonTokensAfter,
      costSavings: stats.toonCostSavings,
    };
  }

  // ---------------------------------------------------------------------------
  // Build Modified Request
  // ---------------------------------------------------------------------------

  toProviderRequest(): OpenAiResponsesRequest {
    let input = this.request.input;

    if (Object.keys(this.toolResultUpdates).length > 0) {
      input = this.applyUpdates(input, this.toolResultUpdates);
    }

    return {
      ...this.request,
      model: this.getModel(),
      input,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private findFunctionName(
    input: OpenAiResponses.Types.InputItem[],
    callId: string,
  ): string | null {
    // In multi-turn conversations, we might have function_call items from previous responses
    // However, in the input, we typically only have function_call_output items
    // The function name might need to be tracked externally or passed in metadata
    // For now, return null and handle at a higher level if needed
    return null;
  }

  private toCommonFormat(input: OpenAiResponsesInput): CommonMessage[] {
    if (typeof input === "string") {
      return [{ role: "user" }];
    }

    const commonMessages: CommonMessage[] = [];

    for (const item of input) {
      if (item.type === "message" || !item.type) {
        // EasyInputMessage or InputMessage
        const role = (item as { role: string }).role;
        commonMessages.push({
          role: role as CommonMessage["role"],
        });
      } else if (isFunctionCallOutput(item)) {
        const functionName = this.findFunctionName(input, item.call_id);
        let toolResult: unknown;
        try {
          toolResult = JSON.parse(item.output);
        } catch {
          toolResult = item.output;
        }

        commonMessages.push({
          role: "tool",
          toolCalls: [
            {
              id: item.call_id,
              name: functionName ?? "unknown",
              content: toolResult,
              isError: false,
            },
          ],
        });
      }
    }

    return commonMessages;
  }

  private applyUpdates(
    input: OpenAiResponsesInput,
    updates: Record<string, string>,
  ): OpenAiResponsesInput {
    if (typeof input === "string") {
      return input;
    }

    const updateCount = Object.keys(updates).length;
    if (updateCount === 0) {
      return input;
    }

    let appliedCount = 0;
    const result = input.map((item) => {
      if (isFunctionCallOutput(item) && updates[item.call_id]) {
        appliedCount++;
        logger.debug(
          { callId: item.call_id },
          "[OpenAIResponsesAdapter] applyUpdates: applying update to function_call_output",
        );
        return {
          ...item,
          output: updates[item.call_id],
        };
      }
      return item;
    });

    logger.debug(
      { updateCount, appliedCount },
      "[OpenAIResponsesAdapter] applyUpdates: complete",
    );
    return result;
  }
}

// =============================================================================
// RESPONSE ADAPTER
// =============================================================================

class OpenAIResponsesResponseAdapter
  implements LLMResponseAdapter<OpenAiResponsesResponse>
{
  readonly provider = "openai-responses" as const;
  private response: OpenAiResponsesResponse;

  constructor(response: OpenAiResponsesResponse) {
    this.response = response;
  }

  getId(): string {
    return this.response.id;
  }

  getModel(): string {
    return this.response.model;
  }

  getText(): string {
    const textParts: string[] = [];

    for (const item of this.response.output) {
      if (item.type === "message" && item.role === "assistant") {
        for (const contentPart of item.content) {
          if (contentPart.type === "output_text") {
            textParts.push(contentPart.text);
          }
        }
      }
    }

    return textParts.join("");
  }

  getToolCalls(): CommonToolCall[] {
    const toolCalls: CommonToolCall[] = [];

    for (const item of this.response.output) {
      if (item.type === "function_call") {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(item.arguments);
        } catch {
          args = {};
        }

        toolCalls.push({
          id: item.call_id,
          name: item.name,
          arguments: args,
        });
      }
    }

    return toolCalls;
  }

  hasToolCalls(): boolean {
    return this.response.output.some((item) => item.type === "function_call");
  }

  getUsage(): UsageView {
    return {
      inputTokens: this.response.usage?.input_tokens ?? 0,
      outputTokens: this.response.usage?.output_tokens ?? 0,
    };
  }

  getOriginalResponse(): OpenAiResponsesResponse {
    return this.response;
  }

  toRefusalResponse(
    _refusalMessage: string,
    contentMessage: string,
  ): OpenAiResponsesResponse {
    return {
      ...this.response,
      output: [
        {
          type: "message",
          id: `msg_refusal_${Date.now()}`,
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: contentMessage,
            },
          ],
        },
      ],
    };
  }
}

// =============================================================================
// STREAM ADAPTER
// =============================================================================

class OpenAIResponsesStreamAdapter
  implements
    LLMStreamAdapter<OpenAiResponsesStreamEvent, OpenAiResponsesResponse>
{
  readonly provider = "openai-responses" as const;
  readonly state: StreamAccumulatorState;

  // Track output items during streaming
  private outputItems: OpenAiResponses.Types.OutputItem[] = [];
  private currentTextByOutput: Map<number, string> = new Map();
  private currentFunctionArgsByOutput: Map<number, string> = new Map();
  private functionCallsByOutput: Map<
    number,
    { id: string; call_id: string; name: string }
  > = new Map();

  constructor() {
    this.state = {
      responseId: "",
      model: "",
      text: "",
      toolCalls: [],
      rawToolCallEvents: [],
      usage: null,
      stopReason: null,
      timing: {
        startTime: Date.now(),
        firstChunkTime: null,
      },
    };
  }

  processChunk(event: OpenAiResponsesStreamEvent): ChunkProcessingResult {
    if (this.state.timing.firstChunkTime === null) {
      this.state.timing.firstChunkTime = Date.now();
    }

    let sseData: string | null = null;
    let isToolCallChunk = false;
    let isFinal = false;

    switch (event.type) {
      case "response.created":
      case "response.in_progress":
        this.state.responseId = event.response.id;
        this.state.model = event.response.model;
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "response.completed":
        this.state.responseId = event.response.id;
        this.state.model = event.response.model;
        this.state.stopReason = "stop";
        if (event.response.usage) {
          this.state.usage = {
            inputTokens: event.response.usage.input_tokens,
            outputTokens: event.response.usage.output_tokens,
          };
        }
        isFinal = true;
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "response.failed":
      case "response.incomplete":
        this.state.stopReason =
          event.type === "response.failed" ? "error" : "incomplete";
        isFinal = true;
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "response.output_item.added":
        this.outputItems[event.output_index] = event.item;
        if (event.item.type === "function_call") {
          this.functionCallsByOutput.set(event.output_index, {
            id: event.item.id,
            call_id: event.item.call_id,
            name: event.item.name,
          });
          isToolCallChunk = true;
          this.state.rawToolCallEvents.push(event);
        }
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "response.output_item.done":
        if (event.item.type === "function_call") {
          const args =
            this.currentFunctionArgsByOutput.get(event.output_index) ?? "";
          this.state.toolCalls.push({
            id: event.item.call_id,
            name: event.item.name,
            arguments: args,
          });
          isToolCallChunk = true;
          this.state.rawToolCallEvents.push(event);
        }
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "response.output_text.delta":
        {
          const currentText =
            this.currentTextByOutput.get(event.output_index) ?? "";
          this.currentTextByOutput.set(
            event.output_index,
            currentText + event.delta,
          );
          this.state.text += event.delta;
          sseData = `data: ${JSON.stringify(event)}\n\n`;
        }
        break;

      case "response.output_text.done":
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "response.function_call_arguments.delta":
        {
          const currentArgs =
            this.currentFunctionArgsByOutput.get(event.output_index) ?? "";
          this.currentFunctionArgsByOutput.set(
            event.output_index,
            currentArgs + event.delta,
          );
          isToolCallChunk = true;
          this.state.rawToolCallEvents.push(event);
        }
        // Don't send tool call deltas immediately - hold for policy evaluation
        break;

      case "response.function_call_arguments.done":
        isToolCallChunk = true;
        this.state.rawToolCallEvents.push(event);
        break;

      case "response.content_part.added":
      case "response.content_part.done":
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "response.refusal.delta":
      case "response.refusal.done":
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      // Built-in tool events - pass through
      case "response.file_search_call.in_progress":
      case "response.file_search_call.searching":
      case "response.file_search_call.completed":
      case "response.web_search_call.in_progress":
      case "response.web_search_call.searching":
      case "response.web_search_call.completed":
      case "response.code_interpreter_call.in_progress":
      case "response.code_interpreter_call.interpreting":
      case "response.code_interpreter_call.completed":
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      // Reasoning events
      case "response.reasoning_summary_part.added":
      case "response.reasoning_summary_part.done":
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_summary_text.done":
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;

      case "error":
        this.state.stopReason = "error";
        isFinal = true;
        sseData = `data: ${JSON.stringify(event)}\n\n`;
        break;
    }

    return { sseData, isToolCallChunk, isFinal };
  }

  getSSEHeaders(): Record<string, string> {
    return {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };
  }

  formatTextDeltaSSE(text: string): string {
    const event = {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: text,
    };
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  getRawToolCallEvents(): string[] {
    return this.state.rawToolCallEvents.map(
      (event) => `data: ${JSON.stringify(event)}\n\n`,
    );
  }

  formatCompleteTextSSE(text: string): string[] {
    const events = [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          id: `msg_${Date.now()}`,
          role: "assistant",
          status: "in_progress",
          content: [],
        },
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: {
          type: "output_text",
          text: "",
        },
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: text,
      },
      {
        type: "response.output_text.done",
        output_index: 0,
        content_index: 0,
        text: text,
      },
    ];

    return events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  }

  formatEndSSE(): string {
    const completedEvent = {
      type: "response.completed",
      response: this.toProviderResponse(),
    };
    return `data: ${JSON.stringify(completedEvent)}\n\ndata: [DONE]\n\n`;
  }

  toProviderResponse(): OpenAiResponsesResponse {
    const output: OpenAiResponses.Types.OutputItem[] = [];

    // Add text message if we have any text
    if (this.state.text) {
      output.push({
        type: "message",
        id: `msg_${this.state.responseId}_text`,
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: this.state.text,
          },
        ],
      });
    }

    // Add function calls
    for (const tc of this.state.toolCalls) {
      output.push({
        type: "function_call",
        id: `fc_${tc.id}`,
        call_id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: "completed",
      });
    }

    return {
      id: this.state.responseId,
      object: "response",
      created_at: Math.floor(this.state.timing.startTime / 1000),
      model: this.state.model,
      status: "completed",
      output,
      usage: this.state.usage
        ? {
            input_tokens: this.state.usage.inputTokens,
            output_tokens: this.state.usage.outputTokens,
            total_tokens:
              this.state.usage.inputTokens + this.state.usage.outputTokens,
          }
        : undefined,
    };
  }

  toProviderRefusalResponse(
    _refusalMessage: string,
    contentMessage: string,
  ): OpenAiResponsesResponse {
    return {
      id: this.state.responseId,
      object: "response",
      created_at: Math.floor(this.state.timing.startTime / 1000),
      model: this.state.model,
      status: "completed",
      output: [
        {
          type: "message",
          id: `msg_refusal_${Date.now()}`,
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: contentMessage,
            },
          ],
        },
      ],
      usage: this.state.usage
        ? {
            input_tokens: this.state.usage.inputTokens,
            output_tokens: this.state.usage.outputTokens,
            total_tokens:
              this.state.usage.inputTokens + this.state.usage.outputTokens,
          }
        : undefined,
    };
  }
}

// =============================================================================
// TOON COMPRESSION
// =============================================================================

async function convertToolResultsToToon(
  input: OpenAiResponsesInput,
  model: string,
): Promise<{
  input: OpenAiResponsesInput;
  stats: CompressionStats;
}> {
  if (typeof input === "string") {
    return {
      input,
      stats: {
        toonTokensBefore: null,
        toonTokensAfter: null,
        toonCostSavings: null,
      },
    };
  }

  const tokenizer = getTokenizer("openai");
  let toolResultCount = 0;
  let totalTokensBefore = 0;
  let totalTokensAfter = 0;

  const result = input.map((item) => {
    if (isFunctionCallOutput(item)) {
      logger.info(
        {
          callId: item.call_id,
          contentType: typeof item.output,
          provider: "openai-responses",
        },
        "convertToolResultsToToon: function_call_output found",
      );

      try {
        const unwrapped = unwrapToolContent(item.output);
        const parsed = JSON.parse(unwrapped);
        const noncompressed = unwrapped;
        const compressed = toonEncode(parsed);

        const tokensBefore = tokenizer.countTokens([
          { role: "user", content: noncompressed },
        ]);
        const tokensAfter = tokenizer.countTokens([
          { role: "user", content: compressed },
        ]);

        totalTokensBefore += tokensBefore;
        totalTokensAfter += tokensAfter;
        toolResultCount++;

        logger.info(
          {
            callId: item.call_id,
            beforeLength: noncompressed.length,
            afterLength: compressed.length,
            tokensBefore,
            tokensAfter,
            toonPreview: compressed.substring(0, 150),
            provider: "openai-responses",
          },
          "convertToolResultsToToon: compressed",
        );

        return {
          ...item,
          output: compressed,
        };
      } catch {
        logger.info(
          {
            callId: item.call_id,
            contentPreview: item.output.substring(0, 100),
          },
          "Skipping TOON conversion - content is not JSON",
        );
        return item;
      }
    }

    return item;
  });

  logger.info(
    { itemCount: input.length, toolResultCount },
    "convertToolResultsToToon completed",
  );

  let toonCostSavings: number | null = null;
  if (toolResultCount > 0) {
    const tokensSaved = totalTokensBefore - totalTokensAfter;
    if (tokensSaved > 0) {
      const tokenPrice = await TokenPriceModel.findByModel(model);
      if (tokenPrice) {
        const inputPricePerToken =
          Number(tokenPrice.pricePerMillionInput) / 1000000;
        toonCostSavings = tokensSaved * inputPricePerToken;
      }
    }
  }

  return {
    input: result,
    stats: {
      toonTokensBefore: toolResultCount > 0 ? totalTokensBefore : null,
      toonTokensAfter: toolResultCount > 0 ? totalTokensAfter : null,
      toonCostSavings,
    },
  };
}

// =============================================================================
// ADAPTER FACTORY
// =============================================================================

// openaiResponsesAdapterFactory is a synthetic provider to support OpenAI Responses API.
// It's not a real provider, but needed to support the OpenAI Responses API.
// All logs, optimizations, etc. should feel in UX as openai provider.
export const openaiResponsesAdapterFactory: LLMProvider<
  OpenAiResponsesRequest,
  OpenAiResponsesResponse,
  OpenAiResponsesInput,
  OpenAiResponsesStreamEvent,
  OpenAiResponsesHeaders
> = {
  provider: "openai-responses",
  interactionType: "openai:responses",

  createRequestAdapter(
    request: OpenAiResponsesRequest,
  ): LLMRequestAdapter<OpenAiResponsesRequest, OpenAiResponsesInput> {
    return new OpenAIResponsesRequestAdapter(request);
  },

  createResponseAdapter(
    response: OpenAiResponsesResponse,
  ): LLMResponseAdapter<OpenAiResponsesResponse> {
    return new OpenAIResponsesResponseAdapter(response);
  },

  createStreamAdapter(): LLMStreamAdapter<
    OpenAiResponsesStreamEvent,
    OpenAiResponsesResponse
  > {
    return new OpenAIResponsesStreamAdapter();
  },

  extractApiKey(headers: OpenAiResponsesHeaders): string | undefined {
    // Return the authorization header as-is (legacy behavior)
    // OpenAI SDK handles both "Bearer sk-xxx" and "sk-xxx" formats
    return headers.authorization;
  },

  getBaseUrl(): string | undefined {
    return config.llm.openai.baseUrl;
  },

  getSpanName(): string {
    return "openai.responses";
  },

  createClient(
    apiKey: string | undefined,
    options?: CreateClientOptions,
  ): OpenAIProvider {
    if (options?.mockMode) {
      return new MockOpenAIClient() as unknown as OpenAIProvider;
    }

    // Use observable fetch for request duration metrics if agent is provided
    const customFetch = options?.agent
      ? getObservableFetch("openai", options.agent, options.externalAgentId)
      : undefined;

    return new OpenAIProvider({
      apiKey,
      baseURL: options?.baseUrl,
      fetch: customFetch,
    });
  },

  async execute(
    client: unknown,
    request: OpenAiResponsesRequest,
  ): Promise<OpenAiResponsesResponse> {
    const openaiClient = client as OpenAIProvider;
    // The OpenAI SDK's responses.create returns a Response object
    // We use type assertion because our Zod schema matches the API spec but
    // has slight type differences from the SDK's internal types
    const response = await openaiClient.responses.create({
      ...(request as Parameters<typeof openaiClient.responses.create>[0]),
      stream: false,
    });
    return response as unknown as OpenAiResponsesResponse;
  },

  async executeStream(
    client: unknown,
    request: OpenAiResponsesRequest,
  ): Promise<AsyncIterable<OpenAiResponsesStreamEvent>> {
    const openaiClient = client as OpenAIProvider;
    // We use type assertion because our Zod schema matches the API spec but
    // has slight type differences from the SDK's internal types
    const stream = await openaiClient.responses.create({
      ...(request as Parameters<typeof openaiClient.responses.create>[0]),
      stream: true,
    });

    return {
      [Symbol.asyncIterator]: async function* () {
        for await (const event of stream) {
          yield event as unknown as OpenAiResponsesStreamEvent;
        }
      },
    };
  },

  extractErrorMessage(error: unknown): string {
    // OpenAI SDK error structure
    const openaiMessage = get(error, "error.message");
    if (typeof openaiMessage === "string") {
      return openaiMessage;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Internal server error";
  },
};
