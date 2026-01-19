"use client";

import type { archestraApiTypes } from "@shared";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Textarea } from "@/components/ui/textarea";
import {
  usePromptAgents,
  useSyncPromptAgents,
} from "@/lib/prompt-agents.query";
import {
  usePromptAssignedTools,
  useSyncPromptTools,
} from "@/lib/prompt-tools.query";
import {
  useCreatePrompt,
  usePrompts,
  useUpdatePrompt,
} from "@/lib/prompts.query";
import { useTools } from "@/lib/tool.query";

type Prompt = archestraApiTypes.GetPromptsResponses["200"][number];

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt?: Prompt | null;
  onViewVersionHistory?: (prompt: Prompt) => void;
}

export function PromptDialog({
  open,
  onOpenChange,
  prompt,
  onViewVersionHistory,
}: PromptDialogProps) {
  const { data: allPrompts = [] } = usePrompts();
  const { data: allTools } = useTools({});
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const syncPromptAgents = useSyncPromptAgents();
  const syncPromptTools = useSyncPromptTools();
  const { data: currentAgents = [] } = usePromptAgents(prompt?.id);
  const { data: currentTools = [] } = usePromptAssignedTools(prompt?.id);

  const [name, setName] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedAgentPromptIds, setSelectedAgentPromptIds] = useState<
    string[]
  >([]);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);

  // Available prompts that can be used as agents (excluding self)
  const availableAgentPrompts = useMemo(() => {
    return allPrompts
      .filter((p) => p.id !== prompt?.id)
      .map((p) => ({
        value: p.id,
        label: p.name,
      }));
  }, [allPrompts, prompt?.id]);

  // Available tools for assignment
  const availableTools = useMemo(() => {
    return (allTools ?? []).map((t) => ({
      value: t.id,
      label: t.name,
    }));
  }, [allTools]);

  // Reset form when dialog opens/closes or prompt changes
  useEffect(() => {
    if (open) {
      // edit
      if (prompt) {
        setName(prompt.name);
        setUserPrompt(prompt.userPrompt || "");
        setSystemPrompt(prompt.systemPrompt || "");
        // Note: agents and tools are loaded separately via queries
      } else {
        // create
        setName("");
        setUserPrompt("");
        setSystemPrompt("");
        setSelectedAgentPromptIds([]);
        setSelectedToolIds([]);
      }
    } else {
      // reset form
      setName("");
      setUserPrompt("");
      setSystemPrompt("");
      setSelectedAgentPromptIds([]);
      setSelectedToolIds([]);
    }
  }, [open, prompt]);

  // Sync selectedAgentPromptIds with currentAgents when data loads
  const currentAgentIds = currentAgents.map((a) => a.agentPromptId).join(",");
  const promptId = prompt?.id;

  useEffect(() => {
    if (open && promptId && currentAgentIds) {
      setSelectedAgentPromptIds(currentAgentIds.split(",").filter(Boolean));
    }
  }, [open, promptId, currentAgentIds]);

  // Sync selectedToolIds with currentTools when data loads
  const currentToolIds = currentTools.map((t) => t.id).join(",");

  useEffect(() => {
    if (open && promptId && currentToolIds) {
      setSelectedToolIds(currentToolIds.split(",").filter(Boolean));
    }
  }, [open, promptId, currentToolIds]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedUserPrompt = userPrompt.trim();
    const trimmedSystemPrompt = systemPrompt.trim();

    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }

    try {
      let savedPromptId: string;

      if (prompt) {
        // Update existing prompt
        const updated = await updatePrompt.mutateAsync({
          id: prompt.id,
          data: {
            name: trimmedName,
            userPrompt: trimmedUserPrompt || undefined,
            systemPrompt: trimmedSystemPrompt || undefined,
          },
        });
        savedPromptId = updated?.id ?? prompt.id;
        toast.success("Agent updated successfully");
      } else {
        // Create new prompt
        const created = await createPrompt.mutateAsync({
          name: trimmedName,
          userPrompt: trimmedUserPrompt || undefined,
          systemPrompt: trimmedSystemPrompt || undefined,
        });
        savedPromptId = created?.id ?? "";
        toast.success("Agent created successfully");
      }

      // Sync agents
      if (savedPromptId) {
        if (selectedAgentPromptIds.length > 0) {
          await syncPromptAgents.mutateAsync({
            promptId: savedPromptId,
            agentPromptIds: selectedAgentPromptIds,
          });
        } else if (prompt && currentAgents.length > 0) {
          await syncPromptAgents.mutateAsync({
            promptId: savedPromptId,
            agentPromptIds: [],
          });
        }

        // Sync tools
        if (selectedToolIds.length > 0 || (prompt && currentTools.length > 0)) {
          await syncPromptTools.mutateAsync({
            promptId: savedPromptId,
            toolIds: selectedToolIds,
          });
        }
      }

      onOpenChange(false);
    } catch (_error) {
      toast.error("Failed to save Agent");
    }
  }, [
    name,
    userPrompt,
    systemPrompt,
    prompt,
    selectedAgentPromptIds,
    selectedToolIds,
    currentAgents.length,
    currentTools.length,
    updatePrompt,
    createPrompt,
    syncPromptAgents,
    syncPromptTools,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {prompt ? "Edit Agent" : "Create New Agent"}
            {prompt && onViewVersionHistory && (
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onViewVersionHistory(prompt);
                }}
                className="text-xs h-auto p-0 ml-2"
              >
                Version History
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="promptName">Name *</Label>
            <Input
              id="promptName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter agent name"
            />
          </div>
          <div className="space-y-2">
            <Label>Tools</Label>
            <p className="text-sm text-muted-foreground">
              Select tools available to this agent
            </p>
            <MultiSelect
              value={selectedToolIds}
              onValueChange={setSelectedToolIds}
              items={availableTools}
              placeholder="Select tools..."
              disabled={availableTools.length === 0}
            />
            {availableTools.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No tools available
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Delegate to Agents</Label>
            <p className="text-sm text-muted-foreground">
              Select other agents to delegate tasks
            </p>
            <MultiSelect
              value={selectedAgentPromptIds}
              onValueChange={setSelectedAgentPromptIds}
              items={availableAgentPrompts}
              placeholder="Select agents..."
              disabled={availableAgentPrompts.length === 0}
            />
            {availableAgentPrompts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No other agents available
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="systemPrompt">System Prompt</Label>
            <Textarea
              id="systemPrompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Enter system prompt (instructions for the LLM)"
              className="min-h-[150px] font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="userPrompt">User Prompt</Label>
            <Textarea
              id="userPrompt"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="Enter user prompt (shown to user, sent to LLM)"
              className="min-h-[150px] font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !name.trim() || createPrompt.isPending || updatePrompt.isPending
            }
          >
            {(createPrompt.isPending || updatePrompt.isPending) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {prompt ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
