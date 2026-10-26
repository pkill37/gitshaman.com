import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { BUILTIN_CURATED_REPOS, mergeContributions } from '../../../src/lib/curated-repos';
import {
  validateContribution,
  type CuratedContribution,
} from '../../../src/lib/curated-contribution';
import { validateGuideMarkdown } from '../../../scripts/guide-validation';
import { currentGeneration } from './analysis';
import { CLI_VERSION, STATE, git, readConfig, readJson, sha256, writeJson } from './repository';

const UPSTREAM = 'pkill37/gitshaman.com';
export type ShareOptions = {
  source?: string;
  name?: string;
  description?: string;
  slug?: string;
  guide?: string;
  dryRun?: boolean;
  noOpen?: boolean;
};
export type Github = {
  publicGet: (endpoint: string) => Promise<Record<string, unknown>>;
  gh: (args: string[], input?: unknown) => unknown;
};
export const github: Github = {
  async publicGet(endpoint) {
    const response = await fetch(`https://api.github.com/${endpoint}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        `Public GitHub lookup failed (HTTP ${response.status}). The repository and commit must be publicly accessible; check the API rate limit if necessary.`
      );
    return (await response.json()) as Record<string, unknown>;
  },
  gh(args, input) {
    try {
      const result = execFileSync('gh', args, {
        encoding: 'utf8',
        input: input === undefined ? undefined : JSON.stringify(input),
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
        timeout: 60_000,
      });
      try {
        return JSON.parse(result) as unknown;
      } catch {
        return result.trim();
      }
    } catch {
      throw new Error(
        `GitHub CLI operation failed (${args.slice(0, 2).join(' ')}). Install gh, run gh auth login, and check repository access. Rerun share to resume.`
      );
    }
  },
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Unexpected GitHub response.');
  return value as Record<string, unknown>;
}
function sourceIdentity(root: string, explicit?: string): string {
  if (explicit) {
    if (
      !/^[a-z\d-]+\/[\w.-]+$/i.test(explicit) ||
      explicit.split('/').some((part) => ['.', '..'].includes(part))
    )
      throw new Error('--source must be owner/repository.');
    return explicit;
  }
  const names = git(root, ['remote']).trim().split('\n').filter(Boolean);
  const sources = names.flatMap((name) => {
    const url = git(root, ['remote', 'get-url', name]).trim();
    const match = url.match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w-]+\/[\w.-]+?)(?:\.git)?$/
    );
    return match ? [{ name, identity: match[1] }] : [];
  });
  const origin = sources.find((entry) => entry.name === 'origin');
  if (origin) return origin.identity;
  const unique = [...new Set(sources.map((entry) => entry.identity))];
  if (unique.length !== 1)
    throw new Error('Cannot select a GitHub source. Pass --source owner/repository.');
  return unique[0];
}

export async function prepareShare(
  root: string,
  options: ShareOptions,
  api: Github = github
): Promise<{
  record: CuratedContribution;
  files: Record<string, string>;
  title: string;
  body: string;
}> {
  const { snapshot } = currentGeneration(root);
  const config = readConfig(root);
  if (
    !snapshot.committed ||
    snapshot.commit !== git(root, ['rev-parse', 'HEAD']).trim() ||
    JSON.stringify(snapshot.settings) !== JSON.stringify(config.analysis)
  ) {
    throw new Error(
      'Sharing requires analysis of the current committed snapshot. Run gitshaman analyze --committed.'
    );
  }
  const identity = sourceIdentity(root, options.source);
  const metadata = await api.publicGet(`repos/${identity}`);
  if (metadata.private !== false) throw new Error('Only public GitHub repositories can be shared.');
  const commit = await api.publicGet(`repos/${identity}/commits/${snapshot.commit}`);
  if (commit.sha !== snapshot.commit)
    throw new Error(
      'The analyzed commit is not publicly available. Push it to the public source repository first.'
    );
  const canonical = String(metadata.full_name ?? identity).split('/');
  const [owner, repo] = canonical;
  const existing = BUILTIN_CURATED_REPOS.find(
    (entry) => `${entry.owner}/${entry.repo}`.toLowerCase() === `${owner}/${repo}`.toLowerCase()
  );
  const record = validateContribution({
    version: 1,
    owner,
    repo,
    revision: snapshot.commit,
    slug:
      options.slug ??
      existing?.slug ??
      `${owner}-${repo}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    displayName: options.name ?? existing?.displayName ?? repo,
    description:
      options.description ??
      String(
        metadata.description ||
          `Explore the source, symbols, and relationships of ${owner}/${repo}.`
      ),
    analyzerVersion: CLI_VERSION,
    sourceFingerprint: snapshot.signature,
    analysis: snapshot.settings,
    summary: {
      fileCount: snapshot.stats.fileCount,
      symbolCount: snapshot.stats.symbolCount,
      edgeCount: snapshot.stats.edgeCount,
      truncatedFileCount: snapshot.stats.truncatedFileCount,
    },
    capabilities: snapshot.capabilities.map((entry) => ({
      language: String(entry.language),
      feature: String(entry.feature),
      provider: String(entry.provider),
      status: String(entry.status),
    })),
  });
  const files: Record<string, string> = {};
  if (options.guide) {
    const content = fs.readFileSync(path.resolve(options.guide), 'utf8');
    if (Buffer.byteLength(content) > 256_000) throw new Error('Guide exceeds 256 KiB.');
    const validation = validateGuideMarkdown(content);
    if (validation.errors.length)
      throw new Error(`Guide validation failed: ${validation.errors.join('; ')}`);
    const { data } = matter(content);
    const id = existing?.id ?? `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (
      data.owner !== owner ||
      data.repo !== repo ||
      data.revision !== snapshot.commit ||
      data.curatedRepoId !== id ||
      typeof data.guideId !== 'string' ||
      !data.name ||
      !data.description
    ) {
      throw new Error(
        'Guide frontmatter must match the source owner, repo, commit, curatedRepoId, and include guideId/name/description.'
      );
    }
    record.guideId = data.guideId;
    record.guidePath = `docs/${owner}_${repo}.md`;
    validateContribution(record);
    files[record.guidePath] = content;
  }
  mergeContributions(BUILTIN_CURATED_REPOS, [record]);
  const filename = `src/curated/${owner.toLowerCase()}_${repo.toLowerCase()}.json`;
  files[filename] = `${JSON.stringify(record, null, 2)}\n`;
  const title = `Curate ${owner}/${repo} at ${snapshot.commit.slice(0, 12)}`;
  const body =
    `Add or refresh [${owner}/${repo}](https://github.com/${owner}/${repo}/tree/${snapshot.commit}) in the free GitShaman collection.\n\n` +
    `- Commit: ${snapshot.commit}\n- Analyzer: ${CLI_VERSION}\n- Source fingerprint: ${snapshot.signature}\n- Files: ${record.summary.fileCount}; symbols: ${record.summary.symbolCount}; relationships: ${record.summary.edgeCount}\n- Enrichment: ${record.analysis.enrichment}; relationships may be approximate.\n- Guide: ${record.guidePath ?? 'Generated overview'}\n- Public route: https://gitshaman.com/${record.slug}/\n\n` +
    `This PR contributes a reproducible recipe and summary. GitShaman rebuilds structural indexes after review and merge, uploads the corpus, then deploys the website. Local vectors, credentials, and conversations are not included.\n`;
  return { record, files, title, body };
}

export async function share(
  root: string,
  options: ShareOptions,
  api: Github = github
): Promise<Record<string, unknown>> {
  const prepared = await prepareShare(root, options, api);
  if (options.dryRun) return { dryRun: true, upstream: UPSTREAM, ...prepared };
  api.gh(['auth', 'status']);
  const user = object(api.gh(['api', 'user']));
  const login = String(user.login);
  if (!/^[\w-]+$/.test(login)) throw new Error('Invalid GitHub account response.');
  const upstream = object(api.gh(['api', `repos/${UPSTREAM}`]));
  const base = String(upstream.default_branch);
  const baseRef = object(
    api.gh(['api', `repos/${UPSTREAM}/git/ref/heads/${encodeURIComponent(base)}`])
  );
  const baseSha = String(object(baseRef.object).sha);
  const commit = object(api.gh(['api', `repos/${UPSTREAM}/git/commits/${baseSha}`]));
  const treeSha = String(object(commit.tree).sha);
  const tree = object(api.gh(['api', `repos/${UPSTREAM}/git/trees/${treeSha}?recursive=1`]));
  if (tree.truncated) throw new Error('Upstream tree is too large to validate safely.');
  const entries = tree.tree as Array<{ path: string; sha: string; type: string }>;
  const records: CuratedContribution[] = [];
  for (const entry of entries.filter(
    (entry) =>
      /^src\/curated\/[^/]+\.json$/.test(entry.path) && !entry.path.endsWith('/registry.json')
  )) {
    const blob = object(api.gh(['api', `repos/${UPSTREAM}/git/blobs/${entry.sha}`]));
    records.push(
      validateContribution(JSON.parse(Buffer.from(String(blob.content), 'base64').toString('utf8')))
    );
  }
  const existing = records.find(
    (entry) =>
      `${entry.owner}/${entry.repo}`.toLowerCase() ===
      `${prepared.record.owner}/${prepared.record.repo}`.toLowerCase()
  );
  if (existing && existing.slug !== prepared.record.slug && !options.slug) {
    return share(root, { ...options, slug: existing.slug }, api);
  }
  if (existing && existing.slug !== prepared.record.slug)
    throw new Error('An existing curated repository must keep its slug.');
  if (
    existing?.revision === prepared.record.revision &&
    !options.guide &&
    JSON.stringify(existing.analysis) === JSON.stringify(prepared.record.analysis)
  )
    return { unchanged: true, url: `https://gitshaman.com/${existing.slug}/` };
  if (!existing) {
    const builtin = BUILTIN_CURATED_REPOS.find(
      (entry) =>
        `${entry.owner}/${entry.repo}`.toLowerCase() ===
        `${prepared.record.owner}/${prepared.record.repo}`.toLowerCase()
    );
    if (builtin?.revision === prepared.record.revision && !options.guide)
      return { unchanged: true, url: `https://gitshaman.com/${builtin.slug}/` };
  }
  mergeContributions(BUILTIN_CURATED_REPOS, [
    ...records.filter((entry) => entry !== existing),
    prepared.record,
  ]);
  api.gh(['repo', 'fork', UPSTREAM, '--clone=false', '--remote=false']);
  const fork = `${login}/gitshaman.com`;
  const forkMeta = object(api.gh(['api', `repos/${fork}`]));
  if (object(forkMeta.parent).full_name !== UPSTREAM)
    throw new Error('The existing fork name belongs to a different repository.');
  const branch = `gitshaman-share/${prepared.record.owner.toLowerCase()}-${prepared.record.repo.toLowerCase()}`;
  const digest = sha256(JSON.stringify(prepared.files));
  const stateFile = path.join(root, STATE, 'share.json');
  let saved: { digest?: string; url?: string } = {};
  if (fs.existsSync(stateFile)) saved = readJson(stateFile);
  const prs = api.gh([
    'pr',
    'list',
    '--repo',
    UPSTREAM,
    '--head',
    `${login}:${branch}`,
    '--state',
    'open',
    '--json',
    'number,url',
  ]) as Array<{ number: number; url: string }>;
  if (!Array.isArray(prs)) throw new Error('Unexpected PR list response.');
  if (saved.digest === digest && prs[0]) return { unchanged: true, url: prs[0].url };
  const newTree = object(
    api.gh(['api', '--method', 'POST', `repos/${fork}/git/trees`, '--input', '-'], {
      base_tree: treeSha,
      tree: Object.entries(prepared.files).map(([file, content]) => ({
        path: file,
        mode: '100644',
        type: 'blob',
        content,
      })),
    })
  );
  const newCommit = object(
    api.gh(['api', '--method', 'POST', `repos/${fork}/git/commits`, '--input', '-'], {
      message: prepared.title,
      tree: newTree.sha,
      parents: [baseSha],
    })
  );
  // Only update a branch created by this command; never touch a source-repository ref.
  let refExists = false;
  try {
    api.gh(['api', `repos/${fork}/git/ref/heads/${encodeURIComponent(branch)}`]);
    refExists = true;
  } catch {
    /* First contribution branch. */
  }
  if (refExists)
    api.gh(
      [
        'api',
        '--method',
        'PATCH',
        `repos/${fork}/git/refs/heads/${encodeURIComponent(branch)}`,
        '--input',
        '-',
      ],
      { sha: newCommit.sha, force: true }
    );
  else
    api.gh(['api', '--method', 'POST', `repos/${fork}/git/refs`, '--input', '-'], {
      ref: `refs/heads/${branch}`,
      sha: newCommit.sha,
    });
  const bodyFile = path.join(root, STATE, 'share-pr.md');
  fs.writeFileSync(bodyFile, prepared.body);
  let url: string;
  if (prs[0]) {
    api.gh([
      'pr',
      'edit',
      String(prs[0].number),
      '--repo',
      UPSTREAM,
      '--title',
      prepared.title,
      '--body-file',
      bodyFile,
    ]);
    url = prs[0].url;
  } else
    url = String(
      api.gh([
        'pr',
        'create',
        '--repo',
        UPSTREAM,
        '--base',
        base,
        '--head',
        `${login}:${branch}`,
        '--title',
        prepared.title,
        '--body-file',
        bodyFile,
      ])
    );
  writeJson(stateFile, { digest, url, branch, commit: newCommit.sha });
  return { url, branch };
}
