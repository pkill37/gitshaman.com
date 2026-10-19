'use client';

import { ReactNode, useEffect } from 'react';
import { useRepositoryNotification } from './RepositoryNotifications';

interface SidebarSearchHeaderProps {
  titleLabel?: string;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  ariaLabel: string;
  searchVisible?: boolean;
  isRegex?: boolean;
  onRegexChange?: (isRegex: boolean) => void;
  statusVisible?: boolean;
  statusLoading?: boolean;
  statusReady?: boolean;
  statusCached?: boolean;
  statusError?: boolean;
  statusProgress?: number;
  statusLabel?: string;
  statusBadgeLabel?: string;
  statusNotificationId?: string;
  meta?: ReactNode;
}

export default function SidebarSearchHeader({
  titleLabel,
  query,
  onQueryChange,
  placeholder,
  ariaLabel,
  searchVisible = true,
  isRegex = false,
  onRegexChange,
  statusVisible = false,
  statusLoading = false,
  statusReady = false,
  statusCached = false,
  statusError = false,
  statusProgress = 0,
  statusLabel,
  statusBadgeLabel,
  statusNotificationId,
  meta,
}: SidebarSearchHeaderProps) {
  const normalizedQuery = query.trim();
  const notify = useRepositoryNotification();
  const clampedProgress = Math.max(0, Math.min(100, statusProgress));

  const resolvedStatusLabel =
    statusLabel ??
    (statusReady
      ? statusCached
        ? 'Cached index ready'
        : 'Index ready'
      : statusLoading
        ? `${clampedProgress.toFixed(1)}% loaded`
        : statusError
          ? 'Index unavailable'
          : '');
  const resolvedBadgeLabel =
    statusBadgeLabel ??
    (statusCached ? 'cached' : statusLoading ? 'loading' : statusError ? 'error' : 'ready');

  const showReadyNotification =
    !!statusNotificationId && statusVisible && statusReady && !statusLoading && !statusError;

  useEffect(() => {
    if (showReadyNotification && statusNotificationId) {
      notify(statusNotificationId, resolvedStatusLabel);
    }
  }, [notify, showReadyNotification, statusNotificationId, resolvedStatusLabel]);

  return (
    <div
      style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--vscode-border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '8px',
        flexShrink: 0,
      }}
    >
      {titleLabel && (
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--vscode-text-muted, #999)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={titleLabel}
        >
          {titleLabel}
        </div>
      )}
      {searchVisible && (
        <div className="vscode-tree-search">
          <div className="vscode-tree-search-input-wrap">
            <span className="vscode-tree-search-input-icon" aria-hidden="true" />
            <input
              className="vscode-tree-search-input vscode-tree-search-input-with-icon"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={placeholder}
              aria-label={ariaLabel}
              spellCheck={false}
            />
          </div>
          {onRegexChange && (
            <button
              type="button"
              className={`vscode-tree-search-toggle${isRegex ? ' is-active' : ''}`}
              onClick={() => onRegexChange(!isRegex)}
              title={isRegex ? 'Regex search on' : 'Regex search off'}
              aria-label={isRegex ? 'Disable regex search' : 'Enable regex search'}
            >
              .*
            </button>
          )}
          {normalizedQuery && (
            <button
              type="button"
              className="vscode-tree-search-clear"
              onClick={() => onQueryChange('')}
              title="Clear search"
              aria-label="Clear query"
            >
              ×
            </button>
          )}
        </div>
      )}
      {statusVisible && !showReadyNotification && (
        <div className="vscode-tree-search-index-status">
          <div className="vscode-tree-search-index-status-header">
            <span>{resolvedStatusLabel || 'Loading index'}</span>
            <span
              className={`vscode-tree-search-index-badge${
                statusReady ? ' is-ready' : statusError ? ' is-error' : ''
              }`}
            >
              {resolvedBadgeLabel}
            </span>
          </div>
          <div className="vscode-tree-search-index-track" aria-hidden="true">
            <div
              className={`vscode-tree-search-index-bar${
                statusReady ? ' is-ready' : statusError ? ' is-error' : ''
              }`}
              style={{
                width: `${statusError ? 100 : clampedProgress}%`,
              }}
            />
          </div>
        </div>
      )}
      {meta}
    </div>
  );
}
