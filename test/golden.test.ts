// The rules' version is raised when the rules change: a save made under a
// version plays on under it the same for good. Held by a saved game kept
// with its fingerprint (test/golden.ts): if it no longer plays out to the
// same state, the map, the rules or the state's shape changed, and saves
// already out there would load wrong. Then: raise RULES_VERSION in
// src/version.ts and run `npx tsx scripts/golden.ts` (the old file stays,
// the record of that version).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SAVE_VERSION, saveInfo } from '../src/save.ts';
import { goldenPath, goldenPrint } from './golden.ts';

describe('SV2: a version of the rules plays its saves the same for good', () => {
  it(`the saved game of version ${SAVE_VERSION} still plays out to the state it did`, () => {
    const path = goldenPath(SAVE_VERSION);
    expect(existsSync(path), `No saved game for version ${SAVE_VERSION}: run npx tsx scripts/golden.ts`).toBe(true);
    const { print, save } = JSON.parse(readFileSync(path, 'utf8')) as { print: string; save: string };
    expect(saveInfo(save)?.version).toBe(SAVE_VERSION);
    expect(goldenPrint(save), 'The rules, the map or the state changed: old saves would load wrong. Raise RULES_VERSION and set RELEASE to 0 (src/version.ts), then run npx tsx scripts/golden.ts').toBe(print);
  });
});
