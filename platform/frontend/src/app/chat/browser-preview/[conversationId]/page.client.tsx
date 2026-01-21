"use client";

import { BrowserPreviewContent } from "@/components/chat/browser-preview-content";

interface BrowserPreviewClientProps {
  conversationId: string;
}

export function BrowserPreviewClient({
  conversationId,
}: BrowserPreviewClientProps) {
  return (
    <BrowserPreviewContent
      conversationId={conversationId}
      isActive
      className="h-screen w-full"
    />
  );
}
