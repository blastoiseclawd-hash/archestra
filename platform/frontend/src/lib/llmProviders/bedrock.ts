import type { archestraApiTypes } from "@shared";
import type { PartialUIMessage } from "@/components/chatbot-demo";
import type { DualLlmResult, Interaction, InteractionUtils } from "./common";

type BedrockContentBlock = {
  text?: string;
  toolUse?: {
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  };
  toolResult?: {
    toolUseId: string;
    content: Array<
      | { text: string }
      | { json: Record<string, unknown> }
      | { image: unknown }
      | { document: unknown }
    >;
    status?: "success" | "error";
  };
};

class BedrockConverseInteraction implements InteractionUtils {
  private request: archestraApiTypes.BedrockConverseRequest;
  private response: archestraApiTypes.BedrockConverseResponse;
  modelName: string;

  constructor(interaction: Interaction) {
    this.request =
      interaction.request as unknown as archestraApiTypes.BedrockConverseRequest;
    this.response =
      interaction.response as unknown as archestraApiTypes.BedrockConverseResponse;
    this.modelName = interaction.model ?? this.request.modelId;
  }

  isLastMessageToolCall(): boolean {
    const messages = this.request.messages;

    if (messages.length === 0) {
      return false;
    }

    const lastMessage = messages[messages.length - 1];

    // Check if last user message contains toolResult blocks
    if (lastMessage.role === "user" && Array.isArray(lastMessage.content)) {
      return lastMessage.content.some(
        (block) => "toolResult" in block && block.toolResult !== undefined,
      );
    }

    return false;
  }

  getLastToolCallId(): string | null {
    const messages = this.request.messages;
    if (messages.length === 0) {
      return null;
    }

    // Look for the last toolResult block in user messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === "user" && Array.isArray(message.content)) {
        for (const block of message.content as BedrockContentBlock[]) {
          if (block.toolResult) {
            return block.toolResult.toolUseId;
          }
        }
      }
    }

    return null;
  }

  getToolNamesUsed(): string[] {
    const toolsUsed = new Set<string>();

    // Tools are invoked by the assistant in toolUse blocks
    for (const message of this.request.messages) {
      if (message.role === "assistant" && Array.isArray(message.content)) {
        for (const block of message.content as BedrockContentBlock[]) {
          if (block.toolUse) {
            toolsUsed.add(block.toolUse.name);
          }
        }
      }
    }

    return Array.from(toolsUsed);
  }

  getToolNamesRefused(): string[] {
    // TODO: Implement tool refusal detection for Bedrock if needed
    return [];
  }

  getToolNamesRequested(): string[] {
    const toolsRequested = new Set<string>();

    // Check the response for toolUse blocks (tools that LLM wants to execute)
    const content = this.response.output?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as BedrockContentBlock[]) {
        if (block.toolUse) {
          toolsRequested.add(block.toolUse.name);
        }
      }
    }

    return Array.from(toolsRequested);
  }

  getToolRefusedCount(): number {
    return 0;
  }

  getLastUserMessage(): string {
    const reversedMessages = [...this.request.messages].reverse();
    for (const message of reversedMessages) {
      if (message.role !== "user") {
        continue;
      }

      if (Array.isArray(message.content)) {
        // Find the first text block that's not a toolResult
        for (const block of message.content as BedrockContentBlock[]) {
          if (block.text) {
            return block.text;
          }
        }
      }
    }
    return "";
  }

  getLastAssistantResponse(): string {
    const content = this.response.output?.message?.content;

    if (!Array.isArray(content)) {
      return "";
    }

    // Find the first text block in the response
    for (const block of content as BedrockContentBlock[]) {
      if (block.text) {
        return block.text;
      }
    }

    return "";
  }

  private mapToUiMessage(
    message:
      | archestraApiTypes.BedrockConverseRequest["messages"][number]
      | {
          role: "assistant";
          content: NonNullable<
            archestraApiTypes.BedrockConverseResponse["output"]["message"]
          >["content"];
        },
    _dualLlmResults?: DualLlmResult[],
  ): PartialUIMessage {
    const parts: PartialUIMessage["parts"] = [];
    const { content, role } = message;

    if (!Array.isArray(content)) {
      return { role: role as PartialUIMessage["role"], parts };
    }

    // Process content blocks
    for (const block of content as BedrockContentBlock[]) {
      if (block.text) {
        parts.push({ type: "text", text: block.text });
      } else if (block.toolUse) {
        // Tool invocation by assistant
        parts.push({
          type: "dynamic-tool",
          toolName: block.toolUse.name,
          toolCallId: block.toolUse.toolUseId,
          state: "input-available",
          input: block.toolUse.input,
        });
      }
      // Note: toolResult blocks are handled in mapToUiMessages() where they're merged
      // with their corresponding toolUse blocks, so we skip them here
    }

    return {
      role: role as PartialUIMessage["role"],
      parts,
    };
  }

  mapToUiMessages(dualLlmResults?: DualLlmResult[]): PartialUIMessage[] {
    const uiMessages: PartialUIMessage[] = [];
    const messages = this.request.messages;

    // Track which user messages contain only toolResult blocks (to skip them later)
    const userMessagesWithToolResults = new Set<number>();

    // First pass: identify user messages that only contain toolResult blocks
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const hasOnlyToolResults = (msg.content as BedrockContentBlock[]).every(
          (block) => "toolResult" in block && block.toolResult,
        );
        if (hasOnlyToolResults && msg.content.length > 0) {
          userMessagesWithToolResults.add(i);
        }
      }
    }

    // Map request messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Skip user messages that only contain tool results - they'll be merged with assistant
      if (userMessagesWithToolResults.has(i)) {
        continue;
      }

      const uiMessage = this.mapToUiMessage(msg, dualLlmResults);

      // If this is an assistant message with toolUse blocks, look ahead for tool results
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const hasToolUse = (msg.content as BedrockContentBlock[]).some(
          (block) => "toolUse" in block && block.toolUse,
        );

        if (hasToolUse) {
          const toolCallParts: PartialUIMessage["parts"] = [...uiMessage.parts];

          // For each toolUse block, find its corresponding toolResult
          for (const block of msg.content as BedrockContentBlock[]) {
            if (block.toolUse) {
              const toolUseId = block.toolUse.toolUseId;

              // Look for the tool result in the next user message
              const toolResultMsg = messages
                .slice(i + 1)
                .find(
                  (m) =>
                    m.role === "user" &&
                    Array.isArray(m.content) &&
                    (m.content as BedrockContentBlock[]).some(
                      (b) => b.toolResult?.toolUseId === toolUseId,
                    ),
                );

              if (toolResultMsg && Array.isArray(toolResultMsg.content)) {
                // Find the specific toolResult block
                const toolResultBlock = (
                  toolResultMsg.content as BedrockContentBlock[]
                ).find((b) => b.toolResult?.toolUseId === toolUseId);

                if (toolResultBlock?.toolResult) {
                  // Parse the tool result
                  let output: unknown;
                  const resultContent = toolResultBlock.toolResult.content;
                  if (resultContent && resultContent.length > 0) {
                    const firstContent = resultContent[0];
                    if ("text" in firstContent && firstContent.text) {
                      try {
                        output = JSON.parse(firstContent.text);
                      } catch {
                        output = firstContent.text;
                      }
                    } else if ("json" in firstContent) {
                      output = firstContent.json;
                    } else {
                      output = firstContent;
                    }
                  }

                  // Add tool result part
                  toolCallParts.push({
                    type: "dynamic-tool",
                    toolName: "tool-result",
                    toolCallId: toolUseId,
                    state: "output-available",
                    input: {},
                    output,
                  });

                  // Check for dual LLM result
                  const dualLlmResultForTool = dualLlmResults?.find(
                    (result) => result.toolCallId === toolUseId,
                  );

                  if (dualLlmResultForTool) {
                    toolCallParts.push({
                      type: "dual-llm-analysis",
                      toolCallId: dualLlmResultForTool.toolCallId,
                      safeResult: dualLlmResultForTool.result,
                      conversations: Array.isArray(
                        dualLlmResultForTool.conversations,
                      )
                        ? (dualLlmResultForTool.conversations as Array<{
                            role: "user" | "assistant";
                            content: string | unknown;
                          }>)
                        : [],
                    });
                  }
                }
              }
            }
          }

          uiMessages.push({
            ...uiMessage,
            parts: toolCallParts,
          });
        } else {
          uiMessages.push(uiMessage);
        }
      } else {
        uiMessages.push(uiMessage);
      }
    }

    // Map response
    if (this.response.output?.message) {
      uiMessages.push(
        this.mapToUiMessage(
          {
            role: "assistant",
            content: this.response.output.message.content,
          },
          dualLlmResults,
        ),
      );
    }

    return uiMessages;
  }
}

export default BedrockConverseInteraction;
