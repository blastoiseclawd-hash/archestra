"use client";

import type { archestraApiTypes } from "@shared";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { ErrorBoundary } from "@/app/_parts/error-boundary";
import { PromptDialog } from "@/components/chat/prompt-dialog";
import { PromptVersionHistoryDialog } from "@/components/chat/prompt-version-history-dialog";
import { PageLayout } from "@/components/page-layout";
import { PermissivePolicyBar } from "@/components/permissive-policy-bar";
import { WithPermissions } from "@/components/roles/with-permissions";
import { PermissionButton } from "@/components/ui/permission-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProfile, useProfiles } from "@/lib/agent.query";

type InternalAgent = archestraApiTypes.GetAllAgentsResponses["200"][number];

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: allProfiles = [] } = useProfiles();

  // Dialog state for creating/editing internal agents
  const [isAgentDialogOpen, setIsAgentDialogOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [versionHistoryAgent, setVersionHistoryAgent] =
    useState<InternalAgent | null>(null);

  const { data: editingAgent } = useProfile(editingAgentId ?? undefined);

  const handleCreateAgent = useCallback(() => {
    setEditingAgentId(null);
    setIsAgentDialogOpen(true);
  }, []);

  const hasNoProfiles = allProfiles.length === 0;

  return (
    <ErrorBoundary>
      <PermissivePolicyBar />
      <PageLayout
        title="Agents"
        description={
          <p className="text-sm text-muted-foreground">
            Agents are pre-configured prompts that can be used to start
            conversations with specific system prompts and user prompts.
          </p>
        }
        actionButton={
          <WithPermissions
            permissions={{ profile: ["create"] }}
            noPermissionHandle="hide"
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <PermissionButton
                      permissions={{ profile: ["create"] }}
                      onClick={handleCreateAgent}
                      disabled={hasNoProfiles}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create Agent
                    </PermissionButton>
                  </span>
                </TooltipTrigger>
                {hasNoProfiles && (
                  <TooltipContent>
                    <p>No profiles available. Create a profile first.</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </WithPermissions>
        }
      >
        {children}

        {/* Create/Edit Agent Dialog */}
        <PromptDialog
          open={isAgentDialogOpen}
          onOpenChange={(open) => {
            setIsAgentDialogOpen(open);
            if (!open) {
              setEditingAgentId(null);
            }
          }}
          agent={editingAgent}
          onViewVersionHistory={setVersionHistoryAgent}
        />

        {/* Version History Dialog */}
        <PromptVersionHistoryDialog
          open={!!versionHistoryAgent}
          onOpenChange={(open) => {
            if (!open) {
              setVersionHistoryAgent(null);
            }
          }}
          agent={versionHistoryAgent}
        />
      </PageLayout>
    </ErrorBoundary>
  );
}
