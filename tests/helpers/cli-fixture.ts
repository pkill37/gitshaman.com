import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, initialize, readConfig, writeJson } from '../../packages/cli/src/repository';

export function cliFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshaman-cli-'));
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'cli-test@example.invalid']);
  git(root, ['config', 'user.name', 'CLI Test']);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(
    path.join(root, 'src/auth.ts'),
    "import { verifyToken } from './token';\nexport function authenticate(token: string) {\n  return verifyToken(token);\n}\n"
  );
  fs.writeFileSync(
    path.join(root, 'src/token.ts'),
    'export function verifyToken(token: string) {\n  return token.length > 0;\n}\n'
  );
  fs.writeFileSync(
    path.join(root, 'README.md'),
    '# Example\n\nAuthentication and token verification.\n'
  );
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
  initialize(root);
  const config = readConfig(root);
  config.analysis.enrichment = 'off';
  writeJson(path.join(root, 'gitshaman.json'), config);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'Initial fixture']);
  git(root, ['remote', 'add', 'origin', 'https://github.com/example/fixture.git']);
  return root;
}
