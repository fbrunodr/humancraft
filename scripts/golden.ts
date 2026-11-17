// Writes the saved game the rules are held to, and its fingerprint
// (test/golden.ts), for the version of the rules as it stands:
//   npx tsx scripts/golden.ts
// Run after raising RULES_VERSION (src/version.ts), never to quiet the test
// once a version is out: a published version's file is never written again.
import { existsSync, writeFileSync } from 'node:fs';
import { SAVE_VERSION } from '../src/save.ts';
import { goldenPath, goldenPrint, goldenSave } from '../test/golden.ts';

const path = goldenPath(SAVE_VERSION), force = process.argv.includes('--force');
if (existsSync(path) && !force) { console.error(`${path.pathname} is there already. A version that is out is never rewritten: raise RULES_VERSION (src/version.ts). (Before it is out: --force.)`); process.exit(1); }
const save = goldenSave(), print = goldenPrint(save);
writeFileSync(path, JSON.stringify({ print, save }));
console.log(`version ${SAVE_VERSION}: ${(save.length / 1024).toFixed(0)} KB, fingerprint ${print.slice(0, 16)}…`);
