import { spawnSync } from 'node:child_process';
import { CURATED_REPOS } from '../src/lib/curated-repos';
import { generateContributions, validatePublicContributions } from './curated-contributions';
import { readR2Env, runAwsSync } from './deploy-r2';

const records = generateContributions();
const repositories = CURATED_REPOS.filter((repo) => repo.contribution);
if (records.length) {
  if (process.argv[2] === 'build') {
    await validatePublicContributions(records);
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = spawnSync(
      command,
      [
        '--no-install',
        'tsx',
        'scripts/download-repos.ts',
        `--only=${repositories.map((repo) => `${repo.owner}/${repo.repo}`).join(',')}`,
        '--depth=1',
      ],
      { stdio: 'inherit' }
    );
    if (result.error || result.status !== 0) throw new Error('Community corpus build failed.');
  } else if (process.argv[2] === 'deploy') {
    await runAwsSync(readR2Env(), {
      repositories,
      manifestKey: 'deployments/community-corpus.json',
    });
    const hook = process.env.CLOUDFLARE_PAGES_DEPLOY_HOOK;
    if (!hook || new URL(hook).protocol !== 'https:')
      throw new Error('Configure CLOUDFLARE_PAGES_DEPLOY_HOOK with an HTTPS deploy hook.');
    const response = await fetch(hook, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(`Cloudflare Pages deployment trigger failed (${response.status}).`);
    console.log('Community corpus published; Cloudflare Pages deployment triggered.');
  } else throw new Error('Usage: community-publish.ts build|deploy');
} else console.log('No community contributions to publish.');
