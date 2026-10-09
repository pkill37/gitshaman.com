'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import BugReportWidget from '@/components/BugReportWidget';

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

interface Guide {
  id: string;
  name: string;
  sections: Section[];
}

interface GuidePanelProps {
  sections?: Section[];
  guides?: Guide[];
  activeChapterId?: string | null;
  onActiveChapterChange?: (id: string | null) => void;
  onSidebarToggle?: () => void;
  sidebarToggleLabel?: string;
  sidebarToggleIcon?: React.ReactNode;
}

interface SelectionTooltipState {
  text: string;
  x: number;
  y: number;
}

// Extract a display number from chapter id: "ch1" → 1, "chapter-3-foo" → 3, else null
function chapterNumber(id: string): number | null {
  const m = id.match(/(?:^ch|chapter[-_])(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export default function GuidePanel({
  sections,
  guides,
  activeChapterId,
  onActiveChapterChange,
  onSidebarToggle,
  sidebarToggleLabel = 'Toggle guide sidebar',
  sidebarToggleIcon = '›',
}: GuidePanelProps) {
  const guideList: Guide[] =
    guides || (sections ? [{ id: 'default', name: 'Guide', sections }] : []);
  const selectedGuideId = guideList[0]?.id || 'default';
  const currentGuide = guideList.find((g) => g.id === selectedGuideId) || guideList[0];
  const currentSections = useMemo(() => currentGuide?.sections || [], [currentGuide?.sections]);
  const storageScope = useMemo(() => {
    const sectionIds = currentSections.map((section) => section.id).join('|');
    return `${selectedGuideId}:${sectionIds}`;
  }, [selectedGuideId, currentSections]);
  const scrollPositionStorageKey = `guide-panel-scroll-position:${storageScope}`;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const currentActiveId = activeChapterId ?? null;

  // Scroll active chapter into view when it opens
  useEffect(() => {
    if (!currentActiveId) return;
    const el = sectionRefs.current[currentActiveId];
    if (el && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const elTop = el.offsetTop;
      const elHeight = el.offsetHeight;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (elTop < viewTop || elTop + elHeight > viewBottom) {
        container.scrollTo({ top: Math.max(0, elTop - 16), behavior: 'smooth' });
      }
    }
  }, [currentActiveId]);

  // Save scroll position — debounced
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const pos = scrollContainerRef.current.scrollTop;
    if (scrollSaveTimer.current !== null) clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(scrollPositionStorageKey, pos.toString());
      } catch {
        // ignore
      }
    }, 250);
  }, [scrollPositionStorageKey]);

  // Restore scroll on mount
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    try {
      const saved = localStorage.getItem(scrollPositionStorageKey);
      if (saved) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current)
            scrollContainerRef.current.scrollTop = parseInt(saved, 10);
        });
      }
    } catch {
      // ignore
    }
  }, [scrollPositionStorageKey]);

  const toggle = useCallback(
    (id: string) => {
      onActiveChapterChange?.(currentActiveId === id ? null : id);
    },
    [currentActiveId, onActiveChapterChange]
  );

  const [selectionTooltip, setSelectionTooltip] = useState<SelectionTooltipState | null>(null);

  const handleBodyMouseUp = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
    // Let the browser finish updating the selection before reading it.
    const body = event.currentTarget;
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        !selection.toString().trim() ||
        selection.rangeCount === 0
      ) {
        setSelectionTooltip(null);
        return;
      }

      const range = selection.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) {
        setSelectionTooltip(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      setSelectionTooltip({
        text: selection.toString().trim(),
        x: Math.min(Math.max(rect.left + rect.width / 2, 72), window.innerWidth - 72),
        y: Math.max(rect.top - 8, 8),
      });
    }, 0);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minHeight: 0,
        overflow: 'hidden',
        flex: '1 1 0%',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          background: 'var(--vscode-bg-tertiary)',
          borderBottom: '1px solid var(--vscode-border)',
          padding: '8px 12px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 auto' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {onSidebarToggle && (
            <button
              onClick={onSidebarToggle}
              title={sidebarToggleLabel}
              aria-label={sidebarToggleLabel}
              style={{
                width: 24,
                height: 24,
                borderRadius: 3,
                border: '1px solid var(--vscode-border)',
                background: 'transparent',
                color: 'var(--vscode-text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--vscode-bg-hover)';
                e.currentTarget.style.borderColor =
                  'var(--repo-accent, var(--vscode-text-accent, #0078d4))';
                e.currentTarget.style.color = 'var(--vscode-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'var(--vscode-border)';
                e.currentTarget.style.color = 'var(--vscode-text-secondary)';
              }}
            >
              {sidebarToggleIcon}
            </button>
          )}
        </div>
      </div>

      {/* ── Chapter list ── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={() => setSelectionTooltip(null)}
        style={{
          flex: '1 1 0%',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '4px',
          minHeight: 0,
        }}
      >
        {currentSections.map((s, idx) => {
          const isActive = s.id === currentActiveId;
          const num = chapterNumber(s.id) ?? idx + 1;
          const ACCENT = 'var(--repo-accent, var(--vscode-text-accent, #0078d4))';

          return (
            <div
              key={s.id}
              ref={(el) => {
                sectionRefs.current[s.id] = el;
              }}
              style={{
                marginBottom: 3,
                borderRadius: 5,
                overflow: 'hidden',
                border: isActive ? `1px solid ${ACCENT}44` : '1px solid transparent',
                transition: 'border-color 0.2s ease',
              }}
            >
              {/* Chapter header row */}
              <div
                onClick={() => toggle(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0,
                  cursor: 'pointer',
                  background: isActive ? 'var(--vscode-bg-hover)' : 'var(--vscode-bg-tertiary)',
                  borderLeft: isActive ? `3px solid ${ACCENT}` : '3px solid transparent',
                  padding: isActive ? '9px 10px 9px 9px' : '7px 10px 7px 9px',
                  transition: 'background 0.15s ease, padding 0.15s ease',
                  userSelect: 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.background = 'var(--vscode-bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.background = 'var(--vscode-bg-tertiary)';
                }}
              >
                {/* Chapter number badge */}
                <span
                  style={{
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: isActive ? ACCENT : 'var(--vscode-border)',
                    color: isActive ? '#fff' : 'var(--vscode-text-muted, #555)',
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 8,
                    transition: 'background 0.2s ease, color 0.2s ease',
                    letterSpacing: 0,
                  }}
                >
                  {num}
                </span>

                {/* Title */}
                <span
                  style={{
                    flex: 1,
                    fontSize: isActive ? 12 : 11,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive
                      ? 'var(--vscode-text-primary)'
                      : 'var(--vscode-text-muted, #555)',
                    lineHeight: 1.3,
                    transition: 'color 0.15s ease, font-size 0.15s ease',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    // Strip "Chapter N — " prefix since we show the number badge
                    // Rendered as-is; the title already has leading "Chapter N — " stripped in the guide loader
                  }}
                >
                  {s.title}
                </span>

                {/* Chevron */}
                <span
                  style={{
                    flexShrink: 0,
                    marginLeft: 6,
                    fontSize: 9,
                    color: isActive ? ACCENT : 'var(--vscode-text-muted, #444)',
                    transition: 'transform 0.2s ease, color 0.2s ease',
                    transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)',
                    display: 'inline-block',
                  }}
                >
                  ›
                </span>
              </div>

              {/* Chapter body */}
              {isActive && (
                <div
                  onMouseUp={handleBodyMouseUp}
                  onKeyUp={handleBodyMouseUp}
                  style={{
                    position: 'relative',
                    background: 'var(--vscode-bg-secondary)',
                    borderTop: `1px solid ${ACCENT}22`,
                    padding: '10px 10px 12px',
                    color: 'var(--vscode-text-secondary)',
                    fontSize: 12,
                    lineHeight: 1.65,
                  }}
                >
                  {s.body}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {selectionTooltip && (
        <div
          role="toolbar"
          aria-label="Selected text actions"
          style={{
            position: 'fixed',
            left: selectionTooltip.x,
            top: selectionTooltip.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 1100,
            padding: 3,
            border: '1px solid var(--vscode-border)',
            borderRadius: 4,
            background: 'var(--vscode-bg-tertiary)',
            boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
          }}
        >
          <BugReportWidget
            initialDescription={`I found an issue in the guide with this selected text:\n\n> ${selectionTooltip.text.replaceAll('\n', '\n> ')}`}
            trigger={
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 6px',
                  color: 'inherit',
                  fontSize: 10,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                <svg
                  aria-hidden="true"
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M5.5 5.5h5" />
                  <path d="M4.5 7.5h7" />
                  <path d="M4.5 9.5h7" />
                  <path d="M6 3.5 4.5 2" />
                  <path d="M10 3.5 11.5 2" />
                  <path d="M3 6H1.5" />
                  <path d="M14.5 6H13" />
                  <path d="M3 10H1.5" />
                  <path d="M14.5 10H13" />
                  <path d="M5 4.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8v5c0 2-1.3 3.8-3 3.8s-3-1.8-3-3.8z" />
                </svg>
                Report bug
              </span>
            }
          />
        </div>
      )}
    </div>
  );
}
