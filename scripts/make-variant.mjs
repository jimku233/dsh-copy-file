/**
 * Write (or check) the `icon/` package's `lib/` from the root package's `lib/`.
 *
 * Usage:
 *   node scripts/make-variant.mjs            # regenerate
 *   node scripts/make-variant.mjs --check    # exit 1 when out of date
 *
 * @module dsh-copy-file/scripts/make-variant
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FILES, variantOf } from './variant.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icon', 'lib');
const checkOnly = process.argv.includes('--check');

let stale = 0;
for (const name of FILES) {
  const source = readFileSync(path.join(ROOT, 'lib', name), 'utf8');
  const expected = variantOf(name, source);
  const target = path.join(OUT, name);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current === expected) continue;
  stale += 1;
  if (checkOnly) {
    console.error(`stale: icon/lib/${name} (run: node scripts/make-variant.mjs)`);
    continue;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(target, expected, 'utf8');
  console.log(`wrote icon/lib/${name}`);
}

if (checkOnly) {
  if (stale > 0) process.exit(1);
  console.log('icon/lib is current.');
} else {
  console.log(stale === 0 ? 'icon/lib already current.' : `updated ${stale} file(s).`);
}
