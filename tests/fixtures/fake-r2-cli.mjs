#!/usr/bin/env node
// Filesystem-backed S3 stub for deployment integration tests; never uses the network.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const root = process.env.FAKE_R2_ROOT;
const audit = process.env.FAKE_R2_AUDIT;
const keyPath = (uri) => path.join(root, uri.replace(/^s3:\/\/[^/]+\//, ''));
const write = (file, contents) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};
function walk(dir, relative = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((name) => {
    const key = relative ? `${relative}/${name}` : name;
    return fs.statSync(path.join(dir, name)).isDirectory()
      ? walk(path.join(dir, name), key)
      : [key];
  });
}
if (args[0] === 's3api' && args[1] === 'head-bucket') {
  process.exit(0);
} else if (args[0] === 's3api' && args[1] === 'list-objects-v2') {
  const prefix = args[args.indexOf('--prefix') + 1];
  const dir = path.join(root, prefix);
  console.log(
    JSON.stringify(
      walk(dir).map((key) => {
        const content = fs.readFileSync(path.join(dir, key));
        return [
          prefix + key,
          content.length,
          `"${createHash('md5').update(content).digest('hex')}"`,
        ];
      })
    )
  );
} else if (args[0] === 's3' && args[1] === 'cp') {
  const [, , source, target] = args;
  if (source === '-') {
    write(keyPath(target), fs.readFileSync(0));
    fs.appendFileSync(audit, `${target.replace(/^s3:\/\/[^/]+\//, '')}\n`);
  } else if (target === '-') {
    const file = keyPath(source);
    if (!fs.existsSync(file)) {
      console.error('An error occurred (404) when calling the HeadObject operation');
      process.exit(1);
    }
    process.stdout.write(fs.readFileSync(file));
  } else if (args.includes('--recursive')) {
    for (const key of walk(source)) {
      write(path.join(keyPath(target), key), fs.readFileSync(path.join(source, key)));
      fs.appendFileSync(audit, `${key}\n`);
    }
  } else {
    throw new Error(`Unexpected cp: ${args.join(' ')}`);
  }
} else {
  throw new Error(`Unexpected AWS command: ${args.join(' ')}`);
}
