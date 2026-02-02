"use client";

import type { UIMessage } from "@ai-sdk/react";
import type { BrowserTab } from "@shared";
import { useCallback, useEffect, useRef, useState } from "react";
import websocketService from "@/lib/websocket";

interface UseBrowserStreamOptions {
  conversationId: string | undefined;
  isActive: boolean;
  chatMessages?: UIMessage[];
  setChatMessages?: (messages: UIMessage[]) => void;
}

interface UseBrowserStreamReturn {
  screenshot: string | null;
  urlInput: string;
  isConnected: boolean;
  isConnecting: boolean;
  isNavigating: boolean;
  isInteracting: boolean;
  error: string | null;
  navigate: (url: string) => void;
  navigateBack: () => void;
  click: (x: number, y: number) => void;
  type: (text: string) => void;
  pressKey: (key: string) => void;
  setUrlInput: (url: string) => void;
  setIsEditingUrl: (isEditing: boolean) => void;
  isEditingUrl: boolean;
  // Tab management
  tabs: BrowserTab[];
  activeTabIndex: number;
  isLoadingTabs: boolean;
  refreshTabs: () => void;
  selectTab: (tabIndex: number) => void;
  createTab: () => void;
  closeTab: (tabIndex: number) => void;
}

export function useBrowserStream({
  conversationId,
  isActive,
  chatMessages = [],
  setChatMessages,
}: UseBrowserStreamOptions): UseBrowserStreamReturn {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  // Tab state
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);

  const subscribedConversationIdRef = useRef<string | null>(null);
  const prevConversationIdRef = useRef<string | undefined>(undefined);
  const isEditingUrlRef = useRef(false);
  const chatMessagesRef = useRef<UIMessage[]>([]);
  const setChatMessagesRef = useRef<((messages: UIMessage[]) => void) | null>(
    null,
  );

  chatMessagesRef.current = chatMessages;
  setChatMessagesRef.current = setChatMessages ?? null;

  const appendNavigationMessage = useCallback((text: string) => {
    const updateMessages = setChatMessagesRef.current;
    if (!updateMessages) return;

    const messageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `nav-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const navigationMessage: UIMessage = {
      id: messageId,
      role: "user",
      parts: [{ type: "text", text }],
    };

    updateMessages([...chatMessagesRef.current, navigationMessage]);
  }, []);

  // Keep ref in sync with state for use in subscription callbacks
  useEffect(() => {
    isEditingUrlRef.current = isEditingUrl;
  }, [isEditingUrl]);

  // Subscribe to browser stream via existing WebSocket
  useEffect(() => {
    if (!isActive || !conversationId) {
      // Unsubscribe when panel closes
      if (subscribedConversationIdRef.current) {
        websocketService.send({
          type: "unsubscribe_browser_stream",
          payload: { conversationId: subscribedConversationIdRef.current },
        });
        subscribedConversationIdRef.current = null;
      }
      setIsConnected(false);
      setScreenshot(null);
      prevConversationIdRef.current = conversationId;
      return;
    }

    // Clear state when switching conversations
    const isConversationSwitch =
      prevConversationIdRef.current !== undefined &&
      prevConversationIdRef.current !== conversationId;

    if (isConversationSwitch) {
      if (subscribedConversationIdRef.current) {
        websocketService.send({
          type: "unsubscribe_browser_stream",
          payload: { conversationId: subscribedConversationIdRef.current },
        });
        subscribedConversationIdRef.current = null;
      }
      setScreenshot(null);
      setUrlInput("");
      setIsConnected(false);
      setIsEditingUrl(false);
    }

    prevConversationIdRef.current = conversationId;

    setIsConnecting(true);
    setError(null);

    websocketService.connect();

    const unsubScreenshot = websocketService.subscribe(
      "browser_screenshot",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setScreenshot(message.payload.screenshot);
          if (message.payload.url && !isEditingUrlRef.current) {
            setUrlInput(message.payload.url);
          }
          setError(null);
          setIsConnecting(false);
          setIsConnected(true);
        }
      },
    );

    const unsubNavigate = websocketService.subscribe(
      "browser_navigate_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsNavigating(false);
          if (message.payload.success && message.payload.url) {
            if (!isEditingUrlRef.current) {
              setUrlInput(message.payload.url);
            }
            appendNavigationMessage(
              `[User manually navigated browser to: ${message.payload.url}]`,
            );
          } else if (message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const unsubError = websocketService.subscribe(
      "browser_stream_error",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setError(message.payload.error);
          setIsConnecting(false);
        }
      },
    );

    const unsubClick = websocketService.subscribe(
      "browser_click_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsInteracting(false);
          if (message.payload.url && !isEditingUrlRef.current) {
            setUrlInput(message.payload.url);
          }
          if (!message.payload.success && message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const unsubType = websocketService.subscribe(
      "browser_type_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsInteracting(false);
          if (!message.payload.success && message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const unsubPressKey = websocketService.subscribe(
      "browser_press_key_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsInteracting(false);
          if (message.payload.url && !isEditingUrlRef.current) {
            setUrlInput(message.payload.url);
          }
          if (!message.payload.success && message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const unsubZoom = websocketService.subscribe(
      "browser_set_zoom_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsInteracting(false);
          if (!message.payload.success && message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const unsubNavigateBack = websocketService.subscribe(
      "browser_navigate_back_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsNavigating(false);
          if (message.payload.success) {
            if (message.payload.url && !isEditingUrlRef.current) {
              setUrlInput(message.payload.url);
            }
            appendNavigationMessage(
              "[User navigated browser back to previous page]",
            );
          } else if (message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    // Tab management subscriptions
    const unsubTabsList = websocketService.subscribe(
      "browser_tabs_list",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setTabs(message.payload.tabs);
          setActiveTabIndex(message.payload.activeTabIndex);
          setIsLoadingTabs(false);
        }
      },
    );

    const unsubSelectTabResult = websocketService.subscribe(
      "browser_select_tab_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsLoadingTabs(false);
          if (
            message.payload.success &&
            message.payload.tabIndex !== undefined
          ) {
            setActiveTabIndex(message.payload.tabIndex);
          } else if (message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const unsubCreateTabResult = websocketService.subscribe(
      "browser_create_tab_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsLoadingTabs(false);
          if (!message.payload.success && message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const unsubCloseTabResult = websocketService.subscribe(
      "browser_close_tab_result",
      (message) => {
        if (message.payload.conversationId === conversationId) {
          setIsLoadingTabs(false);
          if (!message.payload.success && message.payload.error) {
            setError(message.payload.error);
          }
        }
      },
    );

    const subscribeTimeout = setTimeout(() => {
      websocketService.send({
        type: "subscribe_browser_stream",
        payload: { conversationId },
      });
      subscribedConversationIdRef.current = conversationId;
    }, 100);

    // Request tabs list after subscribing
    const tabsTimeout = setTimeout(() => {
      setIsLoadingTabs(true);
      websocketService.send({
        type: "browser_list_tabs",
        payload: { conversationId },
      });
    }, 200);

    return () => {
      clearTimeout(subscribeTimeout);
      clearTimeout(tabsTimeout);
      unsubScreenshot();
      unsubNavigate();
      unsubError();
      unsubClick();
      unsubType();
      unsubPressKey();
      unsubZoom();
      unsubNavigateBack();
      unsubTabsList();
      unsubSelectTabResult();
      unsubCreateTabResult();
      unsubCloseTabResult();

      if (subscribedConversationIdRef.current) {
        websocketService.send({
          type: "unsubscribe_browser_stream",
          payload: { conversationId: subscribedConversationIdRef.current },
        });
        subscribedConversationIdRef.current = null;
      }
    };
  }, [isActive, conversationId, appendNavigationMessage]);

  const navigate = useCallback(
    (url: string) => {
      if (!websocketService.isConnected() || !conversationId) return;
      if (!url.trim()) return;

      let normalizedUrl = url.trim();
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      setIsNavigating(true);
      setError(null);
      setUrlInput(normalizedUrl);
      setIsEditingUrl(false);

      websocketService.send({
        type: "browser_navigate",
        payload: { conversationId, url: normalizedUrl },
      });
    },
    [conversationId],
  );

  const navigateBack = useCallback(() => {
    if (!websocketService.isConnected() || !conversationId) return;

    setIsNavigating(true);
    setError(null);

    websocketService.send({
      type: "browser_navigate_back",
      payload: { conversationId },
    });
  }, [conversationId]);

  const click = useCallback(
    (x: number, y: number) => {
      if (!websocketService.isConnected() || !conversationId) return;

      setIsInteracting(true);
      setError(null);

      websocketService.send({
        type: "browser_click",
        payload: { conversationId, x, y },
      });
    },
    [conversationId],
  );

  const type = useCallback(
    (text: string) => {
      if (!websocketService.isConnected() || !conversationId) return;
      if (!text) return;

      setIsInteracting(true);
      setError(null);

      websocketService.send({
        type: "browser_type",
        payload: { conversationId, text },
      });
    },
    [conversationId],
  );

  const pressKey = useCallback(
    (key: string) => {
      if (!websocketService.isConnected() || !conversationId) return;

      setIsInteracting(true);
      setError(null);

      websocketService.send({
        type: "browser_press_key",
        payload: { conversationId, key },
      });
    },
    [conversationId],
  );

  // Tab management methods
  const refreshTabs = useCallback(() => {
    if (!websocketService.isConnected() || !conversationId) return;

    setIsLoadingTabs(true);
    websocketService.send({
      type: "browser_list_tabs",
      payload: { conversationId },
    });
  }, [conversationId]);

  const selectTab = useCallback(
    (tabIndex: number) => {
      if (!websocketService.isConnected() || !conversationId) return;

      setIsLoadingTabs(true);
      setError(null);

      websocketService.send({
        type: "browser_select_tab",
        payload: { conversationId, tabIndex },
      });
    },
    [conversationId],
  );

  const createTab = useCallback(() => {
    if (!websocketService.isConnected() || !conversationId) return;

    setIsLoadingTabs(true);
    setError(null);

    websocketService.send({
      type: "browser_create_tab",
      payload: { conversationId },
    });
  }, [conversationId]);

  const closeTab = useCallback(
    (tabIndex: number) => {
      if (!websocketService.isConnected() || !conversationId) return;
      if (tabIndex === 0) return; // Cannot close tab 0

      setIsLoadingTabs(true);
      setError(null);

      websocketService.send({
        type: "browser_close_tab",
        payload: { conversationId, tabIndex },
      });
    },
    [conversationId],
  );

  return {
    screenshot,
    urlInput,
    isConnected,
    isConnecting,
    isNavigating,
    isInteracting,
    error,
    navigate,
    navigateBack,
    click,
    type,
    pressKey,
    setUrlInput,
    setIsEditingUrl,
    isEditingUrl,
    // Tab management
    tabs,
    activeTabIndex,
    isLoadingTabs,
    refreshTabs,
    selectTab,
    createTab,
    closeTab,
  };
}
