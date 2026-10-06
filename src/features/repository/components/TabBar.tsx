'use client';

import React from 'react';
import { EditorTab } from '@/types';

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onCloseAllTabs: () => void;
  onMarkdownPreviewToggle?: () => void;
}

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onCloseAllTabs,
  onMarkdownPreviewToggle,
}) => {
  const activeTabElementRef = React.useRef<HTMLDivElement | null>(null);
  const tabStripRef = React.useRef<HTMLDivElement | null>(null);

  const scrollActiveTabIntoView = React.useCallback(() => {
    const activeTabElement = activeTabElementRef.current;
    const tabStripElement = tabStripRef.current;
    if (!activeTabElement || !tabStripElement) {
      return;
    }

    const tabRect = activeTabElement.getBoundingClientRect();
    const stripRect = tabStripElement.getBoundingClientRect();

    if (tabRect.left < stripRect.left) {
      tabStripElement.scrollLeft -= stripRect.left - tabRect.left;
      return;
    }

    if (tabRect.right > stripRect.right) {
      tabStripElement.scrollLeft += tabRect.right - stripRect.right;
    }
  }, []);

  const getFileIcon = (tab: EditorTab): string => {
    const path = tab.path;
    const extension = path.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'c':
        return '⚙️';
      case 'h':
        return '🔧';
      case 's':
      case 'S':
        return '🔩';
      case 'py':
        return '🐍';
      case 'sh':
        return '🐚';
      case 'md':
      case 'rst':
        return '📖';
      case 'json':
        return '📋';
      default:
        return '📄';
    }
  };

  const getFileName = (path: string): string => {
    return path.split('/').pop() || path;
  };

  const handleTabClick = (tab: EditorTab, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (tab.isLoading) return;

    onTabSelect(tab.id);
  };

  const handleTabClose = (tabId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onTabClose(tabId);
  };

  const handleTabMiddleClick = (tab: EditorTab, event: React.MouseEvent) => {
    if (event.button === 1) {
      // Middle mouse button
      event.preventDefault();
      event.stopPropagation();
      onTabClose(tab.id);
    }
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const isMarkdownTab = !!activeTab && /\.(md|rst)$/i.test(activeTab.path);
  const isPreviewMode = activeTab?.viewMode === 'preview';

  React.useLayoutEffect(() => {
    let frameId: number | null = null;

    scrollActiveTabIntoView();
    frameId = window.requestAnimationFrame(scrollActiveTabIntoView);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [activeTabId, tabs.length, scrollActiveTabIntoView]);

  React.useEffect(() => {
    const tabStripElement = tabStripRef.current;
    if (!tabStripElement || typeof ResizeObserver === 'undefined') {
      return;
    }

    const resizeObserver = new ResizeObserver(scrollActiveTabIntoView);
    resizeObserver.observe(tabStripElement);

    return () => resizeObserver.disconnect();
  }, [scrollActiveTabIntoView]);

  return (
    <div className="vscode-tab-bar">
      <button
        type="button"
        className="vscode-tab-bar-action"
        onClick={onCloseAllTabs}
        disabled={tabs.length === 0}
        title="Close all files"
        aria-label="Close all files"
      >
        ×
      </button>
      <div className="vscode-tab-strip" ref={tabStripRef}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(element) => {
              if (tab.id === activeTabId) {
                activeTabElementRef.current = element;
              }
            }}
            className={`vscode-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={(e) => handleTabClick(tab, e)}
            onMouseDown={(e) => handleTabMiddleClick(tab, e)}
            title={tab.path}
          >
            <span className="icon">
              {tab.isLoading ? (
                <div className="vscode-spinner" style={{ width: '10px', height: '10px' }} />
              ) : (
                getFileIcon(tab)
              )}
            </span>

            <span className="name">{getFileName(tab.title || tab.path)}</span>

            {tab.isDirty && (
              <span style={{ color: '#dcdcaa', fontSize: '12px', marginLeft: '4px' }}>•</span>
            )}

            <div
              className="close"
              onClick={(e) => handleTabClose(tab.id, e)}
              title={`Close ${getFileName(tab.path)}`}
            >
              ✕
            </div>
          </div>
        ))}
      </div>
      {isMarkdownTab && onMarkdownPreviewToggle && (
        <button
          type="button"
          onClick={onMarkdownPreviewToggle}
          title={isPreviewMode ? 'Show source' : 'Open preview'}
          aria-label={isPreviewMode ? 'Show source' : 'Open preview'}
          style={{
            marginLeft: 'auto',
            marginRight: '8px',
            alignSelf: 'center',
            border: '1px solid var(--vscode-border)',
            background: isPreviewMode
              ? 'var(--repo-accent, var(--vscode-text-accent, #0078d4))'
              : 'var(--vscode-editor-background, #1e1e1e)',
            color: isPreviewMode
              ? 'var(--vscode-button-foreground, #fff)'
              : 'var(--vscode-foreground, #d4d4d4)',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {isPreviewMode ? 'Source' : 'Preview'}
        </button>
      )}
    </div>
  );
};

export default TabBar;
