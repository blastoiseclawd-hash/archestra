"use client";

import { Bot, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  useChatProfileMcpTools,
  useConversationEnabledTools,
  usePromptTools,
  useUpdateConversationEnabledTools,
} from "@/lib/chat.query";
import {
  addPendingAction,
  applyPendingActions,
  getPendingActions,
  type PendingToolAction,
} from "@/lib/pending-tool-state";
import { usePrompts } from "@/lib/prompts.query";
import { cn } from "@/lib/utils";

// Component to display tools for a specific agent
function AgentToolsList({ agentId }: { agentId: string }) {
  const { data: tools = [], isLoading } = useChatProfileMcpTools(agentId);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading tools...</p>;
  }

  if (tools.length === 0) {
    return <p className="text-xs text-muted-foreground">No tools available</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Available tools ({tools.length}):
      </p>
      <div className="flex flex-wrap gap-1 max-h-[200px] overflow-y-auto">
        {tools.map((tool) => (
          <span
            key={tool.name}
            className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded"
          >
            <Wrench className="h-3 w-3 opacity-70" />
            {tool.name}
          </span>
        ))}
      </div>
    </div>
  );
}

interface AgentToolsDisplayProps {
  agentId: string;
  promptId: string | null;
  conversationId?: string;
}

/**
 * Display agent delegation tools with ability to toggle them.
 * When no conversation exists, pending actions are stored in localStorage
 * and applied when the conversation is created via first message.
 */
export function AgentToolsDisplay({
  agentId,
  promptId,
  conversationId,
}: AgentToolsDisplayProps) {
  // Always fetch prompt tools - they exist regardless of conversation
  const { data: promptTools = [], isLoading } = usePromptTools(
    promptId ?? undefined,
  );

  const { data: allPrompts = [] } = usePrompts();

  // Local pending actions for display (synced with localStorage)
  const [localPendingActions, setLocalPendingActions] = useState<
    PendingToolAction[]
  >([]);

  // Load pending actions from localStorage on mount and when context changes
  useEffect(() => {
    if (!conversationId) {
      const actions = getPendingActions(agentId, promptId);
      setLocalPendingActions(actions);
    } else {
      setLocalPendingActions([]);
    }
  }, [agentId, promptId, conversationId]);

  // Fetch enabled tools for the conversation
  const { data: enabledToolsData } =
    useConversationEnabledTools(conversationId);

  // Mutation for updating enabled tools
  const updateEnabledTools = useUpdateConversationEnabledTools();

  // Derived values
  const enabledToolIds = enabledToolsData?.enabledToolIds ?? [];
  const hasCustomSelection = enabledToolsData?.hasCustomSelection ?? false;

  // Map promptTools to their display names and matching agent IDs
  const agentToolsWithNames = useMemo(() => {
    return promptTools.map((tool) => {
      const promptName = tool.name.replace(/^agent__/, "");
      const matchingPrompt = allPrompts.find(
        (p) => p.name.toLowerCase().replace(/\s+/g, "_") === promptName,
      );
      return {
        ...tool,
        displayName: matchingPrompt?.name ?? promptName.replace(/_/g, " "),
        matchingAgentId: matchingPrompt?.agentId,
      };
    });
  }, [promptTools, allPrompts]);

  // Default: all agent tools are enabled (matches backend behavior)
  const defaultEnabledAgentToolIds = useMemo(
    () => promptTools.map((t) => t.id),
    [promptTools],
  );

  // Compute current enabled tool IDs:
  // - If conversation exists with custom selection, use it
  // - If no conversation, apply pending actions to defaults
  const currentEnabledToolIds = useMemo(() => {
    if (conversationId && hasCustomSelection) {
      return enabledToolIds;
    }

    // Start with defaults (all agent tools enabled)
    const baseIds = defaultEnabledAgentToolIds;

    // If no conversation, apply pending actions for display
    if (!conversationId && localPendingActions.length > 0) {
      return applyPendingActions(baseIds, localPendingActions);
    }

    return baseIds;
  }, [
    conversationId,
    hasCustomSelection,
    enabledToolIds,
    defaultEnabledAgentToolIds,
    localPendingActions,
  ]);

  // Check if a tool is enabled
  const isToolEnabled = (toolId: string) => {
    return currentEnabledToolIds.includes(toolId);
  };

  // Handle toggle - works for both initial and conversation states
  const handleToggle = (toolId: string) => {
    const isCurrentlyEnabled = isToolEnabled(toolId);

    if (!conversationId) {
      // No conversation yet - store in localStorage
      const action: PendingToolAction = isCurrentlyEnabled
        ? { type: "disable", toolId }
        : { type: "enable", toolId };
      addPendingAction(action, agentId, promptId);
      setLocalPendingActions((prev) => [...prev, action]);
      return;
    }

    // Has conversation - update directly
    let newEnabledToolIds: string[];
    if (isCurrentlyEnabled) {
      newEnabledToolIds = enabledToolIds.filter((id) => id !== toolId);
    } else {
      newEnabledToolIds = [...enabledToolIds, toolId];
    }

    updateEnabledTools.mutate({
      conversationId,
      toolIds: newEnabledToolIds,
    });
  };

  if (isLoading || agentToolsWithNames.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {agentToolsWithNames.map((tool) => {
        const isEnabled = isToolEnabled(tool.id);

        return (
          <HoverCard key={tool.id} openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 px-2 gap-1.5 text-xs",
                  !isEnabled && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    isEnabled ? "bg-green-500" : "bg-red-500",
                  )}
                />
                <Bot className="h-3 w-3" />
                <span>{tool.displayName}</span>
              </Button>
            </HoverCardTrigger>
            <HoverCardContent
              className="w-80 cursor-pointer"
              align="start"
              onClick={() => handleToggle(tool.id)}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{tool.displayName}</h4>
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded",
                      isEnabled
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700",
                    )}
                  >
                    {isEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click to {isEnabled ? "disable" : "enable"} this agent
                </p>
                {tool.matchingAgentId && (
                  <AgentToolsList agentId={tool.matchingAgentId} />
                )}
              </div>
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
}
