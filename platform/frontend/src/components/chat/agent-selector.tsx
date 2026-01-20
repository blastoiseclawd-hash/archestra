"use client";

import { Bot, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useInternalAgents } from "@/lib/agent.query";
import { useCreateConversation } from "@/lib/chat.query";
import { cn } from "@/lib/utils";

interface AgentSelectorProps {
  currentPromptId: string | null;
  currentAgentId: string;
  currentModel: string;
}

export function AgentSelector({
  currentPromptId,
  currentAgentId,
  currentModel,
}: AgentSelectorProps) {
  const router = useRouter();
  const { data: agents = [] } = useInternalAgents();
  const createConversationMutation = useCreateConversation();
  const [open, setOpen] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<{
    id: string | null;
    name: string;
  } | null>(null);

  const currentAgent = useMemo(
    () => agents.find((a) => a.id === currentPromptId),
    [agents, currentPromptId],
  );

  const handleAgentSelect = (newAgentId: string | null, agentName: string) => {
    if (newAgentId === currentPromptId) {
      setOpen(false);
      return;
    }

    // Show confirmation dialog
    setPendingAgent({ id: newAgentId, name: agentName });
    setOpen(false);
  };

  const handleConfirm = async () => {
    if (!pendingAgent) return;

    // Create a new conversation with the selected agent
    // For internal agents, the agent ID is both the "prompt ID" and agent ID
    const newConversation = await createConversationMutation.mutateAsync({
      agentId: pendingAgent.id ?? currentAgentId,
      promptId: pendingAgent.id ?? undefined,
      selectedModel: currentModel,
    });

    if (newConversation) {
      router.push(`/chat?conversation=${newConversation.id}`);
    }

    setPendingAgent(null);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 justify-between"
          >
            <Bot className="h-3 w-3 shrink-0 opacity-70" />
            <span className="text-xs font-medium">
              {currentAgent?.name || "No agent selected"}
            </span>
            {open ? (
              <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
            ) : (
              <ChevronRight className="ml-1 h-3 w-3 shrink-0 opacity-50" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search agent..." className="h-9" />
            <CommandList>
              <CommandEmpty>No agent found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="no-agent-selected"
                  onSelect={() => handleAgentSelect(null, "No agent selected")}
                >
                  No agent selected
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      currentPromptId === null ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
                {agents.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={agent.name}
                    onSelect={() => handleAgentSelect(agent.id, agent.name)}
                  >
                    {agent.name}
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        currentPromptId === agent.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={!!pendingAgent}
        onOpenChange={(open) => !open && setPendingAgent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start new conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will start a new conversation with{" "}
              <span className="font-medium">{pendingAgent?.name}</span>. Your
              current conversation will be saved and available in the sidebar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={createConversationMutation.isPending}
            >
              {createConversationMutation.isPending
                ? "Creating..."
                : "Start new conversation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
