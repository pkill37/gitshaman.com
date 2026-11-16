import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** Keep macOS Firefox app data separate from the user's protected Firefox data. */
export function firefoxLaunchOptions(env: Record<string, string | undefined> = process.env) {
  const browserEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
  if (process.platform === 'darwin') {
    // HOME alone does not redirect the macOS CoreFoundation app-data lookup.
    // Workaround for https://github.com/microsoft/playwright/issues/42768.
    // Keep browser-managed macOS directories outside Next's build output.
    // Firefox may add privacy ACLs to Documents/Downloads that prevent
    // Next from removing out/ during the next production build.
    const home =
      env.GITSHAMAN_FIREFOX_HOME?.trim() || path.join(process.cwd(), '.cache', 'firefox-home');
    mkdirSync(home, { recursive: true });
    browserEnv.CFFIXED_USER_HOME = home;
  }
  return { env: browserEnv };
}
