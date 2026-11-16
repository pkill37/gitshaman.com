interface BrowserDebugEntry {
  label: string;
  payload?: unknown;
  timestamp: string;
}

declare global {
  interface Window {
    __explorarDebugLogs?: BrowserDebugEntry[];
  }
}

const MAX_DEBUG_LOGS = 500;

function pushBrowserDebugLog(label: string, payload?: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }

  const entry: BrowserDebugEntry = {
    label,
    payload,
    timestamp: new Date().toISOString(),
  };

  const currentLogs = window.__explorarDebugLogs ?? [];
  const nextLogs =
    currentLogs.length >= MAX_DEBUG_LOGS
      ? [...currentLogs.slice(currentLogs.length - MAX_DEBUG_LOGS + 1), entry]
      : [...currentLogs, entry];

  window.__explorarDebugLogs = nextLogs;
}

export function debugLog(label: string, payload?: unknown): void {
  pushBrowserDebugLog(label, payload);
  console.debug(label, payload);
}
