'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import BugReportWidget from '@/components/BugReportWidget';
import IconSidebarToggleButton from './IconSidebarToggleButton';

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

function chapterTitle(title: string): string {
  return title.replace(/^(?:\d+\.\s*)?Chapter\s+\d+\s*[-–—:]\s*/i, '').trim();
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
  const currentActiveId = activeChapterId ?? currentSections[0]?.id ?? null;
  const activeIndex = Math.max(
    0,
    currentSections.findIndex((section) => section.id === currentActiveId)
  );
  const activeSection = currentSections[activeIndex] ?? currentSections[0];
  const progressPercent = currentSections.length
    ? ((activeIndex + 1) / currentSections.length) * 100
    : 0;

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
      onActiveChapterChange?.(id);
    },
    [onActiveChapterChange]
  );

  const [selectionTooltip, setSelectionTooltip] = useState<SelectionTooltipState | null>(null);

  const handleBodyMouseUp = useCallback((event: React.SyntheticEvent<HTMLElement>) => {
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
      {onSidebarToggle && (
        <div
          style={{
            background: 'var(--vscode-bg-tertiary)',
            borderBottom: '1px solid var(--vscode-border)',
            padding: '4px 8px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <IconSidebarToggleButton onClick={onSidebarToggle} label={sidebarToggleLabel}>
            {sidebarToggleIcon}
          </IconSidebarToggleButton>
        </div>
      )}

      {/* ── Always-visible chapter selector ── */}
      {currentSections.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            borderBottom: '1px solid var(--vscode-border)',
            background: 'var(--vscode-bg-secondary)',
            padding: '6px 8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              marginBottom: 5,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                title={activeSection ? chapterTitle(activeSection.title) : undefined}
                style={{
                  color: 'var(--vscode-text-primary)',
                  fontSize: 12,
                  fontWeight: 650,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {activeSection ? chapterTitle(activeSection.title) : 'No chapter selected'}
              </div>
            </div>
            <div
              aria-label="Chapter progress"
              style={{
                flexShrink: 0,
                color: 'var(--vscode-text-muted, #888)',
                fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {activeIndex + 1}/{currentSections.length}
            </div>
          </div>

          <div
            aria-hidden="true"
            style={{
              height: 2,
              overflow: 'hidden',
              borderRadius: 999,
              background: 'var(--vscode-border)',
              marginBottom: 5,
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                borderRadius: 999,
                background: 'var(--repo-accent, var(--vscode-text-accent, #0078d4))',
                transition: 'width 0.2s ease',
              }}
            />
          </div>

          <div
            role="tablist"
            aria-label="Guide chapters"
            style={{
              display: 'flex',
              gap: 4,
              overflowX: 'auto',
              paddingBottom: 1,
              scrollbarWidth: 'thin',
            }}
          >
            {currentSections.map((section, idx) => {
              const isActive = section.id === currentActiveId;
              const num = chapterNumber(section.id) ?? idx + 1;

              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`guide-chapter-${section.id}`}
                  title={chapterTitle(section.title)}
                  aria-label={chapterTitle(section.title)}
                  onClick={() => toggle(section.id)}
                  style={{
                    flex: '0 0 auto',
                    minWidth: 24,
                    height: 24,
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: isActive
                      ? 'color-mix(in srgb, var(--repo-accent, var(--vscode-text-accent, #0078d4)) 18%, var(--vscode-bg-hover))'
                      : 'transparent',
                    color: isActive ? 'var(--vscode-text-primary)' : 'var(--vscode-text-secondary)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: isActive ? 800 : 650,
                    fontFamily: 'monospace',
                    padding: '0 6px',
                  }}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Chapter body ── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={() => setSelectionTooltip(null)}
        style={{
          flex: '1 1 0%',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '8px 10px',
          minHeight: 0,
        }}
      >
        {activeSection && (
          <section
            id={`guide-chapter-${activeSection.id}`}
            role="tabpanel"
            aria-label={chapterTitle(activeSection.title)}
            onMouseUp={handleBodyMouseUp}
            onKeyUp={handleBodyMouseUp}
            style={{
              position: 'relative',
              color: 'var(--vscode-text-secondary)',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {activeSection.body}
          </section>
        )}
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
