"use client";

import type { archestraApiTypes } from "@shared";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChatToolsDisplay } from "@/components/chat/chat-tools-display";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  useCreateProfile,
  useInternalAgents,
  useUpdateProfile,
} from "@/lib/agent.query";
import {
  useAgentDelegations,
  useSyncAgentDelegations,
} from "@/lib/agent-tools.query";
import { useChatOpsStatus } from "@/lib/chatops.query";

type InternalAgent = archestraApiTypes.GetAllAgentsResponses["200"][number];

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: InternalAgent | null;
  onViewVersionHistory?: (agent: InternalAgent) => void;
}

export function PromptDialog({
  open,
  onOpenChange,
  agent,
  onViewVersionHistory,
}: PromptDialogProps) {
  const { data: allInternalAgents = [] } = useInternalAgents();
  const createAgent = useCreateProfile();
  const updateAgent = useUpdateProfile();
  const syncDelegations = useSyncAgentDelegations();
  const { data: currentDelegations = [] } = useAgentDelegations(agent?.id);

  const [name, setName] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedDelegationTargetIds, setSelectedDelegationTargetIds] =
    useState<string[]>([]);
  const [allowedChatops, setAllowedChatops] = useState<string[]>([]);

  const { data: chatopsProviders = [] } = useChatOpsStatus();

  // Available agents that can be delegated to (excluding self)
  const availableDelegationTargets = useMemo(() => {
    return allInternalAgents
      .filter((a) => a.id !== agent?.id)
      .map((a) => ({
        value: a.id,
        label: a.name,
      }));
  }, [allInternalAgents, agent?.id]);

  // Reset form when dialog opens/closes or agent changes
  useEffect(() => {
    if (open) {
      // edit
      if (agent) {
        setName(agent.name);
        setUserPrompt(agent.userPrompt || "");
        setSystemPrompt(agent.systemPrompt || "");
        // Note: delegations are loaded separately via currentDelegations query
        // Parse allowedChatops from agent (may be in different formats from API)
        const chatopsValue = agent.allowedChatops;
        if (Array.isArray(chatopsValue)) {
          setAllowedChatops(chatopsValue as string[]);
        } else {
          setAllowedChatops([]);
        }
      } else {
        // create
        setName("");
        setUserPrompt("");
        setSystemPrompt("");
        setSelectedDelegationTargetIds([]);
        setAllowedChatops([]);
      }
    } else {
      // reset form
      setName("");
      setUserPrompt("");
      setSystemPrompt("");
      setSelectedDelegationTargetIds([]);
      setAllowedChatops([]);
    }
  }, [open, agent]);

  // Sync selectedDelegationTargetIds with currentDelegations when data loads
  // currentDelegations is an array of agent objects that this agent can delegate to
  const currentDelegationIds = currentDelegations.map((a) => a.id).join(",");
  const agentId = agent?.id;

  useEffect(() => {
    if (open && agentId && currentDelegationIds) {
      setSelectedDelegationTargetIds(
        currentDelegationIds.split(",").filter(Boolean),
      );
    }
  }, [open, agentId, currentDelegationIds]);

  const handleSave = useCallback(async () => {
    // Trim values once at the start
    const trimmedName = name.trim();
    const trimmedUserPrompt = userPrompt.trim();
    const trimmedSystemPrompt = systemPrompt.trim();

    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }

    try {
      let savedAgentId: string;

      if (agent) {
        // Update increments version (ID stays the same with JSONB history)
        const updated = await updateAgent.mutateAsync({
          id: agent.id,
          data: {
            name: trimmedName,
            userPrompt: trimmedUserPrompt || undefined,
            systemPrompt: trimmedSystemPrompt || undefined,
            allowedChatops,
          },
        });
        savedAgentId = updated?.id ?? agent.id;
        toast.success("Agent updated successfully");
      } else {
        const created = await createAgent.mutateAsync({
          name: trimmedName,
          isInternal: true,
          userPrompt: trimmedUserPrompt || undefined,
          systemPrompt: trimmedSystemPrompt || undefined,
          allowedChatops,
          teams: [], // Internal agents don't need team assignment
        });
        savedAgentId = created?.id ?? "";
        toast.success("Agent created successfully");
      }

      // Sync delegations if any were selected and we have a valid agentId
      if (savedAgentId && selectedDelegationTargetIds.length > 0) {
        await syncDelegations.mutateAsync({
          agentId: savedAgentId,
          targetAgentIds: selectedDelegationTargetIds,
        });
      } else if (savedAgentId && agent && currentDelegations.length > 0) {
        // Clear delegations if none selected but there were some before
        await syncDelegations.mutateAsync({
          agentId: savedAgentId,
          targetAgentIds: [],
        });
      }

      onOpenChange(false);
    } catch (_error) {
      toast.error("Failed to save Agent");
    }
  }, [
    name,
    userPrompt,
    systemPrompt,
    allowedChatops,
    agent,
    selectedDelegationTargetIds,
    currentDelegations.length,
    updateAgent,
    createAgent,
    syncDelegations,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {agent ? "Edit Agent" : "Create New Agent"}
            {agent && onViewVersionHistory && (
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onViewVersionHistory(agent);
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
            <Label htmlFor="agentName">Name *</Label>
            <Input
              id="agentName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter agent name"
            />
          </div>
          {agent && (
            <div className="space-y-2">
              <Label>Tools</Label>
              <p className="text-sm text-muted-foreground">
                Tools assigned to this agent (manage via Profiles page)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ChatToolsDisplay agentId={agent.id} readOnly />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Delegated Agents</Label>
            <p className="text-sm text-muted-foreground">
              Select other agents this agent can delegate tasks to
            </p>
            <MultiSelect
              value={selectedDelegationTargetIds}
              onValueChange={setSelectedDelegationTargetIds}
              items={availableDelegationTargets}
              placeholder="Select agents..."
              disabled={availableDelegationTargets.length === 0}
            />
            {availableDelegationTargets.length === 0 && (
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
          {chatopsProviders.filter((provider) => provider.configured).length >
            0 && (
            <div className="space-y-2">
              <Label>ChatOps Integrations</Label>
              <p className="text-sm text-muted-foreground">
                Select which chat platforms can trigger this agent
              </p>
            </div>
          )}
          {chatopsProviders
            .filter((provider) => provider.configured)
            .map((provider) => (
              <div key={provider.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`chatops-${provider.id}`}
                  checked={allowedChatops.includes(provider.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setAllowedChatops([...allowedChatops, provider.id]);
                    } else {
                      setAllowedChatops(
                        allowedChatops.filter((id) => id !== provider.id),
                      );
                    }
                  }}
                />
                <Label
                  htmlFor={`chatops-${provider.id}`}
                  className={
                    !provider.configured
                      ? "text-muted-foreground cursor-not-allowed font-normal"
                      : "cursor-pointer font-normal"
                  }
                >
                  {provider.displayName}
                  {!provider.configured && " (not configured)"}
                </Label>
              </div>
            ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !name.trim() || createAgent.isPending || updateAgent.isPending
            }
          >
            {(createAgent.isPending || updateAgent.isPending) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {agent ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
