'use client';

import newGithubIssueUrl from 'new-github-issue-url';
import {
  formatConsoleLogsForIssue,
  getConsoleLogs,
  redactDiagnosticText,
  type ConsoleLogEntry,
} from './console-log-buffer';

const DEFAULT_ISSUE_OWNER = 'pkill37';
const DEFAULT_ISSUE_REPO = 'gitshaman.com';
const MAX_DESCRIPTION_LENGTH = 4_000;

export type BugReportIssueInput = {
  description: string;
  screenshotIncluded: boolean;
};

export type BugReportDiagnostics = {
  cleanUrl: string;
  route: string;
  userAgent: string;
  release: string;
  timestamp: string;
  consoleLogs: ConsoleLogEntry[];
};

function getIssueTarget(): { owner: string; repo: string } {
  return {
    owner: process.env.NEXT_PUBLIC_GITHUB_ISSUE_OWNER || DEFAULT_ISSUE_OWNER,
    repo: process.env.NEXT_PUBLIC_GITHUB_ISSUE_REPO || DEFAULT_ISSUE_REPO,
  };
}

export function getCleanCurrentUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function collectBugReportDiagnostics(): BugReportDiagnostics {
  return {
    cleanUrl: getCleanCurrentUrl(),
    route: typeof window === 'undefined' ? '' : window.location.pathname,
    userAgent: typeof navigator === 'undefined' ? 'Unavailable' : navigator.userAgent,
    release: process.env.NEXT_PUBLIC_APP_RELEASE || 'Unspecified',
    timestamp: new Date().toISOString(),
    consoleLogs: getConsoleLogs(),
  };
}

function formatIssueBody(
  input: BugReportIssueInput,
  diagnostics: BugReportDiagnostics = collectBugReportDiagnostics()
): string {
  const description =
    redactDiagnosticText(input.description.trim()).slice(0, MAX_DESCRIPTION_LENGTH) ||
    '<!-- Describe what happened and what you expected. -->';

  const screenshotInstruction = input.screenshotIncluded
    ? 'A screenshot preview was generated in gitshaman.com. Please paste or drag it into this GitHub issue before submitting.'
    : 'No screenshot preview was available.';

  return `
## What happened?

${description}

## Screenshot

${screenshotInstruction}

## Diagnostics

- URL: ${diagnostics.cleanUrl}
- Route: ${diagnostics.route}
- Browser: ${redactDiagnosticText(diagnostics.userAgent)}
- Release: ${diagnostics.release}
- Time: ${diagnostics.timestamp}

## Recent console logs

\`\`\`text
${formatConsoleLogsForIssue(diagnostics.consoleLogs)}
\`\`\`
  `.trim();
}

export function createBugReportIssueUrl(input: BugReportIssueInput): string {
  const { owner, repo } = getIssueTarget();
  const route = typeof window === 'undefined' ? 'unknown route' : window.location.pathname;

  return newGithubIssueUrl({
    user: owner,
    repo,
    title: `Bug report: ${route}`,
    body: formatIssueBody(input),
    labels: ['bug', 'user-report'],
  });
}
