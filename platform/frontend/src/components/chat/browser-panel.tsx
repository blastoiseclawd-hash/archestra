"use client";

import { ExternalLink, X } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useChatSession } from "@/contexts/global-chat-context";
import {
  BROWSER_PREVIEW_HEADER_HEIGHT,
  DEFAULT_BROWSER_PREVIEW_VIEWPORT_HEIGHT,
  DEFAULT_BROWSER_PREVIEW_VIEWPORT_WIDTH,
} from "../../../../shared";
import { BrowserPreviewContent } from "./browser-preview-content";

interface BrowserPanelProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string | undefined;
}

export function BrowserPanel({
  isOpen,
  onClose,
  conversationId,
}: BrowserPanelProps) {
  const chatSession = useChatSession(conversationId);
  const chatMessages = chatSession?.messages ?? [];
  const setChatMessages = chatSession?.setMessages;

  const handleOpenInNewWindow = useCallback(() => {
    if (!conversationId) return;

    // Window sized to fit viewport + header, matching the screenshot aspect ratio
    const windowWidth = DEFAULT_BROWSER_PREVIEW_VIEWPORT_WIDTH;
    const windowHeight =
      DEFAULT_BROWSER_PREVIEW_VIEWPORT_HEIGHT + BROWSER_PREVIEW_HEADER_HEIGHT;

    // Center the window on screen
    const left = Math.max(0, (window.screen.width - windowWidth) / 2);
    const top = Math.max(0, (window.screen.height - windowHeight) / 2);

    window.open(
      `/chat/browser-preview/${conversationId}`,
      `browser-preview-${conversationId}`,
      `width=${windowWidth},height=${windowHeight},left=${left},top=${top},resizable=yes,scrollbars=no`,
    );
  }, [conversationId]);

  if (!isOpen) return null;

  return (
    <BrowserPreviewContent
      conversationId={conversationId}
      isActive={isOpen}
      chatMessages={chatMessages}
      setChatMessages={setChatMessages}
      className="border-t"
      headerActions={
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleOpenInNewWindow}
            title="Open in new window"
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
            title="Close"
          >
            <X className="h-3 w-3" />
          </Button>
        </>
      }
    />
  );
}
