// A game saved and loaded. A save is a text: what the game was made with
// (its size, seed, lands, speed, who plays), and the whole of its state
// as it stands. Loading makes the world again from the same seed (the
// same world, tile for tile) and puts the state back on it, so the loaded
// game is the saved one exactly: played on, it goes the way the other
// would have, draw for draw (test/save.test.ts holds it to that).
//
// A save carries the version of the rules it was made under
// (SAVE_VERSION: raised whenever a change to the rules or to the state's
// shape would make an old save play differently or not at all). A save of
// another version is refused, with a message that says so: it is never
// read as if it were this one's.

import { Game, type GameOptions } from './game.ts';
import { militaryMemory, setMilitaryMemory } from './aiMilitary.ts';

export const SAVE_VERSION = 1;
const APP = 'human-craft';

export interface SaveFile {
  readonly app: typeof APP;
  readonly version: number;
  readonly turn: number;              // (for showing a save without loading it)
  readonly civ: string;
  readonly options: GameOptions;
  readonly rng: number;
  readonly state: Packed;             // the game's own fields
  readonly ai: Packed;                // what the computer civs' armies were about
}

// ---- a value packed: every object once, by number, so what is shared stays shared ----
type Enc = null | boolean | number | string | { r: number } | { x: 'undefined' | 'NaN' | 'Infinity' | '-Infinity' };
type Obj = { t: 'o'; v: Record<string, Enc> } | { t: 'a'; v: Enc[] } | { t: 'm'; v: [Enc, Enc][] } | { t: 's'; v: Enc[] } | { t: 'b'; k: string; v: string };
interface Packed { root: Enc; objs: Obj[] }

const TYPED: Record<string, new (n: number) => ArrayBufferView & ArrayLike<number> & { set(a: ArrayLike<number>): void }> = { Uint8Array, Int8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
// (A typed array as a string of numbers, runs of the same value folded: most are mostly zeros.)
const fold = (a: ArrayLike<number>): string => {
  const out: string[] = [];
  for (let i = 0; i < a.length;) {
    let j = i + 1;
    while (j < a.length && a[j] === a[i]) j++;
    out.push(j - i > 1 ? `${a[i]}x${j - i}` : String(a[i]));
    i = j;
  }
  return `${a.length}:${out.join(',')}`;
};
const unfold = (kind: string, text: string): ArrayBufferView => {
  const at = text.indexOf(':'), n = Number(text.slice(0, at)), a = new TYPED[kind]!(n);
  let i = 0;
  if (n) for (const part of text.slice(at + 1).split(',')) {
    const x = part.indexOf('x', 1), v = Number(x < 0 ? part : part.slice(0, x)), k = x < 0 ? 1 : Number(part.slice(x + 1));
    for (let j = 0; j < k; j++) (a as unknown as number[])[i++] = v;
  }
  return a;
};

function pack(root: unknown): Packed {
  const ids = new Map<object, number>(), objs: Obj[] = [];
  const enc = (v: unknown): Enc => {
    if (v === null) return null;
    if (v === undefined) return { x: 'undefined' };
    if (typeof v === 'number') return Number.isFinite(v) ? v : { x: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity' };
    if (typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'function') throw new Error('a function cannot be saved');
    const o = v as object;
    let id = ids.get(o);
    if (id !== undefined) return { r: id };
    id = objs.length;
    ids.set(o, id);
    objs.push({ t: 'a', v: [] }); // (its place kept; filled below)
    if (ArrayBuffer.isView(o)) objs[id] = { t: 'b', k: o.constructor.name, v: fold(o as unknown as ArrayLike<number>) };
    else if (Array.isArray(o)) objs[id] = { t: 'a', v: o.map(enc) };
    else if (o instanceof Map) objs[id] = { t: 'm', v: [...o].map(([k, x]) => [enc(k), enc(x)]) };
    else if (o instanceof Set) objs[id] = { t: 's', v: [...o].map(enc) };
    else objs[id] = { t: 'o', v: Object.fromEntries(Object.entries(o).map(([k, x]) => [k, enc(x)])) };
    return { r: id };
  };
  return { root: enc(root), objs };
}
function unpack(p: Packed): unknown {
  const made: unknown[] = p.objs.map((o) => (o.t === 'o' ? {} : o.t === 'a' ? [] : o.t === 'm' ? new Map() : o.t === 's' ? new Set() : unfold(o.k, o.v)));
  const dec = (e: Enc): unknown => {
    if (e === null || typeof e !== 'object') return e;
    if ('r' in e) return made[e.r];
    return e.x === 'undefined' ? undefined : e.x === 'NaN' ? NaN : e.x === 'Infinity' ? Infinity : -Infinity;
  };
  p.objs.forEach((o, i) => {
    if (o.t === 'o') { const t = made[i] as Record<string, unknown>; for (const [k, x] of Object.entries(o.v)) t[k] = dec(x); }
    else if (o.t === 'a') { const t = made[i] as unknown[]; for (const x of o.v) t.push(dec(x)); }
    else if (o.t === 'm') { const t = made[i] as Map<unknown, unknown>; for (const [k, x] of o.v) t.set(dec(k), dec(x)); }
    else if (o.t === 's') { const t = made[i] as Set<unknown>; for (const x of o.v) t.add(dec(x)); }
  });
  return dec(p.root);
}

// What a game is made again from, not saved: the world (the seed makes it) and what is not state.
const MADE = new Set(['seed', 'globe', 'tiles', 'N', 'map', 'flora', 'world', 'rng', 'options', 'onStep', 'onBattle']);

export function saveGame(g: Game): string {
  const state: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) if (!MADE.has(k)) state[k] = v;
  const file: SaveFile = { app: APP, version: SAVE_VERSION, turn: g.turn, civ: g.players[0]?.name ?? '', options: g.options, rng: g.rng.getState(), state: pack(state), ai: pack(militaryMemory(g)) };
  return JSON.stringify(file);
}

// A game's whole state as one text, by content alone (two games with the
// same text are the same game, whatever objects they happen to share):
// what the tests compare a loaded game to the saved one by.
export function digest(g: Game): string {
  const plain = (_k: string, v: unknown): unknown => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : ArrayBuffer.isView(v) ? fold(v as unknown as ArrayLike<number>) : v);
  const state: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) if (!MADE.has(k)) state[k] = v;
  return JSON.stringify({ options: g.options, rng: g.rng.getState(), state, ai: militaryMemory(g) }, plain);
}

// What a save says of itself without being loaded (null: not a save of this game at all).
export function saveInfo(text: string): { version: number; turn: number; civ: string; current: boolean } | null {
  try {
    const f = JSON.parse(text) as Partial<SaveFile>;
    if (f.app !== APP || typeof f.version !== 'number') return null;
    return { version: f.version, turn: f.turn ?? 0, civ: f.civ ?? '', current: f.version === SAVE_VERSION };
  } catch { return null; }
}

// Puts a saved value back on the game's own: arrays of numbers and typed
// arrays in place (the world's own views of them stay the same objects),
// maps and sets refilled, lists of things replaced whole.
function restore(g: Record<string, unknown>, k: string, v: unknown): void {
  const cur = g[k];
  const flat = (a: unknown): a is unknown[] => Array.isArray(a) && a.every((x) => x === null || typeof x !== 'object');
  if (ArrayBuffer.isView(cur) && ArrayBuffer.isView(v)) (cur as unknown as { set(a: unknown): void }).set(v);
  else if (Array.isArray(cur) && Array.isArray(v) && cur.length === v.length && cur.length > 0 && cur.every((x) => ArrayBuffer.isView(x))) cur.forEach((x, i) => (x as unknown as { set(a: unknown): void }).set(v[i]));
  else if (Array.isArray(cur) && Array.isArray(v) && (flat(v) || true)) { cur.length = 0; for (const x of v) cur.push(x); }
  else if (cur instanceof Map && v instanceof Map) { cur.clear(); for (const [a, b] of v) cur.set(a, b); }
  else if (cur instanceof Set && v instanceof Set) { cur.clear(); for (const a of v) cur.add(a); }
  else g[k] = v;
}

export function loadGame(text: string): Game {
  let f: SaveFile;
  try { f = JSON.parse(text) as SaveFile; } catch { throw new Error('This is not a saved game.'); }
  if (f.app !== APP) throw new Error('This is not a saved game.');
  if (f.version !== SAVE_VERSION) throw new Error(`This game was saved under version ${f.version} of the rules; this is version ${SAVE_VERSION}. It cannot be loaded.`);
  const g = new Game(f.options);
  const state = unpack(f.state) as Record<string, unknown>, own = g as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(state)) restore(own, k, v);
  g.rng.setState(f.rng);
  setMilitaryMemory(g, unpack(f.ai));
  return g;
}
