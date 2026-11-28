import { attackBlock, attackStyle, canAssault, canAttackType, canShoot, isShooter, siegeStyle, UNIT_CLASS, type AttackMode, type AttackStyle } from './unitClasses.ts';
import { buildFlora, type Flora } from './flora.ts';
import type { ArchCiv } from './architecture.ts';
import type { Globe, Tile } from './goldberg.ts';
import type { MapData } from './mapgen.ts';
import { generateWorld, type World } from './world.ts';
import { isWaterKey, tileYieldOf } from './mapRules.ts';
import { trueStartsOf } from './mapPaint.ts';
import { mulberry32, type SeededRng } from './rng.ts';
import {
  unitDef, buildDef, isUnitKey, isWonder, UNITS, BUILDINGS, CIVS, growthCost, UPGRADES, domainOf,
  type UnitKey, type BuildingKey, type BuildKey, type MapSizeKey, type MapScriptKey,
  GAME_SPEEDS, DEFAULT_SPEED, type GameSpeedKey,
} from './rules.ts';
import {
  isWaterBiome, terrainMoveCost, terrainFireCost, terrainDefense,
  type BiomeKey, type ReliefKey, type FeatureKey, type TileTerrain, type Yields,
  BIOMES,
} from './terrain.ts';
import { LEVELS, DEFAULT_LEVEL, type AiPolicy } from './aiPolicy.ts';
import { aiTurn, aiPickTech, aiPickPolitics, aiGovern, aiAcceptsPeace, aiPickTraits, aiFaith } from './ai.ts';
import { DEAL_TURNS, DEAL_MIN, isLasting, isMutual, sameItem, givenBy, partyTo, between, type Item, type LastingItem, type Offer, type Treaty } from './deals.ts';
import { MEMOS, MEMO_KEYS, aiAnswers, aiVote, noteDeal, regard, itemText, FRIENDLY, type MemoKey, type Memos } from './diplomacy.ts';
export { DEAL_TURNS };
import {
  USE, FOOD_PER_CITIZEN, ZERO, CITY_REACH, START_REACH, tileCost, GROWTH_TURNS, SPECIALIST_KINDS, AQUEDUCT_KEEP, BUILDINGS as CITY_BUILDINGS,
  addOut, scaleOut, centerYield, ruralYield, improvementFor, governorScore, specialistsWanted, borderRing,
  buildingsYield, withPercents, TEMPLE_KEYS, CATHEDRAL_KEYS, wonderBeside, MAX_CITY_WONDERS, specialistYield, specialistSlots, buildingAllowed, weigh, WONDERS, WONDER_KEYS, ERAS,
  type FocusKey, type GrowthOption, type TileUse, type Output, type SpecialistKind, type WonderKey, type WonderSite, type EraIndex, type ImprovementKey,
} from './cities.ts';
import { IMPROVEMENTS, IMPROVEMENT_KEYS, IMPROVE_TURNS, drained, out, OUTPUT_KEYS } from './cities.ts';
import { techDef, techPath, improvementStage, STAGE_TECHS, TECHS, type TechKey, FINAL_TECH } from './techs.ts';
import { politicsDef, politicsPath, GOVERNMENTS, governmentDef, policyDef, fits, SLOT_KINDS, type PoliticsKey, type GovernmentKey, type PolicyKey, type PolicySlot } from './politics.ts';
import { traitDef, traitBlock, traitCost, type TraitKey } from './identity.ts';
import { MISSIONARY_FAITH, MISSIONARIES_MOST, religionDef, spreadChance, STATE_BONUS, SECULAR_BONUS, CONVERSION_TURNS, CONVERSION_COST, TITHE, TEMPLE_TECH, CATHEDRAL_TECH, type ReligionKey } from './religion.ts';
import { placeResources, resourceDef, empireBonus, RESOURCE_IMPROVEMENT, type ResourceKey } from './resources.ts';
import { total, yieldBonus, prodBonus, flat, tileBonus, specialistBonus, movesBonus, type Effect, type ProdTarget } from './effects.ts';
import { cityUpkeep, unitUpkeep, buildingUpkeep, inflation, arrearsOf, WEALTH_RATE } from './economy.ts';
import type { GameEvent, GameEventKind } from './gameLog.ts';


export const HUMAN = 0;

export type Yield = Yields;

export interface CityYield extends Output {
  surplus: number;
}

export interface Player {
  id: number;
  name: ArchCiv;
  color: string;
  cityNames: string[];
  isHuman: boolean;
  alive: boolean;
  gold: number;
  science: number; // totals so far
  culture: number;
  cohesion: number;
  faith: number;
  era: EraIndex;
  citiesFounded: number;
  offensive: boolean; // AI only
  // Research and politics: what it knows, what it is on (and the goals
  // after it), progress toward each (kept if it switches away), and what it
  // made with nothing chosen (spent on the next one chosen).
  techs: Set<TechKey>;
  bought: Set<TechKey>;      // those it got in a deal (for the record: they are its own to pass on)
  research: TechKey | null;
  researchQueue: TechKey[];
  techProgress: Partial<Record<TechKey, number>>;
  scienceBank: number;
  politics: Set<PoliticsKey>;
  studying: PoliticsKey | null;
  politicsQueue: PoliticsKey[];
  politicsProgress: Partial<Record<PoliticsKey, number>>;
  cohesionBank: number;
  // Identity (identity.ts): the traits it adopted, and the identity points
  // (culture) it has to spend.
  identity: Set<TraitKey>;
  identityPoints: number;
  // The share of last turn's upkeep it could not pay (0: all paid): its
  // cities make that much less production, science and culture (economy.ts).
  arrears: number;
  // Turns left of the dishonour of a broken truce (declareWar): its cities make less cohesion.
  dishonor: number;
  // The state's religion (religion.ts): one a city of its own holds, or none (a secular state); whether it ever had
  // one (its first costs nothing); and the turns left of the upheaval of changing it (its cities make less cohesion).
  stateReligion: ReligionKey | null;
  hadStateReligion: boolean;
  conversion: number;
  government: GovernmentKey;
  policies: Record<PolicySlot, (PolicyKey | null)[]>;
  capital: number | null;    // the city with its palace (the first it founded, or the oldest left)
  firstCapital: number | null; // the first city it founded, whoever holds it now (the conquest victory counts these)
  goldFrac: number;          // the treasury's fraction of a gold (upkeep is fractional)
  ledger: Ledger;            // last turn's accounts, for the panels
}

// A civ's accounts for a turn.
export interface Ledger {
  readonly income: Output;       // what its cities made (gold before upkeep)
  readonly cityUpkeep: number;
  readonly unitUpkeep: number;
  readonly tithes: number;       // from the cities holding the religions whose holy cities it holds
  readonly luxuries: Output;     // its luxuries' empire bonus (in income too)
  readonly trade: number;        // gold a turn from its lasting deals (paid: negative)
}
const EMPTY_LEDGER: Ledger = { income: ZERO, cityUpkeep: 0, unitUpkeep: 0, tithes: 0, luxuries: ZERO, trade: 0 };

// Relations between two civs: at peace (the start), or at war since a turn.
export interface Relation { war: boolean; since: number; asked?: number } // (asked: the turn peace was last offered, by the first of the two)
// War, peace: a war lasts at least MIN_WAR turns before peace can be made.
// How the game is won (game.ts checkVictory).
export type Victory = 'conquest' | 'science' | 'diplomacy' | 'time';
export const VICTORIES: Record<Victory, { name: string; rule: string }> = {
  conquest: { name: 'Conquest', rule: 'Hold the first capitals of two thirds of the civilizations (your own among them).' },
  science: { name: 'Science', rule: 'Be the first to discover Artificial Superintelligence, the last technology.' },
  diplomacy: { name: 'Diplomacy', rule: 'Be voted leader of the world by the United Nations: three fifths of the votes of the rest of the world (a vote a citizen; no one votes for itself, and those who abstain count against).' },
  time: { name: 'Time', rule: 'Have the best score when the last turn ends, if no one has won before.' },
};
export const TURN_LIMIT = 300;
export const MIN_WAR = 8;
// A peace is a truce for this many turns: war may be declared again before, at a price (declareWar).
export const TRUCE_TURNS = 20;
export const TRUCE_BREAK = 0.5;

// The United Nations (Civ IV's): founded when the first civ learns UN_TECH; from then its council sits every
// UN_EVERY turns and votes on a leader of the world between the two civs with the most votes (a vote a
// citizen). Each civ gives all its votes to one of the two, or abstains; no one votes for itself. A candidate
// with UN_SHARE of the votes of the rest of the world (every civ but itself, abstentions counted against) wins
// the game: it is the world that makes a leader, not the leader's own numbers.
export const UN_TECH: TechKey = 'telecommunications';
export const UN_EVERY = 10;
export const UN_SHARE = 0.6;
export interface UNSession { readonly turn: number; readonly candidates: readonly [number, number]; readonly votes: readonly { civ: number; weight: number; for: number | null }[]; readonly winner: number | null }
// What is kept of every civ turn by turn, for the charts of its history (each yield's sheet, the accounts, the Victory sheet): one figure a turn each.
export const HISTORY = {
  score: 'Score', science: 'Science a turn', culture: 'Culture a turn', cohesion: 'Cohesion a turn', faith: 'Faith a turn', income: 'Gold income', expenses: 'Gold expenses', treasury: 'Treasury',
} as const;
export type HistoryKey = keyof typeof HISTORY;
export const HISTORY_KEYS = Object.keys(HISTORY) as HistoryKey[];
// The capital's palace.
export const PALACE = { prod: 1, gold: 2, science: 2, culture: 2 } as const;
// A rival city takes a border tile when its culture presses this much harder.
export const CLASH_MARGIN = 1.5;
// The most a civ's effects take off the food to grow (%).
export const GROWTH_CUT_MAX = 40;
// Buying: gold per point of production left (faith for religious buildings).
export const GOLD_PER_PROD = 3;
export const UPGRADE_GOLD = 2.5;
export const FAITH_PER_PROD = 2;
const FAITH_BUYS: ReadonlySet<BuildKey> = new Set<BuildKey>(['shrine', ...TEMPLE_KEYS, ...CATHEDRAL_KEYS]);
// What anyone can build from the start (the rest: techs.ts, politics.ts).
const STARTING: readonly BuildKey[] = ['warrior', 'slinger', 'scout', 'settler', 'worker', 'monument'];

// ---- combat (shared with the Units page's battle sandbox) ----
// Fortified, a unit defends this much better.
export const FORTIFY_BONUS = 0.4;
// What a unit that did not move or attack heals a turn, attacked or not:
// in a city of its own, and elsewhere on its civ's land or waters; outside
// its civ's territory it does not heal at all (ships the same).
export const GARRISON_HEAL = 15, FIELD_HEAL = 10;
// What a city adds to its garrison's strength, open and walled, and a
// fort to the unit in it. By simulation (scripts/siege.ts): two of a kind
// take an open city from one of the same more often than not; behind
// walls two seldom do, and it takes three.
export const CITY_DEFENSE = 0.2, FORT_DEFENSE = 0.3, WALLS_DEFENSE = 0.5;
// A fort: the turns a worker takes to build one (one of its improvements:
// a charge). It stands in an improvement's place: the tile has one or the other.
export const FORT_TURNS = 4;
// Which of its strengths a unit fights with (rules.ts): at close quarters
// (attacking or defending), shooting, or under fire.
export type Stat = 'melee' | 'ranged' | 'guard';
// What an attacker and its target fight with, as the attack is made.
export const statOf = (mode: AttackMode, role: 'atk' | 'def'): Stat => (mode === 'melee' ? 'melee' : role === 'atk' ? 'ranged' : 'guard');
// A unit's strength, with a bonus (a fraction: defending, its ground, city,
// fortified), weakened as it is hurt (half at no HP).
export function combatStrength(type: UnitKey, stat: Stat, hp: number, bonus: number): number {
  const T = unitDef(type), s = stat === 'melee' ? T.melee : stat === 'ranged' ? T.rangedAtk ?? 0 : T.rangedDef;
  return s * (1 + bonus) * (0.5 + 0.5 * hp / 100);
}
// Siege engines are this much weaker against units than their attack
// (they are built for walls: twice as strong against a city).
export const SIEGE_VS_UNITS = 0.5;
// And this much stronger again against a unit garrisoned in a city (on top of the above: twice their attack in all).
export const SIEGE_VS_CITY = 4;
// The counters between two units (rules.ts): what `self`'s strength is
// multiplied by against `other`, `self` attacking or defending. Spears and
// pikes hold off horse (not armour: only anti-tank guns stop that), a charge
// rides down archers and engines, engines are weak against units.
export function matchup(self: UnitKey, other: UnitKey, role: 'atk' | 'def'): number {
  const S = unitDef(self), O = unitDef(other);
  let k = 1;
  if (O.mounted && !O.armored) k += S.vsMounted ?? 0;
  if (O.armored) k += S.vsArmor ?? 0;
  if (role === 'atk' && (isShooter(other) || O.siege)) k += S.vsRanged ?? 0;
  if (domainOf(O) === 'sea') k += S.vsShips ?? 0;
  if (domainOf(O) === 'air') k += S.vsAir ?? 0;
  if (role === 'atk' && S.siege) k *= SIEGE_VS_UNITS;
  return k;
}
// A fight between strengths A and D: exchanges of 18-31 damage, each won by
// the attacker with odds A / (A + D). A melee goes on until one side has
// no HP left; fire is a volley of three exchanges, the target never firing
// back (an exchange it wins is a miss); a dogfight (fighters intercepting)
// is three exchanges, each side hurting the other.
// The HP each side is left with (at or below 0: destroyed).
export type Fight = 'melee' | 'ranged' | 'dogfight' | 'strike';
// A clash at close quarters is this many exchanges, not a fight to the
// death: a battle between equals takes a few attacks, over a turn or
// three, and either side may break off, be relieved or be reinforced.
// What an exchange costs the side that loses it, of a unit's 100: a clash
// between equals takes about 36 from each (Civ V's is 30 from each; more
// here, since a unit that is losing pulls back to heal and a fight drags
// on by that alone), so two that go at each other every turn fight for two turns.
export const HIT_MIN = 14, HIT_MAX = 22;
export const MELEE_ROUNDS = 4;
// A volley of fire is this many (the target never answering): lighter than a clash, as it costs the shooter nothing.
export const VOLLEY_ROUNDS = 2;
export const CRUSH_FROM = 2, CRUSH_MAX = 3;
const crush = (edge: number): number => Math.min(CRUSH_MAX, Math.max(1, edge / CRUSH_FROM));
export function fightRounds(hpA: number, hpD: number, A: number, D: number, kind: Fight, rng: () => number): { attacker: number; defender: number } {
  // (An air strike: a volley's exchanges, and what it strikes fires back at half effect: an aircraft comes home hurt from troops that can shoot.)
  const back = kind === 'melee' ? 1 : kind === 'dogfight' || kind === 'strike' ? 0.5 : 0;
  for (let round = 0; hpA > 0 && hpD > 0 && round < (kind === 'melee' ? MELEE_ROUNDS : kind === 'ranged' || kind === 'strike' ? VOLLEY_ROUNDS : 3); round++) {
    const dmg = HIT_MIN + Math.floor(rng() * (HIT_MAX - HIT_MIN + 1));
    // (At close quarters a side more than twice as strong hits the harder
    // for it, to three times: riflemen do not trade blows with warriors,
    // they sweep them away. Between units of a kind, bonuses and all,
    // nothing changes; nor for fire, which is weighed by its own odds.)
    const close = kind === 'melee';
    if (rng() < A / (A + D)) hpD -= Math.round(dmg * (close ? crush(A / D) : 1)); else hpA -= Math.round(dmg * back * (close ? crush(D / A) : 1));
  }
  return { attacker: hpA, defender: hpD };
}

// ---- one unit per tile ----
// A tile holds at most one military unit and one civilian of a player (a
// unit's slot): armies are spread over the land, never stacked (Civ V's).
// Ships have a slot of their own (a ship in port beside the garrison, a
// ship escorting a unit embarked on the water), and aircraft theirs: up
// to AIR_PER_CITY in each of their civ's cities.
export type Slot = 'military' | 'civilian' | 'naval' | 'air';
export const slotOf = (type: UnitKey): Slot => {
  const d = unitDef(type), dom = domainOf(d);
  return d.civilian ? 'civilian' : dom === 'sea' ? 'naval' : dom === 'air' ? 'air' : 'military';
};
export const AIR_PER_CITY = 4;
// A land unit embarked on the water (its civ has Shipbuilding) defends at
// this share of its strength, and can't attack.
export const EMBARKED_DEF = 0.5;
export const EMBARK_TECH = 'shipbuilding';
// The deep ocean is closed to every ship and embarked unit until its civ knows this (the Renaissance's first: Civ V's
// Astronomy): before it they keep to the shallows, the coasts and the lakes, and what lies over the ocean is not theirs to find.
export const OCEAN_TECH = 'astronomy';
// Turns a nuclear strike's burnt land takes to recover (as a pillaged tile's).
export const FALLOUT = 12;

export interface Unit {
  id: number;
  type: UnitKey;
  owner: number;
  tile: number;
  moves: number;
  hp: number;
  fortified: boolean;
  skipped: boolean;
  goal: number | null;
  goalMode: AttackMode | null;          // how it attacks at its goal (null: as it does unless told: defaultMode)
  dead: boolean;
  aiTarget: number | null;
  work: number | null;                  // a worker's: the tile it is working on (it stays there)
  job: WorkerJob | null;                // and what it does there
  charges: number;                      // a worker's: the improvements it can still build (roads and repairs cost none)
  religion: ReligionKey | null;         // a missionary's: the religion it preaches
}
// What a worker does on a tile: builds its improvement (a charge, of
// WORKER_CHARGES), repairs it when pillaged, or lays a road (both free, as
// often as wanted).
export type WorkerJob = 'improve' | 'repair' | 'road' | 'fort';
export const WORKER_CHARGES = 3;
// The units needing a strategic resource that one source of it arms (resourceRoom).
export const UNITS_PER_SOURCE = 3;
export const REPAIR_TURNS = 2;
// A road: the turns to lay one (a turn more through woods, hills and the
// like), and what a step from road to road costs of a unit's moves.
export const ROAD_TURNS = 2;
export const ROAD_MOVE = 0.5;
// What a city joined to its capital by road gains (the trade along it): gold, more as it grows, and a little production.
export const connectionBonus = (pop: number): Output => out({ gold: 1 + Math.floor(pop / 4), prod: 1 });

export interface City {
  id: number;
  name: string;
  owner: number;
  tile: number;
  pop: number;
  food: number;
  prod: number;
  building: BuildKey | null;
  buildings: Set<BuildingKey>;
  founded: number;
  focus: FocusKey;
  growth: number; // citizens born but not yet placed (the human places them)
  specialists: Record<SpecialistKind, number>; // in its buildings' slots, by kind
  wonderTile: number | null;           // where the wonder being built will stand (the center, or a mountain top)
  bought: number;                      // tiles bought (each costs more: cities.ts tileCost)
  hp: number;                          // the center's hit points (0: a melee unit can take it)
  founder: number;                     // the civ that founded it
  razing: boolean;                     // burning down, a citizen a turn
  religions: Set<ReligionKey>;         // the religions it holds (never lost: religion.ts)
  blessed: boolean;                    // what it is building was bought with faith
  culture: number;                     // culture it made so far (its borders grow with it)
  ring: number;                        // how far its borders reach (cities.ts borderRing)
}

// Sieges (design doc "Cities: Feel & Play", war): a city's center has hit
// points and strikes nearby enemies; it falls when its hit points are gone
// and a melee unit enters.
export const CITY_HP = 100;
// A city does not defend itself: its garrison does (a little stronger in
// its streets, more behind walls: CITY_DEFENSE, WALLS_DEFENSE), and one with no garrison is taken
// by the first enemy to walk in. So every city wants a unit in it, unless
// it lies where no enemy can come.
// What a city's fall hands its taker: gold, more for a larger city (out of its old owner's treasury as far as that goes).
export const plunder = (pop: number): number => 20 + 8 * pop;
export const PILLAGE_REPAIR = 3;     // turns to repair a pillaged tile once no enemy stands on it
export const PILLAGE_GOLD = 15;
// Where a fallen wonder was (its city razed): never to be rebuilt.
const FALLEN = -1;
// A government's slots, all empty.
const emptySlots = (g: GovernmentKey): Record<PolicySlot, (PolicyKey | null)[]> =>
  Object.fromEntries(SLOT_KINDS.map((s) => [s, new Array(GOVERNMENTS[g].slots[s]).fill(null)])) as Record<PolicySlot, (PolicyKey | null)[]>;
const noSpecialists = (): Record<SpecialistKind, number> =>
  Object.fromEntries(SPECIALIST_KINDS.map((k) => [k, 0])) as Record<SpecialistKind, number>;

export interface CombatPreview {
  atk: number;
  def: number;
  defender: Unit;
  mode: AttackMode;
}

export interface Message {
  turn: number;
  text: string;
}

export interface GameOptions {
  size: MapSizeKey;
  seed: number;
  script?: MapScriptKey;
  // Who the human plays as (the first player): that civ, the others following in their order (CIVS); the first of them unless given.
  civ?: ArchCiv;
  // Each civ where it really began (a painted map that says where: mapPaint.ts starts; the Earth). The civs playing are
  // the human's and others drawn by the seed from those that have a place; without it, starts are placed fairly.
  trueStarts?: boolean;
  // Every civ a player (the City Lab): those past the map's starts begin with no units.
  everyCiv?: boolean;
  // How each computer civ decides (aiPolicy.ts), by player id; or one
  // level of difficulty for all of them (an index of LEVELS; the default
  // otherwise).
  policies?: readonly AiPolicy[];
  level?: number;
  // The last turn (the time victory then): TURN_LIMIT at the game's pace unless given.
  turnLimit?: number;
  // The game's speed (rules.ts GAME_SPEEDS): Quick unless given.
  speed?: GameSpeedKey;
}

// Pure game state + rules. Knows nothing about rendering or the DOM.
export class Game {
  readonly seed: number;
  readonly globe: Globe;
  readonly tiles: Tile[];
  readonly N: number;
  readonly biome: BiomeKey[];
  readonly relief: ReliefKey[];
  readonly feature: (FeatureKey | null)[];
  readonly map: MapData;
  readonly flora: Flora; // which variant of its biome each tile shows (visual only)
  readonly world: World;
  readonly rng: SeededRng;
  // What it was made with (a saved game is made again with the same, then given its state: save.ts).
  readonly options: GameOptions;

  turn = 1;
  private nextId = 1;
  units: Unit[] = [];
  // Told of every attack as it starts (the renderer shows the fight).
  // A fight shown: the attacker, the tile, how it attacks; what it comes to (the defender, the HP each side is left with), if anyone defends.
  // Each step a unit takes onto the next tile (the view marches it there, tile by tile).
  onStep: ((u: Unit, from: number, to: number) => void) | null = null;
  onBattle: ((u: Unit, tile: number, style: AttackStyle, result?: { defender: number; attackerHp: number; defenderHp: number }) => void) | null = null;
  cities: City[] = [];
  readonly cityById = new Map<number, City>();
  readonly cityByTile = new Map<number, City>();
  readonly tileCity: Int32Array; // territory: owning city id, or -1
  readonly use: Uint8Array;         // TileUse of each tile (cities.ts); wild unless a city developed it
  readonly improved: Int8Array;     // the improvement built on each tile (IMPROVEMENT_KEYS index; -1: none)
  readonly underway: Int8Array;     // the improvement a worker has begun there (-1: none)
  readonly buildLeft: Uint8Array;   // turns of work it still needs
  readonly pillaged: Uint8Array;    // turns of repair left on a pillaged rural tile (0 = fine)
  readonly ruins: Uint8Array;       // 1 where a razed city stood
  readonly drained: Uint8Array;     // 1 where a peat bog was drained to be worked (its feature is gone; its ground stays dry)
  readonly wondersBuilt = new Map<WonderKey, number>(); // wonder -> its tile (its city's center, or a mountain top; FALLEN)
  useVersion = 0;                   // bumped whenever a tile's use changes (for the renderer)
  readonly fort: Uint8Array;        // 1 where a fort stands (built by workers, in an improvement's place)
  readonly fortLeft: Uint8Array;    // turns left of fort work begun on a tile
  fortVersion = 0;                  // bumped whenever a fort is built or goes
  readonly road: Uint8Array;        // 1 where workers have laid a road (a city's center counts as one: hasRoad)
  readonly roadLeft: Uint8Array;    // turns left of road work begun on a tile
  roadVersion = 0;                  // bumped whenever a road is laid
  diploVersion = 0;                 // bumped whenever a war begins or ends
  aiPolicies: AiPolicy[];           // how each computer civ decides (aiPolicy.ts), by player id
  policyVersion = 0;                // bumped when they are changed mid-game
  readonly explored: Uint8Array;
  // What each civ has explored (1: seen at least once), by player id: the
  // player's is `explored` itself; a computer civ's is filled by what its
  // units and cities see (explore), and it settles, scouts and marches by
  // it: it knows no more of the map than it has been to see.
  readonly known: Uint8Array[];
  readonly visible: Uint8Array;
  readonly messages: Message[] = [];
  readonly players: Player[];
  over: 'victory' | 'defeat' | null = null;
  winner: { player: number; how: Victory } | null = null; // who won the game, and how (checkVictory)
  readonly turnLimit: number;
  // The game's speed, and its pace: what multiplies every cost of making (rules.ts GAME_SPEEDS).
  readonly speed: GameSpeedKey;
  readonly pace: number;
  readonly resources: (ResourceKey | null)[];  // the resource on each tile (resources.ts)
  readonly religions = new Map<ReligionKey, { founder: number; holyCity: number | null; turn: number }>();
  readonly relations: Relation[][];             // [a][b], symmetric
  readonly met: Uint8Array[];                   // [a][b]: a has met b
  readonly peaceOffers = new Set<string>();     // "from>to": peace offered, not yet answered
  readonly deals: Treaty[] = [];                // lasting deals in force (deals.ts)
  readonly dealOffers: Offer[] = [];            // what the computer's civs offered the human, for this turn
  readonly memos: Memos[][];                    // [a][b]: what a remembers of b, for and against (diplomacy.ts MEMOS)
  un: { since: number | null; next: number; last: UNSession | null } = { since: null, next: 0, last: null };
  // Each civ's history: [metric][player] is a figure a turn, from turn 1 (HISTORY).
  readonly history: Record<HistoryKey, number[][]>;
  ballot: number | null = null;                  // the player's standing vote in the United Nations: a civ, if it stands (never itself), or to abstain
  readonly events: GameEvent[] = [];            // everything every player did (gameLog.ts)

  constructor({ size, seed, script = 'continents', everyCiv = false, policies, level = DEFAULT_LEVEL, turnLimit, speed = DEFAULT_SPEED, civ: playAs, trueStarts = false }: GameOptions) {
    this.options = { size, seed, script, everyCiv, level, speed, ...(policies ? { policies } : {}), ...(turnLimit !== undefined ? { turnLimit } : {}), ...(playAs ? { civ: playAs } : {}), ...(trueStarts ? { trueStarts } : {}) };
    this.seed = seed;
    this.speed = speed;
    this.pace = GAME_SPEEDS[speed].pace;
    this.turnLimit = turnLimit ?? Math.round(TURN_LIMIT * this.pace);
    this.world = generateWorld(size, seed, script);
    // (True starting places: the civs that have one, the human's first, the rest in an order the seed draws; as many as the map holds.)
    const places = trueStarts ? trueStartsOf(script, size) : {};
    const placed = (name: string) => { const t = places[name]; return t !== undefined && t >= 0 && t < this.world.globe.tiles.length && !isWaterKey(this.world.map.biome[t]!); };
    let trueCivs: typeof CIVS[number][] | null = null;
    if (CIVS.filter((c) => placed(c.name)).length >= 2) {
      const draw = mulberry32(seed ^ 0x51ed270b), rest = CIVS.filter((c) => placed(c.name) && c.name !== playAs).map((c) => ({ c, k: draw() })).sort((a, b) => a.k - b.k).map((x) => x.c);
      const first = CIVS.filter((c) => c.name === playAs && placed(c.name));
      trueCivs = [...first, ...rest].slice(0, this.world.starts.length);
      this.world = { ...this.world, starts: trueCivs.map((c) => places[c.name]!) };
    }
    this.globe = this.world.globe;
    this.tiles = this.globe.tiles;
    this.N = this.tiles.length;
    this.map = this.world.map;
    this.biome = this.map.biome;
    this.relief = this.map.relief;
    this.feature = this.map.feature;
    this.flora = buildFlora(this.globe, this.map, seed);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.tileCity = new Int32Array(this.N).fill(-1);
    this.use = new Uint8Array(this.N);
    this.improved = new Int8Array(this.N).fill(-1);
    this.underway = new Int8Array(this.N).fill(-1);
    this.buildLeft = new Uint8Array(this.N);
    this.pillaged = new Uint8Array(this.N);
    this.ruins = new Uint8Array(this.N);
    this.drained = new Uint8Array(this.N);
    this.fort = new Uint8Array(this.N);
    this.fortLeft = new Uint8Array(this.N);
    this.road = new Uint8Array(this.N);
    this.roadLeft = new Uint8Array(this.N);
    this.explored = new Uint8Array(this.N);
    this.visible = new Uint8Array(this.N);

    const civs = trueCivs ?? (playAs ? [...CIVS.filter((c) => c.name === playAs), ...CIVS.filter((c) => c.name !== playAs)] : CIVS);
    this.players = (everyCiv ? civs : civs.slice(0, this.world.starts.length)).map((civ, id) => ({
      id, name: civ.name, color: civ.color, cityNames: civ.cities,
      isHuman: id === HUMAN, alive: true, gold: 0, science: 0, culture: 0, cohesion: 0, faith: 0, era: 0, citiesFounded: 0, offensive: false,
      techs: new Set(), bought: new Set(), research: null, researchQueue: [], techProgress: {}, scienceBank: 0,
      politics: new Set(), studying: null, politicsQueue: [], politicsProgress: {}, cohesionBank: 0,
      identity: new Set(), identityPoints: 0, arrears: 0, dishonor: 0, stateReligion: null, hadStateReligion: false, conversion: 0,
      government: 'chiefdom', policies: emptySlots('chiefdom'), capital: null, firstCapital: null, goldFrac: 0, ledger: EMPTY_LEDGER,
    }));
    const n = this.players.length;
    this.aiPolicies = this.players.map((_, i) => policies?.[i] ?? LEVELS[Math.min(LEVELS.length - 1, Math.max(0, level))]!.policy);
    this.relations = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ war: false, since: 0 })));
    this.met = Array.from({ length: n }, () => new Uint8Array(n));
    this.memos = Array.from({ length: n }, () => Array.from({ length: n }, () => ({})));
    this.history = Object.fromEntries(HISTORY_KEYS.map((k) => [k, Array.from({ length: n }, () => [])])) as unknown as Record<HistoryKey, number[][]>;
    this.resources = placeResources(this.globe, this.map, this.world.starts, seed).at;

    this.known = this.players.map((p) => (p.id === HUMAN ? this.explored : new Uint8Array(this.N)));
    this.placeUnits();
    for (const p of this.players) this.explore(p.id);
    this.updateVisibility();
    this.record('start', -1, { seed, size, script, players: this.players.map((p) => p.name) });
  }

  // ---------- the record ----------

  record(kind: GameEventKind, player: number, data: Record<string, unknown> = {}): void {
    this.events.push({ turn: this.turn, player, kind, data });
  }

  // ---------- queries ----------

  terrainAt(t: number): TileTerrain {
    return { biome: this.biome[t], relief: this.relief[t], feature: this.feature[t] };
  }

  isWater(t: number): boolean { return isWaterBiome(this.biome[t]); }

  tileYield(t: number): Yield { return tileYieldOf(this.map, t); }

  moveCost(t: number): number { return terrainMoveCost(this.terrainAt(t)); }
  // What a shot crossing tile `t` costs of its reach (terrain.ts).
  fireCost(t: number): number { return terrainFireCost(this.terrainAt(t)); }
  // The tiles `u` can shoot at from where it stands: its reach (rules.ts;
  // one more from hills) paid out over the tiles its shot crosses, each
  // costing as fireCost says, the target itself 1. (Aircraft: their range,
  // whatever the ground.)
  fireReach(u: Unit): Set<number> { return this.fireReachFrom(u.type, u.tile); }
  // (The same from any tile: where a unit of a type would reach from there.)
  fireReachFrom(type: UnitKey, from: number): Set<number> {
    const T = unitDef(type), u = { tile: from };
    if (domainOf(T) === 'air') return new Set(this.tilesWithinMap(u.tile, T.range ?? 1).keys());
    const reach = (T.reach ?? 1) + (this.relief[u.tile] === 'hills' && !this.isWater(u.tile) ? 1 : 0);
    // (The cheapest way out to each tile the shot may cross, then one step on.)
    const cost = new Map<number, number>([[u.tile, 0]]), open = [u.tile], out = new Set<number>();
    while (open.length) {
      open.sort((a, b) => cost.get(b)! - cost.get(a)!);
      const t = open.pop()!, c = cost.get(t)!;
      for (const nb of this.tiles[t].neighbors) {
        if (nb !== u.tile) out.add(nb);
        const k = c + this.fireCost(nb);
        if (k <= reach - 1 && k < (cost.get(nb) ?? Infinity)) { cost.set(nb, k); open.push(nb); }
      }
    }
    return out;
  }

  // What the ground adds to a defender's strength: its terrain, and a fort standing there.
  defenseBonus(t: number): number { return terrainDefense(this.terrainAt(t)) + (this.fort[t] ? FORT_DEFENSE : 0); }

  ownerOf(t: number): number {
    const c = this.tileCity[t];
    return c < 0 ? -1 : this.cityById.get(c)!.owner;
  }

  // The units standing on a tile.
  unitsAt(t: number): Unit[] { return this.units.filter((u) => u.tile === t); }

  // ---- domains ----
  // Whether a civ's land units may embark on the water.
  canEmbark(owner: number): boolean { return this.players[owner]!.techs.has(EMBARK_TECH); }
  // Whether a civ's ships and embarked units may go out on the deep ocean (OCEAN_TECH).
  canCrossOcean(owner: number): boolean { return this.players[owner]!.techs.has(OCEAN_TECH); }
  // (Water a civ's ships and embarked units may be on.)
  private sails(owner: number, t: number): boolean { return this.isWater(t) && (this.biome[t] !== 'ocean' || this.canCrossOcean(owner)); }
  // A land unit on the water: embarked.
  isEmbarked(u: Unit): boolean { return domainOf(unitDef(u.type)) === 'land' && this.isWater(u.tile); }
  // Whether a unit may go onto a tile at all: land units on land (and the
  // water, once embarking), ships on the water and their civ's coastal
  // cities, aircraft only into their civ's cities. (The deep ocean: only once its civ can cross it, OCEAN_TECH.)
  canEnter(u: { type: UnitKey; owner: number }, t: number): boolean {
    const city = this.cityByTile.get(t);
    // (Another civ's land is closed to fighting units and ships while the two are at peace without open borders. Civilians pass.)
    if (!unitDef(u.type).civilian && domainOf(unitDef(u.type)) !== 'air' && this.closedTo(u.owner, t)) return false;
    switch (domainOf(unitDef(u.type))) {
      // (No one walks the mountains: they are walls on the map, to go round or to hold a pass between.)
      case 'land': return this.relief[t] !== 'mountains' && (!this.isWater(t) || (this.canEmbark(u.owner) && this.sails(u.owner, t)));
      case 'sea': return this.sails(u.owner, t) || (city !== undefined && city.owner === u.owner && this.cityCoast(city));
      case 'air': return (city !== undefined && city.owner === u.owner) || this.carrierRoom(t, u.owner) > 0;
    }
  }
  // Whether tile t is closed to a civ's fighting units: another's land, at peace, with no open borders between them.
  closedTo(owner: number, t: number): boolean {
    const c = this.tileCity[t]!;
    if (c < 0) return false;
    const o = this.cityById.get(c)!.owner;
    if (o === owner) return false;
    // (Who may walk whose land, worked out again when a war, a peace or a deal changes it.)
    const key = `${this.diploVersion}|${this.deals.length}`;
    if (this.passKey !== key) {
      this.passKey = key;
      const n = this.players.length;
      this.pass = Array.from({ length: n }, (_, a) => Uint8Array.from({ length: n }, (_, b) => (a === b || this.atWar(a, b) || this.openBorders(a, b) ? 1 : 0)));
    }
    return this.pass[owner]![o] !== 1;
  }
  private passKey = '';
  private pass: Uint8Array[] = [];
  // The aircraft a civ's carriers on a tile can take.
  carrierRoom(t: number, owner: number): number {
    return this.units.reduce((n, v) => n + (v.tile === t && v.owner === owner ? unitDef(v.type).carries ?? 0 : 0), 0);
  }

  // Whether a unit could stand on a tile: one it may enter, and its slot
  // there free of its owner's other units (aircraft: room in the city; an
  // enemy there is a fight, not a place).
  canStand(u: { type: UnitKey; owner: number; id?: number }, t: number): boolean {
    if (!this.canEnter(u, t)) return false;
    const slot = slotOf(u.type);
    const mine = this.units.filter((v) => v.tile === t && v.id !== u.id && v.owner === u.owner && slotOf(v.type) === slot).length;
    const city = this.cityByTile.get(t);
    return mine < (slot === 'air' ? (city?.owner === u.owner ? AIR_PER_CITY : 0) + this.carrierRoom(t, u.owner) : 1);
  }

  // The nearest tile to t (t itself first) where a new unit of its type can
  // stand, free of enemies; null if none within a few rings.
  freeTileNear(type: UnitKey, owner: number, t: number, reach = 3): number | null {
    const near = [...this.tilesWithinMap(t, reach)].sort((a, b) => a[1] - b[1]);
    // (A new land unit on land, never embarked.)
    const land = domainOf(unitDef(type)) === 'land';
    for (const [x] of near) if (this.canStand({ type, owner }, x) && !(land && this.isWater(x)) && !this.isEnemyOccupied(x, owner) && this.relief[x] !== 'mountains') return x;
    return null;
  }

  // A tile with a city or units of a civ at war with `owner` (moving there is a fight).
  isEnemyOccupied(t: number, owner: number): boolean {
    const city = this.cityByTile.get(t);
    if (city && city.owner !== owner && this.atWar(owner, city.owner)) return true;
    return this.units.some((u) => u.tile === t && u.owner !== owner && this.atWar(owner, u.owner));
  }

  // A tile with a city or units of a civ `owner` is at peace with: no way through.
  isForeignBlocked(t: number, owner: number): boolean {
    const city = this.cityByTile.get(t);
    if (city && city.owner !== owner && !this.atWar(owner, city.owner)) return true;
    return this.units.some((u) => u.tile === t && u.owner !== owner && !this.atWar(owner, u.owner));
  }

  canAttack(u: Unit): boolean { return canAttackType(u.type); }
  // Whether a unit's fire reaches a garrison behind a city's houses and walls: what is made to break them (siege
  // engines and guns), and whatever fires from the sea or the air (ships' guns, aircraft, missiles). The arrows and
  // bullets of troops on land do nothing to it: a city is taken at close quarters, and held so; bows and guns are
  // for the field.
  static breaches(type: UnitKey): boolean { const d = unitDef(type); return d.siege === true || domainOf(d) !== 'land'; }
  // (An enemy's city `u` could not fire into.)
  private shelters(u: { type: UnitKey; owner: number }, tile: number): boolean { const c = this.cityByTile.get(tile); return c !== undefined && c.owner !== u.owner && !Game.breaches(u.type); }
  // How `u` attacks `tile` unless told otherwise: by fire if it can shoot
  // and there is something there to shoot (a defender, a city's walls
  // standing); else it closes in (to take what is left: a fallen city, a
  // civilian).
  attackModeFor(u: Unit, tile: number): AttackMode {
    if (!canShoot(u.type)) return 'melee';
    const target = this.bestDefender(tile, u.owner, 'ranged') !== null && !this.shelters(u, tile);
    return target || !canAssault(u.type) ? 'ranged' : 'melee';
  }
  // Why `u` can't attack `tile` now, so (`mode`: its class against the
  // unit that would defend it: unitClasses.ts), or null if it can.
  attackBlockAt(u: Unit, tile: number, mode: AttackMode = this.attackModeFor(u, tile)): string | null {
    if (!this.canAttack(u)) return 'cannot attack';
    if (domainOf(unitDef(u.type)) === 'air' && !this.inRange(u, tile)) return 'out of range';
    if (mode === 'ranged' && canShoot(u.type) && this.shelters(u, tile)) return 'cannot fire into a city (siege weapons, ships and aircraft do)';
    const d = this.bestDefender(tile, u.owner, mode), where = { atSea: this.isWater(tile), city: this.cityByTile.has(tile), embarked: this.isEmbarked(u) };
    if (d) return attackBlock(u.type, d.type, where, mode) ?? (mode === 'ranged' && !this.fireReach(u).has(tile) ? 'out of reach' : null);
    if (mode === 'melee' && !canAssault(u.type)) return 'cannot close in';
    if (mode === 'ranged' && !canShoot(u.type)) return 'cannot shoot';
    if (mode === 'ranged' && !this.fireReach(u).has(tile)) return 'out of reach';
    if (where.embarked && !unitDef(u.type).amphibious) return 'cannot attack while embarked';
    return null;
  }

  // tile -> graph distance, for all tiles within r steps of t.
  tilesWithinMap(t: number, r: number): Map<number, number> {
    const dist = new Map<number, number>([[t, 0]]);
    let frontier = [t];
    for (let d = 1; d <= r; d++) {
      const next: number[] = [];
      for (const f of frontier) {
        for (const nb of this.tiles[f].neighbors) {
          if (!dist.has(nb)) { dist.set(nb, d); next.push(nb); }
        }
      }
      frontier = next;
    }
    return dist;
  }

  tilesWithin(t: number, r: number): number[] { return [...this.tilesWithinMap(t, r).keys()]; }

  // Approximate tile distance using the angle between tile centers.
  approxDist(a: number, b: number): number {
    return this.tiles[a].center.angleTo(this.tiles[b].center) / this.globe.avgEdgeAngle;
  }

  // Pentagons (12 on the globe) are never built up: no city. Farms are fine.
  isPentagon(t: number): boolean { return this.tiles[t].corners.length !== 6; }

  canFoundCity(t: number, owner: number): boolean {
    if (this.isPentagon(t)) return false;
    if (this.isWater(t) || this.relief[t] === 'mountains' || this.biome[t] === 'iceSheet') return false;
    const f = this.feature[t];
    if (f === 'volcano' || f === 'glacier') return false;
    const o = this.ownerOf(t);
    if (o !== -1 && o !== owner) return false;
    if (this.use[t] !== USE.wild) return false;
    return !this.tilesWithin(t, 2).some((x) => this.cityByTile.has(x));
  }

  siteScore(t: number): number {
    let s = 0;
    for (const x of this.tilesWithin(t, 2)) {
      if (this.ownerOf(x) !== -1) continue;
      const y = this.tileYield(x);
      s += (y.food * 1.5 + y.prod + y.gold * 0.5) * (this.isWater(x) ? 0.6 : 1);
    }
    return s;
  }

  // ---------- pathfinding ----------

  // A* over the tile graph. Returns the tiles to step through (excluding the
  // start), or null if unreachable. Enemy-occupied tiles are only allowed as
  // the final destination (that step becomes an attack). Tiles where the
  // unit's own side already has a unit of its slot are gone round (one
  // unit per tile), but for the goal next to it: that step is a swap.
  // (Aircraft never walk: they strike and rebase, goTo. Land units embark
  // and land at a cost that keeps them on land where they can.)
  findPath(u: Unit, goal: number): number[] | null {
    if (goal === u.tile) return [];
    if (domainOf(unitDef(u.type)) === 'air') return null;
    if ((!this.canEnter(u, goal) && !this.isEnemyOccupied(goal, u.owner)) || this.isForeignBlocked(goal, u.owner)) return null;
    if (this.isEnemyOccupied(goal, u.owner) && !this.canAttack(u)) return null;
    const swap = this.tiles[u.tile].neighbors.includes(goal) && this.swapPartner(u, goal) !== null;
    if (!swap && !this.canStand(u, goal) && !this.isEnemyOccupied(goal, u.owner)) return null;

    const tiles = this.tiles;
    const goalC = tiles[goal].center;
    const hScale = 1 / this.globe.maxEdgeAngle;
    const h = (t: number) => tiles[t].center.angleTo(goalC) * hScale;

    // (Who stands where, read once: its own side's units of its slot, enemies, and those at peace with it; cities likewise.)
    const slot = slotOf(u.type), taken = new Set<number>(), foes = new Set<number>(), barred = new Set<number>();
    for (const v of this.units) {
      if (v === u) continue;
      if (v.owner === u.owner) { if (slotOf(v.type) === slot) taken.add(v.tile); }
      else (this.atWar(u.owner, v.owner) ? foes : barred).add(v.tile);
    }
    for (const c of this.cities) if (c.owner !== u.owner) (this.atWar(u.owner, c.owner) ? foes : barred).add(c.tile);
    const g = new Map<number, number>([[u.tile, 0]]);
    const came = new Map<number, number>();
    const heap = new MinHeap();
    heap.push(h(u.tile), u.tile);
    const closed = new Set<number>();
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const nb of tiles[cur].neighbors) {
        if (closed.has(nb)) continue;
        if (nb !== goal && (foes.has(nb) || taken.has(nb) || !this.canEnter(u, nb))) continue;
        if (barred.has(nb)) continue;
        const ng = g.get(cur)! + this.stepCost(u, cur, nb) + (this.isWater(cur) !== this.isWater(nb) && domainOf(unitDef(u.type)) === 'land' ? 3 : 0);
        if (ng < (g.get(nb) ?? Infinity)) {
          g.set(nb, ng);
          came.set(nb, cur);
          heap.push(ng + h(nb), nb);
        }
      }
    }
    if (!came.has(goal)) return null;
    const path: number[] = [];
    for (let t = goal; t !== u.tile; t = came.get(t)!) path.push(t);
    return path.reverse();
  }

  // Number of turns to walk a path, counting the current turn as 1.
  pathTurns(u: Unit, path: number[]): number {
    let moves = u.moves, turns = 1, at = u.tile;
    for (const t of path) {
      if (moves <= 0) { turns++; moves = this.maxMoves(u.type, u.owner); }
      moves = this.landing(u, at, t) ? 0 : moves - this.stepCost(u, at, t);
      at = t;
    }
    return turns;
  }
  // The moves a step costs: on the water a move a tile; on land the terrain's.
  // (Along a road, from a tile with one to the next: ROAD_MOVE, whatever the ground.)
  stepCost(u: { type: UnitKey }, from: number, to: number): number {
    if (this.isWater(to) || domainOf(unitDef(u.type)) === 'sea') return 1;
    return this.hasRoad(from) && this.hasRoad(to) ? ROAD_MOVE : this.moveCost(to);
  }
  // Whether a road runs on a tile: one laid there, or a city's streets.
  hasRoad(t: number): boolean { return this.road[t] === 1 || this.use[t] === USE.center; }
  // Whether a step embarks or lands a land unit (it takes its turn).
  landing(u: { type: UnitKey }, from: number, to: number): boolean {
    return domainOf(unitDef(u.type)) === 'land' && this.isWater(from) !== this.isWater(to);
  }

  // ---------- actions ----------

  // Where a unit a city raises would stand: the city, or (another of its
  // kind standing there already) a tile next to it; null: no room, the
  // city and all around it taken. Nothing is raised without a place to
  // stand.
  static readonly MUSTER_REACH = 1;
  musterTile(city: City, type: UnitKey): number | null { return this.freeTileNear(type, city.owner, city.tile, Game.MUSTER_REACH); }
  // Why a city can't raise a unit it otherwise could (`offers` it, but
  // canBuild says no; so the reason can be shown): settlers leave with one of its
  // citizens, so a city of one has none to send; and a unit needs a place
  // to stand (musterTile). null: it can.
  unitBlock(city: City, type: UnitKey): string | null {
    if (type === 'settler' && city.pop < 2) return 'Needs a city of size 2: settlers leave with one of its citizens.';
    return this.musterTile(city, type) === null ? 'No room to stand: the city and every tile around it hold a unit of its kind.' : null;
  }

  // A new unit on `tile`, or (one unit per tile) the nearest free tile.
  createUnit(type: UnitKey, owner: number, tile: number): Unit {
    tile = this.freeTileNear(type, owner, tile) ?? tile;
    this.record('unitCreated', owner, { unit: type, tile });
    const u: Unit = { id: this.nextId++, type, owner, tile, moves: this.maxMoves(type, owner), hp: 100,
      fortified: false, skipped: false, goal: null, goalMode: null, dead: false, aiTarget: null, work: null, job: null,
      charges: unitDef(type).improves ? WORKER_CHARGES : 0, religion: null };
    this.units.push(u);
    return u;
  }

  // A unit's moves a turn: its own, and what its civ's effects add (fighting units).
  maxMoves(type: UnitKey, owner: number): number {
    const d = unitDef(type);
    return d.mv + (d.civilian ? 0 : movesBonus(this.effectsOf(this.players[owner]!), d.mounted === true));
  }

  // A unit gone.
  removeUnit(u: Unit): void {
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    u.dead = true;
    // (A carrier lost at sea takes down the aircraft it had no more room for.)
    if (unitDef(u.type).carries && !this.cityByTile.has(u.tile)) for (const v of [...this.units]) if (v.tile === u.tile && v.owner === u.owner && domainOf(unitDef(v.type)) === 'air' && !this.canStand(v, v.tile)) this.removeUnit(v);
  }

  // A paratrooper's drop: from its own city, with its moves whole, onto free
  // land within its reach, not next door (walk there).
  canParadrop(u: Unit, t: number): boolean {
    const reach = unitDef(u.type).paradrop;
    const city = this.cityByTile.get(u.tile);
    return reach !== undefined && city !== undefined && city.owner === u.owner && u.moves >= this.maxMoves(u.type, u.owner)
      && !this.isWater(t) && this.relief[t] !== 'mountains' && !this.tiles[u.tile].neighbors.includes(t)
      && this.tilesWithinMap(u.tile, reach).has(t) && this.canStand(u, t) && !this.isEnemyOccupied(t, u.owner) && !this.isForeignBlocked(t, u.owner);
  }

  // ---- aircraft ----
  // An aircraft's orders: a strike on an enemy within its range, or a
  // rebase to another of its civ's cities with room, within twice it.
  // (A missile is spent in its strike.)
  fly(u: Unit, goal: number): void {
    if (u.moves <= 0 || goal === u.tile) return;
    if (this.isEnemyOccupied(goal, u.owner)) {
      if (this.attackBlockAt(u, goal) !== null) return;
      if (unitDef(u.type).nuke) { this.detonate(u, goal); return; }
      this.attack(u, goal);
      if (unitDef(u.type).missile && !u.dead) this.removeUnit(u);
      return;
    }
    if (this.canRebase(u, goal)) { this.record('rebase', u.owner, { unit: u.type, from: u.tile, to: goal }); u.tile = goal; u.moves = 0; }
  }
  inRange(u: Unit, t: number, k = 1): boolean { return this.tilesWithinMap(u.tile, (unitDef(u.type).range ?? 1) * k).has(t); }
  canRebase(u: Unit, t: number): boolean { return domainOf(unitDef(u.type)) === 'air' && t !== u.tile && this.inRange(u, t, 2) && this.canStand(u, t); }
  // The tiles an aircraft flies over from its base to a target (stepping
  // each time to the neighbour nearest the target), the target last.
  flightPath(from: number, to: number): number[] {
    const out: number[] = [], goal = this.tiles[to].center;
    for (let t = from, n = 0; t !== to && n < 64; n++) {
      t = this.tiles[t].neighbors.reduce((a, b) => (this.tiles[b].center.angleTo(goal) < this.tiles[a].center.angleTo(goal) ? b : a));
      out.push(t);
    }
    return out;
  }
  // Anti-aircraft guns guard the sky round them: each enemy one within its
  // reach of the aircraft's way to its target fires on it (a volley; the
  // gun takes nothing back). Whether the aircraft comes through.
  private flak(u: Unit, tile: number): boolean {
    const way = this.flightPath(u.tile, tile);
    for (const v of [...this.units]) {
      const reach = unitDef(v.type).aaRange;
      if (!reach || v.owner === u.owner || !this.atWar(u.owner, v.owner)) continue;
      const near = this.tilesWithinMap(v.tile, reach);
      if (!way.some((t) => near.has(t))) continue;
      const after = fightRounds(v.hp, u.hp, this.unitStrength(v, 'ranged', 'atk', tile) * matchup(v.type, u.type, 'atk'), this.unitStrength(u, 'ranged', 'def', tile), 'ranged', this.rng);
      u.hp = after.defender;
      this.record('intercept', v.owner, { unit: v.type, target: u.type, hp: Math.max(0, u.hp) });
      if (u.owner === HUMAN || v.owner === HUMAN) this.log(`${this.players[v.owner].name} anti-aircraft fire hit the ${this.players[u.owner].name} ${unitDef(u.type).name}${u.hp <= 0 ? ', shooting it down' : ''}.`);
      if (u.hp <= 0) { this.removeUnit(u); return false; }
    }
    return true;
  }
  // Enemy fighters covering a tile intercept an aircraft striking it: the
  // strongest of them (its base within its range) fights it first. Whether
  // the striker comes through.
  // (Stealth aircraft and missiles get past fighters.)
  private intercept(u: Unit, tile: number): boolean {
    if (unitDef(u.type).stealth || unitDef(u.type).missile) return true;
    let best: Unit | null = null;
    for (const v of this.units) {
      if (UNIT_CLASS[v.type] !== 'fighter' || v.owner === u.owner || !this.atWar(u.owner, v.owner) || !this.inRange(v, tile)) continue;
      if (!best || v.hp > best.hp) best = v;
    }
    if (!best) return true;
    const after = fightRounds(best.hp, u.hp, this.unitStrength(best, 'ranged', 'atk', tile) * matchup(best.type, u.type, 'atk'), this.unitStrength(u, 'ranged', 'def', tile), 'dogfight', this.rng);
    best.hp = after.attacker;
    u.hp = after.defender;
    this.record('intercept', best.owner, { unit: best.type, target: u.type, hp: Math.max(0, u.hp) });
    if (u.owner === HUMAN || best.owner === HUMAN) this.log(`${this.players[best.owner].name} fighters intercepted the ${this.players[u.owner].name} ${unitDef(u.type).name}${u.hp <= 0 ? ', shooting it down' : ''}.`);
    if (best.hp <= 0) this.removeUnit(best);
    if (u.hp <= 0) { this.removeUnit(u); return false; }
    return true;
  }

  // A nuclear strike: the weapon flies in (fighters may catch a bomb,
  // anti-aircraft fire either), and is spent. Its blast, NUKE_RADIUS round
  // the target: every unit there (anyone's) wrecked, hardest at the centre;
  // every city's defences down and half its people dead; its land burnt
  // (FALLOUT turns to recover). An act of war on everyone it strikes.
  detonate(u: Unit, tile: number): void {
    const R = unitDef(u.type).nuke ?? 1;
    u.moves = 0;
    const hit = new Set<number>([...this.units.filter((v) => v.owner !== u.owner && this.tilesWithinMap(tile, R).has(v.tile)).map((v) => v.owner), ...[...this.cities].filter((c) => this.tilesWithinMap(tile, R).has(c.tile) && c.owner !== u.owner).map((c) => c.owner)]);
    for (const o of hit) if (!this.atWar(u.owner, o)) this.declareWar(u.owner, o);
    for (const o of hit) this.remember(o, u.owner, 'nuked');
    this.onBattle?.(u, tile, 'sortie');
    if (!this.flak(u, tile) || !this.intercept(u, tile)) return;
    const zone = this.tilesWithinMap(tile, R);
    this.record('nuke', u.owner, { unit: u.type, tile });
    for (const v of [...this.units]) {
      const d = zone.get(v.tile);
      if (d === undefined && v.tile !== tile || v === u || v.dead) continue;
      v.hp -= v.tile === tile ? 100 : 70 - 15 * (d ?? 0);
      if (v.hp <= 0) this.removeUnit(v);
    }
    for (const c of [...this.cities]) {
      if (c.tile !== tile && !zone.has(c.tile)) continue;
      c.hp = 0;
      for (let k = Math.floor(c.pop / 2); k > 0 && c.pop > 1; k--) this.removeCitizen(c);
    }
    for (const t of [tile, ...zone.keys()]) if (this.builtAt(t)) this.pillaged[t] = FALLOUT;
    this.log(`The ${this.players[u.owner].name} dropped a nuclear weapon (${unitDef(u.type).name}).`);
    this.removeUnit(u);
  }

  // A unit of `u`'s side and slot on the tile next to it that could swap
  // places with it (both with moves left).
  swapPartner(u: Unit, t: number): Unit | null {
    if (u.moves <= 0) return null;
    const slot = slotOf(u.type);
    return this.units.find((v) => v.tile === t && v.owner === u.owner && v !== u && slotOf(v.type) === slot && v.moves > 0) ?? null;
  }

  // Moves a unit one tile.
  private step(u: Unit, t: number): void {
    // (A carrier at sea takes its aircraft with it; in port they stay in the city.)
    if (unitDef(u.type).carries && !this.cityByTile.has(u.tile)) for (const v of this.units) if (v.tile === u.tile && v.owner === u.owner && domainOf(unitDef(v.type)) === 'air') v.tile = t;
    u.moves = this.landing(u, u.tile, t) ? 0 : Math.max(0, u.moves - this.stepCost(u, u.tile, t));
    u.work = null; // (a worker walking off leaves its work where it stands)
    u.job = null;
    this.onStep?.(u, u.tile, t);
    u.tile = t;
  }

  // (`mode`: how it attacks there, if it is an enemy's: unless told, attackModeFor.)
  goTo(u: Unit, goal: number, mode: AttackMode | null = null): void {
    if (domainOf(unitDef(u.type)) === 'air') { this.fly(u, goal); return; }
    if (this.canParadrop(u, goal)) { this.record('rebase', u.owner, { unit: u.type, from: u.tile, to: goal }); u.tile = goal; u.moves = 0; u.fortified = false; return; }
    this.record('move', u.owner, { unit: u.type, id: u.id, from: u.tile, to: goal });
    u.goal = goal;
    u.goalMode = mode;
    u.fortified = false;
    this.continueGoto(u);
  }

  continueGoto(u: Unit): void {
    while (!u.dead && u.moves > 0 && u.goal != null) {
      if (u.tile === u.goal) break;
      // (Its goal an enemy within its reach: it shoots from where it stands.)
      if (this.isEnemyOccupied(u.goal, u.owner)) {
        const mode = u.goalMode ?? this.attackModeFor(u, u.goal);
        if (mode === 'ranged' && this.attackBlockAt(u, u.goal, mode) === null) { this.attack(u, u.goal, mode); u.goal = null; break; }
      }
      const path = this.findPath(u, u.goal);
      if (!path || !path.length) { u.goal = null; break; }
      const next = path[0];
      if (this.isEnemyOccupied(next, u.owner)) {
        const mode = u.goalMode ?? this.attackModeFor(u, next);
        if (next === u.goal && this.attackBlockAt(u, next, mode) === null) this.attack(u, next, mode);
        u.goal = null;
        break;
      }
      // (Onto one of its own: they swap places.)
      const other = this.swapPartner(u, next);
      if (other) {
        const from = u.tile;
        this.step(u, next);
        this.step(other, from);
        other.goal = null;
        u.goal = null;
        break;
      }
      this.step(u, next);
    }
    if (u.tile === u.goal) u.goal = null;
    if (u.owner === HUMAN) this.updateVisibility();
  }

  // A unit's strength in an attack made so (`mode`), attacking or defending.
  unitStrength(u: Unit, mode: AttackMode, role: 'atk' | 'def', tile: number): number {
    const fx = this.effectsOf(this.players[u.owner]!), combat = 1 + total(fx, 'combat') / 100, stat = statOf(mode, role);
    if (role === 'atk') return combatStrength(u.type, stat, u.hp, 0) * (combat + (this.cityByTile.has(tile) ? total(fx, 'vsCities') / 100 : 0));
    let bonus = this.defenseBonus(tile) + (this.ownerOf(tile) === u.owner ? total(fx, 'homeDefense') / 100 : 0);
    const city = this.cityByTile.get(tile);
    // (In a city: its streets, or its walls if it has them; its barracks; and what its civ's policies add to them.)
    if (city) bonus += ((this.walled(city) ? WALLS_DEFENSE : CITY_DEFENSE) + 0.25 * (Number(city.buildings.has('barracks')) + Number(city.buildings.has('stable')))) * (1 + total(fx, 'cityStrength') / 100);
    if (u.fortified) bonus += FORTIFY_BONUS;
    if (this.isEmbarked(u)) return combatStrength(u.type, stat, u.hp, 0) * combat * EMBARKED_DEF;
    return combatStrength(u.type, stat, u.hp, bonus) * combat;
  }

  // The unit that defends a tile against an attack made so (the strongest against it).
  bestDefender(tile: number, attackerOwner: number, mode: AttackMode = 'melee'): Unit | null {
    let best: Unit | null = null, bestS = -1;
    for (const d of this.units) {
      // (Aircraft never defend a tile, nor ships in port.)
      const dom = domainOf(unitDef(d.type));
      if (d.tile !== tile || d.owner === attackerOwner || unitDef(d.type).civilian || dom === 'air' || (dom === 'sea' && !this.isWater(tile))) continue;
      const s = this.unitStrength(d, mode, 'def', tile);
      if (s > bestS) { best = d; bestS = s; }
    }
    return best;
  }

  // Strengths of a prospective fight (made so: `mode`), or null if nothing defends the tile.
  combatPreview(u: Unit, tile: number, mode: AttackMode = this.attackModeFor(u, tile)): CombatPreview | null {
    const d = this.bestDefender(tile, u.owner, mode);
    if (!d) return null;
    return { atk: this.unitStrength(u, mode, 'atk', tile) * matchup(u.type, d.type, 'atk') * this.siegeEdge(u, tile), def: this.unitStrength(d, mode, 'def', tile) * matchup(d.type, u.type, 'def'), defender: d, mode };
  }

  // (`mode`: by fire, or closing in: unless told, attackModeFor.)
  attack(u: Unit, tile: number, mode: AttackMode = this.attackModeFor(u, tile)): void {
    if (this.attackBlockAt(u, tile, mode) !== null) return;
    u.moves = 0;
    if (domainOf(unitDef(u.type)) === 'air' && (!this.flak(u, tile) || !this.intercept(u, tile))) return;
    u.fortified = false;
    const ranged = mode === 'ranged';
    // (Attacking a civ at peace is a declaration of war.)
    const target = this.cityByTile.get(tile)?.owner ?? this.units.find((v) => v.tile === tile && v.owner !== u.owner)?.owner;
    if (target !== undefined && target !== u.owner && !this.atWar(u.owner, target)) {
      this.declareWar(u.owner, target);
    }
    const d = this.bestDefender(tile, u.owner, mode);
    const style = (d ? attackStyle(u.type, d.type, mode) : siegeStyle(u.type, mode)) ?? 'melee';
    if (!d) this.onBattle?.(u, tile, style);
    if (d) {
      // (The counters: pikes against horse, a charge against archers...)
      const A = this.unitStrength(u, mode, 'atk', tile) * matchup(u.type, d.type, 'atk') * this.siegeEdge(u, tile);
      const D = this.unitStrength(d, mode, 'def', tile) * matchup(d.type, u.type, 'def');
      const before = { a: u.hp, d: d.hp };
      // (An aircraft striking troops is fired back on; a missile or a bomb is not: it is spent.)
      const air = domainOf(unitDef(u.type)) === 'air' && !unitDef(u.type).missile && !unitDef(u.type).nuke;
      const after = fightRounds(u.hp, d.hp, A, D, air && mode === 'ranged' ? 'strike' : mode, this.rng);
      this.onBattle?.(u, tile, style, { defender: d.id, attackerHp: after.attacker, defenderHp: after.defender });
      u.hp = after.attacker;
      d.hp = after.defender;
      this.record('attack', u.owner, { unit: u.type, defender: d.type, defenderOwner: d.owner, tile, A: +A.toFixed(2), D: +D.toFixed(2), hp: [before.a, Math.max(0, u.hp)], defenderHp: [before.d, Math.max(0, d.hp)] });
      if (u.hp <= 0) this.record('unitLost', u.owner, { unit: u.type, tile: u.tile, by: d.owner });
      if (d.hp <= 0) this.record('unitLost', d.owner, { unit: d.type, tile, by: u.owner });
      const an = this.players[u.owner].name, dn = this.players[d.owner].name;
      const involved = u.owner === HUMAN || d.owner === HUMAN;
      if (u.hp <= 0) {
        this.removeUnit(u);
        if (involved) this.log(`${dn} ${unitDef(d.type).name} defeated ${an} ${unitDef(u.type).name}.`);
        return;
      }
      if (d.hp > 0) return; // the volley did not finish it
      this.removeUnit(d);
      if (involved) this.log(`${an} ${unitDef(u.type).name} defeated ${dn} ${unitDef(d.type).name}.`);
      if (this.bestDefender(tile, u.owner, mode)) return;
    }
    // No defenders left: nothing holds the tile. A city does not defend
    // itself: its garrison does, behind its walls; an empty city is taken
    // by whoever walks in.
    const city = this.cityByTile.get(tile);
    if (ranged) return; // fire never moves in
    // Civilians are captured and the attacker moves in.
    for (const v of this.unitsAt(tile)) {
      if (v.owner === u.owner) continue;
      if (v.owner === HUMAN || u.owner === HUMAN) this.log(`${this.players[v.owner].name} ${unitDef(v.type).name} was captured.`);
      this.removeUnit(v);
    }
    u.tile = tile;
    if (city && city.owner !== u.owner) this.captureCity(city, u.owner);
  }

  // Whether a city's walls are no more: its owner defends in depth (techs.ts
  // defenseInDepth), every city as if walled, walls no longer built.
  wallsObsolete(owner: number): boolean { return this.effectsOf(this.players[owner]!).some((e) => e.k === 'fortified'); }
  // Whether a city defends as walled: its walls, or its owner's defense in depth.
  walled(c: City): boolean { return c.buildings.has('walls') || this.wallsObsolete(c.owner); }

  // (A city has no hit points of its own any more; kept for the dev pages.)
  cityMaxHp(_c: City): number { return CITY_HP; }

  // What holds a city: its garrison's strength at close quarters, behind
  // its walls and all (0: no one, it is anyone's who walks in).
  cityStrength(c: City): number {
    const d = this.bestDefender(c.tile, -1, 'melee');
    return d ? this.unitStrength(d, 'melee', 'def', c.tile) : 0;
  }
  // An engine against a garrison: built for it (SIEGE_VS_CITY over what
  // engines lose against units, so twice as strong as its attack says).
  private siegeEdge(u: Unit, tile: number): number {
    const c = this.cityByTile.get(tile);
    return unitDef(u.type).siege && c !== undefined && c.owner !== u.owner ? SIEGE_VS_CITY : 1;
  }

  // ---------- pillage and raze ----------

  canPillage(u: Unit): boolean {
    if (unitDef(u.type).civilian || u.moves <= 0 || domainOf(unitDef(u.type)) !== 'land') return false;
    const t = u.tile, o = this.ownerOf(t);
    return o >= 0 && o !== u.owner && this.atWar(u.owner, o) && this.builtAt(t) !== null && this.pillaged[t] === 0;
  }

  // Burns an enemy rural tile: it yields nothing until repaired; the raider takes gold.
  pillage(u: Unit): boolean {
    if (!this.canPillage(u)) return false;
    const t = u.tile, victim = this.ownerOf(t);
    this.pillaged[t] = PILLAGE_REPAIR;
    this.players[u.owner]!.gold += PILLAGE_GOLD;
    u.moves = 0;
    u.fortified = false;
    this.useVersion++;
    if (u.owner === HUMAN || victim === HUMAN) {
      const city = this.cityById.get(this.tileCity[t]!);
      this.log(`${this.players[u.owner].name} pillaged ${city ? `${city.name}'s` : 'a'} ${IMPROVEMENTS[this.builtAt(t)!].name.toLowerCase()}.`);
    }
    return true;
  }

  canRaze(c: City): boolean { return c.founder !== c.owner && !c.razing; }

  // A captured city burns down, a citizen a turn, then leaves ruins.
  raze(c: City): boolean {
    if (!this.canRaze(c)) return false;
    c.razing = true;
    c.building = null;
    c.wonderTile = null;
    this.log(`${c.name} is being razed.`);
    return true;
  }

  destroyCity(c: City): void {
    // Its wonders fall with it (never to be rebuilt).
    for (const k of this.cityWonders(c)) this.wondersBuilt.set(k, FALLEN);
    for (let t = 0; t < this.N; t++) {
      if (this.tileCity[t] !== c.id) continue;
      if (this.use[t] === USE.center) this.ruins[t] = 1;
      if (this.use[t] !== USE.wild) this.setUse(t, USE.wild);
      this.pillaged[t] = 0;
      this.improved[t] = this.underway[t] = -1;
      this.tileCity[t] = -1;
    }
    this.cities.splice(this.cities.indexOf(c), 1);
    this.cityById.delete(c.id);
    this.cityByTile.delete(c.tile);
    this.record('cityDestroyed', c.owner, { city: c.name, tile: c.tile });
    if (c.founder !== c.owner) this.remember(c.founder, c.owner, 'razed');
    const owner = this.players[c.owner]!;
    if (owner.capital === c.id) owner.capital = this.cities.filter((x) => x.owner === owner.id).sort((a, b) => a.founded - b.founded)[0]?.id ?? null;
    for (const f of this.religions.values()) if (f.holyCity === c.id) f.holyCity = null;
    this.useVersion++;
    this.log(`${c.name} has been razed to the ground.`);
  }

  foundCity(u: Unit): City | null {
    if (u.type !== 'settler' || !this.canFoundCity(u.tile, u.owner)) return null;
    const p = this.players[u.owner];
    const name = p.cityNames[p.citiesFounded] ?? `${p.name} ${p.citiesFounded + 1}`;
    p.citiesFounded++;
    const city: City = { id: this.nextId++, name, owner: u.owner, tile: u.tile, pop: 1, food: 0, prod: 0,
      building: null, buildings: new Set(), founded: this.turn, focus: 'balanced', growth: 0, specialists: noSpecialists(), wonderTile: null, bought: 0,
      hp: CITY_HP, founder: u.owner, razing: false, religions: new Set(), blessed: false, culture: 0, ring: START_REACH };
    this.cities.push(city);
    this.cityById.set(city.id, city);
    this.cityByTile.set(city.tile, city);
    this.tileCity[city.tile] = city.id;
    // (What was built on its tile is built over: the improvement, work begun, a fort.)
    const at = city.tile;
    this.improved[at] = this.underway[at] = -1;
    this.buildLeft[at] = this.pillaged[at] = this.fortLeft[at] = this.roadLeft[at] = 0;
    if (this.fort[at]) { this.fort[at] = 0; this.fortVersion++; }
    for (const w of this.units) if (w.work === at) { w.work = null; w.job = null; }
    this.setUse(city.tile, USE.center);
    this.claimTerritory(city);
    this.removeUnit(u);
    if (p.capital === null) {
      p.capital = city.id;
      if (p.firstCapital === null) p.firstCapital = city.id;
      // (A religion founded before it had a city: its holy city now.)
      for (const [r, f] of this.religions) if (f.founder === p.id && f.holyCity === null) { f.holyCity = city.id; city.religions.add(r); }
    }
    this.record('cityFounded', p.id, { city: name, tile: city.tile, capital: p.capital === city.id });
    if (p.isHuman) this.log(`Founded ${name}.`);
    else if (this.explored[city.tile]) this.log(`${p.name} founded ${name}.`);
    this.updateVisibility();
    return city;
  }

  // A city owns the tiles within its borders' ring that no one owns yet.
  private claimTerritory(city: City): void {
    let any = false;
    for (const t of this.tilesWithin(city.tile, city.ring)) {
      if (this.tileCity[t] === -1) { this.tileCity[t] = city.id; any = true; }
    }
    if (any) this.useVersion++;
  }
  // Border clashes (Civ IV's): a tile two or more steps from the city
  // holding it goes to a rival's city whose culture presses on it much
  // harder (influence: its culture over the square of one plus the
  // distance; CLASH_MARGIN times more). A citizen who worked it goes back to
  // its city, to be placed again; wonders' tiles never change hands.
  private contestBorders(): void {
    const influence = (c: City, d: number) => c.culture / ((1 + d) * (1 + d));
    for (const c of this.cities) {
      for (const [t, d] of this.tilesWithinMap(c.tile, c.ring)) {
        const o = this.cityById.get(this.tileCity[t]!);
        if (!o || o.owner === c.owner || d < 2 || this.wondersAt(t).length) continue;
        const od = Math.round(this.approxDist(t, o.tile));
        if (od < 2 || influence(c, d) <= CLASH_MARGIN * influence(o, od)) continue;
        const worked = this.use[t] === USE.rural;
        if (worked) this.setUse(t, USE.wild);
        this.tileCity[t] = c.id;
        // (Its citizen goes back to its city, to be placed elsewhere.)
        if (worked) {
          o.pop = Math.max(1, o.pop - 1);
          o.growth++;
          if (!this.players[o.owner]!.isHuman) this.autoPlace(o);
        }
        this.useVersion++;
        this.record('tileFlipped', c.owner, { tile: t, from: o.owner, city: c.name });
        this.remember(o.owner, c.owner, 'borderFlip');
        if (o.owner === HUMAN) this.log(`${c.name}'s culture took a tile from ${o.name}.`);
        else if (c.owner === HUMAN) this.log(`${c.name}'s culture won a tile from ${o.name}.`);
      }
    }
  }

  // Its culture so far brings a city's borders out ring by ring (cities.ts).
  private growBorders(city: City): void {
    const ring = borderRing(city.culture);
    if (ring <= city.ring) return;
    city.ring = ring;
    this.claimTerritory(city);
    if (city.owner === HUMAN) this.log(`${city.name}'s borders expanded.`);
  }

  // ---------- buying tiles ----------

  // The tiles a city could buy: within its reach, owned by no one, touching
  // a tile of its own.
  buyableTiles(city: City): number[] {
    return this.tilesWithin(city.tile, CITY_REACH).filter((t) => this.tileCity[t] === -1
      && this.tiles[t].neighbors.some((n) => this.tileCity[n] === city.id));
  }
  tilePrice(city: City): number { return Math.round(tileCost(city.bought) * (1 + total(this.effectsOf(this.players[city.owner]!), 'tilePrice') / 100)); }
  canBuyTile(city: City, t: number): boolean {
    return this.players[city.owner]!.gold >= this.tilePrice(city) && this.buyableTiles(city).includes(t);
  }
  // The governor's pick of a tile to buy: what it would yield worked, for
  // the city's focus (ties to the lower tile).
  governorTileToBuy(city: City): number | null {
    let best: number | null = null, bestS = -Infinity;
    for (const t of this.buyableTiles(city)) {
      const k = this.improvementAt(t);
      const s = k ? weigh(city.focus, this.improvedYield(t, city.owner)) : -1;
      if (s > bestS) { best = t; bestS = s; }
    }
    return best;
  }
  buyTile(city: City, t: number): boolean {
    if (!this.canBuyTile(city, t)) return false;
    this.players[city.owner]!.gold -= this.tilePrice(city);
    this.record('tileBought', city.owner, { city: city.name, tile: t, resource: this.resources[t] });
    this.tileCity[t] = city.id;
    city.bought++;
    this.useVersion++;
    return true;
  }

  // A city changes hands: taken (plundered, a citizen lost, its temples and barracks gone), or `ceded` in a deal (whole).
  private captureCity(city: City, newOwner: number, ceded = false): void {
    const old = this.players[city.owner];
    const p = this.players[newOwner];
    this.record(ceded ? 'cityCeded' : 'cityCaptured', newOwner, { city: city.name, from: city.owner, tile: city.tile });
    // (Its plunder.)
    if (old && p && !ceded) { const loot = plunder(city.pop); old.gold = Math.max(0, old.gold - loot); p.gold += loot; }
    // (What it remembers: a city taken from it; a city of its own founding given back.)
    if (!ceded) this.remember(old.id, newOwner, 'tookCity');
    else if (city.founder === newOwner) this.remember(newOwner, old.id, 'liberated');
    // (Ceded: the old owner's units in it march out.)
    if (ceded) for (const u of this.units.filter((x) => x.tile === city.tile && x.owner === old.id)) { const home = this.cities.find((c) => c.owner === old.id && c !== city); const t = home ? this.freeTileNear(u.type, u.owner, home.tile, 4) : null; if (t !== null) u.tile = t; else this.removeUnit(u); }
    city.ring = Math.min(city.ring, borderRing(city.culture));
    if (old && old.capital === city.id) old.capital = this.cities.filter((c) => c.owner === old.id && c !== city).sort((a, b) => a.founded - b.founded)[0]?.id ?? null;
    if (p && p.capital === null) p.capital = city.id;
    city.owner = newOwner;
    city.razing = false;
    if (city.pop > 1 && !ceded) this.removeCitizen(city);
    city.growth = 0;
    city.wonderTile = null;
    // Temples and garrisons do not survive a conquest; the rest change hands.
    if (!ceded) for (const b of [...city.buildings]) if (CITY_BUILDINGS[b].lostOnCapture) this.removeBuilding(city, b);
    this.useVersion++;
    city.food = 0;
    city.prod = 0;
    // (Nothing chosen for the player: what a new city builds is theirs to say, and they are asked.)
    city.building = null;
    if (newOwner === HUMAN || old.id === HUMAN || this.explored[city.tile]) {
      this.log(ceded ? `${old.name} ceded ${city.name} to ${p.name}.` : `${p.name} captured ${city.name} from ${old.name}!`);
    }
    this.checkElimination();
  }

  // ---------- cities ----------

  // Tiles of the city in a given use (the center excluded unless asked for).
  cityTiles(city: City, use: TileUse): number[] {
    return this.tilesWithin(city.tile, CITY_REACH).filter((t) => this.tileCity[t] === city.id && this.use[t] === use);
  }

  // ---------- buildings ----------

  // Whether the city stands by a river, or on the coast (beside the sea:
  // some buildings and wonders need it).
  cityRiver(city: City): boolean { return this.map.riverTile[city.tile] === 1; }
  cityCoast(city: City): boolean { return this.tiles[city.tile].neighbors.some((n) => this.isSea(n)); }
  isSea(t: number): boolean { return this.biome[t] === 'shallowSea' || this.biome[t] === 'ocean'; }

  // How many more specialists of a kind the city's buildings have slots for.
  specialistRoom(city: City, k: SpecialistKind): number {
    return specialistSlots(city.buildings, k) - city.specialists[k];
  }
  // The city's rural tiles worked with an improvement.
  private worked(city: City, k: ImprovementKey): number {
    return this.cityTiles(city, USE.rural).filter((t) => !this.pillaged[t] && this.builtAt(t) === k).length;
  }
  specialistCount(city: City): number { return SPECIALIST_KINDS.reduce((n, k) => n + city.specialists[k], 0); }

  // What adding building k would change in the city's output.
  buildingGain(city: City, k: BuildingKey): Output {
    if (city.buildings.has(k)) return ZERO;
    const before = this.cityYields(city);
    city.buildings.add(k);
    const after = this.cityYields(city);
    city.buildings.delete(k);
    return addOut(after, scaleOut(before, -1));
  }

  addBuilding(city: City, k: BuildingKey): void {
    // (New walls come with their HP: a city just walled is whole, not hurt.)
    city.buildings.add(k);
    this.useVersion++;
  }
  // Removes building k (a conquest, the City Lab) and those that need it;
  // specialists left without a slot leave the city.
  removeBuilding(city: City, k: BuildingKey): void {
    if (!city.buildings.delete(k)) return;
    for (const b of [...city.buildings]) if (CITY_BUILDINGS[b].requires === k) this.removeBuilding(city, b);
    for (const s of SPECIALIST_KINDS) {
      const over = -this.specialistRoom(city, s);
      if (over > 0) { city.specialists[s] -= over; city.pop = Math.max(1, city.pop - over); }
    }
    this.useVersion++;
  }

  // ---------- wonders ----------

  // The wonders standing on tile t (a city's center: any number; a tile
  // beside it: one).
  wondersAt(t: number): WonderKey[] {
    const out: WonderKey[] = [];
    for (const [k, at] of this.wondersBuilt) if (at === t) out.push(k);
    return out;
  }
  wonderOn(t: number): WonderKey | null { return this.wondersAt(t)[0] ?? null; }
  // The wonders a city has (on its center, and beside it).
  cityWonders(city: City): WonderKey[] {
    const out: WonderKey[] = [];
    for (const [k, t] of this.wondersBuilt) if (t !== FALLEN && this.tileCity[t] === city.id) out.push(k);
    return out;
  }

  // What a wonder needs of the tile it stands on (coast: of its city's center).
  private siteOk(t: number, site: WonderSite): boolean {
    switch (site) {
      case 'desertOrFloodplain': return this.biome[t] === 'hotDesert' || this.biome[t] === 'coldDesert' || this.feature[t] === 'floodplain';
      case 'coast': return this.tiles[t].neighbors.some((n) => this.isSea(n));
      case 'river': return this.map.riverTile[t] === 1;
      case 'mountainTop': return this.relief[t] === 'mountains' && this.feature[t] !== 'volcano';
      case 'hills': return this.relief[t] === 'hills';
      case 'flat': return this.relief[t] === 'flat' && this.feature[t] === null;
      case 'any': return true;
    }
  }

  // Where wonder k could stand: in the city (its center), if the center
  // meets its need; beside it, on a tile of the city's next to it with no
  // wonder yet: a wild mountain, the sea (shallow first; a coastal city),
  // flat land (hills for a wonder that needs them; a hex, wild or worked)
  // meeting its need.
  wonderSpots(city: City, k: WonderKey): number[] {
    const site = WONDERS[k].site, beside = wonderBeside(k);
    if (!beside) return this.siteOk(city.tile, site) ? [city.tile] : [];
    const ok = (t: number) => (beside === 'sea' ? this.isSea(t)
      : beside === 'mountain' ? this.use[t] === USE.wild && this.siteOk(t, 'mountainTop')
      : !this.isWater(t) && !this.isPentagon(t) && this.relief[t] === (site === 'hills' ? 'hills' : 'flat') && this.use[t] !== USE.center && this.siteOk(t, site));
    return this.tiles[city.tile].neighbors.filter((t) => this.tileCity[t] === city.id && !this.blockedFor(city, t) && !this.wondersAt(t).length && ok(t))
      .sort((a, b) => Number(this.biome[b] === 'shallowSea') - Number(this.biome[a] === 'shallowSea') || a - b);
  }

  // Whether a city may take on another wonder: fewer than MAX_CITY_WONDERS
  // so far (in it and beside it alike).
  wonderRoom(city: City): boolean { return this.cityWonders(city).length < MAX_CITY_WONDERS; }

  // Starts wonder k on tile t (production goes on).
  startWonder(city: City, k: WonderKey, t: number): boolean {
    if (this.wondersBuilt.has(k) || !this.wonderRoom(city) || !this.wonderSpots(city, k).includes(t)) return false;
    if (city.building !== k) city.building = k;
    city.wonderTile = t;
    this.useVersion++;
    return true;
  }

  governorWonderSpot(city: City, k: WonderKey): number | null {
    return this.wonderSpots(city, k)[0] ?? null;
  }

  // Builds wonder k on tile t at once (the City Lab; the game completes
  // wonders through production).
  placeWonder(city: City, k: WonderKey, t: number): boolean {
    if (this.wondersBuilt.has(k) || !this.wonderRoom(city) || !this.wonderSpots(city, k).includes(t)) return false;
    this.completeWonder(city, k, t);
    return true;
  }

  private completeWonder(city: City, k: WonderKey, t: number): void {
    this.wondersBuilt.set(k, t);
    // (Beside its city, it takes the tile: any improvement there gone, a
    // citizen working it back to its city to be placed again, the tile's
    // resource worked by the wonder itself: connected.)
    if (t !== city.tile) {
      this.improved[t] = this.underway[t] = -1;
      this.buildLeft[t] = 0;
      this.pillaged[t] = 0;
      for (const v of this.units) if (v.work === t) v.work = null;
      if (this.use[t] === USE.rural) {
        this.setUse(t, USE.wild);
        city.pop = Math.max(1, city.pop - 1);
        city.growth++;
        if (!this.players[city.owner]!.isHuman) this.autoPlace(city);
      }
    }
    city.building = null;
    city.wonderTile = null;
    this.useVersion++;
    const p = this.players[city.owner]!;
    if (p.isHuman || this.explored[t]) this.log(`${p.name} completed the ${WONDERS[k].name} in ${city.name}!`);
    // Anyone else building it keeps their production for something else.
    for (const c of this.cities) {
      if (c.building !== k) continue;
      c.building = null;
      c.wonderTile = null;
      if (this.players[c.owner]!.isHuman) this.log(`${c.name} lost the race for the ${WONDERS[k].name}; its production is kept.`);
    }
  }

  // The era of the civ owning tile t.
  eraAt(t: number): EraIndex {
    const o = this.ownerOf(t);
    return o < 0 ? 0 : this.players[o]!.era;
  }

  // The resource on tile t as civ `owner` knows it: null if none, or if it
  // is a strategic one that civ has not revealed yet (resources.ts).
  resourceFor(t: number, owner: number): ResourceKey | null {
    const r = this.resources[t];
    if (!r) return null;
    const need = resourceDef(r).reveal;
    // (A world with no civs on it, a map being drawn: no one knows the hidden ones.)
    return !need || (owner >= 0 && this.players[owner]?.techs.has(need)) ? r : null;
  }

  // What tile t yields worked by civ `owner`: its terrain, its improvement
  // if one is built (and not pillaged), its resource, and what the civ's
  // effects add (effects.ts).
  workedYield(t: number, owner: number): Output {
    return this.yieldWith(t, owner, this.pillaged[t] ? null : this.builtAt(t));
  }
  // What it would yield worked once improved (its improvement built: a bog drained).
  improvedYield(t: number, owner: number): Output {
    return this.yieldWith(t, owner, this.improvementAt(t, owner));
  }
  private yieldWith(t: number, owner: number, built: ImprovementKey | null): Output {
    const res = this.resourceFor(t, owner), fx = owner >= 0 ? this.effectsOf(this.players[owner]!) : [];
    const kind = res ? resourceDef(res).kind : null, terrain = built ? drained(this.terrainAt(t)) : this.terrainAt(t);
    return addOut(ruralYield(terrain, this.map.riverTile[t] === 1, built, (k) => tileBonus(fx, k, kind)), res ? resourceDef(res).yields : ZERO);
  }
  // The improvement tile t would get (by `owner`: the resource it knows of
  // there decides it; cities.ts improvementFor).
  improvementAt(t: number, owner: number = this.ownerOf(t)): ImprovementKey | null {
    const res = this.resourceFor(t, owner);
    return improvementFor(this.terrainAt(t), res ? RESOURCE_IMPROVEMENT[res] : null);
  }
  // The improvement a worker built on tile t, if any.
  builtAt(t: number): ImprovementKey | null {
    const i = this.improved[t]!;
    return i >= 0 ? IMPROVEMENT_KEYS[i]! : null;
  }
  // How far its owner's techs have taken tile t's improvement (techs.ts
  // improvementStage): the one built, else the one it would get. (0: its
  // owner knows none of its techs: one taken from a civ that did.)
  stageAt(t: number, owner: number = this.ownerOf(t)): number {
    const k = this.builtAt(t) ?? this.improvementAt(t, owner);
    return k && owner >= 0 ? improvementStage(this.players[owner]!.techs, k) : 0;
  }

  // ---------- workers ----------

  // The tiles a worker could improve: the one it stands on, land or (embarked: fishing boats, an offshore well) water.
  improveTiles(u: Unit): number[] { return [u.tile]; }
  // Why worker u can't improve tile t now (null: it can). `started`: it is
  // already at work there (its moves don't matter).
  improveBlock(u: Unit, t: number, started = false): string | null {
    if (!unitDef(u.type).improves) return 'Only workers improve the land.';
    if (!this.improveTiles(u).includes(t)) return 'A worker improves the tile it stands on.';
    if (!started && u.moves <= 0) return 'No moves left.';
    if (this.ownerOf(t) !== u.owner) return 'Not your land.';
    if (this.use[t] === USE.center || this.wondersAt(t).length) return 'Nothing to build here.';
    const k = this.improvementAt(t, u.owner);
    if (!k) return 'Nothing to build here.';
    // (Pillaged: it mends it, as often as it takes.)
    if (this.builtAt(t) === k) return this.pillaged[t] ? null : 'Already improved.';
    const need = this.improvementTech(u.owner, k);
    if (need) return `Needs ${TECHS[need].name}.`;
    return !started && u.charges <= 0 ? 'It has built all it could: it still lays roads and repairs.' : null;
  }
  // Why worker u can't lay a road where it stands (null: it can): on land
  // of its own or no one's, short of the mountains.
  roadBlock(u: Unit, started = false): string | null {
    const t = u.tile;
    if (!unitDef(u.type).improves) return 'Only workers lay roads.';
    if (this.isWater(t) || this.relief[t] === 'mountains') return 'No road can run here.';
    if (!started && u.moves <= 0) return 'No moves left.';
    if (this.hasRoad(t)) return 'A road runs here already.';
    const o = this.ownerOf(t);
    return o >= 0 && o !== u.owner ? 'Not your land.' : null;
  }
  // Why worker u can't build a fort where it stands (null: it can): on
  // land of its own or no one's, not a city's center nor a wonder's tile,
  // with an improvement left to build. A fort takes the place of the
  // tile's improvement (and of a citizen's work there).
  fortBlock(u: Unit, started = false): string | null {
    const t = u.tile;
    if (!unitDef(u.type).improves) return 'Only workers build forts.';
    if (this.isWater(t) || this.relief[t] === 'mountains') return 'No fort can stand here.';
    if (this.use[t] === USE.center || this.wondersAt(t).length) return 'No fort can stand here.';
    if (this.fort[t]) return 'A fort stands here already.';
    const o = this.ownerOf(t);
    if (o >= 0 && o !== u.owner) return 'Not your land.';
    if (!started && u.moves <= 0) return 'No moves left.';
    return !started && u.charges <= 0 ? 'It has built all it could: it still lays roads and repairs.' : null;
  }
  buildFort(u: Unit): boolean {
    if (this.fortBlock(u) !== null) return false;
    this.fortLeft[u.tile] = this.fortLeft[u.tile] || FORT_TURNS;
    u.work = u.tile; u.job = 'fort';
    u.moves = 0; u.goal = null; u.fortified = false;
    this.record('improve', u.owner, { tile: u.tile, improvement: 'fort' });
    return true;
  }
  roadTurns(t: number): number { return this.roadLeft[t] || ROAD_TURNS + (this.moveCost(t) > 1 ? 1 : 0); }
  // Sets worker u to laying a road on its tile.
  buildRoad(u: Unit): boolean {
    if (this.roadBlock(u) !== null) return false;
    this.roadLeft[u.tile] = this.roadTurns(u.tile);
    u.work = u.tile; u.job = 'road';
    u.moves = 0; u.goal = null; u.fortified = false;
    this.record('road', u.owner, { tile: u.tile });
    return true;
  }
  // Whether a city is joined to its civ's capital by road (cities' streets
  // count; so does a road through anyone's land).
  private linked: { key: string; set: Set<number> } = { key: '', set: new Set() };
  roadLinked(city: City): boolean {
    const key = `${this.roadVersion}|${this.useVersion}|${this.cities.length}|${this.turn}`;
    if (this.linked.key !== key) {
      const set = new Set<number>();
      for (const p of this.players) {
        const cap = p.capital === null ? undefined : this.cityById.get(p.capital);
        if (!cap || cap.owner !== p.id) continue;
        const seen = new Set<number>([cap.tile]), open = [cap.tile];
        while (open.length) {
          const t = open.pop()!;
          const c = this.cityByTile.get(t);
          if (c && c.owner === p.id) set.add(c.id);
          for (const n of this.tiles[t]!.neighbors) if (!seen.has(n) && this.hasRoad(n)) { seen.add(n); open.push(n); }
        }
      }
      this.linked = { key, set };
    }
    return this.linked.set.has(city.id);
  }
  // The tech civ `owner` still needs to build improvement k (its first: techs.ts STAGE_TECHS), or null.
  improvementTech(owner: number, k: ImprovementKey): TechKey | null {
    const need = STAGE_TECHS(k)[0];
    return need && !this.players[owner]!.techs.has(need) ? need : null;
  }
  // How many of its tiles civ `owner` could improve now (not improved yet,
  // its techs knowing how, the water once its workers can embark; and `keep` them).
  openWork(owner: number, keep: (t: number) => boolean = () => true): number {
    let n = 0;
    for (let t = 0; t < this.N; t++) {
      if (this.ownerOf(t) !== owner || (this.isWater(t) && !this.canEnter({ type: 'worker', owner }, t)) || this.use[t] === USE.center || !keep(t)) continue;
      const k = this.improvementAt(t, owner);
      if (k && this.builtAt(t) !== k && !this.wondersAt(t).length && !this.improvementTech(owner, k)) n++;
    }
    return n;
  }
  // The tile the worker would improve (its own), or null.
  improveTarget(u: Unit): number | null {
    return this.improveTiles(u).find((t) => this.improveBlock(u, t) === null) ?? null;
  }
  // Turns the work on tile t still needs (from scratch, or what is left of work begun).
  improveTurns(t: number, owner: number = this.ownerOf(t)): number {
    const k = this.improvementAt(t, owner);
    if (!k) return 0;
    if (this.builtAt(t) === k && this.pillaged[t]) return Math.min(this.pillaged[t]!, REPAIR_TURNS);
    return this.underway[t] === IMPROVEMENT_KEYS.indexOf(k) ? this.buildLeft[t]! : IMPROVE_TURNS[k];
  }
  // Sets worker u to improving tile t: it stays there until it is done
  // (each turn's end takes a turn off: advanceWork).
  improve(u: Unit, t: number = this.improveTarget(u) ?? -1): boolean {
    if (t < 0 || this.improveBlock(u, t) !== null) return false;
    const k = this.improvementAt(t, u.owner)!, i = IMPROVEMENT_KEYS.indexOf(k);
    const repair = this.builtAt(t) === k;
    if (!repair && this.underway[t] !== i) { this.underway[t] = i; this.buildLeft[t] = IMPROVE_TURNS[k]; }
    u.job = repair ? 'repair' : 'improve';
    u.work = t;
    u.moves = 0;
    u.goal = null;
    u.fortified = false;
    this.record('improve', u.owner, { tile: t, improvement: k });
    return true;
  }
  // A turn of every worker's work; what is finished is built.
  private advanceWork(): void {
    for (const u of this.units) {
      const t = u.work;
      if (t === null || u.dead) continue;
      const done = () => { for (const v of this.units) if (v.work === t && v.job === u.job) { v.work = null; v.job = null; } };
      if (u.job === 'fort') {
        if (this.fortBlock(u, true) !== null) { u.work = null; u.job = null; continue; }
        if (this.fortLeft[t]! > 1) { this.fortLeft[t]!--; continue; }
        // (In the improvement's place: what was built there goes, and the citizen who worked it is to be placed again.)
        this.fort[t] = 1;
        this.fortLeft[t] = 0;
        this.improved[t] = -1;
        this.underway[t] = -1;
        this.pillaged[t] = 0;
        const city = this.cityById.get(this.tileCity[t]!);
        if (city && this.use[t] === USE.rural) this.unplace(city, { tile: t });
        if (city && !this.players[city.owner]!.isHuman) this.autoPlace(city);
        this.fortVersion++;
        this.useVersion++;
        u.charges--;
        done();
        if (u.owner === HUMAN) this.log('A worker built a fort.');
        continue;
      }
      if (u.job === 'road') {
        if (this.roadBlock(u, true) !== null) { u.work = null; u.job = null; continue; }
        if (this.roadLeft[t]! > 1) { this.roadLeft[t]!--; continue; }
        this.road[t] = 1;
        this.roadLeft[t] = 0;
        this.roadVersion++;
        done();
        continue;
      }
      const k = this.improvementAt(t, u.owner);
      if (this.improveBlock(u, t, true) !== null || !k) { u.work = null; u.job = null; continue; }
      if (u.job === 'repair') {
        const left = Math.min(this.pillaged[t]!, REPAIR_TURNS) - 1;
        this.pillaged[t] = Math.max(0, left);
        if (left > 0) continue;
        this.useVersion++;
        done();
        if (u.owner === HUMAN) this.log(`A worker repaired a ${IMPROVEMENTS[k].name.toLowerCase()}.`);
        continue;
      }
      if (this.underway[t] !== IMPROVEMENT_KEYS.indexOf(k)) { u.work = null; u.job = null; continue; }
      if (this.buildLeft[t]! > 1) { this.buildLeft[t]!--; continue; }
      this.build(t, k);
      u.charges--;
      done();
      if (u.owner === HUMAN) this.log(`A worker built a ${IMPROVEMENTS[k].name.toLowerCase()}${u.charges > 0 ? '' : ': it has built all it could, and still lays roads and repairs'}.`);
    }
  }
  // Tile t improved (a peat bog drained for good: it is its land from now
  // on, cities.ts drained).
  build(t: number, k: ImprovementKey): void {
    if (this.wondersAt(t).length) return; // (a wonder's tile is the wonder's)
    if (this.fort[t]) { this.fort[t] = 0; this.fortVersion++; } // (an improvement takes a fort's place)
    if (this.feature[t] === 'bog') {
      this.feature[t] = null;
      this.drained[t] = 1;
      const city = this.cityById.get(this.tileCity[t]!);
      if (city?.owner === HUMAN) this.log(`${city.name} drained a peat bog.`);
    }
    this.improved[t] = IMPROVEMENT_KEYS.indexOf(k);
    this.underway[t] = -1;
    this.buildLeft[t] = 0;
    this.pillaged[t] = 0;
    this.useVersion++;
  }

  // What a developed tile adds to its city (wild tiles add nothing).
  tileOutput(t: number): Output {
    const terrain = this.terrainAt(t), river = this.map.riverTile[t] === 1;
    const u = this.use[t], owner = this.ownerOf(t);
    const wonders = this.wondersAt(t).reduce((o, w) => addOut(o, WONDERS[w].yields), ZERO);
    if (u === USE.rural) return addOut(this.workedYield(t, owner), wonders);
    if (u === USE.wild) return wonders; // a wonder beside the city
    // The center: the city, its buildings, wonders and specialists.
    const city = this.cityByTile.get(t);
    if (!city) return ZERO;
    const res = this.resourceFor(t, owner), resYield = res ? resourceDef(res).yields : ZERO;
    const fx = this.effectsOf(this.players[city.owner]!);
    const specialists = SPECIALIST_KINDS.reduce((o, k) => addOut(o, scaleOut(addOut(specialistYield(k), specialistBonus(fx, k)), city.specialists[k])), ZERO);
    return addOut(addOut(addOut(addOut(centerYield(terrain, river), resYield), buildingsYield(city.buildings, city.pop, (k) => this.worked(city, k))), wonders), specialists);
  }

  // A tile an enemy unit stands on yields nothing to its city.
  private blockedFor(city: City, t: number): boolean {
    return this.units.some((u) => u.tile === t && u.owner !== city.owner && this.atWar(city.owner, u.owner));
  }

  cityYields(city: City): CityYield {
    let sum: Output = ZERO;
    for (const t of this.tilesWithin(city.tile, CITY_REACH)) {
      if (this.tileCity[t] !== city.id || (this.use[t] === USE.wild && !this.wondersAt(t).length)) continue;
      if (t !== city.tile && this.blockedFor(city, t)) continue;
      sum = addOut(sum, this.tileOutput(t));
    }
    // (Buildings' percentages count everything the city makes.)
    sum = withPercents(sum, city.buildings);
    // Its civ's: the palace and the capital's bonuses, its religion's, and
    // the percentages of its government and policies.
    const p = this.players[city.owner]!, fx = this.effectsOf(p);
    if (p.capital === city.id) sum = addOut(addOut(sum, out(PALACE)), flat(fx, 'capital'));
    else if (this.roadLinked(city)) sum = addOut(sum, connectionBonus(city.pop));
    sum = addOut(sum, this.religionYield(city));
    let strife = 0;
    if (p.dishonor > 0) strife += TRUCE_BREAK;
    // (Its state's religion changed of late: its people unsettled.)
    if (p.conversion > 0) strife += CONVERSION_COST;
    if (strife) sum = { ...sum, cohesion: sum.cohesion * (1 - Math.min(0.9, strife)) };
    // (In arrears: what it could not pay of its upkeep, its cities make less by, in production, science and culture.)
    const paid = (y: keyof Output) => (y === 'prod' || y === 'science' || y === 'culture' ? 1 - p.arrears : 1);
    sum = out(Object.fromEntries(OUTPUT_KEYS.map((y) => [y, Math.max(0, Math.floor(sum[y] * paid(y) * (100 + yieldBonus(fx, y)) / 100))])));
    return { ...sum, surplus: sum.food - FOOD_PER_CITIZEN * city.pop };
  }

  // What a city's religions give it, by its civ's state (religion.ts): under a state religion, STATE_BONUS if it
  // holds that one; in a secular state, SECULAR_BONUS for each it holds past its first.
  religionYield(city: City, state: ReligionKey | null = this.players[city.owner]!.stateReligion): Output {
    if (state) return city.religions.has(state) ? out(STATE_BONUS) : ZERO;
    return scaleOut(out(SECULAR_BONUS), Math.max(0, city.religions.size - 1));
  }

  // A city's yields taken apart, for the panels (cityYields is the rule;
  // this only says where they come from): each part before any percentage,
  // and the whole as cityYields gives it. The whole less the parts is what
  // the percentages, the troubles and the rounding make of them.
  cityYieldParts(city: City): { land: Output; center: Output; buildings: Output; wonders: Output; specialists: Output; capital: Output; roads: Output; religion: Output; total: Output } {
    let land: Output = ZERO, center: Output = ZERO, buildings: Output = ZERO, wonders: Output = ZERO, specialists: Output = ZERO;
    const p = this.players[city.owner]!, fx = this.effectsOf(p);
    for (const t of this.tilesWithin(city.tile, CITY_REACH)) {
      if (this.tileCity[t] !== city.id || (this.use[t] === USE.wild && !this.wondersAt(t).length)) continue;
      if (t !== city.tile && this.blockedFor(city, t)) continue;
      wonders = this.wondersAt(t).reduce((o, w) => addOut(o, WONDERS[w].yields), wonders);
      if (this.use[t] === USE.rural) land = addOut(land, this.workedYield(t, this.ownerOf(t)));
      else if (this.use[t] !== USE.wild && this.cityByTile.get(t)) {
        const res = this.resourceFor(t, this.ownerOf(t));
        center = addOut(center, addOut(centerYield(this.terrainAt(t), this.map.riverTile[t] === 1), res ? resourceDef(res).yields : ZERO));
        buildings = addOut(buildings, buildingsYield(city.buildings, city.pop, (k) => this.worked(city, k)));
        specialists = SPECIALIST_KINDS.reduce((o, k) => addOut(o, scaleOut(addOut(specialistYield(k), specialistBonus(fx, k)), city.specialists[k])), specialists);
      }
    }
    const capital = p.capital === city.id ? addOut(out(PALACE), flat(fx, 'capital')) : ZERO;
    const roads = p.capital !== city.id && this.roadLinked(city) ? connectionBonus(city.pop) : ZERO;
    const religion = this.religionYield(city);
    const { surplus: _, ...total } = this.cityYields(city);
    return { land, center, buildings, wonders, specialists, capital, roads, religion, total };
  }

  // Where the city's next citizen may go: a tile it owns, not worked yet,
  // land that could be improved (not mountains, ice or the deep ocean) and
  // yields something, improved or not; or a specialist in one of its
  // buildings with room.
  growthOptions(city: City): GrowthOption[] {
    const out: GrowthOption[] = [];
    for (const t of this.tilesWithin(city.tile, CITY_REACH)) {
      // (Any tile of its civ within its reach that no citizen works, its own or a sister city's: worked, it becomes this city's.)
      if (this.ownerOf(t) !== city.owner || this.blockedFor(city, t) || this.use[t] !== USE.wild || this.fort[t] || this.wondersAt(t).length || !this.improvementAt(t, city.owner)) continue;
      const y = this.workedYield(t, city.owner);
      if (y.food + y.prod + y.gold > 0) out.push({ kind: 'rural', tile: t, improvement: this.builtAt(t) });
    }
    for (const k of SPECIALIST_KINDS) if (this.specialistRoom(city, k) > 0) out.push({ kind: 'specialist', specialist: k });
    return out;
  }

  // What an option adds to the city.
  optionYield(o: GrowthOption, owner: number = this.ownerOf(o.kind === 'rural' ? o.tile : -1)): Output {
    if (o.kind === 'specialist') return owner >= 0 ? addOut(specialistYield(o.specialist), specialistBonus(this.effectsOf(this.players[owner]!), o.specialist)) : specialistYield(o.specialist);
    return this.workedYield(o.tile, owner);
  }

  // The governor's pick for the city's focus (ties go to the lower tile, so
  // it is deterministic), or null if the city has nowhere to grow.
  governorPick(city: City): GrowthOption | null {
    const surplus = this.cityYields(city).surplus - FOOD_PER_CITIZEN;
    const short = this.specialistCount(city) < specialistsWanted(city.pop + 1);
    const want = this.growthCostOf(city, city.pop + 1) / GROWTH_TURNS;
    let best: GrowthOption | null = null, bestS = -Infinity;
    for (const o of this.growthOptions(city)) {
      const gain = this.optionYield(o, city.owner);
      const s = governorScore(city.focus, o.kind, gain, surplus + gain.food, want, short);
      if (s > bestS) { best = o; bestS = s; }
    }
    return best;
  }

  // Places one pending citizen. Returns false if the option is not legal now.
  placeGrowth(city: City, o: GrowthOption): boolean {
    if (city.growth <= 0) return false;
    const legal = this.growthOptions(city).some((x) => sameOption(x, o));
    if (!legal) return false;
    if (o.kind === 'specialist') city.specialists[o.specialist]++;
    else { this.tileCity[o.tile] = city.id; this.setUse(o.tile, USE.rural); }
    city.growth--;
    city.pop++;
    return true;
  }
  // A citizen taken off its work (a tile it works, or a specialist's place),
  // to be placed again: it waits, as one newly grown does.
  unplace(city: City, from: { tile: number } | { specialist: SpecialistKind }): boolean {
    if ('tile' in from) {
      if (this.tileCity[from.tile] !== city.id || this.use[from.tile] !== USE.rural) return false;
      this.setUse(from.tile, USE.wild);
    } else {
      if (city.specialists[from.specialist] <= 0) return false;
      city.specialists[from.specialist]--;
      this.useVersion++;
    }
    city.pop--;
    city.growth++;
    return true;
  }

  // The governor moves citizens off their worst tiles onto better free ones
  // (an improvement finished there), a few a turn, for the city's focus.
  rework(city: City): void {
    for (let n = 0; n < 3; n++) {
      const worked = this.cityTiles(city, USE.rural);
      const free = this.growthOptions(city).flatMap((o) => (o.kind === 'rural' ? [o.tile] : []));
      if (!worked.length || !free.length) return;
      const value = (t: number) => weigh(city.focus, this.workedYield(t, city.owner));
      const worst = worked.reduce((a, b) => (value(b) < value(a) ? b : a)), best = free.reduce((a, b) => (value(b) > value(a) ? b : a));
      if (value(best) <= value(worst) + 0.5) return;
      this.setUse(worst, USE.wild);
      this.tileCity[best] = city.id;
      this.setUse(best, USE.rural);
    }
  }

  // Lets the governor place every pending citizen of the city.
  autoPlace(city: City): void {
    while (city.growth > 0) {
      const o = this.governorPick(city);
      if (!o || !this.placeGrowth(city, o)) { city.growth = 0; break; }
    }
  }

  // The city loses a citizen (starvation, a settler, capture): its least
  // valuable specialist first, then its least valuable rural tile. The
  // center always stays.
  removeCitizen(city: City): void {
    if (city.pop <= 1) return;
    const kinds = SPECIALIST_KINDS.filter((k) => city.specialists[k] > 0);
    const rural = this.cityTiles(city, USE.rural);
    if (kinds.length) {
      const k = kinds.reduce((a, b) => (weigh('balanced', specialistYield(b)) < weigh('balanced', specialistYield(a)) ? b : a));
      city.specialists[k]--;
    } else if (rural.length) {
      const value = (t: number) => weigh('balanced', this.tileOutput(t));
      this.setUse(rural.reduce((a, b) => (value(b) < value(a) ? b : a)), USE.wild);
    } else return;
    city.pop--;
  }

  private setUse(t: number, u: TileUse): void {
    this.use[t] = u;
    this.useVersion++;
  }

  // What things cost to make at the game's pace (rules.ts GAME_SPEEDS).
  paced(x: number): number { return Math.round(x * this.pace); }
  costOf(k: BuildKey): number { return this.paced(buildDef(k).cost); }
  techCost(k: TechKey): number { return this.paced(techDef(k).cost); }
  politicsCost(k: PoliticsKey): number { return this.paced(politicsDef(k).cost); }
  // (Prices rise with the turns as on a Quick game they would by the same point of it.)
  get inflation(): number { return inflation(this.turn / this.pace); }
  // Food for a city's next citizen (`pop`: its size after), with its civ's
  // effects (which never take off more than GROWTH_CUT_MAX).
  growthCostOf(city: City, pop: number): number {
    const pct = Math.max(-GROWTH_CUT_MAX, total(this.effectsOf(this.players[city.owner]!), 'growth'));
    return Math.max(1, Math.round(growthCost(pop) * (1 + pct / 100) * this.pace));
  }

  // A building can be queued once per city, and only while it has a place to go.
  // (`anyResource`: as if the civ had every strategic resource; the City Lab.)
  canBuild(city: City, key: BuildKey, anyResource = false): boolean {
    return this.offers(city, key, anyResource) && !(isUnitKey(key) && this.unitBlock(city, key) !== null);
  }
  // The same, but for a unit's need of a citizen to send and a place to stand (unitBlock).
  offers(city: City, key: BuildKey, anyResource = false): boolean {
    const p = this.players[city.owner]!;
    if (!this.unlocked(p).has(key)) return false;
    if (isUnitKey(key)) {
      if (unitDef(key).preaches) return false; // (raised with faith: trainMissionary)
      const need = unitDef(key).needs;
      if (domainOf(unitDef(key)) === 'sea' && !this.cityCoast(city)) return false;
      return !need || anyResource || this.resourceRoom(p.id, need) > 0;
    }
    if (isWonder(key)) return !this.wondersBuilt.has(key) && this.wonderRoom(city) && (this.wonderSpots(city, key).length > 0 || city.wonderTile !== null && city.building === key);
    if (key === 'walls' && this.wallsObsolete(city.owner)) return false;
    const need = CITY_BUILDINGS[key].resource;
    return (!need || anyResource || this.hasResource(p.id, need)) && buildingAllowed(key, city.buildings, this.cityRiver(city), this.cityCoast(city), city.religions);
  }

  private processCity(city: City): void {
    const p = this.players[city.owner];
    if (city.razing) {
      if (city.pop > 1) this.removeCitizen(city);
      else this.destroyCity(city);
      return;
    }
    // (Walls obsolete: they come down, no more upkeep.)
    if (city.buildings.has('walls') && this.wallsObsolete(city.owner)) { city.buildings.delete('walls'); this.useVersion++; }
    const y = this.cityYields(city);

    city.food += y.surplus;
    const cost = this.growthCostOf(city, city.pop + city.growth);
    if (city.food >= cost) {
      if (!this.growthOptions(city).length) {
        city.food = cost; // nowhere to put a new citizen: the city stagnates
      } else {
        city.growth++;
        city.food = city.buildings.has('aqueduct') ? Math.floor(cost * AQUEDUCT_KEEP) : 0;
        this.record('cityGrew', city.owner, { city: city.name, pop: city.pop + city.growth });
        if (p.isHuman) this.log(`${city.name} grew: place a citizen.`);
        else this.autoPlace(city);
      }
    } else if (city.food < 0) {
      city.food = 0;
      if (city.pop > 1) {
        this.removeCitizen(city);
        if (p.isHuman) this.log(`${city.name} is starving!`);
      }
    }

    // (A unit it can no longer raise, the city shrunk to one citizen with
    // settlers under way, or no place left for the unit to stand: what was
    // put into it is lost, and the city must turn to something else.)
    if (city.building && isUnitKey(city.building)) {
      const why = this.unitBlock(city, city.building);
      if (why !== null) {
        this.record('buildLost', city.owner, { city: city.name, item: city.building, prod: city.prod });
        if (p.isHuman) this.log(`${city.name} gave up its ${buildDef(city.building).name}: ${why[0]!.toLowerCase()}${why.slice(1)}`);
        city.prod = 0;
        city.building = null;
      }
    }
    const key = city.building;
    if (key) {
      const item = { ...buildDef(key), cost: this.costOf(key) };
      city.prod += Math.round(y.prod * (1 + prodBonus(this.effectsOf(p), this.prodKinds(key)) / 100));
      if (city.prod >= item.cost) {
        {
          city.prod -= item.cost;
          if (isUnitKey(key)) {
            this.createUnit(key, city.owner, this.musterTile(city, key) ?? city.tile);
            city.blessed = false;
            this.record('built', city.owner, { city: city.name, item: key });
            if (key === 'settler') this.removeCitizen(city);
            // (Done: what it builds next is chosen anew, the player asked as the computer asks itself.)
            city.building = null;
            if (p.isHuman) this.log(`${city.name} completed ${item.name}.`);
          } else if (isWonder(key)) {
            // On its tile, or another if that one was lost (a mountain top); else it waits.
            const spots = this.wonderSpots(city, key);
            const t = city.wonderTile !== null && spots.includes(city.wonderTile) ? city.wonderTile : this.governorWonderSpot(city, key);
            if (t === null || this.wondersBuilt.has(key)) city.prod += item.cost;
            else this.completeWonder(city, key, t);
          } else {
            this.addBuilding(city, key);
            this.record('built', city.owner, { city: city.name, item: key });
            city.building = null;
            if (p.isHuman) this.log(`${city.name} completed ${item.name}.`);
          }
        }
      }
    } else {
      // Nothing to build: production becomes gold.
      p.gold += Math.floor(y.prod * (WEALTH_RATE + total(this.effectsOf(p), 'wealth') / 100));
    }
    p.gold += y.gold;
    p.faith += y.faith;
    this.addScience(p, y.science);
    this.addCohesion(p, y.cohesion);
    this.addCulture(p, y.culture);
    // (Toward its borders, at the game's pace: the rings come as much later as everything else.)
    city.culture += (y.culture * (1 + total(this.effectsOf(p), 'border') / 100)) / this.pace;
    this.growBorders(city);
    this.turnIncome[p.id] = addOut(this.turnIncome[p.id] ?? ZERO, y);
  }

  // What a city makes this turn, summed per civ (endTurn's accounts).
  private turnIncome: Output[] = [];
  private turnLuxuries: Output[] = [];

  // Its luxuries' empire bonus, to the civ as a whole (its culture to
  // identity, not to any city's borders).
  private addLuxuries(p: Player): void {
    if (!this.cities.some((c) => c.owner === p.id)) return;
    const y = this.luxuryYield(p);
    p.gold += y.gold;
    p.faith += y.faith;
    this.addScience(p, y.science);
    this.addCohesion(p, y.cohesion);
    this.addCulture(p, y.culture);
    this.turnLuxuries[p.id] = y;
    this.turnIncome[p.id] = addOut(this.turnIncome[p.id] ?? ZERO, y);
  }

  // ---------- what a civ can do ----------

  // Its techs', government's, policies' and identity's effects (effects.ts),
  // kept until any of those change.
  private readonly fxCache = new Map<number, { key: string; fx: Effect[] }>();
  effectsOf(p: Player): Effect[] {
    const key = `${p.techs.size}|${p.identity.size}|${p.government}|${SLOT_KINDS.map((s) => p.policies[s].join(',')).join(';')}`;
    const hit = this.fxCache.get(p.id);
    if (hit && hit.key === key) return hit.fx;
    const fx: Effect[] = [...governmentDef(p.government).effects];
    for (const slot of SLOT_KINDS) for (const k of p.policies[slot]) if (k) fx.push(...policyDef(k).effects);
    for (const k of p.techs) fx.push(...(techDef(k).effects ?? []));
    for (const k of p.identity) fx.push(...traitDef(k).effects);
    this.fxCache.set(p.id, { key, fx });
    return fx;
  }

  // What a civ can build: the starting items, and everything its techs and
  // politics unlock.
  unlocked(p: Player): Set<BuildKey> {
    const out = new Set<BuildKey>(STARTING);
    const add = (d: { units?: readonly UnitKey[]; buildings?: readonly BuildingKey[]; wonders?: readonly WonderKey[] }) => {
      for (const k of d.units ?? []) out.add(k);
      for (const k of d.buildings ?? []) out.add(k);
      for (const k of d.wonders ?? []) out.add(k);
    };
    for (const k of p.techs) add(techDef(k));
    for (const k of p.politics) add(politicsDef(k));
    // (Each religion's buildings: a city that holds it builds them, offers.)
    if (p.techs.has(TEMPLE_TECH)) for (const k of TEMPLE_KEYS) out.add(k);
    if (p.techs.has(CATHEDRAL_TECH)) for (const k of CATHEDRAL_KEYS) out.add(k);
    return out;
  }
  governmentsOf(p: Player): GovernmentKey[] {
    return (Object.keys(GOVERNMENTS) as GovernmentKey[]).filter((g) => g === 'chiefdom' || [...p.politics].some((c) => (politicsDef(c).governments ?? []).includes(g)));
  }
  policiesOf(p: Player): PolicyKey[] {
    return [...p.politics].flatMap((c) => [...(politicsDef(c).policies ?? [])]);
  }

  // The kinds an item counts as, for production bonuses.
  private prodKinds(key: BuildKey): ProdTarget[] {
    if (isUnitKey(key)) {
      if (key === 'settler') return ['settler'];
      const d = unitDef(key);
      if (d.civilian || key === 'scout') return [];
      const out: ProdTarget[] = ['military', d.siege ? 'siege' : isShooter(key) ? 'ranged' : d.mounted ? 'mounted' : 'melee'];
      return out;
    }
    return isWonder(key) ? ['wonder'] : ['building'];
  }

  // ---------- resources ----------

  // The resource on tile t civ `owner` has the use of: on its land, its
  // improvement built there (Civ V's: a mine on the iron), not pillaged; or
  // a wonder standing there, which works it as a city would.
  private connected(t: number, owner: number): ResourceKey | null {
    if (!this.resources[t] || this.ownerOf(t) !== owner || this.pillaged[t]) return null;
    const r = this.resourceFor(t, owner);
    return r && (this.builtAt(t) === RESOURCE_IMPROVEMENT[r] || this.wondersAt(t).length > 0) ? r : null;
  }
  // The resources on tiles a civ owns, by kind (each counted once; a
  // strategic one once the civ has revealed it).
  ownedResources(owner: number): Set<ResourceKey> {
    const out = new Set<ResourceKey>();
    for (let t = 0; t < this.N; t++) {
      const r = this.connected(t, owner);
      if (r) out.add(r);
    }
    return out;
  }
  // How many tiles of each it owns (its copies).
  resourceCopies(owner: number): Map<ResourceKey, number> {
    const out = new Map<ResourceKey, number>();
    for (let t = 0; t < this.N; t++) {
      const r = this.connected(t, owner);
      if (r) out.set(r, (out.get(r) ?? 0) + 1);
    }
    return out;
  }
  // What it has: its own and what its deals bring it.
  availableResources(owner: number): Set<ResourceKey> {
    const out = this.ownedResources(owner);
    for (const r of this.imports(owner)) out.add(r);
    return out;
  }
  hasResource(owner: number, r: ResourceKey): boolean { return this.availableResources(owner).has(r); }
  // A strategic resource's sources a civ has the use of: its own tiles of
  // it (improved), less those it trades away, plus those it trades for.
  resourceSources(owner: number, r: ResourceKey): number {
    return (this.resourceCopies(owner).get(r) ?? 0) - this.exports(owner).filter((x) => x === r).length + this.imports(owner).filter((x) => x === r).length;
  }
  // The units that need it a civ keeps, and how many more it could: each
  // source arms UNITS_PER_SOURCE of them (a second source, by settling,
  // trade or conquest, is worth having). Units it already has stay if a source is lost.
  resourceUsed(owner: number, r: ResourceKey): number { return this.units.reduce((n, u) => n + (u.owner === owner && unitDef(u.type).needs === r ? 1 : 0), 0); }
  resourceRoom(owner: number, r: ResourceKey): number { return UNITS_PER_SOURCE * this.resourceSources(owner, r) - this.resourceUsed(owner, r); }
  luxuriesOf(owner: number): ResourceKey[] { return [...this.availableResources(owner)].filter((r) => resourceDef(r).kind === 'luxury'); }
  // The empire bonus of its luxuries (one copy of each kind counts), and its effects' per luxury.
  luxuryYield(p: Player): Output {
    const kinds = this.luxuriesOf(p.id), per = flat(this.effectsOf(p), 'luxury');
    return kinds.reduce((s, k) => addOut(addOut(s, empireBonus(k, p.era)), per), ZERO);
  }

  // ---------- trade ----------

  // Whether open borders stand between two civs, a defensive pact; whether either has sworn off trading with the other.
  openBorders(a: number, b: number): boolean { return this.deals.some((t) => between(t, a, b) && t.give.some((i) => i.k === 'openBorders')); }
  pact(a: number, b: number): boolean { return this.deals.some((t) => between(t, a, b) && t.give.some((i) => i.k === 'pact')); }
  embargoed(a: number, b: number): boolean {
    return this.deals.some((t) => (partyTo(t, a) && givenBy(t, a).some((i) => i.k === 'embargo' && i.civ === b)) || (partyTo(t, b) && givenBy(t, b).some((i) => i.k === 'embargo' && i.civ === a)));
  }
  // What its deals bring it, and what it sends away (one entry a deal).
  imports(owner: number): ResourceKey[] {
    return this.deals.flatMap((t) => (partyTo(t, owner) ? givenBy(t, t.a === owner ? t.b : t.a).flatMap((i) => (i.k === 'resource' ? [i.resource] : [])) : []));
  }
  exports(owner: number): ResourceKey[] {
    return this.deals.flatMap((t) => givenBy(t, owner).flatMap((i) => (i.k === 'resource' ? [i.resource] : [])));
  }
  // The resources a civ has promised in letters not answered yet (it wrote them: what it offered is kept for the
  // answer, and cannot be sold again meanwhile). (`but`: one letter left out, when it is that letter being weighed.)
  promised(owner: number, but?: Offer): ResourceKey[] {
    return this.dealOffers.flatMap((o) => (o !== but && o.from === owner ? o.give.flatMap((i) => (i.k === 'resource' ? [i.resource] : [])) : []));
  }
  // The copies it could still trade away: past the one it keeps, those already sent, and those promised in a letter.
  spareResources(owner: number, but?: Offer): Map<ResourceKey, number> {
    const out = new Map<ResourceKey, number>(), sent = [...this.exports(owner), ...this.promised(owner, but)];
    for (const [r, n] of this.resourceCopies(owner)) {
      const spare = n - 1 - sent.filter((x) => x === r).length;
      if (spare > 0) out.set(r, spare);
    }
    return out;
  }
  // Whether two civs may trade: met, at peace, both alive, no embargo between them.
  canTrade(a: number, b: number): boolean {
    return a !== b && this.players[a]!.alive && this.players[b]!.alive && !!this.met[a]![b] && !this.atWar(a, b) && !this.embargoed(a, b);
  }
  // What `from` could give `to`: a spare copy of something `to` has
  // revealed (a strategic) and lacks.
  tradeable(from: number, to: number, but?: Offer): ResourceKey[] {
    const has = this.availableResources(to), techs = this.players[to]!.techs;
    return [...this.spareResources(from, but).keys()].filter((r) => !has.has(r) && (!resourceDef(r).reveal || techs.has(resourceDef(r).reveal!)));
  }
  // A civ's gold a turn, last turn, before its deals.
  goldRate(owner: number): number {
    const l = this.players[owner]!.ledger;
    return Math.max(0, Math.floor(l.income.gold + l.tithes - l.cityUpkeep - l.unitUpkeep));
  }
  // Why civ `giver` can't give item i to civ `taker` now, or null.
  // (`but`: the letter the item is in, if it is one already written: what it promises does not stand in its own way.)
  itemBlock(giver: number, taker: number, i: Item, but?: Offer): string | null {
    const G = this.players[giver]!, T = this.players[taker]!;
    const third = (x: number): string | null => (x === giver || x === taker || !this.players[x]?.alive ? 'No such civilization.' : !this.met[giver]![x] ? `The ${G.name} have not met the ${this.players[x]!.name}.` : null);
    switch (i.k) {
      case 'gold': case 'goldPerTurn': return Number.isInteger(i.n) && i.n > 0 ? null : 'Gold is given, not taken.';
      case 'resource': return this.tradeable(giver, taker, but).includes(i.resource) ? null : `The ${G.name} have no spare ${resourceDef(i.resource).name} the ${T.name} could use.`;
      case 'tech':
        if (!G.techs.has(i.tech) || T.techs.has(i.tech)) return `${techDef(i.tech).name} is not the ${G.name}' to teach the ${T.name}.`;
        return techDef(i.tech).needs.every((n) => T.techs.has(n)) ? null : `The ${T.name} lack what ${techDef(i.tech).name} rests on.`;
      case 'map': return null;
      case 'city': { const c = this.cityById.get(i.city); return !c || c.owner !== giver ? 'Not their city.' : G.capital === c.id ? 'A capital is not given away.' : c.razing ? 'It is burning.' : null; }
      case 'warOn': return third(i.civ) ?? (this.atWar(giver, i.civ) ? `The ${G.name} are at war with the ${this.players[i.civ]!.name} already.` : this.pact(giver, i.civ) ? `The ${G.name} are sworn to defend the ${this.players[i.civ]!.name}.` : this.truceLeft(giver, i.civ) > 0 ? `A truce binds the ${G.name} and the ${this.players[i.civ]!.name}.` : null);
      case 'peaceWith': {
        const why = third(i.civ);
        if (why) return why;
        if (!this.canMakePeace(giver, i.civ)) return `The ${G.name} and the ${this.players[i.civ]!.name} cannot make peace now.`;
        // (The third civ must want it too: the computer's is asked; the player's is the player's to make.)
        return this.players[i.civ]!.isHuman ? `Peace with the ${this.players[i.civ]!.name} is theirs to make.` : aiAcceptsPeace(this, this.players[i.civ]!, giver) ? null : `The ${this.players[i.civ]!.name} will not make peace.`;
      }
      case 'convert': return G.stateReligion === i.religion ? 'It is their state religion already.' : this.stateBlock(G, i.religion);
      case 'openBorders': return this.openBorders(giver, taker) ? 'Your borders are open to each other already.' : null;
      case 'pact': return this.pact(giver, taker) ? 'You are sworn to each other already.' : this.players.some((o) => o.alive && (this.atWar(giver, o.id) || this.atWar(taker, o.id))) ? 'A pact is sworn in peace: not while either is at war.' : null;
      case 'embargo': return third(i.civ) ?? (this.deals.some((t) => givenBy(t, giver).some((x) => x.k === 'embargo' && x.civ === i.civ)) ? `The ${G.name} have sworn off that trade already.` : null);
    }
  }
  // Why an offer can't be made now, or null.
  offerBlock(o: Offer): string | null {
    const A = this.players[o.from], B = this.players[o.to];
    if (!A || !B || o.from === o.to || !A.alive || !B.alive || !this.met[o.from]![o.to]) return 'You have not met.';
    const items = [...o.give, ...o.get];
    if (o.peace) {
      if (!this.atWar(o.from, o.to)) return 'You are not at war.';
      if (!this.canMakePeace(o.from, o.to)) return `Peace can be made once a war has lasted ${MIN_WAR} turns.`;
      if (items.some(isLasting)) return 'A peace is settled at once: nothing in it runs for turns.';
    } else {
      if (this.atWar(o.from, o.to)) return 'At war, only a peace can be agreed.';
      if (!items.length) return 'Nothing is traded.';
      if (this.embargoed(o.from, o.to) && items.some((i) => i.k === 'resource' || i.k === 'goldPerTurn')) return 'An embargo stands between you.';
    }
    if (items.some(isLasting) && items.some((i) => !isLasting(i))) return 'A deal is either settled at once or runs for turns: the two are not mixed.';
    for (const [giver, taker, list, back] of [[o.from, o.to, o.give, o.get], [o.to, o.from, o.get, o.give]] as const) {
      let gold = 0, rate = 0;
      for (let n = 0; n < list.length; n++) {
        const i = list[n]!;
        if (list.findIndex((x) => sameItem(x, i)) !== n) return 'The same thing is in it twice.';
        const why = this.itemBlock(giver, taker, i, o);
        if (why) return why;
        if (isMutual(i) && !back.some((x) => x.k === i.k)) return `${i.k === 'pact' ? 'A defensive pact' : 'Open borders'} binds both sides.`;
        if (i.k === 'gold') gold += i.n;
        if (i.k === 'goldPerTurn') rate += i.n;
      }
      if (gold > this.players[giver]!.gold) return `The ${this.players[giver]!.name} do not have ${gold} gold.`;
      if (rate > this.players[giver]!.gold + this.goldRate(giver)) return `The ${this.players[giver]!.name} cannot pay ${rate} gold a turn.`;
    }
    return null;
  }
  // Proposes a deal: a computer civ answers at once (diplomacy.ts: by how
  // the deal balances for it and what it thinks of the proposer), the
  // human in the Diplomacy sheet.
  propose(o: Offer): 'blocked' | 'declined' | 'offered' | 'signed' {
    if (this.offerBlock(o) !== null) return 'blocked';
    this.record('tradeProposed', o.from, { to: o.to, give: o.give, get: o.get, peace: o.peace === true, demand: o.demand === true });
    if (this.players[o.to]!.isHuman) {
      if (this.dealOffers.some((d) => d.from === o.from)) return 'declined';
      this.dealOffers.push(o);
      this.log(`The ${this.players[o.from]!.name} ${o.demand ? 'make a demand' : o.peace ? 'offer peace, with terms' : 'offer a deal'} (Diplomacy).`);
      return 'offered';
    }
    if (!aiAnswers(this, o)) return 'declined';
    this.sign(o);
    return 'signed';
  }
  // The human answers an offer. (A demand refused is remembered.)
  answerOffer(i: number, yes: boolean): boolean {
    const o = this.dealOffers[i];
    if (!o) return false;
    this.dealOffers.splice(i, 1);
    if (!yes) { if (o.demand) this.remember(o.from, o.to, 'demandRefused'); return false; }
    if (this.offerBlock(o) !== null) return false;
    this.sign(o);
    return true;
  }
  private sign(o: Offer): void {
    const A = this.players[o.from]!, B = this.players[o.to]!;
    this.record('trade', o.from, { with: o.to, give: o.give, get: o.get, peace: o.peace === true });
    noteDeal(this, o);
    const said = (list: readonly Item[]) => (list.length ? list.map((i) => itemText(this, i)).join(', ') : 'nothing');
    if (A.isHuman || B.isHuman) this.log(`Deal with the ${(A.isHuman ? B : A).name} signed: you give ${said(A.isHuman ? o.give : o.get)}; you get ${said(A.isHuman ? o.get : o.give)}.`);
    if (o.peace) this.makePeace(o.from, o.to);
    if ([...o.give, ...o.get].some(isLasting)) {
      this.deals.push({ a: o.from, b: o.to, give: o.give as readonly LastingItem[], get: o.get as readonly LastingItem[], since: this.turn, until: this.turn + DEAL_TURNS });
      // (An embargo sworn: its deals with that civ end.)
      for (const [s, list] of [[o.from, o.give], [o.to, o.get]] as const) for (const i of list) if (i.k === 'embargo') for (const t of this.deals.filter((x) => between(x, s, i.civ))) this.endDeal(t, 'an embargo');
      this.diploVersion++;
      return;
    }
    for (const [giver, taker, list] of [[o.from, o.to, o.give], [o.to, o.from, o.get]] as const) for (const i of list) this.settle(giver, taker, i);
    this.diploVersion++;
  }
  // A thing settled at once: handed over, or done.
  private settle(giver: number, taker: number, i: Item): void {
    const G = this.players[giver]!, T = this.players[taker]!;
    switch (i.k) {
      case 'gold': { const n = Math.min(i.n, G.gold); G.gold -= n; T.gold += n; break; }
      case 'tech': if (!T.techs.has(i.tech)) { T.bought.add(i.tech); this.learn(T, i.tech); } break;
      case 'map': {
        const from = this.known[giver]!, to = this.known[taker]!;
        for (let t = 0; t < this.N; t++) if (from[t]) to[t] = 1;
        for (let o = 0; o < this.players.length; o++) if (this.met[giver]![o] && o !== taker && this.players[o]!.alive) this.met[taker]![o] = this.met[o]![taker] = 1;
        break;
      }
      case 'city': { const c = this.cityById.get(i.city); if (c && c.owner === giver) this.captureCity(c, taker, true); break; }
      case 'warOn': if (!this.atWar(giver, i.civ)) { this.declareWar(giver, i.civ); this.remember(taker, giver, 'joinedWar'); } break;
      case 'peaceWith': this.makePeace(giver, i.civ); break;
      case 'convert': if (this.setStateReligion(G, i.religion)) this.remember(taker, giver, 'converted'); break;
      default: break;
    }
  }
  private endDeal(t: Treaty, why: string): void {
    const i = this.deals.indexOf(t);
    if (i < 0) return;
    this.deals.splice(i, 1);
    this.diploVersion++;
    this.record('tradeEnded', t.a, { with: t.b, why });
    if (t.a === HUMAN || t.b === HUMAN) this.log(`A deal with the ${this.players[t.a === HUMAN ? t.b : t.a]!.name} ended: ${why}.`);
  }
  // Either side ends a lasting deal once it has run DEAL_MIN turns.
  canCancel(t: Treaty): boolean { return this.deals.includes(t) && this.turn - t.since >= DEAL_MIN; }
  cancelTreaty(t: Treaty, by: number): boolean {
    if (!partyTo(t, by) || !this.canCancel(t)) return false;
    this.endDeal(t, `the ${this.players[by]!.name} ended it`);
    return true;
  }
  // Each turn: deals that ran out, lost their goods or their peace end; the gold is paid; what trade does for regard grows.
  private settleDeals(): void {
    for (const t of [...this.deals]) {
      const A = this.players[t.a]!, B = this.players[t.b]!;
      if (this.turn >= t.until) { this.endDeal(t, 'its term is over'); continue; }
      if (!A.alive || !B.alive || this.atWar(t.a, t.b)) { this.endDeal(t, 'no longer at peace'); continue; }
      const goods = [...t.give, ...t.get].some((i) => i.k === 'resource' || i.k === 'goldPerTurn');
      if (goods && this.embargoed(t.a, t.b)) { this.endDeal(t, 'an embargo'); continue; }
      const lost = ([[t.a, t.give], [t.b, t.get]] as const).find(([s, list]) => list.some((i) => i.k === 'resource' && (this.resourceCopies(s).get(i.resource) ?? 0) <= this.exports(s).filter((x) => x === i.resource).length));
      if (lost) { this.endDeal(t, `the ${this.players[lost[0]]!.name} lost their spare goods`); continue; }
      const rate = (list: readonly LastingItem[]) => list.reduce((n, i) => n + (i.k === 'goldPerTurn' ? i.n : 0), 0);
      const ra = rate(t.give), rb = rate(t.get);
      if (ra > A.gold || rb > B.gold) { this.endDeal(t, `the ${(ra > A.gold ? A : B).name} could not pay`); continue; }
      A.gold += rb - ra;
      B.gold += ra - rb;
      if (goods) { this.remember(t.a, t.b, 'trade'); this.remember(t.b, t.a, 'trade'); }
    }
  }
  // Its net gold a turn from deals.
  dealGold(owner: number): number {
    let n = 0;
    for (const t of this.deals) {
      if (!partyTo(t, owner)) continue;
      const mine = givenBy(t, owner), theirs = givenBy(t, t.a === owner ? t.b : t.a);
      for (const i of theirs) if (i.k === 'goldPerTurn') n += i.n;
      for (const i of mine) if (i.k === 'goldPerTurn') n -= i.n;
    }
    return n;
  }

  // ---------- what civs remember of each other ----------

  // Civ `of` remembers a thing of civ `about` (diplomacy.ts MEMOS): `times` instances of it, up to its most.
  remember(of: number, about: number, key: MemoKey, times = 1): void {
    if (of === about || of < 0 || about < 0 || !this.memos[of]?.[about]) return;
    const d = MEMOS[key], m = this.memos[of]![about]!, v = (m[key] ?? 0) + d.each * times;
    m[key] = d.each > 0 ? Math.min(d.most, v) : Math.max(d.most, v);
    this.memoVersion++;
  }
  memoVersion = 0; // (bumped whenever something is remembered)
  // A turn passes: what is remembered fades; peace and a shared enemy add up.
  private fadeMemos(): void {
    const n = this.players.length;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const m = this.memos[a]![b]!;
      for (const k of MEMO_KEYS) {
        const v = m[k];
        if (!v) continue;
        const step = 1 / MEMOS[k].fade, next = v > 0 ? Math.max(0, v - step) : Math.min(0, v + step);
        if (next === 0) delete m[k]; else m[k] = next;
      }
      if (!this.players[a]!.alive || !this.players[b]!.alive || !this.met[a]![b]) continue;
      if (this.atWar(a, b)) { delete m.peace; continue; }
      this.remember(a, b, 'peace');
      if (this.players.some((o) => o.alive && o.id !== a && o.id !== b && this.atWar(a, o.id) && this.atWar(b, o.id))) this.remember(a, b, 'sharedWar');
    }
  }
  // Fighting units left on land that has closed to them (a deal ended, a border grown over them, a peace made) go home.
  private expel(): void {
    for (const u of this.units) {
      if (unitDef(u.type).civilian || domainOf(unitDef(u.type)) === 'air' || !this.closedTo(u.owner, u.tile)) continue;
      const t = this.freeTileNear(u.type, u.owner, u.tile, 8) ?? (() => { const home = this.cities.find((c) => c.owner === u.owner); return home ? this.freeTileNear(u.type, u.owner, home.tile, 4) : null; })();
      if (t !== null) { u.tile = t; u.goal = null; u.work = null; u.job = null; }
    }
  }

  // ---------- the United Nations ----------

  // A civ's votes: a vote a citizen.
  unVotes(id: number): number { return this.cities.reduce((n, c) => n + (c.owner === id ? c.pop : 0), 0); }
  // The two civs the council votes between: those with the most votes.
  unCandidates(): [number, number] | null {
    const by = this.players.filter((p) => p.alive).map((p) => ({ id: p.id, v: this.unVotes(p.id) })).sort((a, b) => b.v - a.v || a.id - b.id);
    return by.length >= 2 ? [by[0]!.id, by[1]!.id] : null;
  }
  // The player's vote as it stands, between two candidates.
  ballotFor(candidates: readonly [number, number]): number | null {
    return this.ballot !== null && this.ballot !== HUMAN && candidates.includes(this.ballot) ? this.ballot : null;
  }
  // The votes a candidate needs: UN_SHARE of everyone's but its own.
  unNeeds(c: number): number { return Math.max(1, Math.ceil(UN_SHARE * this.players.reduce((s, p) => s + (p.alive && p.id !== c ? this.unVotes(p.id) : 0), 0))); }
  // The council sits when its turn has come: every civ votes (not for itself), and a candidate with UN_SHARE of the others' votes leads the world.
  private convene(): void {
    if (this.un.since === null || this.turn < this.un.next) return;
    const candidates = this.unCandidates();
    this.un = { ...this.un, next: this.turn + UN_EVERY };
    if (!candidates) return;
    const votes = this.players.filter((p) => p.alive).map((p) => ({ civ: p.id, weight: this.unVotes(p.id), for: p.isHuman ? this.ballotFor(candidates) : aiVote(this, p, candidates) }));
    const tally = (c: number) => votes.reduce((s, v) => s + (v.for === c && v.civ !== c ? v.weight : 0), 0);
    const winner = candidates.find((c) => tally(c) >= this.unNeeds(c)) ?? null;
    // (A vote is remembered by the candidates: for by the one it went to, against by the other.)
    for (const v of votes) for (const c of candidates) {
      if (v.civ === c || v.for === null) continue;
      this.remember(c, v.civ, v.for === c ? 'votedFor' : 'votedAgainst');
    }
    this.un = { ...this.un, last: { turn: this.turn, candidates, votes, winner } };
    this.record('unVote', -1, { candidates, votes, winner });
    const [x, y] = candidates, name = (c: number) => this.players[c]!.name;
    this.log(`The United Nations voted: the ${name(x)} ${tally(x)} of the ${this.unNeeds(x)} they need, the ${name(y)} ${tally(y)} of ${this.unNeeds(y)}.${winner !== null ? ` The ${name(winner)} lead the world!` : ''}`);
  }

  // ---------- research and politics ----------

  // Sets what a civ researches: the goal's path (the techs it needs first,
  // then it), the first of them now.
  setResearch(p: Player, goal: TechKey): void {
    const path = techPath(goal, p.techs);
    if (!path.length) return;
    p.research = path[0]!;
    p.researchQueue = path.slice(1);
    this.record('research', p.id, { tech: p.research, goal });
    if (p.scienceBank > 0) { const bank = p.scienceBank; p.scienceBank = 0; this.addScience(p, bank, false); }
  }
  setPolitics(p: Player, goal: PoliticsKey): void {
    const path = politicsPath(goal, p.politics);
    if (!path.length) return;
    p.studying = path[0]!;
    p.politicsQueue = path.slice(1);
    this.record('politics', p.id, { politics: p.studying, goal });
    if (p.cohesionBank > 0) { const bank = p.cohesionBank; p.cohesionBank = 0; this.addCohesion(p, bank, false); }
  }
  // Turns to finish a tech or politics at the civ's current rate.
  turnsTo(cost: number, progress: number, rate: number): number { return rate > 0 ? Math.max(1, Math.ceil((cost - progress) / rate)) : Infinity; }

  private addScience(p: Player, amount: number, tally = true): void {
    if (tally) p.science += amount;
    if (!p.research) { p.scienceBank += amount; return; }
    const k = p.research, got = (p.techProgress[k] ?? 0) + amount;
    if (got < this.techCost(k)) { p.techProgress[k] = got; return; }
    this.learn(p, k);
    this.addScience(p, got - this.techCost(k), false);
  }
  // A civ comes to know a tech (researched, or got in a deal): what it was researching moves on if this was it.
  private learn(p: Player, k: TechKey): void {
    p.techs.add(k);
    delete p.techProgress[k];
    // (A tech that improves the land restyles it: rural/stages.)
    if ((techDef(k).effects ?? []).some((e) => e.k === 'improvement')) this.useVersion++;
    this.record('researched', p.id, { tech: k, bought: p.bought.has(k) });
    if (p.isHuman) this.log(`${p.bought.has(k) ? 'Learned' : 'Researched'} ${techDef(k).name}.`);
    const era = Math.max(...[...p.techs].map((t) => techDef(t).era)) as EraIndex;
    if (era > p.era) {
      p.era = era;
      this.useVersion++; // towns restyle
      if (p.isHuman) this.log(`${p.name} entered the ${ERAS[era].name} era.`);
    }
    if (k === UN_TECH && this.un.since === null) {
      this.un = { since: this.turn, next: this.turn + UN_EVERY, last: null };
      // (A body of the whole world: every civ comes to know of every other through it.)
      for (const a of this.players) for (const b of this.players) if (a.id !== b.id && a.alive && b.alive) this.met[a.id]![b.id] = 1;
      this.record('unFounded', p.id, {});
      this.log(`The United Nations are founded: their council votes on a leader of the world every ${UN_EVERY} turns (Diplomacy).`);
    }
    p.researchQueue = p.researchQueue.filter((x) => x !== k);
    if (p.research !== k) return;
    const next = p.researchQueue.shift() ?? null;
    p.research = next;
    if (!next && !p.isHuman) { const pick = aiPickTech(this, p); if (pick) this.setResearch(p, pick); }
  }
  private addCohesion(p: Player, amount: number, tally = true): void {
    if (tally) p.cohesion += amount;
    if (!p.studying) { p.cohesionBank += amount; return; }
    const k = p.studying, got = (p.politicsProgress[k] ?? 0) + amount;
    if (got < this.politicsCost(k)) { p.politicsProgress[k] = got; return; }
    p.politics.add(k);
    delete p.politicsProgress[k];
    this.record('politicsDone', p.id, { politics: k });
    if (p.isHuman) this.log(`Adopted ${politicsDef(k).name}.`);
    const next = p.politicsQueue.shift() ?? null;
    p.studying = next;
    if (!next && !p.isHuman) { const pick = aiPickPolitics(this, p); if (pick) this.setPolitics(p, pick); }
    if (!p.isHuman) aiGovern(this, p);
    this.addCohesion(p, got - this.politicsCost(k), false);
  }
  // Culture is identity points to spend (identity.ts); the computer spends them at once.
  private addCulture(p: Player, amount: number): void {
    p.culture += amount;
    p.identityPoints += amount;
    if (!p.isHuman) aiPickTraits(this, p);
  }

  // ---------- identity ----------

  founded(): Set<ReligionKey> { return new Set(this.religions.keys()); }
  // The identity points the civ's next trait costs.
  nextTraitCost(p: Player): number { return this.paced(traitCost(p.identity.size)); }
  canAdopt(p: Player, k: TraitKey): boolean {
    return traitBlock(k, p.identity, p.era, this.founded()) === null && p.identityPoints >= this.nextTraitCost(p);
  }
  // Adopts trait k, for good; a faith still unfounded founds its religion.
  adoptTrait(p: Player, k: TraitKey): boolean {
    if (!this.canAdopt(p, k)) return false;
    p.identityPoints -= this.nextTraitCost(p);
    p.identity.add(k);
    this.record('trait', p.id, { trait: k });
    if (p.isHuman) this.log(`Your people are now known for ${traitDef(k).name}.`);
    const r = traitDef(k).religion;
    if (r && !this.religions.has(r)) this.foundReligion(p, r);
    return true;
  }

  // ---------- government ----------

  setGovernment(p: Player, g: GovernmentKey): boolean {
    if (!this.governmentsOf(p).includes(g) || p.government === g) return false;
    const old = p.policies;
    p.government = g;
    p.policies = emptySlots(g);
    // (The policies that still fit stay.)
    for (const slot of SLOT_KINDS) for (const k of old[slot]) if (k) this.slotPolicy(p, k);
    this.record('government', p.id, { government: g });
    if (p.isHuman) this.log(`${p.name} adopted ${governmentDef(g).name}.`);
    return true;
  }
  // Puts a policy in the first free slot it fits (its kind's before a wildcard).
  slotPolicy(p: Player, k: PolicyKey): boolean {
    if (!this.policiesOf(p).includes(k) || SLOT_KINDS.some((s) => p.policies[s].includes(k))) return false;
    for (const slot of [policyDef(k).kind, 'wildcard'] as PolicySlot[]) {
      const i = p.policies[slot].indexOf(null);
      if (i >= 0) { p.policies[slot][i] = k; this.record('policies', p.id, { policies: p.policies }); return true; }
    }
    return false;
  }
  setPolicy(p: Player, slot: PolicySlot, i: number, k: PolicyKey | null): boolean {
    if (i < 0 || i >= p.policies[slot].length) return false;
    if (k && (!this.policiesOf(p).includes(k) || !fits(k, slot))) return false;
    for (const s of SLOT_KINDS) p.policies[s] = p.policies[s].map((x) => (x === k ? null : x));
    p.policies[slot][i] = k;
    this.record('policies', p.id, { policies: p.policies });
    return true;
  }

  // ---------- religion ----------

  private foundReligion(p: Player, r: ReligionKey): void {
    const holy = p.capital;
    this.religions.set(r, { founder: p.id, holyCity: holy, turn: this.turn });
    if (holy !== null) this.cityById.get(holy)!.religions.add(r);
    this.faithVersion++;
    this.useVersion++;
    this.record('religionFounded', p.id, { religion: r, holyCity: holy });
    this.log(`${p.name} founded ${religionDef(r).name}.`);
    if (!p.isHuman) aiFaith(this, p);
  }

  // The religion a civ founded, and its holy city (null: it founded none).
  foundedBy(id: number): { religion: ReligionKey; holy: City | undefined } | null {
    for (const [r, f] of this.religions) if (f.founder === id) return { religion: r, holy: f.holyCity === null ? undefined : this.cityById.get(f.holyCity) };
    return null;
  }
  // The religions whose holy cities a civ holds (their tithes are its).
  holySeats(id: number): ReligionKey[] {
    return [...this.religions].filter(([, f]) => f.holyCity !== null && this.cityById.get(f.holyCity)?.owner === id).map(([r]) => r);
  }
  // How many of the world's cities hold a religion, and the share of its people living in them.
  followers(r: ReligionKey): { cities: number; share: number } {
    let cities = 0, all = 0, pop = 0;
    for (const c of this.cities) { all += c.pop; if (c.religions.has(r)) { cities++; pop += c.pop; } }
    return { cities, share: pop / Math.max(1, all) };
  }

  // ---- the state's religion ----
  // The religions a civ could take for its state's: those its own cities hold.
  stateOptions(id: number): ReligionKey[] {
    const out = new Set<ReligionKey>();
    for (const c of this.cities) if (c.owner === id) for (const r of c.religions) out.add(r);
    return [...out];
  }
  // What a civ's cities would make of their religions under a state religion (or none: null), in all.
  stateWorth(id: number, state: ReligionKey | null): Output {
    let sum = ZERO;
    for (const c of this.cities) if (c.owner === id) sum = addOut(sum, this.religionYield(c, state));
    return sum;
  }
  stateBlock(p: Player, r: ReligionKey | null): string | null {
    if (p.stateReligion === r) return r ? 'It is the state religion already.' : 'The state is secular already.';
    if (r && !this.stateOptions(p.id).includes(r)) return `None of your cities holds ${religionDef(r).name}.`;
    return p.conversion > 0 ? `Your people are still unsettled by the last change: ${p.conversion} more turns.` : null;
  }
  // Whether changing it now would unsettle its people (every change but its first religion).
  conversionCosts(p: Player): boolean { return p.hadStateReligion; }
  setStateReligion(p: Player, r: ReligionKey | null): boolean {
    if (this.stateBlock(p, r) !== null) return false;
    const costs = this.conversionCosts(p);
    p.stateReligion = r;
    if (r) p.hadStateReligion = true;
    if (costs) p.conversion = CONVERSION_TURNS;
    this.faithVersion++;
    this.diploVersion++;
    this.record('stateReligion', p.id, { religion: r, upheaval: costs });
    if (p.isHuman) this.log(`${r ? `${religionDef(r).name} is now the state religion` : 'The state is now secular'}${costs ? `: your cities make ${Math.round(100 * CONVERSION_COST)}% less cohesion for ${CONVERSION_TURNS} turns` : ''}.`);
    else if (this.met[HUMAN]?.[p.id]) this.log(`The ${p.name} ${r ? `made ${religionDef(r).name} their state religion` : 'became a secular state'}.`);
    return true;
  }
  // A civ's religion: its state's (none: secular).
  faithVersion = 0; // (bumped whenever a city takes a religion or a state changes its own)
  faithOf(id: number): ReligionKey | null { return this.players[id]?.stateReligion ?? null; }

  // ---- missionaries ----
  // A missionary of a religion is raised with faith in a city of its civ
  // that holds it (any civ's, not only the founder's); MISSIONARIES_MOST of a religion out at once.
  get missionaryCost(): number { return this.paced(MISSIONARY_FAITH); }
  missionaryCostOf(id: number): number { return Math.max(1, Math.round(this.missionaryCost / (1 + Math.max(0, total(this.effectsOf(this.players[id]!), 'missions')) / 100))); }
  missionaryBlock(id: number, city: City, r: ReligionKey): string | null {
    if (city.owner !== id) return 'Not your city.';
    if (!city.religions.has(r)) return `${city.name} does not hold ${religionDef(r).name}.`;
    if (this.units.filter((u) => u.owner === id && u.religion === r).length >= MISSIONARIES_MOST) return `You have ${MISSIONARIES_MOST} missionaries of ${religionDef(r).name} out already.`;
    if (this.musterTile(city, 'missionary') === null) return 'No room: the city and every tile around it hold a civilian.';
    const cost = this.missionaryCostOf(id);
    return this.players[id]!.faith < cost ? `Needs ${cost} faith.` : null;
  }
  trainMissionary(id: number, city: City, r: ReligionKey): Unit | null {
    if (this.missionaryBlock(id, city, r) !== null) return null;
    const cost = this.missionaryCostOf(id);
    this.players[id]!.faith -= cost;
    this.record('bought', id, { city: city.name, item: 'missionary', religion: r, currency: 'faith', cost });
    const u = this.createUnit('missionary', id, this.musterTile(city, 'missionary') ?? city.tile);
    u.religion = r;
    return u;
  }
  // It preaches in a city it stands in or beside, anyone's it is at peace
  // with, that does not hold its religion yet: the city takes it with
  // the odds of spreadChance (Civ IV's), and the missionary is spent
  // whether it does or not.
  preachChance(u: Unit, city: City): number { return spreadChance(city.religions.size, city.owner === u.owner); }
  preachTarget(u: Unit): City | null {
    const here = this.cityByTile.get(u.tile);
    if (here && this.preachBlock(u, here) === null) return here;
    let best: City | null = null;
    for (const t of this.tiles[u.tile]!.neighbors) { const c = this.cityByTile.get(t); if (c && this.preachBlock(u, c) === null && (!best || c.pop > best.pop)) best = c; }
    return best ?? here ?? this.tiles[u.tile]!.neighbors.map((t) => this.cityByTile.get(t)).find((c) => c !== undefined) ?? null;
  }
  preachBlock(u: Unit, city: City): string | null {
    if (!unitDef(u.type).preaches || !u.religion) return 'Only missionaries preach.';
    if (u.tile !== city.tile && !this.tiles[u.tile]!.neighbors.includes(city.tile)) return 'It must stand in the city or beside it.';
    if (city.religions.has(u.religion)) return `It holds ${religionDef(u.religion).name} already.`;
    return city.owner !== u.owner && this.atWar(u.owner, city.owner) ? 'No one listens to an enemy\'s preacher.' : null;
  }
  preach(u: Unit, city: City): boolean {
    if (this.preachBlock(u, city) !== null) return false;
    const r = u.religion!, chance = this.preachChance(u, city), took = this.rng() * 100 < chance;
    this.record('preached', u.owner, { city: city.name, cityOwner: city.owner, religion: r, chance, took });
    if (took) {
      city.religions.add(r);
      this.useVersion++;
      this.faithVersion++;
      if (city.owner === HUMAN || u.owner === HUMAN) this.log(`${religionDef(r).name} took root in ${city.name}.`);
      // (Its owner remembers whose missionary it was: its own state's faith spread, or a rival's brought in.)
      const creed = this.players[city.owner]!.stateReligion;
      if (city.owner !== u.owner && creed) this.remember(city.owner, u.owner, creed === r ? 'preachedOurs' : 'preachedRival');
      if (!this.players[city.owner]!.isHuman) aiFaith(this, this.players[city.owner]!);
    } else if (u.owner === HUMAN) this.log(`The missionary's preaching found no ears in ${city.name} (${chance} in 100).`);
    this.removeUnit(u);
    return true;
  }

  // ---------- accounts ----------

  // A city's upkeep (economy.ts): the capital pays none.
  upkeepOf(city: City): number {
    const p = this.players[city.owner]!;
    if (p.capital === null || p.capital === city.id) return 0;
    const cap = this.cityById.get(p.capital);
    const others = this.cities.filter((c) => c.owner === p.id).length - 1;
    const dist = cap ? Math.round(this.approxDist(city.tile, cap.tile)) : 0;
    return cityUpkeep(dist, others, city.buildings.has('courthouse'), total(this.effectsOf(p), 'upkeep'), city.pop) * this.inflation;
  }
  // A city's buildings' upkeep.
  buildingUpkeepOf(city: City): number {
    let n = 0;
    for (const b of city.buildings) n += buildingUpkeep(CITY_BUILDINGS[b].cost);
    return n * Math.max(0, 1 + total(this.effectsOf(this.players[city.owner]!), 'buildingUpkeep') / 100) * this.inflation;
  }
  // A civ's upkeep this turn: its cities' (and their buildings'), its
  // fighting units' beyond the free ones.
  upkeep(p: Player): { cities: number; units: number } {
    const cities = this.cities.filter((c) => c.owner === p.id);
    const fighting = this.units.filter((u) => u.owner === p.id && !unitDef(u.type).civilian).map((u) => unitDef(u.type).cost);
    return { cities: cities.reduce((s, c) => s + this.upkeepOf(c) + this.buildingUpkeepOf(c), 0), units: unitUpkeep(fighting, cities.length, total(this.effectsOf(p), 'freeUnits')) * this.inflation };
  }

  // ---------- upgrades ----------

  // What a unit could be upgraded to now (its line's next unit the civ can
  // build, the resource it needs owned), or null.
  upgradeTarget(u: Unit): UnitKey | null {
    let to = UPGRADES[u.type];
    // (Skipping what the civ never got: a warrior goes straight to a musketman once swordsmen are past.)
    const p = this.players[u.owner]!, can = this.unlocked(p);
    let best: UnitKey | null = null;
    while (to) {
      const need = unitDef(to).needs;
      // (One that needs the same resource as it does takes its place: no more is needed.)
      if (can.has(to) && (!need || unitDef(u.type).needs === need || this.resourceRoom(p.id, need) > 0)) best = to;
      to = UPGRADES[to];
    }
    return best;
  }
  // Gold to upgrade: UPGRADE_GOLD for each point of the difference in cost
  // (under what buying the new unit outright costs, GOLD_PER_PROD, but not
  // by so much that an army is best made of the cheapest units, upgraded).
  upgradeCost(u: Unit, to: UnitKey): number { return Math.max(10, Math.round(UPGRADE_GOLD * (UNITS[to].cost - UNITS[u.type].cost) * this.pace)); }
  // Upgrades a unit that stands in its own territory, with moves left; it keeps its HP share and spends its turn.
  canUpgrade(u: Unit): boolean {
    const to = this.upgradeTarget(u);
    return to !== null && u.moves > 0 && this.ownerOf(u.tile) === u.owner && this.players[u.owner]!.gold >= this.upgradeCost(u, to);
  }
  upgrade(u: Unit): boolean {
    if (!this.canUpgrade(u)) return false;
    const to = this.upgradeTarget(u)!, cost = this.upgradeCost(u, to);
    this.players[u.owner]!.gold -= cost;
    this.record('upgrade', u.owner, { unit: u.type, to, cost });
    u.type = to;
    u.moves = 0;
    return true;
  }
  // The turn's accounts: upkeep paid, tithes received (from every city holding a religion whose holy city it holds). What it cannot pay
  // it loses in proportion (economy.ts arrearsOf): next turn its cities
  // make that share less production, science and culture, and a unit it
  // cannot keep deserts. No floor: every city more that cannot be paid for
  // costs the whole civ.
  private settleAccounts(p: Player): void {
    const up = this.upkeep(p);
    let tithes = 0;
    const tithe = TITHE + total(this.effectsOf(p), 'tithe');
    for (const r of this.holySeats(p.id)) tithes += tithe * this.followers(r).cities;
    p.goldFrac += tithes - up.cities - up.units;
    const whole = Math.trunc(p.goldFrac);
    p.gold += whole;
    p.goldFrac -= whole;
    const was = p.arrears;
    p.arrears = 0;
    if (p.gold < 0) {
      const short = -p.gold;
      p.gold = 0;
      p.arrears = arrearsOf(short, up.cities + up.units);
      this.record('shortfall', p.id, { gold: short, arrears: +p.arrears.toFixed(2) });
      // (A unit it cannot pay leaves: the cheapest out of its cities first.)
      let gone: Unit | null = null;
      if (up.units > 0) {
        for (const u of this.units) {
          if (u.owner !== p.id || unitDef(u.type).civilian) continue;
          const better = !gone || Number(this.cityByTile.has(u.tile)) - Number(this.cityByTile.has(gone.tile)) < 0
            || (this.cityByTile.has(u.tile) === this.cityByTile.has(gone.tile) && unitDef(u.type).cost < unitDef(gone.type).cost);
          if (better) gone = u;
        }
        if (gone) this.removeUnit(gone);
      }
      if (p.isHuman) this.log(`The treasury is empty: ${short} gold short. Your cities make ${Math.round(100 * p.arrears)}% less production, science and culture${gone ? `, and a ${unitDef(gone.type).name} deserted` : ''}.`);
    } else if (was > 0 && p.isHuman) this.log('The treasury pays its way again.');
    p.ledger = { income: this.turnIncome[p.id] ?? ZERO, cityUpkeep: up.cities, unitUpkeep: up.units, tithes, luxuries: this.turnLuxuries[p.id] ?? ZERO, trade: this.dealGold(p.id) };
  }

  // The turn's figures, kept for the charts (a civ gone: noughts from then on).
  private chronicle(): void {
    for (const p of this.players) {
      const l = p.ledger, y = l.income;
      // (Gold in: its cities', tithes, what deals bring; out: upkeep, what deals take.)
      const row: Record<HistoryKey, number> = { score: this.score(p.id), science: y.science, culture: y.culture, cohesion: y.cohesion, faith: y.faith,
        income: Math.round(y.gold + l.tithes + Math.max(0, l.trade)), expenses: Math.round(l.cityUpkeep + l.unitUpkeep + Math.max(0, -l.trade)), treasury: p.gold };
      for (const k of HISTORY_KEYS) this.history[k]![p.id]!.push(p.alive ? row[k] : 0);
    }
  }
  // What a civ has, for the record.
  private summary(p: Player): Record<string, unknown> {
    const cities = this.cities.filter((c) => c.owner === p.id);
    return {
      cities: cities.length, pop: cities.reduce((s, c) => s + c.pop, 0), units: this.units.filter((u) => u.owner === p.id).length,
      gold: p.gold, techs: p.techs.size, politics: p.politics.size, traits: [...p.identity], era: p.era, government: p.government,
      income: p.ledger.income, upkeep: +(p.ledger.cityUpkeep + p.ledger.unitUpkeep).toFixed(2), tithes: p.ledger.tithes, luxuries: p.ledger.luxuries, trade: p.ledger.trade,
      deals: this.deals.filter((d) => partyTo(d, p.id)).length,
      wars: this.players.filter((o) => o.id !== p.id && this.atWar(p.id, o.id)).map((o) => o.id),
    };
  }

  // ---------- buying ----------

  // What finishing a city's current item costs in gold, or in faith (a
  // Shrine or a religion's building only); null if it can't be bought (a wonder).
  buyCost(city: City, currency: 'gold' | 'faith'): number | null {
    const k = city.building;
    if (!k || isWonder(k) || (isUnitKey(k) && this.unitBlock(city, k) !== null)) return null;
    // (Faith buys shrines and the religions' buildings; and, for a civ with a state religion, fighting units, raised in that faith.)
    if (currency === 'faith' && !FAITH_BUYS.has(k) && !(isUnitKey(k) && !unitDef(k).civilian && this.faithOf(city.owner) !== null)) return null;
    const left = Math.max(0, this.costOf(k) - city.prod);
    const discount = currency === 'gold' ? Math.max(0.2, 1 + total(this.effectsOf(this.players[city.owner]!), 'buyCost') / 100) : 1;
    return Math.ceil(left * (currency === 'gold' ? GOLD_PER_PROD : FAITH_PER_PROD) * discount);
  }
  buy(city: City, currency: 'gold' | 'faith'): boolean {
    const cost = this.buyCost(city, currency), p = this.players[city.owner]!;
    if (cost === null || (currency === 'gold' ? p.gold : p.faith) < cost) return false;
    if (currency === 'gold') p.gold -= cost; else p.faith -= cost;
    this.record('bought', p.id, { city: city.name, item: city.building, currency, cost });
    city.prod = this.costOf(city.building!);
    city.blessed = currency === 'faith';
    return true;
  }

  // ---------- diplomacy ----------

  atWar(a: number, b: number): boolean { return a !== b && this.relations[a]![b]!.war; }
  // How many turns of a truce are left between a and b (0: none): a peace
  // is a truce for TRUCE_TURNS. Nothing forbids breaking it; it costs.
  truceLeft(a: number, b: number): number {
    const r = this.relations[a]![b]!;
    return a === b || r.war || r.since === 0 ? 0 : Math.max(0, r.since + TRUCE_TURNS - this.turn);
  }
  // War declared. Breaking a truce dishonours the civ that does: for as
  // many turns as the truce had left, its people make TRUCE_BREAK less
  // cohesion (cityYields). So a war ended is not started again at once
  // for nothing; but it can be, at that price.
  // (`called`: it goes to war to honour a pact, not of its own will: nothing is held against it for that.)
  // A civ that goes to war of its own will loses its pacts (an aggressor stands alone); the civs sworn to defend
  // the one it falls on go to war with it in their turn.
  declareWar(a: number, b: number, called = false): void {
    if (a === b || this.atWar(a, b)) return;
    const sworn = this.players.filter((c) => c.alive && c.id !== a && c.id !== b && this.pact(b, c.id)).map((c) => c.id);
    const treaty = this.pact(a, b) || this.openBorders(a, b);
    // (Who thought well of the civ fallen on: they hold it against the one that did.)
    const friends = called ? [] : this.players.filter((c) => c.alive && c.id !== a && c.id !== b && !c.isHuman && this.met[c.id]![b] && this.met[c.id]![a] && regard(this, c.id, b).level >= FRIENDLY).map((c) => c.id);
    if (!called) for (const t of this.deals.filter((x) => partyTo(x, a) && x.give.some((i) => i.k === 'pact'))) this.endDeal(t, `the ${this.players[a]!.name} went to war`);
    const broken = this.truceLeft(a, b);
    if (broken > 0) {
      this.players[a]!.dishonor = Math.max(this.players[a]!.dishonor, broken);
      if (a === HUMAN) this.log(`You broke the peace with the ${this.players[b]!.name}: your people make ${Math.round(100 * TRUCE_BREAK)}% less cohesion for ${broken} turns.`);
    }
    this.relations[a]![b] = this.relations[b]![a] = { war: true, since: this.turn };
    this.diploVersion++;
    this.met[a]![b] = this.met[b]![a] = 1;
    this.peaceOffers.delete(`${a}>${b}`);
    this.peaceOffers.delete(`${b}>${a}`);
    for (const d of this.deals.filter((x) => between(x, a, b))) this.endDeal(d, 'war');
    for (let i = this.dealOffers.length - 1; i >= 0; i--) if (this.offerBlock(this.dealOffers[i]!) !== null) this.dealOffers.splice(i, 1);
    if (!called) {
      this.remember(b, a, 'declaredWar');
      if (broken > 0) this.remember(b, a, 'brokeTruce');
      if (treaty) this.remember(b, a, 'betrayed');
      for (const c of friends) this.remember(c, a, 'warOnFriend');
    }
    // (For the record: their states' religions.)
    const fa = this.faithOf(a), fb = this.faithOf(b);
    this.record('war', a, { on: b, faiths: !fa || !fb ? 'none' : fa === fb ? 'same' : 'rival' });
    if (a === HUMAN || b === HUMAN) this.log(`${this.players[a]!.name} declared war on ${this.players[b]!.name}!`);
    for (const c of sworn) {
      if (!this.players[c]!.alive || this.atWar(c, a)) continue;
      if (a === HUMAN || b === HUMAN || c === HUMAN) this.log(`The ${this.players[c]!.name}, sworn to defend the ${this.players[b]!.name}, go to war with the ${this.players[a]!.name}.`);
      this.declareWar(c, a, true);
    }
  }
  // Whether peace can be made yet (after MIN_WAR turns of war).
  canMakePeace(a: number, b: number): boolean { return this.atWar(a, b) && this.turn - this.relations[a]![b]!.since >= MIN_WAR; }
  makePeace(a: number, b: number): boolean {
    if (!this.canMakePeace(a, b)) return false;
    this.relations[a]![b] = this.relations[b]![a] = { war: false, since: this.turn };
    this.diploVersion++;
    this.peaceOffers.delete(`${a}>${b}`);
    this.peaceOffers.delete(`${b}>${a}`);
    this.record('peace', a, { with: b });
    if (a === HUMAN || b === HUMAN) this.log(`${this.players[a]!.name} and ${this.players[b]!.name} made peace.`);
    // (Units left standing in the other's territory go home.)
    for (const u of this.units) {
      const o = this.ownerOf(u.tile);
      if ((u.owner === a && o === b) || (u.owner === b && o === a)) {
        const home = this.cities.find((c) => c.owner === u.owner);
        const t = home ? this.freeTileNear(u.type, u.owner, home.tile) : null;
        if (t !== null) u.tile = t;
      }
    }
    return true;
  }
  // Offers peace: an AI answers at once (ai.ts); the human answers in the
  // diplomacy panel.
  offerPeace(from: number, to: number): boolean {
    if (!this.canMakePeace(from, to)) return false;
    this.record('peaceOffered', from, { to });
    if (!this.players[to]!.isHuman) return aiAcceptsPeace(this, this.players[to]!, from) ? this.makePeace(from, to) : false;
    this.peaceOffers.add(`${from}>${to}`);
    this.log(`${this.players[from]!.name} offers peace.`);
    return true;
  }
  // Civs meet once a unit or city of one comes within sight of the other's, or a unit of one near the other's land.
  private updateContacts(): void {
    const n = this.players.length;
    const seen = (p: number): number[] => [...this.units.filter((u) => u.owner === p).map((u) => u.tile), ...this.cities.filter((c) => c.owner === p).map((c) => c.tile)];
    const at = this.players.map((p) => (p.alive ? seen(p.id) : []));
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (this.met[a]![b]) continue;
      if (at[a]!.some((x) => at[b]!.some((y) => this.approxDist(x, y) <= 4))) {
        this.met[a]![b] = this.met[b]![a] = 1;
        if (a === HUMAN || b === HUMAN) this.log(`Met the ${this.players[a === HUMAN ? b : a]!.name}.`);
      }
    }
    // (And once a unit of one comes within two tiles of the other's land: borders are closed at peace, but they are seen.)
    for (const u of this.units) {
      for (const t of this.tilesWithin(u.tile, 2)) {
        const o = this.ownerOf(t);
        if (o < 0 || o === u.owner || this.met[u.owner]![o] || !this.players[o]!.alive) continue;
        this.met[u.owner]![o] = this.met[o]![u.owner] = 1;
        if (u.owner === HUMAN || o === HUMAN) this.log(`Met the ${this.players[u.owner === HUMAN ? o : u.owner]!.name}.`);
      }
    }
  }

  // ---------- turn flow ----------

  endTurn(): void {
    if (this.over) return;
    // Citizens the human left unplaced: the governor places them.
    for (const c of this.cities) if (c.growth > 0) this.autoPlace(c);
    // (Unanswered offers lapse, a demand ignored as one refused; the computer may make new ones.)
    for (const o of this.dealOffers) if (o.demand) this.remember(o.from, o.to, 'demandRefused');
    this.dealOffers.length = 0;
    for (const p of this.players) {
      if (!p.isHuman && p.alive) { this.explore(p.id); aiTurn(this, p); this.explore(p.id); }
    }
    this.advanceWork();
    this.turnIncome = [];
    this.turnLuxuries = [];
    for (const city of [...this.cities]) this.processCity(city);
    for (const p of this.players) if (p.alive) this.addLuxuries(p);
    this.settleDeals();
    for (const p of this.players) if (p.alive) this.settleAccounts(p);
    this.contestBorders();
    this.fadeMemos();
    this.expel();
    this.convene();
    // (Pillaged tiles wait for a worker to repair them: advanceWork.)
    for (let t = 0; t < this.N; t++) {
      if (!this.pillaged[t]) continue;
      const o = this.ownerOf(t);
      if (o < 0 || !this.builtAt(t)) { this.pillaged[t] = 0; this.useVersion++; continue; }
      // (Fallout clears by itself, down to what a worker can mend: the rest is the workers'.)
      if (this.pillaged[t]! > PILLAGE_REPAIR) this.pillaged[t]!--;
    }
    for (const u of this.units) {
      const mv = this.maxMoves(u.type, u.owner);
      if (u.moves >= mv && u.hp < 100) {
        // (Only on its own civ's land or waters; more in one of its cities.)
        const home = this.cityByTile.get(u.tile)?.owner === u.owner;
        if (home || this.ownerOf(u.tile) === u.owner) u.hp = Math.min(100, u.hp + (home ? GARRISON_HEAL : FIELD_HEAL) + total(this.effectsOf(this.players[u.owner]!), 'heal'));
      }
      u.moves = mv;
      u.skipped = false;
    }
    for (const p of this.players) if (p.dishonor > 0) p.dishonor--;
    for (const p of this.players) if (p.conversion > 0) p.conversion--;
    for (const p of this.players) if (p.alive) this.record('summary', p.id, this.summary(p));
    this.chronicle();
    this.turn++;
    for (const u of this.units.filter((x) => x.owner === HUMAN && x.goal != null)) this.continueGoto(u);
    this.checkElimination();
    this.updateContacts();
    this.updateVisibility();
    this.record('turn', -1, {});
  }

  private checkElimination(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      const hasCity = this.cities.some((c) => c.owner === p.id);
      const hasSettler = this.units.some((u) => u.owner === p.id && u.type === 'settler');
      if (!hasCity && !hasSettler) {
        p.alive = false;
        for (const u of this.units.filter((x) => x.owner === p.id)) this.removeUnit(u);
        this.log(`${p.name} has been destroyed!`);
      }
    }
    this.checkVictory();
  }

  // What a civ has made of its game (the time victory's measure, and the
  // scoreboard's): its citizens and cities, what it knows and has decided,
  // its wonders. A civ wiped out: nothing.
  score(id: number): number {
    const p = this.players[id]!;
    if (!p.alive) return 0;
    let pop = 0, cities = 0;
    for (const c of this.cities) if (c.owner === id) { pop += c.pop; cities++; }
    let wonders = 0;
    for (const t of this.wondersBuilt.values()) if (t >= 0 && this.ownerOf(t) === id) wonders++;
    return pop + 2 * cities + 4 * p.techs.size + 2 * p.politics.size + p.identity.size + 5 * wonders;
  }
  // The first capitals still standing that a civ holds, its own among them.
  capitalsHeld(id: number): number {
    let n = 0;
    for (const p of this.players) { const c = p.firstCapital === null ? undefined : this.cityById.get(p.firstCapital); if (c && c.owner === id) n++; }
    return n;
  }
  // The first capitals a conquest takes: two thirds of the civs the game
  // began with, rounded up (one's own among them).
  get capitalsToWin(): number { return Math.ceil((2 * this.players.length) / 3); }
  // The civ that holds that many (the one holding most, if several could), or null.
  private capitalsLord(): number | null {
    if (this.players.length < 2) return null;
    let best: number | null = null, bestN = this.capitalsToWin - 1;
    for (const p of this.players) { const n = p.alive ? this.capitalsHeld(p.id) : 0; if (n > bestN) { best = p.id; bestN = n; } }
    return best;
  }
  // (By diplomacy: voted leader of the world by the United Nations, convene.)
  // The game is won (VICTORIES): by conquest, holding two thirds of the civs' first capitals (or the last civ standing); by
  // science, the first to know the last tech; and, if no one has won by the
  // turn limit, on time by the best score. Checked as each turn ends.
  private checkVictory(): void {
    if (this.winner) return;
    const alive = this.players.filter((p) => p.alive);
    const best = (f: (p: Player) => number) => alive.reduce((a, b) => (f(b) > f(a) ? b : a));
    const lord = this.capitalsLord();
    if (alive.length === 1 && this.players.length > 1) this.winner = { player: alive[0]!.id, how: 'conquest' };
    else if (lord !== null) this.winner = { player: lord, how: 'conquest' };
    else if (alive.some((p) => p.techs.has(FINAL_TECH))) this.winner = { player: best((p) => (p.techs.has(FINAL_TECH) ? 1e9 : 0) + this.score(p.id)).id, how: 'science' };
    else if (this.un.last?.winner != null && this.un.last.turn >= this.turn - 1 && this.players[this.un.last.winner]!.alive) this.winner = { player: this.un.last.winner, how: 'diplomacy' };
    else if (this.turn > this.turnLimit && alive.length) this.winner = { player: best((p) => this.score(p.id)).id, how: 'time' };
    if (this.winner) this.record('victory', this.winner.player, { how: this.winner.how });
    const human = this.players[HUMAN]!;
    if (!human.isHuman) return;
    if (!human.alive || (this.winner && this.winner.player !== HUMAN)) this.over = 'defeat';
    else if (this.winner) this.over = 'victory';
  }

  // How high a tile stands in the way of a view: open ground and water 0,
  // woods or hills 1, wooded hills 2, mountains 3 (terrain.ts terrainFireCost's woods).
  viewHeight(t: number): number {
    const tt = this.terrainAt(t);
    if (tt.relief === 'mountains' || tt.feature === 'volcano') return 3;
    const b = BIOMES[tt.biome], wooded = (!b.water && b.move >= 2 && b.defense > 0) || tt.feature === 'mangrove';
    return (tt.relief === 'hills' ? 1 : 0) + (wooded ? 1 : 0);
  }
  // The tiles seen from `t`, out to `r`: the tiles next to it always;
  // further ones only along a line of tiles no higher than the viewer's
  // eye (on flat ground woods and hills hide what is behind them; from a
  // hill one sees over them, but not over wooded hills or mountains), or
  // when the tile itself stands above all that is before it (a mountain
  // range shows over a forest).
  sightFrom(t: number, r: number): number[] {
    const eye = this.relief[t] === 'flat' ? 0 : this.relief[t] === 'hills' ? 1 : 2;
    // (Ring by ring: the lowest screen any shortest way to each tile crosses.)
    const screen = new Map<number, number>([[t, -1]]);
    let ring = [t];
    const out = [t];
    for (let d = 1; d <= r; d++) {
      const next = new Map<number, number>();
      for (const p of ring) {
        const through = d === 1 ? -1 : Math.max(screen.get(p)!, this.viewHeight(p));
        for (const x of this.tiles[p]!.neighbors) {
          if (screen.has(x)) continue;
          next.set(x, Math.min(next.get(x) ?? Infinity, through));
        }
      }
      ring = [];
      for (const [x, s] of next) {
        screen.set(x, s);
        ring.push(x);
        if (s <= eye || this.viewHeight(x) > s) out.push(x);
      }
    }
    return out;
  }

  // What a civ's units and cities see now is added to what it has explored
  // (units by line of sight: sightFrom; a city its surroundings; its land).
  explore(id: number): void {
    const known = this.known[id]!;
    for (const u of this.units) {
      if (u.owner !== id) continue;
      const r = unitDef(u.type).sight ?? 2;
      for (const x of domainOf(unitDef(u.type)) === 'air' ? this.tilesWithin(u.tile, r) : this.sightFrom(u.tile, r)) known[x] = 1;
    }
    for (const c of this.cities) if (c.owner === id) for (const x of this.tilesWithin(c.tile, Math.max(2, c.ring))) known[x] = 1;
  }

  updateVisibility(): void {
    this.visible.fill(0);
    const reveal = (t: number, r: number) => { for (const x of this.tilesWithin(t, r)) this.visible[x] = 1; };
    for (const u of this.units) {
      if (u.owner !== HUMAN) continue;
      // (Aircraft see all below them.)
      if (domainOf(unitDef(u.type)) === 'air') reveal(u.tile, unitDef(u.type).sight ?? 2);
      else for (const x of this.sightFrom(u.tile, unitDef(u.type).sight ?? 2)) this.visible[x] = 1;
    }
    for (const c of this.cities) if (c.owner === HUMAN) reveal(c.tile, 2);
    // (Its territory is in sight too.)
    for (let t = 0; t < this.N; t++) if (this.ownerOf(t) === HUMAN) this.visible[t] = 1;
    for (let t = 0; t < this.N; t++) if (this.visible[t]) this.explored[t] = 1;
  }

  log(text: string): void {
    this.messages.push({ turn: this.turn, text });
    if (this.messages.length > 50) this.messages.shift();
  }

  // ---------- setup ----------

  private placeUnits(): void {
    this.players.forEach((p, i) => {
      const s = this.world.starts[i];
      if (s === undefined) return; // (a City Lab civ past the map's starts)
      // (Each on its own tile: createUnit finds the next free one.)
      this.createUnit('settler', p.id, s);
      const nb = this.tiles[s].neighbors.find((x) => !this.isWater(x)) ?? s;
      this.createUnit('warrior', p.id, nb);
      if (p.isHuman) this.createUnit('scout', p.id, nb);
    });
  }

}

// Whether two growth options are the same placement.
export const sameOption = (a: GrowthOption, b: GrowthOption): boolean =>
  a.kind === 'specialist' ? b.kind === 'specialist' && a.specialist === b.specialist : b.kind === 'rural' && a.tile === b.tile;

export const BUILDABLE: BuildKey[] = [...(Object.keys(UNITS) as UnitKey[]), ...(Object.keys(BUILDINGS) as BuildingKey[]), ...WONDER_KEYS];

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number { return this.keys.length; }

  push(key: number, val: number): void {
    const k = this.keys, v = this.vals;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.vals[a], this.vals[b]] = [this.vals[b], this.vals[a]];
  }
}
