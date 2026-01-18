// biome-ignore-all lint/suspicious/noExplicitAny: AWS SDK stream event types require any casts in tests
import { EventStreamCodec } from "@smithy/eventstream-codec";
import { fromUtf8, toUtf8 } from "@smithy/util-utf8";
import { describe, expect, test, vi } from "@/test";
import type { Bedrock } from "@/types";
import { bedrockAdapterFactory, getCommandInput } from "./bedrock";

// Helper to decode AWS Event Stream binary format
const eventStreamCodec = new EventStreamCodec(toUtf8, fromUtf8);

function decodeEventStreamMessage(bytes: Uint8Array): {
  eventType: string;
  body: unknown;
} {
  const message = eventStreamCodec.decode(bytes);
  const eventType = String(message.headers[":event-type"]?.value ?? "");
  let body: unknown = {};
  if (message.body?.length > 0) {
    const bodyText = toUtf8(message.body);
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }
  return { eventType, body };
}

// =============================================================================
// MOCK BEDROCK CLIENT
// =============================================================================

function createMockBedrockClient(options: {
  converseResponse?: Bedrock.Types.ConverseResponse;
  streamEvents?: Array<Record<string, unknown>>;
}) {
  return {
    send: vi.fn().mockImplementation((command) => {
      const commandName = command.constructor.name;

      if (commandName === "ConverseCommand") {
        return Promise.resolve(
          options.converseResponse ?? {
            $metadata: { requestId: "mock-request-id" },
            output: {
              message: {
                role: "assistant",
                content: [{ text: "Mock response" }],
              },
            },
            stopReason: "end_turn",
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        );
      }

      if (commandName === "ConverseStreamCommand") {
        const events = options.streamEvents ?? [
          { messageStart: { role: "assistant" } },
          {
            contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Hi" } },
          },
          { messageStop: { stopReason: "end_turn" } },
          { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } },
        ];

        return Promise.resolve({
          stream: (async function* () {
            for (const event of events) {
              yield event;
            }
          })(),
        });
      }

      throw new Error(`Unknown command: ${commandName}`);
    }),
  };
}

function createMockRequest(
  messages: Bedrock.Types.Message[],
  options?: Partial<Bedrock.Types.ConverseRequest>,
): Bedrock.Types.ConverseRequest {
  return {
    modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
    messages,
    ...options,
  };
}

function createMockResponse(
  content: NonNullable<
    Bedrock.Types.ConverseResponse["output"]["message"]
  >["content"],
  options?: Partial<Bedrock.Types.ConverseResponse>,
): Bedrock.Types.ConverseResponse {
  return {
    $metadata: { requestId: "test-request-id" },
    output: {
      message: {
        role: "assistant",
        content,
      },
    },
    stopReason: "end_turn",
    usage: {
      inputTokens: 100,
      outputTokens: 50,
    },
    ...options,
  };
}

describe("BedrockRequestAdapter", () => {
  describe("getToolResults", () => {
    test("extracts tool results from user messages", () => {
      const request = createMockRequest([
        {
          role: "user",
          content: [{ text: "Get the weather" }],
        },
        {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "tool_123",
                name: "get_weather",
                input: { location: "NYC" },
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_123",
                content: [{ text: '{"temperature": 72}' }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const results = adapter.getToolResults();

      expect(results).toEqual([
        {
          id: "tool_123",
          name: "get_weather",
          content: { temperature: 72 },
          isError: false,
        },
      ]);
    });

    test("handles tool results with JSON content block", () => {
      const request = createMockRequest([
        {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "tool_456",
                name: "query_db",
                input: {},
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_456",
                content: [{ json: { rows: [1, 2, 3] } }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const results = adapter.getToolResults();

      expect(results).toEqual([
        {
          id: "tool_456",
          name: "query_db",
          content: { rows: [1, 2, 3] },
          isError: false,
        },
      ]);
    });

    test("handles error status in tool results", () => {
      const request = createMockRequest([
        {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "tool_789",
                name: "failing_tool",
                input: {},
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_789",
                status: "error",
                content: [{ text: "Connection failed" }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const results = adapter.getToolResults();

      expect(results[0].isError).toBe(true);
    });

    test("handles non-JSON text content gracefully", () => {
      const request = createMockRequest([
        {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "tool_abc",
                name: "text_tool",
                input: {},
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_abc",
                content: [{ text: "Plain text response" }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const results = adapter.getToolResults();

      expect(results[0].content).toBe("Plain text response");
    });

    test("returns unknown for tool name when not found in history", () => {
      const request = createMockRequest([
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "orphan_tool",
                content: [{ text: '{"data": "test"}' }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const results = adapter.getToolResults();

      expect(results[0].name).toBe("unknown");
    });

    test("handles multiple tool results in single message", () => {
      const request = createMockRequest([
        {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "tool_1",
                name: "tool_one",
                input: {},
              },
            },
            {
              toolUse: {
                toolUseId: "tool_2",
                name: "tool_two",
                input: {},
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_1",
                content: [{ text: '{"result": 1}' }],
              },
            },
            {
              toolResult: {
                toolUseId: "tool_2",
                content: [{ text: '{"result": 2}' }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const results = adapter.getToolResults();

      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "tool_one" }),
          expect.objectContaining({ name: "tool_two" }),
        ]),
      );
    });
  });

  describe("getMessages (toCommonFormat)", () => {
    test("converts messages with tool results to common format", () => {
      const request = createMockRequest([
        {
          role: "user",
          content: [{ text: "Hello" }],
        },
        {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "call_123",
                name: "get_weather",
                input: { location: "NYC" },
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "call_123",
                content: [{ text: '{"temp": 72}' }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const messages = adapter.getMessages();

      expect(messages).toHaveLength(3);
      expect(messages[2].toolCalls).toEqual([
        {
          id: "call_123",
          name: "get_weather",
          content: { temp: 72 },
          isError: false,
        },
      ]);
    });

    test("preserves message roles", () => {
      const request = createMockRequest([
        { role: "user", content: [{ text: "Hello" }] },
        { role: "assistant", content: [{ text: "Hi there" }] },
        { role: "user", content: [{ text: "How are you?" }] },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const messages = adapter.getMessages();

      expect(messages).toEqual([
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({ role: "assistant" }),
        expect.objectContaining({ role: "user" }),
      ]);
    });
  });

  describe("updateToolResult and applyUpdates", () => {
    test("applies single tool result update", () => {
      const request = createMockRequest([
        {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "tool_123",
                name: "get_data",
                input: {},
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_123",
                content: [{ text: '{"original": true}' }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      adapter.updateToolResult("tool_123", '{"modified": true}');
      const result = adapter.toProviderRequest();

      expect(result.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                toolResult: expect.objectContaining({
                  content: [{ text: '{"modified": true}' }],
                }),
              }),
            ]),
          }),
        ]),
      );
    });

    test("applies multiple tool result updates", () => {
      const request = createMockRequest([
        {
          role: "assistant",
          content: [
            {
              toolUse: { toolUseId: "tool_1", name: "tool_one", input: {} },
            },
            {
              toolUse: { toolUseId: "tool_2", name: "tool_two", input: {} },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_1",
                content: [{ text: "original_1" }],
              },
            },
            {
              toolResult: {
                toolUseId: "tool_2",
                content: [{ text: "original_2" }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      adapter.applyToolResultUpdates({
        tool_1: "updated_1",
        tool_2: "updated_2",
      });
      const result = adapter.toProviderRequest();

      expect(result.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                toolResult: expect.objectContaining({
                  toolUseId: "tool_1",
                  content: [{ text: "updated_1" }],
                }),
              }),
              expect.objectContaining({
                toolResult: expect.objectContaining({
                  toolUseId: "tool_2",
                  content: [{ text: "updated_2" }],
                }),
              }),
            ]),
          }),
        ]),
      );
    });

    test("does not modify messages when no updates", () => {
      const request = createMockRequest([
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "tool_123",
                content: [{ text: "unchanged" }],
              },
            },
          ],
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const result = adapter.toProviderRequest();

      const userMessage = result.messages.find((m) => m.role === "user");
      const toolResult = userMessage?.content?.find(
        (c) => "toolResult" in c,
      ) as { toolResult: { content: Array<{ text: string }> } };

      expect(toolResult.toolResult.content[0].text).toBe("unchanged");
    });
  });

  describe("setModel", () => {
    test("overrides model in final request", () => {
      const request = createMockRequest(
        [{ role: "user", content: [{ text: "Hello" }] }],
        { modelId: "anthropic.claude-3-sonnet-20240229-v1:0" },
      );

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      adapter.setModel("anthropic.claude-3-haiku-20240307-v1:0");

      expect(adapter.getModel()).toBe("anthropic.claude-3-haiku-20240307-v1:0");
      expect(adapter.toProviderRequest().modelId).toBe(
        "anthropic.claude-3-haiku-20240307-v1:0",
      );
    });
  });
});

// =============================================================================
// RESPONSE ADAPTER TESTS
// =============================================================================

describe("BedrockResponseAdapter", () => {
  describe("getToolCalls", () => {
    test("extracts tool calls from response", () => {
      const response = createMockResponse([
        {
          toolUse: {
            toolUseId: "call_123",
            name: "get_weather",
            input: { location: "NYC" },
          },
        },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const toolCalls = adapter.getToolCalls();

      expect(toolCalls).toEqual([
        {
          id: "call_123",
          name: "get_weather",
          arguments: { location: "NYC" },
        },
      ]);
    });

    test("handles multiple tool calls", () => {
      const response = createMockResponse([
        {
          toolUse: {
            toolUseId: "call_1",
            name: "tool_one",
            input: { param: "a" },
          },
        },
        {
          toolUse: {
            toolUseId: "call_2",
            name: "tool_two",
            input: { param: "b" },
          },
        },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const toolCalls = adapter.getToolCalls();

      expect(toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "tool_one" }),
          expect.objectContaining({ name: "tool_two" }),
        ]),
      );
    });

    test("handles mixed text and tool use content", () => {
      const response = createMockResponse([
        { text: "Let me check that for you." },
        {
          toolUse: {
            toolUseId: "call_123",
            name: "search",
            input: { query: "test" },
          },
        },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const toolCalls = adapter.getToolCalls();

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("search");
    });

    test("returns empty array when no tool calls", () => {
      const response = createMockResponse([{ text: "Just a text response" }]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getToolCalls()).toEqual([]);
    });

    test("handles missing input in tool use", () => {
      const response = createMockResponse([
        {
          toolUse: {
            toolUseId: "call_123",
            name: "no_args_tool",
            input: {},
          },
        },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const toolCalls = adapter.getToolCalls();

      expect(toolCalls[0].arguments).toEqual({});
    });
  });

  describe("getText", () => {
    test("extracts text from response", () => {
      const response = createMockResponse([{ text: "Hello, world!" }]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getText()).toBe("Hello, world!");
    });

    test("concatenates multiple text blocks", () => {
      const response = createMockResponse([
        { text: "First part. " },
        { text: "Second part." },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getText()).toBe("First part. Second part.");
    });

    test("ignores non-text content blocks", () => {
      const response = createMockResponse([
        { text: "Some text" },
        {
          toolUse: {
            toolUseId: "call_123",
            name: "tool",
            input: {},
          },
        },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getText()).toBe("Some text");
    });

    test("returns empty string when no text content", () => {
      const response = createMockResponse([
        {
          toolUse: {
            toolUseId: "call_123",
            name: "tool",
            input: {},
          },
        },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getText()).toBe("");
    });
  });

  describe("getUsage", () => {
    test("extracts token usage", () => {
      const response = createMockResponse([{ text: "Test" }], {
        usage: { inputTokens: 150, outputTokens: 75 },
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const usage = adapter.getUsage();

      expect(usage).toEqual({
        inputTokens: 150,
        outputTokens: 75,
      });
    });

    test("defaults to zero when usage missing", () => {
      const response = createMockResponse([{ text: "Test" }], {
        usage: undefined,
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const usage = adapter.getUsage();

      expect(usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
    });
  });

  describe("hasToolCalls", () => {
    test("returns true when response has tool calls", () => {
      const response = createMockResponse([
        {
          toolUse: {
            toolUseId: "call_123",
            name: "tool",
            input: {},
          },
        },
      ]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.hasToolCalls()).toBe(true);
    });

    test("returns false when response has no tool calls", () => {
      const response = createMockResponse([{ text: "Just text" }]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.hasToolCalls()).toBe(false);
    });
  });

  describe("toRefusalResponse", () => {
    test("creates refusal response with content message", () => {
      const response = createMockResponse([{ text: "Original" }]);

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const refusal = adapter.toRefusalResponse(
        "Full refusal message",
        "Tool blocked by policy",
      );

      expect(refusal.output?.message?.content).toEqual([
        { text: "Tool blocked by policy" },
      ]);
      expect(refusal.stopReason).toBe("end_turn");
    });
  });

  describe("getId", () => {
    test("uses request ID from metadata", () => {
      const response = createMockResponse([{ text: "Test" }], {
        $metadata: { requestId: "custom-request-id" },
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getId()).toBe("custom-request-id");
    });

    test("generates ID when metadata missing", () => {
      const response = createMockResponse([{ text: "Test" }], {
        $metadata: {},
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getId()).toMatch(/^msg_bedrock_/);
    });
  });
});

describe("BedrockStreamAdapter", () => {
  describe("processChunk", () => {
    test("processes messageStart event", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const result = adapter.processChunk({
        messageStart: { role: "assistant" },
      });

      // Binary AWS Event Stream format
      expect(result.sseData).toBeInstanceOf(Uint8Array);
      const decoded = decodeEventStreamMessage(result.sseData as Uint8Array);
      expect(decoded.eventType).toBe("messageStart");
      expect(decoded.body).toEqual({ role: "assistant" });
      expect(result.isToolCallChunk).toBe(false);
      expect(result.isFinal).toBe(false);
    });

    test("processes text contentBlockStart event", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const chunk = {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { text: "" },
        },
      };
      const result = adapter.processChunk(chunk as any);

      // Binary AWS Event Stream format
      expect(result.sseData).toBeInstanceOf(Uint8Array);
      const decoded = decodeEventStreamMessage(result.sseData as Uint8Array);
      expect(decoded.eventType).toBe("contentBlockStart");
      expect(decoded.body).toEqual(chunk.contentBlockStart);
    });

    test("processes toolUse contentBlockStart event", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const result = adapter.processChunk({
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: {
              toolUseId: "call_123",
              name: "get_weather",
            },
          },
        },
      });

      expect(result.isToolCallChunk).toBe(true);
      expect(result.sseData).toBeNull();
      expect(adapter.state.toolCalls).toEqual([
        expect.objectContaining({
          id: "call_123",
          name: "get_weather",
          arguments: "",
        }),
      ]);
    });

    test("processes text contentBlockDelta event", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const chunk = {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: "Hello " },
        },
      };
      const result = adapter.processChunk(chunk);

      // Binary AWS Event Stream format
      expect(result.sseData).toBeInstanceOf(Uint8Array);
      const decoded = decodeEventStreamMessage(result.sseData as Uint8Array);
      expect(decoded.eventType).toBe("contentBlockDelta");
      expect(decoded.body).toEqual(chunk.contentBlockDelta);
      expect(adapter.state.text).toBe("Hello ");
    });

    test("accumulates text across multiple deltas", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      adapter.processChunk({
        contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Hello " } },
      });
      adapter.processChunk({
        contentBlockDelta: { contentBlockIndex: 0, delta: { text: "world!" } },
      });

      expect(adapter.state.text).toBe("Hello world!");
    });

    test("processes toolUse contentBlockDelta event", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      // First start the tool use block
      adapter.processChunk({
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: {
              toolUseId: "call_123",
              name: "get_weather",
            },
          },
        },
      });

      // Then send input delta
      const result = adapter.processChunk({
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: {
            toolUse: { input: '{"location":' },
          },
        },
      });

      expect(result.isToolCallChunk).toBe(true);
      expect(adapter.state.toolCalls[0].arguments).toBe('{"location":');
    });

    test("accumulates tool use input across deltas", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      adapter.processChunk({
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: "call_123", name: "tool" } },
        },
      });

      adapter.processChunk({
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"key":' } },
        },
      });
      adapter.processChunk({
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '"value"}' } },
        },
      });

      expect(adapter.state.toolCalls[0].arguments).toBe('{"key":"value"}');
    });

    test("processes messageStop event without tool calls", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const chunk = { messageStop: { stopReason: "end_turn" } };
      const result = adapter.processChunk(chunk as any);

      // messageStop is NOT final - metadata comes after
      expect(result.isFinal).toBe(false);
      // Binary AWS Event Stream format
      expect(result.sseData).toBeInstanceOf(Uint8Array);
      const decoded = decodeEventStreamMessage(result.sseData as Uint8Array);
      expect(decoded.eventType).toBe("messageStop");
      expect(decoded.body).toEqual(chunk.messageStop);
      expect(adapter.state.stopReason).toBe("end_turn");
    });

    test("processes metadata event with usage without tool calls", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const chunk = {
        metadata: {
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      };
      const result = adapter.processChunk(chunk as any);

      expect(adapter.state.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
      });
      // metadata is the final event - Binary AWS Event Stream format
      expect(result.isFinal).toBe(true);
      expect(result.sseData).toBeInstanceOf(Uint8Array);
      const decoded = decodeEventStreamMessage(result.sseData as Uint8Array);
      expect(decoded.eventType).toBe("metadata");
    });

    test("processes metadata event with latency metrics", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const chunk = {
        metadata: {
          usage: { inputTokens: 10, outputTokens: 5 },
          metrics: { latencyMs: 1234 },
        },
      };
      const result = adapter.processChunk(chunk as any);

      const response = adapter.toProviderResponse();
      expect(response.metrics).toEqual({ latencyMs: 1234 });
      // Binary AWS Event Stream format
      expect(result.sseData).toBeInstanceOf(Uint8Array);
    });

    test("processes metadata event with trace info", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const traceData = { guardrail: { inputAssessment: { blocked: false } } };
      const chunk = {
        metadata: {
          usage: { inputTokens: 10, outputTokens: 5 },
          trace: traceData,
        },
      };
      const result = adapter.processChunk(chunk as any);

      const response = adapter.toProviderResponse();
      expect(response.trace).toEqual(traceData);
      // Binary AWS Event Stream format
      expect(result.sseData).toBeInstanceOf(Uint8Array);
    });

    test("tracks first chunk time", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      expect(adapter.state.timing.firstChunkTime).toBeNull();

      adapter.processChunk({ messageStart: { role: "assistant" } });

      expect(adapter.state.timing.firstChunkTime).not.toBeNull();
    });

    test("handles internalServerException", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const result = adapter.processChunk({
        internalServerException: { message: "Internal error occurred" },
      } as any);

      expect(result).toEqual(
        expect.objectContaining({
          isFinal: true,
          error: {
            type: "internal_server_error",
            message: "Internal error occurred",
          },
        }),
      );
    });

    test("handles throttlingException", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const result = adapter.processChunk({
        throttlingException: { message: "Rate limit exceeded" },
      } as any);

      expect(result).toEqual(
        expect.objectContaining({
          isFinal: true,
          error: { type: "throttling", message: "Rate limit exceeded" },
        }),
      );
    });

    test("handles validationException", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      const result = adapter.processChunk({
        validationException: { message: "Invalid model ID" },
      } as any);

      expect(result).toEqual(
        expect.objectContaining({
          isFinal: true,
          error: { type: "validation_error", message: "Invalid model ID" },
        }),
      );
    });
  });

  describe("toProviderResponse", () => {
    test("assembles complete response from accumulated state", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      // Simulate streaming chunks
      adapter.processChunk({ messageStart: { role: "assistant" } } as any);
      adapter.processChunk({
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: "Hello!" },
        },
      } as any);
      adapter.processChunk({
        metadata: {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      } as any);
      adapter.processChunk({ messageStop: { stopReason: "end_turn" } } as any);

      const response = adapter.toProviderResponse();

      expect(response.output?.message?.content).toContainEqual({
        text: "Hello!",
      });
      expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
      expect(response.stopReason).toBe("end_turn");
    });

    test("includes tool calls in response", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      adapter.processChunk({
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: { toolUseId: "call_123", name: "get_weather" },
          },
        },
      } as any);
      adapter.processChunk({
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"location":"NYC"}' } },
        },
      } as any);
      adapter.processChunk({ messageStop: { stopReason: "tool_use" } } as any);

      const response = adapter.toProviderResponse();

      expect(response.output?.message?.content).toContainEqual({
        toolUse: {
          toolUseId: "call_123",
          name: "get_weather",
          input: { location: "NYC" },
        },
      });
    });

    test("handles invalid JSON in tool arguments", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      adapter.processChunk({
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: "call_123", name: "tool" } },
        },
      } as any);
      adapter.processChunk({
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: "invalid json{" } },
        },
      } as any);

      const response = adapter.toProviderResponse();
      const toolUseContent = response.output?.message?.content?.find(
        (c) => "toolUse" in c,
      ) as { toolUse: { input: Record<string, unknown> } };

      expect(toolUseContent.toolUse.input).toEqual({});
    });
  });

  describe("getRawToolCallEvents", () => {
    test("returns tool call events as binary AWS Event Stream", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      const chunk1 = {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: { toolUseId: "call_123", name: "get_weather" },
          },
        },
      };
      const chunk2 = {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"loc":"NYC"}' } },
        },
      };

      adapter.processChunk(chunk1 as any);
      adapter.processChunk(chunk2 as any);

      const events = adapter.getRawToolCallEvents();

      // Binary AWS Event Stream format
      expect(events).toHaveLength(2);
      expect(events[0]).toBeInstanceOf(Uint8Array);
      expect(events[1]).toBeInstanceOf(Uint8Array);

      // Decode and verify content
      const decoded1 = decodeEventStreamMessage(events[0]);
      expect(decoded1.eventType).toBe("contentBlockStart");
      expect(decoded1.body).toEqual(chunk1.contentBlockStart);

      const decoded2 = decodeEventStreamMessage(events[1]);
      expect(decoded2.eventType).toBe("contentBlockDelta");
      expect(decoded2.body).toEqual(chunk2.contentBlockDelta);
    });

    test("includes messageStop and metadata events after tool call events", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      // Simulate a stream with tool use: text → tool → messageStop → metadata
      // Text block (streamed immediately)
      adapter.processChunk({
        contentBlockStart: { contentBlockIndex: 0, start: { text: "" } },
      } as any);
      adapter.processChunk({
        contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Let me help." } },
      } as any);
      adapter.processChunk({ contentBlockStop: { contentBlockIndex: 0 } } as any);

      // Tool use block (buffered for policy evaluation)
      adapter.processChunk({
        contentBlockStart: {
          contentBlockIndex: 1,
          start: { toolUse: { toolUseId: "call_123", name: "get_weather" } },
        },
      } as any);
      adapter.processChunk({
        contentBlockDelta: {
          contentBlockIndex: 1,
          delta: { toolUse: { input: '{"location":"NYC"}' } },
        },
      } as any);
      adapter.processChunk({ contentBlockStop: { contentBlockIndex: 1 } } as any);

      // messageStop and metadata (buffered when tool calls present)
      const stopResult = adapter.processChunk({
        messageStop: { stopReason: "tool_use" },
      } as any);
      expect(stopResult.sseData).toBeNull(); // Buffered, not streamed
      expect(stopResult.isToolCallChunk).toBe(true);

      const metadataResult = adapter.processChunk({
        metadata: { usage: { inputTokens: 100, outputTokens: 50 } },
      } as any);
      expect(metadataResult.sseData).toBeNull(); // Buffered, not streamed
      expect(metadataResult.isToolCallChunk).toBe(true);
      expect(metadataResult.isFinal).toBe(true);

      // getRawToolCallEvents should return all buffered events in correct order:
      // tool contentBlockStart → tool contentBlockDelta → tool contentBlockStop → messageStop → metadata
      const events = adapter.getRawToolCallEvents();
      expect(events).toHaveLength(5); // 3 tool events + messageStop + metadata

      // Verify order: tool blocks first
      const decoded0 = decodeEventStreamMessage(events[0]);
      expect(decoded0.eventType).toBe("contentBlockStart");

      const decoded1 = decodeEventStreamMessage(events[1]);
      expect(decoded1.eventType).toBe("contentBlockDelta");

      const decoded2 = decodeEventStreamMessage(events[2]);
      expect(decoded2.eventType).toBe("contentBlockStop");

      // Then messageStop
      const decoded3 = decodeEventStreamMessage(events[3]);
      expect(decoded3.eventType).toBe("messageStop");
      expect(decoded3.body).toEqual({ stopReason: "tool_use" });

      // Finally metadata
      const decoded4 = decodeEventStreamMessage(events[4]);
      expect(decoded4.eventType).toBe("metadata");
    });
  });

  describe("formatEndSSE", () => {
    test("returns empty string since events pass through processChunk", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();
      expect(adapter.formatEndSSE()).toBe("");
    });
  });

  describe("processChunk streams messageStop and metadata when no tool calls", () => {
    test("outputs messageStop and metadata as binary AWS Event Stream", () => {
      const adapter = bedrockAdapterFactory.createStreamAdapter();

      const messageStopChunk = { messageStop: { stopReason: "end_turn" } };
      const metadataChunk = {
        metadata: {
          usage: { inputTokens: 100, outputTokens: 50 },
          metrics: { latencyMs: 590 },
        },
      };

      const stopResult = adapter.processChunk(messageStopChunk as any);
      expect(stopResult.sseData).toBeInstanceOf(Uint8Array);
      expect(stopResult.isFinal).toBe(false); // metadata comes after

      const metadataResult = adapter.processChunk(metadataChunk as any);
      expect(metadataResult.sseData).toBeInstanceOf(Uint8Array);
      expect(metadataResult.isFinal).toBe(true); // metadata is final
    });
  });
});

describe("bedrockAdapterFactory", () => {
  describe("extractApiKey", () => {
    test("extracts credentials from custom headers", () => {
      const headers = {
        "x-amz-access-key-id": "AKIAIOSFODNN7EXAMPLE",
        "x-amz-secret-access-key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "x-amz-region": "us-west-2",
      };

      const apiKey = bedrockAdapterFactory.extractApiKey(headers);

      expect(apiKey).toBe(
        "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY::us-west-2",
      );
    });

    test("includes session token when provided", () => {
      const headers = {
        "x-amz-access-key-id": "AKID",
        "x-amz-secret-access-key": "SECRET",
        "x-amz-session-token": "SESSION_TOKEN",
        "x-amz-region": "eu-west-1",
      };

      const apiKey = bedrockAdapterFactory.extractApiKey(headers);

      expect(apiKey).toBe("AKID:SECRET:SESSION_TOKEN:eu-west-1");
    });

    test("returns undefined when credentials missing", () => {
      const headers = {};
      const apiKey = bedrockAdapterFactory.extractApiKey(headers);

      expect(apiKey).toBeUndefined();
    });

    test("falls back to AWS4 authorization header", () => {
      const headers = {
        authorization: "AWS4-HMAC-SHA256 Credential=...",
      };

      const apiKey = bedrockAdapterFactory.extractApiKey(headers);

      expect(apiKey).toBe("AWS4-HMAC-SHA256 Credential=...");
    });
  });
});

describe("bedrockAdapterFactory.execute", () => {
  test("sends request and returns formatted response", async () => {
    const client = createMockBedrockClient({
      converseResponse: {
        $metadata: { requestId: "req-123" },
        output: {
          message: {
            role: "assistant",
            content: [{ text: "Hello from Bedrock!" }],
          },
        },
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
      },
    });

    const request = createMockRequest([
      { role: "user", content: [{ text: "Hi" }] },
    ]);

    const response = await bedrockAdapterFactory.execute(client, request);

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(response).toEqual(
      expect.objectContaining({
        $metadata: { requestId: "req-123" },
        output: {
          message: {
            role: "assistant",
            content: [{ text: "Hello from Bedrock!" }],
          },
        },
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
      }),
    );
  });
});

describe("bedrockAdapterFactory.executeStream", () => {
  // Skip: executeStream uses direct HTTP with SigV4 signing, not client.send()
  // This mock test doesn't match the actual implementation.
  //
  // The actual implementation:
  // 1. Makes HTTP request to Bedrock with SigV4 signing
  // 2. Parses binary AWS Event Stream format
  // 3. Handles exception messages (`:message-type: exception`) by throwing errors
  // 4. Maps event types: messageStart, contentBlockStart, contentBlockDelta,
  //    contentBlockStop, messageStop, metadata
  // 5. Attaches raw bytes (__rawBytes) for passthrough to clients
  test.skip("returns async iterable that yields stream events", async () => {
    const client = createMockBedrockClient({
      streamEvents: [
        { messageStart: { role: "assistant" } },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { text: "Hello " },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { text: "world!" },
          },
        },
        { messageStop: { stopReason: "end_turn" } },
      ],
    });

    const request = createMockRequest([
      { role: "user", content: [{ text: "Hi" }] },
    ]);

    const stream = await bedrockAdapterFactory.executeStream(client, request);
    const events: unknown[] = [];

    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ messageStart: { role: "assistant" } }),
      expect.objectContaining({ contentBlockDelta: expect.anything() }),
      expect.objectContaining({ contentBlockDelta: expect.anything() }),
      expect.objectContaining({ messageStop: { stopReason: "end_turn" } }),
    ]);
  });
});

// =============================================================================
// getCommandInput TESTS
// =============================================================================

describe("getCommandInput", () => {
  test("replaces hyphens with underscores in tool names for Nova compatibility", () => {
    const request: Bedrock.Types.ConverseRequest = {
      modelId: "us.amazon.nova-pro-v1:0",
      messages: [{ role: "user", content: [{ text: "Hi" }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "github-copilot__remote-mcp__issue_read",
              description: "Read GitHub issues",
              inputSchema: { json: { type: "object" } },
            },
          },
        ],
      },
    };

    const result = getCommandInput(request);

    expect(result.toolConfig?.tools?.[0]?.toolSpec?.name).toBe(
      "github_copilot__remote_mcp__issue_read",
    );
  });

  test("preserves tool names without hyphens", () => {
    const request: Bedrock.Types.ConverseRequest = {
      modelId: "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [{ text: "Hi" }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "get_weather",
              description: "Get weather",
              inputSchema: { json: {} },
            },
          },
        ],
      },
    };

    const result = getCommandInput(request);

    expect(result.toolConfig?.tools?.[0]?.toolSpec?.name).toBe("get_weather");
  });

  test("handles multiple tools with hyphens", () => {
    const request: Bedrock.Types.ConverseRequest = {
      modelId: "us.amazon.nova-pro-v1:0",
      messages: [{ role: "user", content: [{ text: "Hi" }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "tool-one",
              description: "Tool 1",
              inputSchema: { json: {} },
            },
          },
          {
            toolSpec: {
              name: "tool-two",
              description: "Tool 2",
              inputSchema: { json: {} },
            },
          },
        ],
      },
    };

    const result = getCommandInput(request);

    expect(result.toolConfig?.tools?.[0]?.toolSpec?.name).toBe("tool_one");
    expect(result.toolConfig?.tools?.[1]?.toolSpec?.name).toBe("tool_two");
  });
});

describe("BedrockStreamAdapter tool name mapping", () => {
  test("decodes tool names in streaming responses using name mapping", () => {
    const request: Bedrock.Types.ConverseRequest = {
      modelId: "us.amazon.nova-pro-v1:0",
      messages: [{ role: "user", content: [{ text: "Hi" }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "github-copilot__issue-read",
              description: "Read issues",
              inputSchema: { json: {} },
            },
          },
        ],
      },
    };

    const streamAdapter = bedrockAdapterFactory.createStreamAdapter(request);

    // Simulate a tool use chunk with encoded name
    const chunk = {
      contentBlockStart: {
        contentBlockIndex: 0,
        start: {
          toolUse: {
            toolUseId: "tool-123",
            name: "github_copilot__issue_read", // Encoded name from Bedrock
          },
        },
      },
    };

    streamAdapter.processChunk(chunk);

    // The tool call should have the original name with hyphens
    expect(streamAdapter.state.toolCalls[0].name).toBe(
      "github-copilot__issue-read",
    );
  });
});
