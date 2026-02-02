"use client";

import type { BrowserTab } from "@shared";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BrowserTabsBarProps {
  tabs: BrowserTab[];
  activeTabIndex: number;
  onSelectTab: (tabIndex: number) => void;
  onCreateTab: () => void;
  onCloseTab: (tabIndex: number) => void;
  disabled?: boolean;
}

export function BrowserTabsBar({
  tabs,
  activeTabIndex,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  disabled = false,
}: BrowserTabsBarProps) {
  // Don't render if no tabs
  if (tabs.length === 0) return null;

  const getTabLabel = (tab: BrowserTab): string => {
    if (tab.title) return tab.title;
    if (tab.url) {
      try {
        const url = new URL(tab.url);
        return url.hostname || tab.url;
      } catch {
        return tab.url;
      }
    }
    return `Tab ${tab.index + 1}`;
  };

  return (
    <div className="flex items-center bg-muted/30 border-b">
      {/* Scrollable tabs container */}
      <div className="flex-1 overflow-x-auto flex items-center gap-0.5 px-2 py-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = activeTabIndex === tab.index;
          return (
            <div
              key={tab.index}
              className={cn(
                "group flex items-center gap-1 px-2 py-1 text-xs min-w-0 max-w-[150px] cursor-pointer rounded-t border-b-2 flex-shrink-0",
                "hover:bg-muted/50 transition-colors",
                isActive
                  ? "bg-background border-primary"
                  : "border-transparent",
                disabled && "opacity-50 pointer-events-none",
              )}
              onClick={() => onSelectTab(tab.index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectTab(tab.index);
                }
              }}
              role="tab"
              tabIndex={disabled ? -1 : 0}
              aria-selected={isActive}
              title={tab.url || tab.title || `Tab ${tab.index + 1}`}
            >
              <span className="truncate flex-1 text-muted-foreground group-hover:text-foreground">
                {getTabLabel(tab)}
              </span>
              {tab.index !== 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-opacity flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.index);
                  }}
                  disabled={disabled}
                  title="Close tab"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* New tab button - always visible */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0 mx-1"
        onClick={onCreateTab}
        disabled={disabled}
        title="New tab"
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
