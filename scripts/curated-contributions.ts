import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_CURATED_REPOS, mergeContributions } from '../src/lib/curated-repos';
import { validateContribution, type CuratedContribution } from '../src/lib/curated-contribution';
import { validateGuideMarkdown } from './guide-validation';
import matter from 'gray-matter';

export function contributionRecords(root = process.cwd()): CuratedContribution[] {
  const directory = path.join(root, 'src/curated');
  const records = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json') && file !== 'registry.json')
    .sort()
    .map((file) => {
      if (
        !/^[a-z0-9_.-]+\.json$/.test(file) ||
        fs.lstatSync(path.join(directory, file)).isSymbolicLink()
      )
        throw new Error('Invalid contribution filename.');
      const record = validateContribution(
        JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
      );
      if (file !== `${record.owner.toLowerCase()}_${record.repo.toLowerCase()}.json`)
        throw new Error('Contribution filename must match owner_repository.json.');
      if (record.guidePath) {
        const guide = fs.readFileSync(path.join(root, record.guidePath), 'utf8');
        const errors = validateGuideMarkdown(guide).errors;
        const { data } = matter(guide);
        const builtin = BUILTIN_CURATED_REPOS.find(
          (entry) =>
            entry.owner.toLowerCase() === record.owner.toLowerCase() &&
            entry.repo.toLowerCase() === record.repo.toLowerCase()
        );
        const id =
          builtin?.id ?? `${record.owner}-${record.repo}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        if (
          errors.length ||
          data.owner !== record.owner ||
          data.repo !== record.repo ||
          data.revision !== record.revision ||
          data.guideId !== record.guideId ||
          data.curatedRepoId !== id
        )
          throw new Error(`Invalid contribution guide: ${record.guidePath}. ${errors.join('; ')}`);
      }
      return record;
    });
  const identities = records.map((record) => `${record.owner}/${record.repo}`.toLowerCase());
  if (new Set(identities).size !== records.length)
    throw new Error('Duplicate contribution repository.');
  mergeContributions(BUILTIN_CURATED_REPOS, records);
  return records;
}
export function generateContributions(root = process.cwd()): CuratedContribution[] {
  const records = contributionRecords(root);
  const output = path.join(root, 'src/curated/registry.json');
  const content = `${JSON.stringify(records, null, 2)}\n`;
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content)
    fs.writeFileSync(output, content);
  return records;
}
export async function validatePublicContributions(records: CuratedContribution[]): Promise<void> {
  for (const record of records) {
    for (const suffix of ['', `/commits/${record.revision}`]) {
      const response = await fetch(
        `https://api.github.com/repos/${record.owner}/${record.repo}${suffix}`,
        { signal: AbortSignal.timeout(20000), redirect: 'error' }
      );
      if (!response.ok)
        throw new Error(
          `Cannot publicly resolve ${record.owner}/${record.repo}${suffix} (${response.status}).`
        );
      const body = (await response.json()) as { private?: boolean; sha?: string };
      if ((!suffix && body.private !== false) || (suffix && body.sha !== record.revision))
        throw new Error('Contribution is not a public pinned commit.');
    }
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const records = generateContributions();
  if (process.argv.includes('--online')) await validatePublicContributions(records);
  console.log(`Validated ${records.length} community contribution(s).`);
}
