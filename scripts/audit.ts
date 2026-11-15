// What the computer civs actually do with the game, to find what is
// never used or goes wrong: whole games of a level against itself, and
// counts of what was built, fought with, left idle or hoarded.
//   npx tsx scripts/audit.ts [--games 4] [--level <index of LEVELS>] [--speed quick]

import { Game } from '../src/game.ts';
import { unitDef, UNITS, BUILDINGS, DEFAULT_SPEED, domainOf, type UnitKey, type GameSpeedKey, type MapSizeKey } from '../src/rules.ts';
import { LEVELS } from '../src/aiPolicy.ts';
import { WONDER_KEYS, USE } from '../src/cities.ts';
import { TECHS, type TechKey } from '../src/techs.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const GAMES = Number(arg('games', '4')), level = LEVELS[Number(arg('level', String(LEVELS.length - 1)))]!, speed = arg('speed', DEFAULT_SPEED) as GameSpeedKey, size = arg('size', 'small') as MapSizeKey;
const built = new Map<string, number>(), lostBy = new Map<string, number>(), kills = new Map<string, number>(), attacks = new Map<string, number>();
const count = new Map<string, number>();
const add = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
let idleCityTurns = 0, cityTurns = 0, goldEnd: number[] = [], faithEnd: number[] = [], improvedShare: number[] = [], wonders = 0, civs = 0, techSpread: number[] = [];
const unlockedEver = new Set<string>();

for (let k = 0; k < GAMES; k++) {
  const g = new Game({ size, seed: 6000 + k, policies: Array.from({ length: 12 }, () => level.policy), speed });
  for (const p of g.players) p.isHuman = false;
  while (!g.winner && g.turn <= g.turnLimit + 1) {
    g.endTurn();
    if (g.turn % 5 === 0) for (const c of g.cities) { cityTurns++; if (!c.building) idleCityTurns++; }
  }
  for (const e of g.events) {
    add(count, e.kind);
    if (e.kind === 'built' || e.kind === 'bought') add(built, String(e.data['item']));
    if (e.kind === 'attack') { add(attacks, String(e.data['unit'])); if ((e.data['defenderHp'] as number[])[1] === 0) add(kills, String(e.data['unit'])); }
    if (e.kind === 'unitLost') add(lostBy, String(e.data['unit']));
  }
  for (const p of g.players) {
    if (!p.alive) continue;
    civs++;
    goldEnd.push(p.gold); faithEnd.push(p.faith);
    for (const t of p.techs) { const d = TECHS[t as TechKey]; for (const u of d.units ?? []) unlockedEver.add(u); for (const b of d.buildings ?? []) unlockedEver.add(b); }
    let worked = 0, improved = 0;
    for (let t = 0; t < g.N; t++) { if (g.isWater(t) || g.ownerOf(t) !== p.id || g.use[t] !== USE.rural) continue; worked++; if (g.builtAt(t) !== null && !g.pillaged[t]) improved++; }
    if (worked) improvedShare.push(improved / worked);
  }
  wonders += [...g.wondersBuilt.values()].filter((t) => t >= 0).length;
  const alive = g.players.filter((p) => p.alive).map((p) => p.techs.size);
  techSpread.push(Math.max(...alive) - Math.min(...alive));
}
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN);
const per = (n: number) => (n / GAMES).toFixed(1);
console.log(`\n${level.name} against itself, ${GAMES} ${speed} games on ${size} maps\n`);
const units = (Object.keys(UNITS) as UnitKey[]).filter((u) => !unitDef(u).civilian && u !== 'commander');
const byDomain = (d: string) => units.filter((u) => domainOf(unitDef(u)) === d);
for (const d of ['land', 'sea', 'air']) {
  console.log(`${d} units built a game (attacks, kills, lost):`);
  console.log('  ' + byDomain(d).map((u) => `${u} ${per(built.get(u) ?? 0)}${attacks.get(u) ? ` (${per(attacks.get(u)!)}, ${per(kills.get(u) ?? 0)}, ${per(lostBy.get(u) ?? 0)})` : ''}`).join(' · '));
  const never = byDomain(d).filter((u) => !(built.get(u) ?? 0) && unlockedEver.has(u));
  console.log(`  NEVER BUILT though unlocked: ${never.join(', ') || 'none'}`);
}
console.log(`civilians a game: settler ${per(built.get('settler') ?? 0)}, worker ${per(built.get('worker') ?? 0)}, commander ${per(built.get('commander') ?? 0)}, missionaries ${per(built.get('missionary') ?? 0)}`);
const bs = Object.keys(BUILDINGS);
console.log(`buildings never built though unlocked: ${bs.filter((b) => !(built.get(b) ?? 0) && unlockedEver.has(b)).join(', ') || 'none'}`);
console.log(`buildings a game: ${bs.map((b) => `${b} ${per(built.get(b) ?? 0)}`).join(' · ')}`);
console.log(`wonders built a game: ${per(wonders)} of ${WONDER_KEYS.length}; never built: ${WONDER_KEYS.filter((w) => !(built.get(w) ?? 0)).join(', ') || 'none'}`);
console.log(`cities with nothing in production: ${Math.round(100 * idleCityTurns / Math.max(1, cityTurns))}% of city-turns`);
console.log(`at the end, a civ: gold ${med(goldEnd)} (median; most ${Math.max(...goldEnd)}), faith ${med(faithEnd)} (most ${Math.max(...faithEnd)}); its cities' worked land improved ${Math.round(100 * med(improvedShare))}%; techs between first and last alive: ${med(techSpread)}`);
console.log(`events a game: ${[...count].filter(([k]) => !['move', 'turn', 'summary', 'attack', 'unitCreated', 'built', 'researched', 'cityGrew'].includes(k)).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${per(n)}`).join(' · ')}`);
