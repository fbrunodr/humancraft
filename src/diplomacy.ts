// Diplomacy: what a civ thinks of another, and what it does about it.
//
// Nothing here is left to emerge from the rules of war or trade: a civ's
// opinion of another is a sum of named reasons, each with its weight, that
// the Diplomacy sheet shows line by line (Civ IV's way). Two things are
// weighed, apart:
//
//   regard   how well it likes the other, from Hateful to Ally: the sum
//            of what it holds for and against it. A shared state religion,
//            kindred ways, open borders, a pact, years of peace, gifts, a
//            war fought on the same side, a vote in the United Nations
//            count for; a rival creed, close borders, a war declared, a
//            truce broken, cities taken or razed, a demand refused, a war
//            on a friend count against. What happened is remembered
//            (MEMOS) and fades with the turns; what holds now counts
//            while it holds.
//   power    how the other compares with it, from Pathetic to
//            Overwhelming: its army, production, learning and income, in
//            the five ranks anyone who has met a civ can see.
//
// Its mood toward the other is read from the two together (MOODS: Hateful
// of a weaker neighbour, it is Predatory; of a stronger one, Bitter), and
// so are its acts: whom it plans a war on, whether it signs a deal (the
// odds: how the deal balances for it, against what its regard asks),
// whom it opens its borders to or swears to defend, whom it votes for.
import { PATHS, PATH_KEYS, pathLevels } from './identity.ts';
import { religionDef } from './religion.ts';
import { resourceDef, type ResourceKey } from './resources.ts';
import { techDef, TECH_KEYS, type TechKey } from './techs.ts';
import { BUILDINGS } from './cities.ts';
import { DEAL_TURNS, between, isLasting, type Item, type Offer } from './deals.ts';
import { power as armyPower, resourceWorth, aiAcceptsPeace, warlike, RANKS, type Rank } from './ai.ts';
import type { Game, Player, City } from './game.ts';

// ---------- what is remembered ----------

// Each thing a civ remembers of another: what one instance adds to its
// regard (`each`), the most it comes to (`most`), and how many turns a
// point of it takes to fade (`fade`). (`text`: as the civ would say it to
// the other.)
export interface MemoDef { readonly each: number; readonly most: number; readonly fade: number; readonly text: string }
export const MEMOS = {
  declaredWar:   { each: -4,    most: -8,  fade: 15, text: 'You declared war on us' },
  brokeTruce:    { each: -3,    most: -6,  fade: 20, text: 'You broke a truce with us' },
  betrayed:      { each: -6,    most: -8,  fade: 25, text: 'You turned on us while a treaty stood between us' },
  tookCity:      { each: -2,    most: -6,  fade: 20, text: 'You took our cities' },
  razed:         { each: -3,    most: -6,  fade: 25, text: 'You razed a city of ours' },
  nuked:         { each: -8,    most: -12, fade: 30, text: 'You used nuclear weapons on us' },
  borderFlip:    { each: -0.5,  most: -2,  fade: 10, text: 'Your culture takes our land' },
  warOnFriend:   { each: -2,    most: -4,  fade: 15, text: 'You declared war on our friends' },
  demandRefused: { each: -2,    most: -4,  fade: 12, text: 'You refused what we asked of you' },
  preachedRival: { each: -1,    most: -3,  fade: 12, text: 'Your missionaries stir up our people with a rival creed' },
  votedAgainst:  { each: -2,    most: -4,  fade: 20, text: 'You voted against us in the United Nations' },
  peace:         { each: 0.025, most: 3,   fade: 1e9, text: 'Years of peace between us' },
  trade:         { each: 0.05,  most: 3,   fade: 20, text: 'Our trade has been fair and steady' },
  gift:          { each: 1,     most: 4,   fade: 12, text: 'You were generous to us' },
  demandMet:     { each: 1,     most: 2,   fade: 15, text: 'You gave us what we asked' },
  sharedWar:     { each: 0.1,   most: 4,   fade: 20, text: 'We fought the same enemy' },
  joinedWar:     { each: 3,     most: 4,   fade: 20, text: 'You went to war at our asking' },
  converted:     { each: 2,     most: 2,   fade: 30, text: 'You took up our faith at our asking' },
  preachedOurs:  { each: 1,     most: 3,   fade: 15, text: 'Your missionaries spread our faith' },
  votedFor:      { each: 3,     most: 6,   fade: 20, text: 'You voted for us in the United Nations' },
  liberated:     { each: 4,     most: 6,   fade: 30, text: 'You gave us back a city of ours' },
} as const satisfies Record<string, MemoDef>;
export type MemoKey = keyof typeof MEMOS;
export const MEMO_KEYS = Object.keys(MEMOS) as MemoKey[];
export type Memos = Partial<Record<MemoKey, number>>;

// ---------- regard ----------

export const REGARDS = ['Hateful', 'Hostile', 'Cautious', 'Friendly', 'Ally'] as const;
export type RegardLevel = 0 | 1 | 2 | 3 | 4;
// (The sum at which each level begins: to -8 Hateful, to -3 Hostile, under 3 Cautious, under 8 Friendly, from 8 Ally.)
export const REGARD_CUTS = [-8, -3, 3, 8] as const;
export const regardLevel = (total: number): RegardLevel => (total <= REGARD_CUTS[0] ? 0 : total <= REGARD_CUTS[1] ? 1 : total < REGARD_CUTS[2] ? 2 : total < REGARD_CUTS[3] ? 3 : 4);
export const FRIENDLY: RegardLevel = 3;

export interface Reason { readonly text: string; readonly value: number }
export interface Regard { readonly total: number; readonly level: RegardLevel; readonly reasons: readonly Reason[] }

// What two civs made of each other when they met: a point for, a point against, or nothing (the seed's draw; the same both ways).
function firstImpression(g: Game, a: number, b: number): number {
  let h = (g.seed ^ Math.imul(Math.min(a, b) + 1, 0x9e3779b1) ^ Math.imul(Math.max(a, b) + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) % 3 - 1;
}
// How near two civs' cities lie (tiles; 99: one has none).
const gaps = new WeakMap<Game, { key: string; of: Map<number, number> }>();
function gap(g: Game, a: number, b: number): number {
  const key = `${g.turn}|${g.cities.length}`;
  let c = gaps.get(g);
  if (!c || c.key !== key) gaps.set(g, c = { key, of: new Map() });
  const id = Math.min(a, b) * 64 + Math.max(a, b), had = c.of.get(id);
  if (had !== undefined) return had;
  let d = 99;
  for (const x of g.cities) if (x.owner === a) for (const o of g.cities) if (o.owner === b) d = Math.min(d, g.approxDist(x.tile, o.tile));
  c.of.set(id, d);
  return d;
}
// (A civ's fighting strength, reckoned once a turn.)
const armies = new WeakMap<Game, { key: string; of: number[] }>();
function army(g: Game, id: number): number {
  const key = `${g.turn}|${g.units.length}`;
  let c = armies.get(g);
  if (!c || c.key !== key) armies.set(g, c = { key, of: [] });
  return c.of[id] ??= armyPower(g, id);
}

const cache = new WeakMap<Game, { key: string; of: Map<number, Regard> }>();
// How civ `of` regards civ `toward`: the sum, its level, and every reason with its weight.
export function regard(g: Game, of: number, toward: number): Regard {
  const key = `${g.turn}|${g.diploVersion}|${g.memoVersion}|${g.faithVersion}|${g.cities.length}|${g.deals.length}`;
  let c = cache.get(g);
  if (!c || c.key !== key) cache.set(g, c = { key, of: new Map() });
  const id = of * 64 + toward, had = c.of.get(id);
  if (had) return had;
  const A = g.players[of]!, B = g.players[toward]!;
  const reasons: Reason[] = [];
  const add = (text: string, value: number): void => { const v = Math.round(value * 10) / 10; if (v !== 0) reasons.push({ text, value: v }); };

  add('First impressions', firstImpression(g, of, toward));
  if (!A.isHuman && warlike(g, A)) add('We are a warlike people, slow to trust', -1);
  // Their ways: the paths of identity both walk, and those of one that the other walks the opposite of.
  const la = pathLevels(A.identity), lb = pathLevels(B.identity);
  const kin = PATH_KEYS.filter((k) => la[k] > 0 && lb[k] > 0), odds = PATH_KEYS.filter((k) => la[k] > 0 && lb[PATHS[k].opposite] > 0);
  if (kin.length) add(`Kindred ways: we are both ${kin.slice(0, 3).map((k) => PATHS[k].epithet).join(', ')}`, Math.min(3, kin.length));
  if (odds.length) add(`Your ${odds.slice(0, 3).map((k) => PATHS[PATHS[k].opposite].epithet).join(', ')} ways sit ill with ours`, -Math.min(3, odds.length));
  // The states' religions.
  const ra = A.stateReligion, rb = B.stateReligion;
  if (ra && rb) add(ra === rb ? `We share the faith of ${religionDef(ra).name}` : `You follow ${religionDef(rb).name}: a rival creed to ours`, ra === rb ? 4 : -3);
  if (ra) {
    const holy = g.religions.get(ra)?.holyCity, seat = holy != null ? g.cityById.get(holy) : undefined;
    if (seat && seat.owner === toward) add(ra === rb ? 'You keep the holy city of our faith' : 'You hold the holy city of our faith', ra === rb ? 1 : -2);
  }
  if (A.government === B.government && A.government !== 'chiefdom') add('Our governments are alike', 1);
  // The land between them.
  const d = gap(g, of, toward);
  if (d <= 7) add('Our close borders spark tensions', d <= 4 ? -2 : -1);
  const held = g.cities.filter((x) => x.founder === of && x.owner === toward).length;
  if (held) add(`You hold ${held === 1 ? 'a city' : `${held} cities`} that ${held === 1 ? 'was' : 'were'} ours`, -Math.min(6, 2 * held));
  // What stands between them now.
  if (g.atWar(of, toward)) add('We are at war', -4);
  const ob = g.deals.find((t) => between(t, of, toward) && t.give.some((i) => i.k === 'openBorders'));
  if (ob) add('Our borders are open to each other', g.turn - ob.since >= 30 ? 2 : 1);
  if (g.pact(of, toward)) add('We are sworn to defend each other', 3);
  // Whose side they are on.
  for (const o of g.players) {
    if (!o.alive || o.id === of || o.id === toward) continue;
    if (g.atWar(of, o.id) && g.pact(toward, o.id)) add(`You are sworn to defend our enemies, the ${o.name}`, -2);
    if (g.atWar(toward, o.id) && g.pact(of, o.id)) add(`You make war on the ${o.name}, whom we are sworn to defend`, -3);
  }
  // Their rise.
  if (g.turn > 60 * g.pace) {
    const x = (g.score(toward) + 1) / (g.score(of) + 1);
    if (x > 1.5) add('Your rise overshadows us', x > 2 ? -2 : -1);
  }
  // And what is remembered.
  const m = g.memos[of]?.[toward] ?? {};
  for (const k of MEMO_KEYS) if (m[k]) add(MEMOS[k].text, m[k]!);

  const total = Math.round(reasons.reduce((s, r) => s + r.value, 0) * 10) / 10;
  const out: Regard = { total, level: regardLevel(total), reasons };
  c.of.set(id, out);
  return out;
}

// ---------- power ----------

// How civ `toward` compares with civ `of`, as `of` sees it: each measure
// in the five ranks (theirs over its own), and all in one (the army half
// of it, production and learning a fifth each, income the rest).
const RANK_CUTS = [0.5, 0.8, 1.25, 2] as const;
export const rankOf = (theirs: number, mine: number): Rank => { const x = (theirs + 1) / (mine + 1); return (RANK_CUTS.findIndex((c) => x < c) + 5) % 5 as Rank; };
export interface Power { readonly rank: Rank; readonly army: Rank; readonly tech: Rank; readonly prod: Rank; readonly gold: Rank }
export function powerOf(g: Game, of: number, toward: number): Power {
  const A = g.players[of]!, B = g.players[toward]!;
  const r = (theirs: number, mine: number) => (theirs + 1) / (mine + 1);
  const arm = r(army(g, toward), army(g, of)), tech = r(B.techs.size, A.techs.size), prod = r(B.ledger.income.prod, A.ledger.income.prod), gold = r(B.ledger.income.gold, A.ledger.income.gold);
  const all = arm ** 0.5 * prod ** 0.2 * tech ** 0.2 * gold ** 0.1;
  const rank = (x: number): Rank => (RANK_CUTS.findIndex((c) => x < c) + 5) % 5 as Rank;
  return { rank: rank(all), army: rank(arm), tech: rank(tech), prod: rank(prod), gold: rank(gold) };
}

// ---------- mood ----------

// A civ's mood toward another: its regard (rows, Hateful to Ally)
// against the other's power beside its own (columns, Pathetic to
// Overwhelming).
export const MOODS = {
  predatory:   { name: 'Predatory',   tells: 'It hates you and thinks you weak: it looks for its moment to strike, and will demand what it can.' },
  belligerent: { name: 'Belligerent', tells: 'It hates you and thinks itself your match: a quarrel away from war.' },
  bitter:      { name: 'Bitter',      tells: 'It hates you and knows you the stronger: it will not strike alone, and will side with anyone against you.' },
  threatening: { name: 'Threatening', tells: 'It dislikes you and thinks you the weaker: it presses you, and may go further.' },
  unfriendly:  { name: 'Unfriendly',  tells: 'It dislikes you. Deals come dear, and its borders stay shut.' },
  guarded:     { name: 'Guarded',     tells: 'It dislikes you but respects your strength: cold, and careful.' },
  fearful:     { name: 'Fearful',     tells: 'You are much the stronger, and it does not trust you: it gives way rather than provoke you.' },
  dismissive:  { name: 'Dismissive',  tells: 'You are weak and it owes you nothing: easy prey, should it want land.' },
  aloof:       { name: 'Aloof',       tells: 'It has no quarrel with you, and no bond; it thinks itself the stronger.' },
  neutral:     { name: 'Neutral',     tells: 'It has no quarrel with you, and no bond.' },
  wary:        { name: 'Wary',        tells: 'It has no quarrel with you, and watches your strength.' },
  protective:  { name: 'Protective',  tells: 'It likes you and knows you the weaker: it would rather see you stand than fall.' },
  cordial:     { name: 'Cordial',     tells: 'It likes you: fair deals, open borders, and no thought of war.' },
  respectful:  { name: 'Respectful',  tells: 'It likes you and respects your strength.' },
  deferential: { name: 'Deferential', tells: 'It likes you and you are much the stronger: it follows your lead.' },
  loyal:       { name: 'Loyal',       tells: 'It stands with you: it will swear to defend you, and vote for you.' },
  admiring:    { name: 'Admiring',    tells: 'It stands with you and looks up to you.' },
} as const satisfies Record<string, { name: string; tells: string }>;
export type Mood = keyof typeof MOODS;
const MOOD_TABLE: readonly (readonly Mood[])[] = [
  ['predatory', 'predatory', 'belligerent', 'bitter', 'bitter'],
  ['threatening', 'threatening', 'unfriendly', 'guarded', 'fearful'],
  ['dismissive', 'aloof', 'neutral', 'wary', 'fearful'],
  ['protective', 'cordial', 'cordial', 'respectful', 'deferential'],
  ['protective', 'loyal', 'loyal', 'admiring', 'admiring'],
];
export const moodOf = (level: RegardLevel, rank: Rank): Mood => MOOD_TABLE[level]![rank]!;
export const mood = (g: Game, of: number, toward: number): Mood => moodOf(regard(g, of, toward).level, powerOf(g, of, toward).rank);
// How much its regard for a civ moves it to a war on it (times its appetite: ai.ts): none on a friend.
export const WAR_BY_REGARD = [1.8, 1.35, 1, 0.12, 0] as const;
// Whether civ o is a threat to `toward`, as anyone can read it: it dislikes it, is no weaker, and lies near.
export const threatens = (g: Game, o: number, toward: number): boolean =>
  !g.atWar(o, toward) && regard(g, o, toward).level <= 1 && powerOf(g, o, toward).rank <= 2 && gap(g, o, toward) <= 14;

// ---------- what a deal is worth ----------

// Everything is weighed in gold: gold itself, and a turn of anything
// lasting as HORIZON turns of it (not all thirty: a promise is worth less
// than gold in hand).
const HORIZON = 20;
export function cityWorth(g: Game, c: City): number {
  let b = 0;
  for (const k of c.buildings) b += BUILDINGS[k].cost;
  return 80 + 30 * c.pop + 0.5 * b + 150 * g.cityWonders(c).length;
}
// What civ `to` does not know of the map that `from` does (tiles).
export function mapNews(g: Game, from: number, to: number): number {
  const a = g.known[from]!, b = g.known[to]!;
  let n = 0;
  for (let t = 0; t < g.N; t++) if (a[t] && !b[t]) n++;
  return n;
}
// What getting item i from civ `from` is worth to p.
export function gainOf(g: Game, p: Player, i: Item, from: number): number {
  switch (i.k) {
    case 'gold': return i.n;
    case 'goldPerTurn': return i.n * HORIZON;
    case 'resource': return resourceWorth(g, p, i.resource) * HORIZON;
    case 'tech': return 0.7 * g.techCost(i.tech);
    case 'map': return Math.min(150, 0.25 * mapNews(g, from, p.id));
    case 'city': { const c = g.cityById.get(i.city); return c ? cityWorth(g, c) : 0; }
    // (A war it is in itself, joined: much. On a civ it merely dislikes: a little.)
    case 'warOn': return g.atWar(p.id, i.civ) ? 120 : regard(g, p.id, i.civ).level <= 1 ? 40 : 5;
    case 'peaceWith': return g.pact(p.id, i.civ) || regard(g, p.id, i.civ).level >= FRIENDLY ? 40 : 5;
    case 'convert': return i.religion === p.stateReligion ? 60 : 0;
    case 'openBorders': return 15;
    case 'pact': return g.players.some((o) => o.alive && o.id !== p.id && o.id !== from && threatens(g, o.id, p.id)) ? 80 : 25;
    case 'embargo': return g.atWar(p.id, i.civ) || regard(g, p.id, i.civ).level <= 1 ? 40 : 5;
  }
}
// Why p would not give item i to civ `to` whatever it was offered (null: it has its price).
export function refusal(g: Game, p: Player, i: Item, to: number, peace = false): string | null {
  const L = regard(g, p.id, to).level;
  switch (i.k) {
    case 'tech': return L < 2 ? 'We do not share what we know with those we mistrust.' : null;
    case 'map': return L < 2 ? 'We do not show our maps to those we mistrust.' : null;
    case 'city': return peace && powerOf(g, p.id, to).army >= 3 ? null : 'Our cities are not for sale.';
    case 'warOn': {
      if (regard(g, p.id, i.civ).level >= FRIENDLY) return `The ${g.players[i.civ]!.name} are our friends.`;
      if (powerOf(g, p.id, i.civ).army >= 3) return `The ${g.players[i.civ]!.name} are too strong for us.`;
      return g.players.some((o) => o.alive && g.atWar(p.id, o.id)) ? 'We have a war on our hands already.' : null;
    }
    case 'peaceWith': return aiAcceptsPeace(g, p, i.civ) ? null : `We mean to finish our war with the ${g.players[i.civ]!.name}.`;
    case 'convert': return L < FRIENDLY ? 'Our faith is not for sale.' : g.foundedBy(p.id)?.religion === p.stateReligion && p.stateReligion !== null ? 'We founded our faith: we keep it.' : null;
    case 'openBorders': return L < 2 ? 'We do not open our borders to those we mistrust.' : null;
    case 'pact': return L < FRIENDLY ? 'We swear to defend only our friends.' : null;
    case 'embargo': return regard(g, p.id, i.civ).level >= FRIENDLY ? `The ${g.players[i.civ]!.name} are our friends.` : null;
    default: return null;
  }
}
// What giving item i to civ `to` costs p.
export function costOf(g: Game, p: Player, i: Item, to: number): number {
  const pw = powerOf(g, p.id, to);
  switch (i.k) {
    case 'gold': return i.n;
    case 'goldPerTurn': return i.n * HORIZON;
    // (Its spares cost it little; a strategic one to a civ stronger than itself, more.)
    case 'resource': return (resourceDef(i.resource).kind === 'strategic' && pw.army >= 3 ? 3 : 1) * HORIZON;
    // (What it knows is its lead: dearer to a rival near or past it in learning.)
    case 'tech': return g.techCost(i.tech) * (pw.tech >= 2 ? 0.7 : 0.45);
    case 'map': return 10 + 0.05 * mapNews(g, p.id, to);
    case 'city': { const c = g.cityById.get(i.city); return c ? 0.6 * cityWorth(g, c) : 0; }
    case 'warOn': { const x = powerOf(g, p.id, i.civ).army, dislike = [0.5, 0.75, 1, 3, 9][regard(g, p.id, i.civ).level]!; return 150 * [0.5, 0.7, 1, 1.6, 2.8][x]! * dislike; }
    case 'peaceWith': return 60;
    case 'convert': { const now = g.stateWorth(p.id, p.stateReligion), then = g.stateWorth(p.id, i.religion); return 40 + 20 * Math.max(0, now.culture + now.cohesion - then.culture - then.cohesion) + (g.conversionCosts(p) ? 5 * Math.max(4, p.ledger.income.cohesion) : 0); }
    // (A friend's armies are welcome; a stranger's are a risk, a stronger stranger's the more.)
    case 'openBorders': return regard(g, p.id, to).level >= FRIENDLY ? 5 : pw.army >= 3 ? 20 : 8;
    case 'pact': return g.players.some((o) => o.alive && o.id !== p.id && o.id !== to && threatens(g, o.id, to)) ? 60 : 20;
    case 'embargo': return 15 + 4 * HORIZON * g.deals.filter((t) => between(t, p.id, i.civ)).length;
  }
}

// How an offer stands with the civ it is made to: what it would get and
// give, as it weighs them; the balance of the two (-1: all loss, 1: all
// gain); what its regard for the proposer asks the balance to be (a
// friend signs a fair deal, an enemy wants much the better of it); and
// the chance it signs. (`why`: a thing in it it will not give at any price.)
export interface Verdict { readonly gets: number; readonly gives: number; readonly balance: number; readonly asks: number; readonly chance: number; readonly why: string | null }
const ASKS = [0.6, 0.35, 0.15, 0.03, -0.1] as const;
export function weigh(g: Game, o: Offer): Verdict {
  const p = g.players[o.to]!, L = regard(g, o.to, o.from).level, asks = ASKS[L];
  for (const i of o.get) { const why = refusal(g, p, i, o.from, o.peace === true); if (why) return { gets: 0, gives: Infinity, balance: -1, asks, chance: 0, why }; }
  let gets = o.give.reduce((s, i) => s + gainOf(g, p, i, o.from), 0), gives = o.get.reduce((s, i) => s + costOf(g, p, i, o.from), 0);
  // (The peace itself: worth much to a civ that wants out of the war, a loss to one that means to go on.)
  if (o.peace) { if (aiAcceptsPeace(g, p, o.from)) gets += 80; else gives += 200; }
  // (Nothing asked of it: a gift is taken.)
  if (gives === 0) return { gets, gives, balance: 1, asks, chance: 1, why: null };
  const balance = (gets - gives) / Math.max(gets, gives, 1);
  const x = 1 / (1 + Math.exp(-(balance - asks) / 0.1));
  return { gets, gives, balance, asks, chance: x > 0.97 ? 1 : x < 0.03 ? 0 : Math.round(x * 100) / 100, why: null };
}
// The draw an offer between two civs is answered by this turn: one draw a
// pair a turn, so asking again the same turn changes nothing, and a
// better offer does.
export function dealRoll(g: Game, from: number, to: number): number {
  let h = (g.seed ^ Math.imul(g.turn + 1, 0x9e3779b1) ^ Math.imul(from + 1, 0x85ebca6b) ^ Math.imul(to + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Whether a computer civ signs an offer made to it.
export const aiAnswers = (g: Game, o: Offer): boolean => g.offerBlock(o) === null && dealRoll(g, o.from, o.to) < weigh(g, o).chance;

// What a deal signed leaves in the two civs' memories of each other: a
// gift (much more given than got, as the taker weighs it) is remembered
// by the taker.
export function noteDeal(g: Game, o: Offer): void {
  const forTo = o.give.reduce((s, i) => s + gainOf(g, g.players[o.to]!, i, o.from), 0) - o.get.reduce((s, i) => s + costOf(g, g.players[o.to]!, i, o.from), 0);
  const forFrom = o.get.reduce((s, i) => s + gainOf(g, g.players[o.from]!, i, o.to), 0) - o.give.reduce((s, i) => s + costOf(g, g.players[o.from]!, i, o.to), 0);
  const size = (x: number) => Math.min(3, Math.floor(x / 60));
  if (o.demand) { g.remember(o.from, o.to, 'demandMet'); return; }
  if (!o.get.length && forTo >= 60) g.remember(o.to, o.from, 'gift', size(forTo));
  if (!o.give.length && forFrom >= 60) g.remember(o.from, o.to, 'gift', size(forFrom));
}

// ---------- what the computer's civs propose ----------

const lasting = (from: number, to: number, give: Item[], get: Item[]): Offer => ({ from, to, give, get });
// The techs civ a could pass to civ b: those b lacks and could research now.
export function techsFor(g: Game, a: number, b: number): TechKey[] {
  const A = g.players[a]!, B = g.players[b]!;
  return TECH_KEYS.filter((k) => A.techs.has(k) && !B.techs.has(k) && techDef(k).needs.every((n) => B.techs.has(n)));
}
// A computer civ's dealings for the turn: now and then, with each civ it
// may deal with, the first of these that fits and is signed (to the
// player: an offer to answer, one a turn at most).
//   goods            a spare resource for one of theirs, or for gold a turn
//   open borders     with a civ it does not mistrust
//   a pact           with a friend, when either is threatened
//   what they know   a technology for a technology, between friends
//   help in a war    a friend asked to join it, for gold
//   an embargo       a friend asked to stop trading with its enemy
//   a demand         gold, of a weaker civ it dislikes
export function aiDeals(g: Game, p: Player): void {
  if (g.rng() > 0.3) return;
  const atWar = g.players.some((o) => o.alive && g.atWar(p.id, o.id));
  const foes = g.players.filter((o) => o.alive && g.atWar(p.id, o.id));
  for (const o of g.players) {
    if (o.id === p.id || !o.alive || !g.met[p.id]![o.id] || g.atWar(p.id, o.id)) continue;
    if (o.isHuman && (g.rng() > 0.35 || g.dealOffers.length)) continue;
    const L = regard(g, p.id, o.id).level, pw = powerOf(g, p.id, o.id);
    const tries: Offer[] = [];
    if (g.canTrade(p.id, o.id)) {
      const byWorth = (to: Player) => (a: ResourceKey, b: ResourceKey) => resourceWorth(g, to, b) - resourceWorth(g, to, a);
      const give = g.tradeable(p.id, o.id).sort(byWorth(o))[0], get = g.tradeable(o.id, p.id).sort(byWorth(p))[0];
      const wantGet = get !== undefined && resourceWorth(g, p, get) >= 2;
      if (give && wantGet) tries.push(lasting(p.id, o.id, [{ k: 'resource', resource: give }], [{ k: 'resource', resource: get }]));
      else if (give) tries.push(lasting(p.id, o.id, [{ k: 'resource', resource: give }], [{ k: 'goldPerTurn', n: Math.max(1, resourceWorth(g, o, give) - 2) }]));
      else if (wantGet) { const pay = Math.max(1, Math.floor(resourceWorth(g, p, get) / 2)); if (pay <= g.goldRate(p.id) / 3) tries.push(lasting(p.id, o.id, [{ k: 'goldPerTurn', n: pay }], [{ k: 'resource', resource: get }])); }
      if (L >= 2 && !g.openBorders(p.id, o.id) && g.turn > 15 && g.rng() < 0.4) tries.push(lasting(p.id, o.id, [{ k: 'openBorders' }], [{ k: 'openBorders' }]));
      if (L >= FRIENDLY && !g.pact(p.id, o.id) && !atWar && !g.players.some((x) => x.alive && g.atWar(o.id, x.id))
        && g.players.some((x) => x.alive && x.id !== p.id && x.id !== o.id && (threatens(g, x.id, p.id) || threatens(g, x.id, o.id)))) tries.push(lasting(p.id, o.id, [{ k: 'pact' }], [{ k: 'pact' }]));
      if (L >= FRIENDLY) {
        const mine = techsFor(g, p.id, o.id), theirs = techsFor(g, o.id, p.id);
        const t = theirs.sort((a, b) => g.techCost(b) - g.techCost(a))[0];
        const m = t ? mine.filter((k) => g.techCost(k) >= 0.6 * g.techCost(t)).sort((a, b) => g.techCost(a) - g.techCost(b))[0] : undefined;
        if (t && m) tries.push({ from: p.id, to: o.id, give: [{ k: 'tech', tech: m }], get: [{ k: 'tech', tech: t }] });
      }
      for (const x of foes) {
        if (L < FRIENDLY || x.id === o.id || !g.met[o.id]![x.id]) continue;
        if (!g.atWar(o.id, x.id) && p.gold >= 60) tries.push({ from: p.id, to: o.id, give: [{ k: 'gold', n: Math.min(Math.floor(p.gold * 0.5), 400) }], get: [{ k: 'warOn', civ: x.id }] });
        if (!g.embargoed(o.id, x.id) && g.deals.some((t) => between(t, o.id, x.id)) && g.goldRate(p.id) >= 6) tries.push(lasting(p.id, o.id, [{ k: 'goldPerTurn', n: 2 }], [{ k: 'embargo', civ: x.id }]));
      }
    }
    // (A demand: of a civ it dislikes and thinks weak, now and then.)
    if (L <= 1 && pw.rank <= 1 && o.gold >= 40 && g.rng() < 0.25) tries.push({ from: p.id, to: o.id, give: [], get: [{ k: 'gold', n: Math.min(Math.floor(o.gold * 0.4), 300) }], demand: true });
    for (const t of tries) {
      if (g.offerBlock(t) !== null) continue;
      // (Only what it would itself sign: an offer is not an insult. A demand is a demand. And nothing another computer civ would never sign.)
      if (!t.demand && selfWorth(g, t) < 0) continue;
      if (!o.isHuman && weigh(g, t).chance <= 0) continue;
      const r = g.propose(t);
      if (r === 'signed' || r === 'offered') break;
      if (t.demand && r === 'declined') g.remember(p.id, o.id, 'demandRefused');
    }
  }
}
// What an offer comes to for the civ that makes it (it does not propose what loses it more than it gains).
function selfWorth(g: Game, o: Offer): number {
  const p = g.players[o.from]!;
  return o.get.reduce((s, i) => s + gainOf(g, p, i, o.to), 0) - o.give.reduce((s, i) => s + costOf(g, p, i, o.to), 0);
}
// Whether a computer civ keeps a lasting deal past its least term: it ends
// one that has turned against it (a partner it has come to hate).
export function aiReviewsTreaties(g: Game, p: Player): void {
  for (const t of [...g.deals]) {
    if (t.a !== p.id && t.b !== p.id) continue;
    const other = t.a === p.id ? t.b : t.a;
    if (g.turn - t.since >= 10 && regard(g, p.id, other).level === 0) g.cancelTreaty(t, p.id);
  }
}

// ---------- the United Nations ----------

// Whom a computer civ votes for, of the two candidates (null: it
// abstains): never itself; of the others, the one it thinks the better
// of, if it is its friend or sworn to it. No one votes for a civ it
// merely tolerates.
export function aiVote(g: Game, p: Player, candidates: readonly [number, number]): number | null {
  let pick: number | null = null, best = -Infinity;
  for (const c of candidates) { if (c === p.id) continue; const r = regard(g, p.id, c).total; if (r > best) { pick = c; best = r; } }
  return pick !== null && (regardLevel(best) >= FRIENDLY || g.pact(p.id, pick)) ? pick : null;
}
// How a vote held now would go, as far as anyone can tell: each civ's votes and whom it would give them to.
export function forecast(g: Game, candidates: readonly [number, number], ballot: number | null): { civ: number; weight: number; for: number | null }[] {
  return g.players.filter((p) => p.alive).map((p) => ({ civ: p.id, weight: g.unVotes(p.id), for: p.isHuman ? ballot : aiVote(g, p, candidates) }));
}

// ---------- said in words ----------

export function itemText(g: Game, i: Item): string {
  switch (i.k) {
    case 'gold': return `${i.n} gold`;
    case 'goldPerTurn': return `${i.n} gold a turn`;
    case 'resource': return resourceDef(i.resource).name;
    case 'tech': return techDef(i.tech).name;
    case 'map': return 'a map of the world';
    case 'city': return g.cityById.get(i.city)?.name ?? 'a city';
    case 'warOn': return `war on the ${g.players[i.civ]!.name}`;
    case 'peaceWith': return `peace with the ${g.players[i.civ]!.name}`;
    case 'convert': return `${religionDef(i.religion).name} as state religion`;
    case 'openBorders': return 'open borders';
    case 'pact': return 'a defensive pact';
    case 'embargo': return `no trade with the ${g.players[i.civ]!.name}`;
  }
}
export const offerLasts = (o: Offer): boolean => [...o.give, ...o.get].some(isLasting);
export const termOf = (o: Offer): string => (offerLasts(o) ? `${DEAL_TURNS} turns` : 'at once');
export { RANKS };
