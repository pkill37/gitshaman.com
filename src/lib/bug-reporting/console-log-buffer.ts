'use client';

type ConsoleLogLevel = 'debug' | 'error' | 'info' | 'log' | 'warn';

export type ConsoleLogEntry = {
  level: ConsoleLogLevel;
  message: string;
  timestamp: string;
};

const MAX_CONSOLE_LOGS = 30;
const MAX_LOG_MESSAGE_LENGTH = 800;
const patchedFlag = Symbol.for('explorar.bugReporting.consolePatched');
const logLevels: ConsoleLogLevel[] = ['debug', 'error', 'info', 'log', 'warn'];
const consoleLogs: ConsoleLogEntry[] = [];

type PatchableConsole = Console & {
  [patchedFlag]?: boolean;
};

declare global {
  interface Window {
    __explorarBugReportConsoleCaptureReady?: boolean;
    __explorarBugReportConsoleLogs?: ConsoleLogEntry[];
  }
}

function sanitizeLogValue(value: unknown): string {
  if (value instanceof Error) {
    return [value.name, value.message, value.stack].filter(Boolean).join(': ');
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(
      /(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)=([^&\s]+)/gi,
      '$1=[REDACTED]'
    )
    .replace(/```/g, "'''");
}

function pushConsoleLog(level: ConsoleLogLevel, values: unknown[]): void {
  const message = redactDiagnosticText(values.map(sanitizeLogValue).join(' ')).slice(
    0,
    MAX_LOG_MESSAGE_LENGTH
  );

  consoleLogs.push({
    level,
    message,
    timestamp: new Date().toISOString(),
  });

  if (consoleLogs.length > MAX_CONSOLE_LOGS) {
    consoleLogs.splice(0, consoleLogs.length - MAX_CONSOLE_LOGS);
  }
}

export function installConsoleLogCapture(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const targetConsole = console as PatchableConsole;
  if (targetConsole[patchedFlag]) {
    window.__explorarBugReportConsoleCaptureReady = true;
    window.__explorarBugReportConsoleLogs = consoleLogs;
    return;
  }

  targetConsole[patchedFlag] = true;
  window.__explorarBugReportConsoleCaptureReady = true;
  window.__explorarBugReportConsoleLogs = consoleLogs;

  for (const level of logLevels) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      pushConsoleLog(level, values);
      original(...values);
    };
  }
}

export function getConsoleLogs(): ConsoleLogEntry[] {
  if (typeof window !== 'undefined' && window.__explorarBugReportConsoleLogs) {
    return [...window.__explorarBugReportConsoleLogs];
  }

  return [...consoleLogs];
}

export function formatConsoleLogsForIssue(entries: ConsoleLogEntry[]): string {
  if (entries.length === 0) {
    return 'No console logs were captured.';
  }

  return entries
    .map((entry) => `- ${entry.timestamp} [${entry.level}] ${redactDiagnosticText(entry.message)}`)
    .join('\n');
}
