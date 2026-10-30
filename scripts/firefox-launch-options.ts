import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Keep macOS Firefox app data separate from the user's protected Firefox data. */
export function firefoxLaunchOptions(env: Record<string, string | undefined> = process.env) {
  const browserEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
  if (process.platform === 'darwin') {
    // HOME alone does not redirect the macOS CoreFoundation app-data lookup.
    // Workaround for https://github.com/microsoft/playwright/issues/42768.
    const home = fileURLToPath(new URL('../out/firefox-home/', import.meta.url));
    mkdirSync(home, { recursive: true });
    browserEnv.CFFIXED_USER_HOME = home;
  }
  return { env: browserEnv };
}
