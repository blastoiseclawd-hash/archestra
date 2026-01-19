"use client";

import { Bot, Check, ChevronDown, Pencil } from "lucide-react";
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
import { useCreateConversation } from "@/lib/chat.query";
import { usePrompts } from "@/lib/prompts.query";
import { cn } from "@/lib/utils";

interface CombinedSelectorProps {
  /** Current prompt ID (agent) - null means no agent selected */
  currentPromptId: string | null;
  /** Current model (for creating new conversations) */
  currentModel?: string;
  /** If provided, this is an existing conversation */
  conversationId?: string;
  /** Callback for prompt change (initial chat mode) */
  onPromptChange?: (promptId: string | null, agentId: string | null) => void;
  /** Callback to open edit agent dialog (when agent is selected) */
  onEditAgent?: (promptId: string) => void;
}

export function CombinedSelector({
  currentPromptId,
  currentModel = "",
  conversationId,
  onPromptChange,
  onEditAgent,
}: CombinedSelectorProps) {
  const router = useRouter();
  const { data: prompts = [] } = usePrompts();
  const createConversationMutation = useCreateConversation();
  const [open, setOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<{
    id: string | null;
    name: string;
    agentId: string | null;
  } | null>(null);

  const currentPrompt = useMemo(
    () => prompts.find((p) => p.id === currentPromptId),
    [prompts, currentPromptId],
  );

  // Display text for the button
  const displayText = currentPrompt?.name || "Select Agent...";

  const handleAgentSelect = (
    promptId: string | null,
    promptName: string,
    agentId: string | null,
  ) => {
    if (promptId === currentPromptId) {
      setOpen(false);
      return;
    }

    if (conversationId) {
      // For existing conversation, show confirmation dialog
      setPendingPrompt({ id: promptId, name: promptName, agentId });
      setOpen(false);
    } else if (onPromptChange) {
      // For initial chat, just update directly
      onPromptChange(promptId, agentId);
      setOpen(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingPrompt) return;

    // Create a new conversation with the selected agent
    const newConversation = await createConversationMutation.mutateAsync({
      agentId: pendingPrompt.agentId ?? "",
      promptId: pendingPrompt.id ?? undefined,
      selectedModel: currentModel,
    });

    if (newConversation) {
      router.push(`/chat?conversation=${newConversation.id}`);
    }

    setPendingPrompt(null);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              role="combobox"
              aria-expanded={open}
              className="h-8 justify-between gap-2 px-3"
            >
              <Bot className="h-4 w-4 shrink-0 opacity-70" />
              <span className="text-sm font-medium">{displayText}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[250px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search agents..." className="h-9" />
              <CommandList>
                <CommandEmpty>No agents found.</CommandEmpty>

                {prompts.length > 0 && (
                  <CommandGroup heading="Agents">
                    {prompts.map((prompt) => (
                      <CommandItem
                        key={prompt.id}
                        value={`agent-${prompt.name}`}
                        onSelect={() =>
                          handleAgentSelect(
                            prompt.id,
                            prompt.name,
                            prompt.agentId,
                          )
                        }
                        className="flex items-center gap-2"
                      >
                        <Bot className="h-3.5 w-3.5 opacity-70" />
                        <span className="flex-1">{prompt.name}</span>
                        <Check
                          className={cn(
                            "h-4 w-4",
                            currentPromptId === prompt.id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Edit agent button */}
        {currentPromptId && onEditAgent && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onEditAgent(currentPromptId)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>

      <AlertDialog
        open={!!pendingPrompt}
        onOpenChange={(open) => !open && setPendingPrompt(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start new conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will start a new conversation with{" "}
              <span className="font-medium">{pendingPrompt?.name}</span>. Your
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
