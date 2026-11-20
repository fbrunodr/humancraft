import { describe, it, expect } from 'vitest';
import { TECHS, TECH_KEYS } from '../src/techs.ts';
import { POLITICS, POLITICS_KEYS } from '../src/politics.ts';

// The research and politics trees as graphs (techs.ts, politics.ts): an
// item names what it needs, and no more than it must. If a needs b and b
// needs c, a does not also name c: it rests on it already, and the line
// from c to a would only clutter the tree's drawing (sheets.ts).

// The links a tree does not need: `need>item` where the item already rests
// on that need through another of its needs.
function redundantLinks(keys: readonly string[], needs: (k: string) => readonly string[]): string[] {
  const all = new Map<string, Set<string>>();
  const under = (k: string): Set<string> => {
    let s = all.get(k);
    if (!s) {
      s = new Set();
      all.set(k, s);
      for (const n of needs(k)) { s.add(n); for (const a of under(n)) s.add(a); }
    }
    return s;
  };
  const out: string[] = [];
  for (const k of keys) for (const n of needs(k)) if (needs(k).some((m) => m !== n && under(m).has(n))) out.push(`${n}>${k}`);
  return out;
}

const TREES = [
  { name: 'research', keys: TECH_KEYS as readonly string[], needs: (k: string): readonly string[] => TECHS[k as keyof typeof TECHS].needs },
  { name: 'politics', keys: POLITICS_KEYS as readonly string[], needs: (k: string): readonly string[] => POLITICS[k as keyof typeof POLITICS].needs },
];

describe.each(TREES)('the $name tree', ({ keys, needs }) => {
  it('names no need an item already rests on through another', () => {
    expect(redundantLinks(keys, needs)).toEqual([]);
  });

  // (The check itself: a link put in where an item's need has a need of its own is found.)
  it('would find such a link', () => {
    const item = keys.find((k) => needs(k).some((n) => needs(n).length > 0))!;
    const parent = needs(item).find((n) => needs(n).length > 0)!, grand = needs(parent)[0]!;
    const more = (k: string) => (k === item ? [...needs(k), grand] : needs(k));
    expect(redundantLinks(keys, more)).toContain(`${grand}>${item}`);
  });

  it('needs only items that exist, and none in a ring', () => {
    const seen = new Set<string>(), open = new Set<string>();
    const visit = (k: string): void => {
      expect(keys).toContain(k);
      expect(open.has(k), `${k} needs itself`).toBe(false);
      if (seen.has(k)) return;
      open.add(k);
      needs(k).forEach(visit);
      open.delete(k);
      seen.add(k);
    };
    keys.forEach(visit);
  });
});
