import { describe, expect, test } from "@/test";
import type { Bedrock } from "@/types";
import { bedrockAdapterFactory } from "./bedrock";

function createMockResponse(
  message: Bedrock.Types.ChatCompletionsResponse["choices"][0]["message"],
  usage?: Partial<Bedrock.Types.Usage>,
): Bedrock.Types.ChatCompletionsResponse {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    choices: [
      {
        index: 0,
        message: {
          refusal: null,
          ...message,
          content: message.content ?? null,
        },
        logprobs: null,
        finish_reason: message.tool_calls ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: usage?.prompt_tokens ?? 100,
      completion_tokens: usage?.completion_tokens ?? 50,
      total_tokens:
        (usage?.prompt_tokens ?? 100) + (usage?.completion_tokens ?? 50),
    },
  };
}

function createMockRequest(
  messages: Bedrock.Types.ChatCompletionsRequest["messages"],
  options?: Partial<Bedrock.Types.ChatCompletionsRequest>,
): Bedrock.Types.ChatCompletionsRequest {
  return {
    model: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    messages,
    ...options,
  };
}

describe("BedrockResponseAdapter", () => {
  describe("getToolCalls", () => {
    test("converts function tool calls to common format", () => {
      const response = createMockResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "test_tool",
              arguments: '{"param1": "value1", "param2": 42}',
            },
          },
        ],
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const result = adapter.getToolCalls();

      expect(result).toEqual([
        {
          id: "call_123",
          name: "test_tool",
          arguments: { param1: "value1", param2: 42 },
        },
      ]);
    });

    test("converts custom tool calls to common format", () => {
      const response = createMockResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_456",
            type: "custom",
            custom: {
              name: "custom_tool",
              input: '{"data": "test"}',
            },
          },
        ],
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const result = adapter.getToolCalls();

      expect(result).toEqual([
        {
          id: "call_456",
          name: "custom_tool",
          arguments: { data: "test" },
        },
      ]);
    });

    test("handles invalid JSON in arguments gracefully", () => {
      const response = createMockResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_789",
            type: "function",
            function: {
              name: "broken_tool",
              arguments: "invalid json{",
            },
          },
        ],
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const result = adapter.getToolCalls();

      expect(result).toEqual([
        {
          id: "call_789",
          name: "broken_tool",
          arguments: {},
        },
      ]);
    });

    test("handles multiple tool calls", () => {
      const response = createMockResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "tool_one",
              arguments: '{"param": "value1"}',
            },
          },
          {
            id: "call_2",
            type: "function",
            function: {
              name: "tool_two",
              arguments: '{"param": "value2"}',
            },
          },
        ],
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const result = adapter.getToolCalls();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "call_1",
        name: "tool_one",
        arguments: { param: "value1" },
      });
      expect(result[1]).toEqual({
        id: "call_2",
        name: "tool_two",
        arguments: { param: "value2" },
      });
    });

    test("handles empty arguments", () => {
      const response = createMockResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_empty",
            type: "function",
            function: {
              name: "empty_tool",
              arguments: "{}",
            },
          },
        ],
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const result = adapter.getToolCalls();

      expect(result).toEqual([
        {
          id: "call_empty",
          name: "empty_tool",
          arguments: {},
        },
      ]);
    });
  });

  describe("getText", () => {
    test("extracts text content from response", () => {
      const response = createMockResponse({
        role: "assistant",
        content: "Hello, world!",
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getText()).toBe("Hello, world!");
    });

    test("returns empty string when content is null", () => {
      const response = createMockResponse({
        role: "assistant",
        content: null,
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      expect(adapter.getText()).toBe("");
    });
  });

  describe("getUsage", () => {
    test("extracts usage tokens from response", () => {
      const response = createMockResponse(
        { role: "assistant", content: "Test" },
        { prompt_tokens: 150, completion_tokens: 75 },
      );

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const usage = adapter.getUsage();

      expect(usage).toEqual({
        inputTokens: 150,
        outputTokens: 75,
      });
    });
  });

  describe("toRefusalResponse", () => {
    test("creates refusal response with provided message", () => {
      const response = createMockResponse({
        role: "assistant",
        content: "Original content",
      });

      const adapter = bedrockAdapterFactory.createResponseAdapter(response);
      const refusal = adapter.toRefusalResponse(
        "Full refusal",
        "Tool call blocked by policy",
      );

      expect(refusal.choices[0].message.content).toBe(
        "Tool call blocked by policy",
      );
      expect(refusal.choices[0].finish_reason).toBe("stop");
    });
  });
});

describe("BedrockRequestAdapter", () => {
  describe("getModel", () => {
    test("returns original model by default", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }], {
        model: "us.anthropic.claude-3-haiku-20240307-v1:0",
      });

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      expect(adapter.getModel()).toBe(
        "us.anthropic.claude-3-haiku-20240307-v1:0",
      );
    });

    test("returns modified model after setModel", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }], {
        model: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      });

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      adapter.setModel("us.anthropic.claude-3-haiku-20240307-v1:0");
      expect(adapter.getModel()).toBe(
        "us.anthropic.claude-3-haiku-20240307-v1:0",
      );
    });
  });

  describe("isStreaming", () => {
    test("returns true when stream is true", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }], {
        stream: true,
      });

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      expect(adapter.isStreaming()).toBe(true);
    });

    test("returns false when stream is false", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }], {
        stream: false,
      });

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      expect(adapter.isStreaming()).toBe(false);
    });

    test("returns false when stream is undefined", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      expect(adapter.isStreaming()).toBe(false);
    });
  });

  describe("getTools", () => {
    test("extracts function tools from request", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }], {
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string" },
                },
              },
            },
          },
        ],
      });

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const tools = adapter.getTools();

      expect(tools).toEqual([
        {
          name: "get_weather",
          description: "Get weather for a location",
          inputSchema: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
          },
        },
      ]);
    });

    test("returns empty array when no tools", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      expect(adapter.getTools()).toEqual([]);
    });
  });

  describe("getMessages", () => {
    test("converts tool messages to common format", () => {
      const request = createMockRequest([
        { role: "user", content: "Get the weather" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location": "NYC"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"temperature": 72, "unit": "fahrenheit"}',
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      const messages = adapter.getMessages();

      expect(messages).toHaveLength(3);
      expect(messages[2].toolCalls).toEqual([
        {
          id: "call_123",
          name: "get_weather",
          content: { temperature: 72, unit: "fahrenheit" },
          isError: false,
        },
      ]);
    });
  });

  describe("toProviderRequest", () => {
    test("applies model change to request", () => {
      const request = createMockRequest([{ role: "user", content: "Hello" }], {
        model: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      });

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      adapter.setModel("us.anthropic.claude-3-haiku-20240307-v1:0");
      const result = adapter.toProviderRequest();

      expect(result.model).toBe("us.anthropic.claude-3-haiku-20240307-v1:0");
    });

    test("applies tool result updates to request", () => {
      const request = createMockRequest([
        { role: "user", content: "Get the weather" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location": "NYC"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"temperature": 72}',
        },
      ]);

      const adapter = bedrockAdapterFactory.createRequestAdapter(request);
      adapter.updateToolResult(
        "call_123",
        '{"temperature": 75, "note": "updated"}',
      );
      const result = adapter.toProviderRequest();

      const toolMessage = result.messages.find((m) => m.role === "tool");
      expect(toolMessage?.content).toBe(
        '{"temperature": 75, "note": "updated"}',
      );
    });
  });
});

describe("bedrockAdapterFactory", () => {
  describe("extractApiKey", () => {
    test("returns authorization header as-is (Bearer token)", () => {
      const headers = { authorization: "Bearer bedrock-key-123" };
      const apiKey = bedrockAdapterFactory.extractApiKey(headers);
      expect(apiKey).toBe("Bearer bedrock-key-123");
    });

    test("returns authorization header as-is (non-Bearer)", () => {
      const headers = { authorization: "bedrock-key-123" };
      const apiKey = bedrockAdapterFactory.extractApiKey(headers);
      expect(apiKey).toBe("bedrock-key-123");
    });

    test("returns undefined when no authorization header", () => {
      const headers = {} as unknown as Bedrock.Types.ChatCompletionsHeaders;
      const apiKey = bedrockAdapterFactory.extractApiKey(headers);
      expect(apiKey).toBeUndefined();
    });
  });

  describe("provider info", () => {
    test("has correct provider name", () => {
      expect(bedrockAdapterFactory.provider).toBe("bedrock");
    });

    test("has correct interaction type", () => {
      expect(bedrockAdapterFactory.interactionType).toBe(
        "bedrock:chatCompletions",
      );
    });
  });
});
