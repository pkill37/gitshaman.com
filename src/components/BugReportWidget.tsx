'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { captureBugReportScreenshot } from '@/lib/bug-reporting/screenshot';
import { createBugReportIssueUrl } from '@/lib/bug-reporting/github-issue';
import {
  formatConsoleLogsForIssue,
  getConsoleLogs,
  installConsoleLogCapture,
} from '@/lib/bug-reporting/console-log-buffer';

type ScreenshotState =
  | { status: 'idle' | 'loading'; dataUrl?: undefined; error?: undefined }
  | { status: 'ready'; dataUrl: string; error?: undefined }
  | { status: 'error'; dataUrl?: undefined; error: string };

interface BugReportWidgetProps {
  variant?: 'floating' | 'sidebar' | 'statusbar';
  trigger?: ReactNode;
  initialDescription?: string;
}

export default function BugReportWidget({
  variant = 'floating',
  trigger,
  initialDescription = '',
}: BugReportWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ status: 'idle' });
  const [copyStatus, setCopyStatus] = useState('');
  const [consoleText, setConsoleText] = useState('No console logs were captured.');

  useEffect(() => {
    installConsoleLogCapture();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    window.setTimeout(() => {
      void captureBugReportScreenshot().then((result) => {
        if (cancelled) {
          return;
        }

        if (result.dataUrl) {
          setScreenshot({ status: 'ready', dataUrl: result.dataUrl });
        } else {
          setScreenshot({ status: 'error', error: result.error ?? 'Screenshot capture failed.' });
        }
      });
    }, 120);

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const githubIssueUrl = createBugReportIssueUrl({
    description,
    screenshotIncluded: screenshot.status === 'ready',
  });

  const openReport = () => {
    setCopyStatus('');
    setDescription(initialDescription);
    setConsoleText(formatConsoleLogsForIssue(getConsoleLogs()));
    setScreenshot({ status: 'loading' });
    setIsOpen(true);
  };

  const copyScreenshot = useCallback(async () => {
    if (screenshot.status !== 'ready') {
      return;
    }

    try {
      const response = await fetch(screenshot.dataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      setCopyStatus('Screenshot copied.');
    } catch {
      setCopyStatus('Copy failed. Drag or save the preview instead.');
    }
  }, [screenshot]);

  return (
    <>
      <button
        type="button"
        data-no-screenshot
        onClick={openReport}
        title="❤️ Report a bug"
        aria-label="Report a bug"
        className={
          trigger
            ? 'rounded border border-[var(--vscode-border,#3e3e3e)] bg-[var(--vscode-bg-secondary,#252526)] text-[var(--vscode-text-secondary,#cccccc)] shadow-sm transition-colors hover:border-[var(--repo-accent,var(--vscode-text-accent,#63d8c9))] hover:bg-[var(--vscode-bg-hover,#2a2d2e)] hover:text-[var(--vscode-text-primary,#ffffff)] focus:ring-2 focus:ring-[var(--repo-accent,var(--vscode-text-accent,#63d8c9))] focus:outline-none'
            : variant === 'sidebar'
              ? 'flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--vscode-border)] bg-[var(--vscode-bg-tertiary)] text-sm font-semibold text-[var(--vscode-text-secondary)] transition-colors hover:border-[var(--repo-accent,var(--vscode-text-accent))] hover:bg-[var(--vscode-bg-hover)] hover:text-[var(--vscode-text-primary)] focus:ring-2 focus:ring-[var(--repo-accent,var(--vscode-text-accent))] focus:outline-none'
              : variant === 'statusbar'
                ? 'cursor-statusbar-item cursor-statusbar-button'
                : 'fixed right-4 bottom-4 z-40 rounded-md border border-gray-700 bg-gray-950/95 px-3 py-2 text-xs font-medium text-gray-100 shadow-lg transition-colors hover:border-[var(--repo-accent,var(--vscode-text-accent))] hover:bg-gray-900 focus:ring-2 focus:ring-[var(--repo-accent,var(--vscode-text-accent))] focus:outline-none'
        }
      >
        {trigger ?? (variant === 'sidebar' ? '❤️' : '❤️ Report a bug')}
      </button>

      {isOpen && (
        <div
          data-no-screenshot
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bug-report-title"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 text-gray-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
              <h2 id="bug-report-title" className="text-sm font-semibold">
                Report a bug
              </h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-900 focus:ring-2 focus:ring-[var(--repo-accent,var(--vscode-text-accent))] focus:outline-none"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 p-4">
              <label className="grid gap-2 text-xs font-medium text-gray-300">
                What happened?
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  className="resize-y rounded-md border border-gray-700 bg-gray-900 p-3 text-sm text-gray-100 outline-none focus:border-[var(--repo-accent,var(--vscode-text-accent))]"
                  placeholder="Describe what broke and what you expected."
                />
              </label>

              <section className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold text-gray-300">Screenshot</h3>
                  {screenshot.status === 'ready' && (
                    <button
                      type="button"
                      onClick={copyScreenshot}
                      className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-900 focus:ring-2 focus:ring-[var(--repo-accent,var(--vscode-text-accent))] focus:outline-none"
                    >
                      Copy screenshot
                    </button>
                  )}
                </div>

                {screenshot.status === 'loading' && (
                  <div className="flex h-48 items-center justify-center rounded-md border border-gray-800 bg-gray-900 text-xs text-gray-400">
                    Capturing screenshot...
                  </div>
                )}

                {screenshot.status === 'error' && (
                  <div className="rounded-md border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-200">
                    Screenshot unavailable: {screenshot.error}
                  </div>
                )}

                {screenshot.status === 'ready' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={screenshot.dataUrl}
                    alt="Captured bug report screenshot preview"
                    className="max-h-72 w-full rounded-md border border-gray-800 bg-gray-900 object-contain"
                  />
                )}

                {copyStatus && <p className="text-xs text-gray-400">{copyStatus}</p>}
              </section>

              <section className="grid gap-2">
                <h3 className="text-xs font-semibold text-gray-300">Recent console logs</h3>
                <pre className="max-h-40 overflow-auto rounded-md border border-gray-800 bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap">
                  {consoleText}
                </pre>
              </section>

              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-800 pt-4">
                <a
                  href={githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-[var(--repo-accent,var(--vscode-text-accent))] px-3 py-2 text-xs font-semibold text-white hover:brightness-110 focus:ring-2 focus:ring-[var(--repo-accent,var(--vscode-text-accent))] focus:outline-none"
                >
                  Open GitHub Issue
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
