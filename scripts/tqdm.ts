export function fmtDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export async function runPhase(
  label: string,
  fn: () => Promise<void> | void,
  details?: string
): Promise<void> {
  const startedAt = Date.now();
  console.log(`\n${label}${details ? ` — ${details}` : ''}`);
  await fn();
  console.log(`done: ${label} (${fmtDuration(Date.now() - startedAt)})`);
}
