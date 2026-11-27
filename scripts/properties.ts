// How the game is played at its best: whole games between computer civs
// all deciding by the strongest level (src/aiLevels.json), measured against
// the properties we want the best play to have. The rules are ours to
// change: when the best play is not the game we mean, the rules are wrong,
// not the players. Run after every breeding (scripts/train.ts):
//   npx tsx scripts/properties.ts [--games 10] [--size small] [--speed quick] [--level <index of LEVELS>]

import { Game } from '../src/game.ts';
import { unitDef, DEFAULT_SPEED, GAME_SPEEDS, type MapSizeKey, type GameSpeedKey } from '../src/rules.ts';
import { LEVELS } from '../src/aiPolicy.ts';
import { TECHS } from '../src/techs.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const speed = arg('speed', DEFAULT_SPEED) as GameSpeedKey;
const GAMES = Number(arg('games', '10')), size = arg('size', 'small') as MapSizeKey, level = LEVELS[Number(arg('level', String(LEVELS.length - 1)))]!;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => `${Math.round(100 * x)}%`;

const won = new Map<string, number>();
const length: number[] = [], winnerCities: number[] = [], allCities: number[] = [], firstWar: number[] = [], wars: number[] = [], captured: number[] = [], eliminated: number[] = [];
const wonders: number[] = [], buildings: number[] = [], founders: number[] = [], capitals: number[] = [], faithTop: number[] = [], techTop: number[] = [];
let crippled = 0, winnersWithFaith = 0, arrears = 0, civTurns = 0, needRes = 0, army = 0;
const warBy = { same: 0, rival: 0, none: 0 }, exposure = { same: 0, rival: 0, none: 0 };
// (The same, by how near the two are: a faith spreads to those nearest, who are also those most fought, so same-faith pairs are compared with others as near.)
type Faiths = 'same' | 'rival' | 'none';
const BANDS = [[0, 5], [6, 9], [10, 14]] as const;
const bandWars = BANDS.map(() => ({ same: 0, rival: 0, none: 0 })), bandPairs = BANDS.map(() => ({ same: 0, rival: 0, none: 0 }));
const gap = (g: Game, a: number, b: number): number => g.cities.reduce((m, x) => (x.owner !== a ? m : g.cities.reduce((n, y) => (y.owner === b ? Math.min(n, g.approxDist(x.tile, y.tile)) : n), m)), 99);
const faiths = (g: Game, a: number, b: number): Faiths => { const x = g.faithOf(a), y = g.faithOf(b); return !x || !y ? 'none' : x === y ? 'same' : 'rival'; };
// (And a pair's first war apart from its later ones: a war won leaves the victor holding the other's cities, and their faith with them.)
const firstWars = { same: 0, rival: 0, none: 0 }, freshPairs = { same: 0, rival: 0, none: 0 };
// (And like with like: pairs as near, at the same time of the game. Early on no one has a faith and no one fights; later both are common. Within each stretch of thirty turns and each distance, the wars a kind of pair would have had were faith nothing to it, against those it had.)
const strata = new Map<string, { wars: Record<Faiths, number>; pairs: Record<Faiths, number> }>();
const stratum = (turn: number, i: number) => { const k = `${Math.floor(turn / 30)}|${i}`; let x = strata.get(k); if (!x) strata.set(k, x = { wars: { same: 0, rival: 0, none: 0 }, pairs: { same: 0, rival: 0, none: 0 } }); return x; };
const band = (d: number): number => BANDS.findIndex(([lo, hi]) => d >= lo && d <= hi);
const t0 = Date.now();

for (let k = 0; k < GAMES; k++) {
  const g = new Game({ size, seed: 5000 + k, policies: Array.from({ length: 12 }, () => level.policy), speed });
  for (const p of g.players) p.isHuman = false;
  const peak = g.players.map(() => 0);
  const fighting = new Set<string>(), fought = new Set<string>();
  while (!g.winner && g.turn <= g.turnLimit + 1) {
    // (What each pair's faiths were going into the turn: a war is counted by what they were when it was declared.)
    const before = new Map<string, Faiths>();
    for (const p of g.players) for (const o of g.players) if (o.id > p.id && p.alive && o.alive) before.set(`${p.id}-${o.id}`, faiths(g, p.id, o.id));
    g.endTurn();
    for (const [key, f] of before) {
      const [a, b] = key.split('-').map(Number) as [number, number];
      const now = g.atWar(a, b);
      if (now && !fighting.has(key)) { const i = band(gap(g, a, b)); if (i >= 0) { bandWars[i]![f]++; stratum(g.turn, i).wars[f]++; } if (!fought.has(key)) firstWars[f]++; fought.add(key); }
      if (now) fighting.add(key); else fighting.delete(key);
    }
    g.players.forEach((p, i) => { peak[i] = Math.max(peak[i]!, g.cities.filter((c) => c.owner === p.id).length); });
    if (g.turn % 10) continue;
    for (const p of g.players) {
      if (!p.alive) continue;
      civTurns++;
      if (p.arrears > 0) arrears++;
      for (const u of g.units) if (u.owner === p.id && !unitDef(u.type).civilian) { army++; if (unitDef(u.type).needs) needRes++; }
      for (const o of g.players) {
        if (o.id <= p.id || !o.alive || !g.met[p.id]![o.id] || g.atWar(p.id, o.id)) continue;
        // (Neighbours only: civs fight those in reach, and a faith spreads to those near, so the chance to compare with is that of a pair within reach.)
        if (!g.cities.some((a) => a.owner === p.id && g.cities.some((b) => b.owner === o.id && g.approxDist(a.tile, b.tile) <= 14))) continue;
        const f = faiths(g, p.id, o.id), i = band(gap(g, p.id, o.id));
        exposure[f]++;
        if (i >= 0) { bandPairs[i]![f]++; stratum(g.turn, i).pairs[f]++; }
        if (!fought.has(`${p.id}-${o.id}`)) freshPairs[f]++;
      }
    }
  }
  const w = g.winner;
  capitals.push(Math.max(...g.players.map((p) => g.capitalsHeld(p.id))) / g.players.length);
  faithTop.push(Math.max(...g.players.map((p) => (p.stateReligion ? g.followers(p.stateReligion).share : 0))));
  techTop.push(Math.max(...g.players.map((p) => p.techs.size)));
  won.set(w?.how ?? 'none', (won.get(w?.how ?? 'none') ?? 0) + 1);
  length.push(g.turn);
  const cities = (id: number) => g.cities.filter((c) => c.owner === id).length;
  if (w) { winnerCities.push(cities(w.player)); if ([...g.religions.values()].some((f) => f.founder === w.player)) winnersWithFaith++; }
  for (const p of g.players) if (p.alive) allCities.push(cities(p.id));
  const warEvents = g.events.filter((e) => e.kind === 'war');
  wars.push(warEvents.length);
  if (warEvents.length) firstWar.push(warEvents[0]!.turn);
  for (const e of warEvents) warBy[(e.data['faiths'] as 'same' | 'rival' | 'none') ?? 'none']++;
  captured.push(g.events.filter((e) => e.kind === 'cityCaptured').length);
  eliminated.push(g.players.filter((p) => !p.alive).length);
  if (g.players.some((p, i) => peak[i]! >= 3 && cities(p.id) <= (2 * peak[i]!) / 3)) crippled++;
  for (const p of g.players) {
    if (!p.alive) continue;
    wonders.push([...g.wondersBuilt.values()].filter((t) => t >= 0 && g.ownerOf(t) === p.id).length);
    const cs = g.cities.filter((c) => c.owner === p.id);
    if (cs.length) buildings.push(cs.reduce((s, c) => s + c.buildings.size, 0) / cs.length);
  }
  founders.push(new Set([...g.religions.values()].map((f) => f.founder)).size / g.players.length);
}

const share = (o: { same: number; rival: number; none: number }, k: 'same' | 'rival' | 'none') => o[k] / Math.max(1, o.same + o.rival + o.none);
const lean = (k: 'same' | 'rival' | 'none') => (share(exposure, k) > 0 ? (share(warBy, k) / share(exposure, k)).toFixed(2) : '–');
const rows: [string, string, string][] = [
  ['How games are won', [...won].map(([h, n]) => `${h} ${n}`).join(', ') + `; ${mean(length).toFixed(0)} turns on average`, 'every way of winning shows up'],
  ['How near each victory comes', `the leader in each, at the game's end: ${pct(mean(capitals))} of the first capitals (conquest: two thirds), ${pct(mean(faithTop))} of the world's people in its faith (religion: 67%), ${mean(techTop).toFixed(0)} of ${Object.keys(TECHS).length} techs (science: the last)`, 'each within reach in some games'],
  ['Compact and wide can both win', `winners hold ${Math.min(...winnerCities)}–${Math.max(...winnerCities)} cities (median ${median(winnerCities)}); all civs ${Math.min(...allCities)}–${Math.max(...allCities)} (median ${median(allCities)})`, 'winners spread over a wide range'],
  ['Expanding past what can be paid loses', `${pct(arrears / Math.max(1, civTurns))} of a civ's turns in arrears`, 'rare: the best play pays its way'],
  ['Wars are frequent, from the first eras', `${mean(wars).toFixed(1)} wars a game; the first at turn ${median(firstWar)} (median)`, 'several a game; the first before turn 60'],
  ['Wars decide things', `${mean(captured).toFixed(1)} cities taken a game; ${mean(eliminated).toFixed(1)} civs wiped out; a civ lost a third of its cities in ${pct(crippled / GAMES)} of games`, 'cities change hands in every game'],
  ['Faith binds and divides, among pairs as near', BANDS.map(([lo, hi], i) => {
    const w = bandWars[i]!, e = bandPairs[i]!, rate = (k: Faiths) => (e[k] > 0 ? ((10 * w[k]) / e[k]) : 0);
    const others = (w.rival + w.none) / Math.max(1, e.rival + e.none) * 10;
    return `${lo}–${hi} tiles apart: same faith ×${others > 0 ? (rate('same') / others).toFixed(2) : '–'} the others' rate (${w.same} wars of ${w.same + w.rival + w.none})`;
  }).join('; '), 'under 1 at every distance'],
  ['Faith binds and divides, like with like', (() => {
    const seen = { same: 0, rival: 0, none: 0 }, due = { same: 0, rival: 0, none: 0 };
    for (const x of strata.values()) {
      const wars = x.wars.same + x.wars.rival + x.wars.none, pairs = x.pairs.same + x.pairs.rival + x.pairs.none;
      if (!pairs) continue;
      for (const k of ['same', 'rival', 'none'] as const) { seen[k] += x.wars[k]; due[k] += (wars * x.pairs[k]) / pairs; }
    }
    const r = (k: Faiths) => (due[k] > 0 ? (seen[k] / due[k]).toFixed(2) : '–');
    return `wars against those due at the same time and distance: same faith ×${r('same')} (${seen.same} of ${due.same.toFixed(1)} due), rival ×${r('rival')} (${seen.rival} of ${due.rival.toFixed(1)}), faithless ×${r('none')} (${seen.none} of ${due.none.toFixed(1)})`;
  })(), 'same under 1, rival over 1'],
  ['Faith binds and divides, the first war of a pair', (() => {
    const lean1 = (k: Faiths) => (share(freshPairs, k) > 0 ? (share(firstWars, k) / share(freshPairs, k)).toFixed(2) : '–');
    return `against chance among pairs that have not fought: same faith ×${lean1('same')}, rival ×${lean1('rival')}, faithless ×${lean1('none')} (${firstWars.same}/${firstWars.rival}/${firstWars.none} wars)`;
  })(), 'same under 1'],
  ['Faith binds and divides', `wars against chance: same faith ×${lean('same')}, rival faiths ×${lean('rival')}, a faithless side ×${lean('none')} (${warBy.same}/${warBy.rival}/${warBy.none} wars)`, 'same well under 1, rival over 1, faithless about 1'],
  ['Religion helps, is not required', `${pct(mean(founders))} of civs found one; ${winnersWithFaith} of ${winnerCities.length} winners had`, 'winners with and without'],
  ['Strong play builds wonders and buildings', `${mean(wonders).toFixed(1)} wonders a civ; ${mean(buildings).toFixed(1)} buildings a city`, 'more than none of each'],
  ['Strategic resources shape armies', `${pct(needRes / Math.max(1, army))} of units need one`, 'a fifth or more'],
];
console.log(`\nThe game as ${level.name} plays it against itself: ${GAMES} ${GAME_SPEEDS[speed].name} games on ${size} maps (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
for (const [what, now, want] of rows) console.log(`${what}\n    now:    ${now}\n    wanted: ${want}\n`);
