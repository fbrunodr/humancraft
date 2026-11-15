import { unitDef, buildDef, domainOf, UNITS, type BuildKey, type UnitKey, type UnitDef } from './rules.ts';
import { BUILDING_KEYS, BUILDINGS, WONDER_KEYS, USE, CITY_REACH, weigh, addOut, OUTPUT_KEYS, ERAS, type BuildingKey } from './cities.ts';
import { resourceDef, empireBonus, type ResourceKey } from './resources.ts';
import { flat } from './effects.ts';
import { buildingUpkeep } from './economy.ts';
import { TECH_KEYS, techDef, type TechKey } from './techs.ts';
import { POLITICS_KEYS, politicsDef, policyDef, SLOT_KINDS, fits, type PoliticsKey, type GovernmentKey, type PolicyKey } from './politics.ts';
import { TRAIT_KEYS, traitDef, PATH_KEYS, PATHS, type PathKey, type TraitKey } from './identity.ts';
import { mulberry32 } from './rng.ts';
import { routeRoads } from './roads.ts';
import { RESOURCE_KEYS } from './resources.ts';
import { BEST, type AiPolicy } from './aiPolicy.ts';
import { militaryPhase, planWar, planning, onCampaign, operationOf } from './aiMilitary.ts';
import { isShooter, canAssault, canShoot } from './unitClasses.ts';
import { canAttackType } from './unitClasses.ts';
import { HOLY_STRIFE } from './religion.ts';
import { MIN_WAR, FAITH_VICTORY, type Game, type Player, type Unit, type City, type DealSide } from './game.ts';

// Deliberately simple AI: expand with settlers, improve the land with
// workers (about one for every WORKER_POP citizens), keep a garrison in every
// city, attack adjacent enemies when the odds are good and, at war with a
// few spare units, march on the nearest enemy city. Each civ has a bent
// (warlike or builder: its id and the seed) that steers its research,
// politics, government and policies, and how readily it goes to war; and
// its own taste in identity paths (pathTaste), so no two are alike.
const warlike = (g: Game, p: Player): boolean => (g.seed + p.id * 7) % 3 === 0;

// The numbers its decisions turn on: its policy (aiPolicy.ts; the game
// gives each civ one), leaned by its bent: the warlike sooner to war and
// fonder of what arms them, the builders the other way.
const leaned = new WeakMap<Game, { w: boolean; policy: AiPolicy }[]>();
function pol(g: Game, p: Player): AiPolicy {
  let all = leaned.get(g);
  if (!all) leaned.set(g, all = []);
  if (g.policyVersion !== versions.get(g)) { all.length = 0; versions.set(g, g.policyVersion); }
  // (By its bent as it is now: the same whether the game was played through or loaded.)
  const w = warlike(g, p), had = all[p.id];
  if (had && had.w === w) return had.policy;
  let mine: AiPolicy;
  {
    const b = g.aiPolicies[p.id]!;
    mine = { ...b,
      techUnits: b.techUnits * (w ? 1.33 : 0.67), techBuildings: b.techBuildings * (w ? 0.78 : 1.22), techWonders: b.techWonders * (w ? 0.67 : 1.33),
      warAfter: b.warAfter * (w ? 0.67 : 1.33), warChance: b.warChance * (w ? 1.6 : 0.6),
      policyMilitary: b.policyMilitary * (w ? 1.5 : 0.5), policySocial: b.policySocial * (w ? 0.67 : 1.33) };
  }
  all[p.id] = { w, policy: mine };
  return mine;
}
const versions = new WeakMap<Game, number>();

export function aiTurn(g: Game, p: Player): void {
  if (!p.research) { const t = aiPickTech(g, p); if (t) g.setResearch(p, t); }
  if (!p.studying) { const c = aiPickPolitics(g, p); if (c) g.setPolitics(p, c); }
  aiPickTraits(g, p);
  aiDiplomacy(g, p);
  aiTrade(g, p);
  const cities = g.cities.filter((c) => c.owner === p.id);
  const units = g.units.filter((u) => u.owner === p.id);
  const settlers = units.filter((u) => u.type === 'settler').length;
  const isMilitary = (u: Unit) => !unitDef(u.type).civilian;
  // (A garrison is a land unit: ships in port and aircraft don't hold a city.)
  const garrisoned = (c: City) => units.some((u) => u.tile === c.tile && isMilitary(u) && domainOf(unitDef(u.type)) === 'land');
  const P = pol(g, p), atWar = g.players.some((o) => o.alive && g.atWar(p.id, o.id));
  // (Its army is its land units: ships and aircraft are counted apart, each against its own share.)
  const dom = (u: Unit) => domainOf(unitDef(u.type));
  const military = units.filter((u) => isMilitary(u) && canAttackType(u.type) && dom(u) === 'land').length;
  p.offensive = onCampaign(g, p);
  const threatened = (c: City) => g.units.some((u) => g.atWar(p.id, u.owner) && !unitDef(u.type).civilian && g.approxDist(u.tile, c.tile) <= 3);

  // Workers (each builds a few improvements, then only roads and repairs):
  // enough for the land that waits, no more than its cities' size calls
  // for; one at least while a resource of its own lies unimproved.
  const open = g.openWork(p.id, (t) => usefulWork(g, p.id, t));
  const waiting = g.openWork(p.id, (t) => g.resourceFor(t, p.id) !== null);
  const byPop = cities.reduce((n, c) => n + (c.pop >= 2 ? Math.max(1, Math.floor(c.pop / P.workerPop)) : 0), 0);
  const wantWorkers = Math.max(Math.min(Math.ceil(open / 2), byPop), waiting > 0 ? 1 : 0);
  // (Those that can still build: one that has built all it could only lays roads and repairs.)
  let workers = units.filter((u) => u.type === 'worker' && u.charges > 0).length + cities.filter((c) => c.building === 'worker').length;
  let expansion = cities.length + settlers + cities.filter((c) => c.building === 'settler').length;
  // Losing money (Civ V's economic strategy of that name): no new units
  // while the treasury runs dry, and the weakest of an army it cannot pay
  // are let go, two a turn, garrisons last.
  const l = p.ledger, net = l.income.gold + l.tithes + l.trade - l.cityUpkeep - l.unitUpkeep;
  const broke = net < 0 && p.gold < 40;
  if (net < 0 && p.gold <= 0) {
    const spare = units.filter((u) => isMilitary(u) && !g.cityByTile.has(u.tile)).sort((a, b) => unitDef(a.type).cost - unitDef(b.type).cost);
    for (const u of spare.slice(0, 2)) g.removeUnit(u);
  }
  // (A civ hostile toward it, as it reads them: it arms.)
  const menaced = !atWar && g.players.some((o) => o.alive && o.id !== p.id && g.met[p.id]![o.id] && attitude(g, o, p.id) === 'hostile');
  const armyTarget = broke ? 0 : (P.armyBase + P.armyPerCity * cities.length) * (atWar || planning(g, p) ? P.armyWar : menaced ? P.armyThreat : 1);
  let coming = cities.filter((c) => c.building && c.building in UNITS && !unitDef(c.building as UnitKey).civilian && domainOf(unitDef(c.building as UnitKey)) === 'land').length;
  // A fleet: for a civ with ports, while a rival has a coast in its reach or ships it has seen: a share of its army.
  const ports = cities.filter((c) => g.cityCoast(c));
  const seaRival = ports.length > 0 && (g.cities.some((c) => c.owner !== p.id && g.known[p.id]![c.tile] && g.cityCoast(c) && ports.some((h) => g.approxDist(h.tile, c.tile) <= 20))
    || g.units.some((u) => u.owner !== p.id && domainOf(unitDef(u.type)) === 'sea' && g.known[p.id]![u.tile] && g.atWar(p.id, u.owner)));
  const building = (d: 'sea' | 'air') => cities.filter((c) => c.building && c.building in UNITS && domainOf(unitDef(c.building as UnitKey)) === d).length;
  const navyShort = broke || !seaRival ? 0 : Math.round(P.navyShare * armyTarget * Math.min(1, (2 * ports.length) / Math.max(1, cities.length))) - units.filter((u) => dom(u) === 'sea').length - building('sea');
  const airShort = broke ? 0 : Math.round(P.airShare * armyTarget) - units.filter((u) => dom(u) === 'air').length - building('air');
  for (const c of cities) {
    g.rework(c);
    if (!c.building) {
      c.building = chooseBuild(g, c, P, { expansion, garrisoned: garrisoned(c), military: military + coming, armyTarget, workersShort: wantWorkers - workers, atWar, threatened: threatened(c), navyShort, airShort });
      if (c.building === 'worker') workers++;
      else if (c.building === 'settler') expansion++;
      else if (c.building && c.building in UNITS) coming++;
    }
    // A full treasury buys: what a city builds, when it costs under a share
    // of the gold (half at least, when the treasury overflows).
    const cost = g.buyCost(c, 'gold');
    if (cost !== null && p.gold > P.goldReserve && cost < p.gold * (p.gold > 1000 ? Math.max(0.5, P.buyShare) : P.buyShare)) g.buy(c, 'gold');
    // Faith buys too: a shrine or a temple whenever it can; a unit while the army is short.
    const fc = g.buyCost(c, 'faith');
    if (fc !== null && p.faith >= fc && (!(c.building! in UNITS) || (military + coming <= armyTarget && g.rng() < P.faithUnits))) g.buy(c, 'faith');
    // Running out of room to grow: buy the best tile of the ring beyond (while the gold lasts).
    while (g.growthOptions(c).filter((o) => o.kind !== 'specialist').length < 2) {
      const t = g.governorTileToBuy(c);
      if (t === null || !g.buyTile(c, t)) break;
    }
  }

  // Gold to spare modernizes the army: the weakest units first.
  for (const u of [...units].sort((a, b) => unitDef(a.type).cost - unitDef(b.type).cost)) {
    const to = g.upgradeTarget(u);
    if (to && p.gold > 2 * g.upgradeCost(u, to) + P.upgradeReserve) g.upgrade(u);
  }

  for (const u of units) {
    if (u.dead) continue;
    if (u.type === 'settler') settlerTurn(g, u, P);
    else if (u.type === 'worker') workerTurn(g, u);
    else if (domainOf(unitDef(u.type)) === 'air') airTurn(g, u);
    else if (domainOf(unitDef(u.type)) === 'sea') seaTurn(g, u);
  }
  // Faith sends missionaries: the founder of a religion raises one when it
  // can pay for it and for the city it would go to, in
  // its city nearest that one; each then goes and preaches.
  const founded = g.foundedBy(p.id);
  if (founded) {
    const out = g.units.filter((u) => u.owner === p.id && u.type === 'missionary' && !u.dead);
    for (const u of out) missionaryTurn(g, u);
    // (Two out, and one more for every 300 faith it has laid by, six at most: faith kept is faith wasted.)
    if (out.length < Math.min(6, 2 + Math.floor(p.faith / (300 * g.pace))) && g.rng() < P.faithConvert) {
      const homes = cities.filter((c) => c.religion === founded.religion);
      const from = founded.holy?.owner === p.id ? founded.holy : homes[0];
      const target = from ? missionTarget(g, p.id, from.tile, p.faith - g.missionaryCost) : null;
      if (target && homes.length) {
        const home = homes.reduce((a, b) => (g.approxDist(b.tile, target.tile) < g.approxDist(a.tile, target.tile) ? b : a));
        const m = g.trainMissionary(p.id, home);
        if (m) missionaryTurn(g, m);
      }
    }
  }
  // The army (aiMilitary.ts): operations, tactics, garrisons and posts.
  militaryPhase(g, p, P, cities);
}

// What the armies a civ faces are made of: the land fighters of the civs
// it is at war with, or else of its neighbours it has met, that it has
// seen: the shares of them that ride, that shoot, that are armoured.
interface Facing { mounted: number; ranged: number; armored: number; air: number }
const facingCache = new WeakMap<Game, { turn: number; of: (Facing | undefined)[] }>();
function facing(g: Game, id: number): Facing {
  let c = facingCache.get(g);
  if (!c || c.turn !== g.turn) facingCache.set(g, c = { turn: g.turn, of: [] });
  const had = c.of[id];
  if (had) return had;
  const wars = g.players.filter((o) => o.alive && g.atWar(id, o.id)).map((o) => o.id);
  const whose = wars.length ? wars : g.players.filter((o) => o.alive && o.id !== id && g.met[id]![o.id]).map((o) => o.id);
  let n = 0, mounted = 0, ranged = 0, armored = 0, air = 0;
  for (const u of g.units) {
    const d = unitDef(u.type);
    if (whose.includes(u.owner) && domainOf(d) === 'air' && !d.nuke && g.known[id]![u.tile]) air++;
    if (!whose.includes(u.owner) || d.civilian || domainOf(d) !== 'land' || !g.known[id]![u.tile]) continue;
    n++;
    if (d.armored) armored++; else if (d.mounted) mounted++;
    if (isShooter(u.type) && !d.siege) ranged++;
  }
  return (c.of[id] = n < 3 ? { mounted: 0, ranged: 0, armored: 0, air } : { mounted: mounted / n, ranged: ranged / n, armored: armored / n, air });
}

// The best unit a city can build now for a role: defending (its defense),
// attacking (its attack), from those it has unlocked (and the resources).
// (`siege`: the best siege engine, for an army that means to take cities;
// `sea`, `air`: the best ship, the best aircraft.)
type Role = 'front' | 'ranged' | 'mounted' | 'siege' | 'sea' | 'air';
function bestUnit(g: Game, city: City, role: Role): UnitKey | null {
  let best: UnitKey | null = null, bestS = -1;
  const domain = role === 'sea' || role === 'air' ? role : 'land';
  const foe = facing(g, city.owner);
  for (const k of Object.keys(UNITS) as UnitKey[]) {
    const d: UnitDef = unitDef(k);
    // (The AI builds no nuclear weapons.)
    if (d.civilian || d.nuke || k === 'commander' || !canAttackType(k) || !g.canBuild(city, k) || domainOf(d) !== domain) continue;
    if (domain === 'land') {
      const is: Role = d.siege ? 'siege' : d.mounted ? 'mounted' : isShooter(k) ? 'ranged' : 'front';
      if (is !== role || (role === 'front' && !canAssault(k))) continue;
    }
    // (Its punch and its staying power, a little for being cheap: the newest it can build, mostly.)
    const hit = Math.max(d.melee, d.rangedAtk ?? 0), hold = (d.melee + d.rangedDef) / 2;
    // (And what it is made to beat, by how much of that the armies it faces are: pikes where they ride, horse where they shoot, guns where they roll.)
    const counters = 1 + 1.5 * ((d.vsMounted ?? 0) * foe.mounted + (d.vsRanged ?? 0) * foe.ranged + (d.vsArmor ?? 0) * foe.armored);
    const s = ((hit * 1.5 + hold + (d.mv > 1 ? 0.5 : 0)) * counters) / d.cost ** 0.25;
    if (s > bestS) { best = k; bestS = s; }
  }
  return best;
}
// The kind of land unit its army is shortest of, against the mix its policy wants.
function armyRole(g: Game, city: City, P: AiPolicy): UnitKey | null {
  const p = g.players[city.owner]!;
  const have: Record<'front' | 'ranged' | 'mounted' | 'siege', number> = { front: 0, ranged: 0, mounted: 0, siege: 0 };
  let n = 0;
  for (const u of g.units) {
    const d = unitDef(u.type);
    if (u.owner !== p.id || d.civilian || domainOf(d) !== 'land' || !canAttackType(u.type)) continue;
    have[d.siege ? 'siege' : d.mounted ? 'mounted' : isShooter(u.type) ? 'ranged' : 'front']++;
    n++;
  }
  // (Aircraft seen among those it faces: guns against them, one for every two, four at most.)
  const foe = facing(g, p.id);
  if (foe.air > 0) {
    const guns = g.units.filter((u) => u.owner === p.id && unitDef(u.type).aaRange).length + g.cities.filter((c) => c.owner === p.id && c.building && c.building in UNITS && unitDef(c.building as UnitKey).aaRange).length;
    if (guns < Math.min(4, Math.ceil(foe.air / 2))) {
      const gun = (Object.keys(UNITS) as UnitKey[]).filter((k) => unitDef(k).aaRange && g.canBuild(city, k)).sort((a, b) => unitDef(b).aaRange! - unitDef(a).aaRange! || unitDef(b).cost - unitDef(a).cost)[0];
      if (gun) return gun;
    }
  }
  const siege = onCampaign(g, p) ? P.siegeShare : P.siegeShare / 3;
  const want = { ranged: P.rangedShare, mounted: P.mountedShare, siege, front: Math.max(0.15, 1 - P.rangedShare - P.mountedShare - siege) };
  const roles = (['front', 'ranged', 'mounted', 'siege'] as const).map((r) => ({ r, short: want[r] - have[r] / Math.max(1, n), unit: bestUnit(g, city, r) }))
    .filter((x) => x.unit !== null).sort((a, b) => b.short - a.short);
  return roles[0]?.unit ?? null;
}

// What a city builds next: each kind of thing pulls by how much it is
// needed now and by its civ's policy; the strongest pull that can be
// answered wins (with a little chance, so cities differ).
interface BuildNeeds { expansion: number; garrisoned: boolean; military: number; armyTarget: number; workersShort: number; atWar: boolean; threatened: boolean; navyShort: number; airShort: number }
function chooseBuild(g: Game, city: City, P: AiPolicy, n: BuildNeeds): BuildKey | null {
  // (A garrison first: a city with none is anyone's who walks in; the unit that holds best at close quarters.)
  if (!n.garrisoned) return bestUnit(g, city, 'front') ?? bestUnit(g, city, 'ranged') ?? 'warrior';
  const wonder = (): BuildKey | null => {
    const options = WONDER_KEYS.filter((w) => g.canBuild(city, w) && !g.cities.some((c) => c.owner === city.owner && c.building === w));
    const w = options[Math.floor(g.rng() * options.length)];
    const t = w ? g.governorWonderSpot(city, w) : null;
    return w && t !== null && g.startWonder(city, w, t) ? w : null;
  };
  const unit = (): BuildKey | null => armyRole(g, city, P);
  // (Ships from a port while its fleet is short of what it wants, aircraft likewise: each a share of its army, by its policy.)
  const ship = n.navyShort > 0 && g.cityCoast(city) ? bestUnit(g, city, 'sea') : null;
  const plane = n.airShort > 0 ? bestUnit(g, city, 'air') : null;
  const short = (n.armyTarget - n.military) / Math.max(1, n.armyTarget);
  const pulls: [number, () => BuildKey | null][] = [
    [n.expansion < P.cityTarget && city.pop >= 2 && !n.threatened ? P.wSettle * (1 - n.expansion / P.cityTarget) * (n.atWar ? 0.5 : 1) : 0, () => 'settler'],
    [n.workersShort > 0 && city.pop >= 2 ? P.wWorker * Math.min(1, n.workersShort / 2) : 0, () => 'worker'],
    [short > 0 ? P.wArmy * (0.25 + short) * (n.threatened ? 2.5 : 1) : n.threatened && short > -0.5 ? P.wArmy * 0.5 : 0, unit],
    [ship && !n.threatened ? P.wArmy * (0.3 + Math.min(1, n.navyShort / 3)) * (n.atWar ? 1.2 : 0.6) : 0, () => ship],
    [plane ? P.wArmy * (0.3 + Math.min(1, n.airShort / 3)) * (n.atWar ? 1.2 : 0.6) : 0, () => plane],
    [city.pop >= 2 ? P.wBuild * 0.6 : P.wBuild * 0.15, () => bestBuilding(g, city)],
    [city.pop >= 5 && !n.atWar ? P.wWonder * 0.5 : 0, wonder],
    [!city.buildings.has('walls') && g.turn > 40 && g.canBuild(city, 'walls') ? P.wWalls * (n.threatened || n.atWar ? 0.8 : 0.3) : 0, () => 'walls'],
    // (A scout while enough of the land round it is still unknown and it has none out: how much is enough is its policy's.)
    [g.canBuild(city, 'scout') && !g.units.some((u) => u.owner === city.owner && (u.type === 'scout' || u.type === 'explorer')) && unknownNear(g, city) > P.scoutUnknown ? P.scoutRate * 1.5 : 0, () => 'scout'],
  ];
  const order = pulls.filter(([w]) => w > 0).map(([w, make]) => ({ w: w + 0.15 * g.rng(), make })).sort((a, b) => b.w - a.w);
  for (const o of order) { const k = o.make(); if (k) return k; }
  // (Nothing to build: a wonder rather than idle production; at war, more arms, while they can be paid; else the production is banked as gold.)
  return wonder() ?? (n.atWar && n.armyTarget > 0 && n.military < 1.5 * n.armyTarget ? unit() : null);
}

// The share of the land within ten tiles of a city its civ has not explored.
function unknownNear(g: Game, city: City): number {
  let land = 0, dark = 0;
  // (Of the land a scout could walk to: its own landmass. What lies over the water is not a scout's to find.)
  const mass = g.flora.landmass[city.tile];
  for (const t of g.tilesWithin(city.tile, 10)) { if (g.isWater(t) || g.flora.landmass[t] !== mass) continue; land++; if (!g.known[city.owner]![t]) dark++; }
  return dark / Math.max(1, land);
}

// The building worth most for the city's focus per point of cost (one of
// the top three, so cities differ).
function bestBuilding(g: Game, city: City): BuildingKey | null {
  const scored: { k: BuildingKey; s: number }[] = [];
  // (Short of gold: what pays, and the Courthouse where upkeep bites, first.)
  const p = g.players[city.owner]!, l = p.ledger;
  const broke = l.income.gold + l.tithes - l.cityUpkeep - l.unitUpkeep < 0 && p.gold < 100;
  for (const k of BUILDING_KEYS) {
    if (k === 'walls' || !g.canBuild(city, k)) continue;
    const yields = g.buildingGain(city, k);
    const upkeep = buildingUpkeep(buildDef(k).cost);
    const gain = weigh(city.focus, yields) - upkeep * (broke ? 4 : 1.5) + (broke ? 3 * yields.gold : 0)
      + (k === 'courthouse' ? g.upkeepOf(city) * (broke ? 4 : 2) : 0);
    // (And what yields do not show: a city's defences; the food an Aqueduct keeps, and the Hospital it opens.)
    const defense = k === 'barracks' || k === 'stable' ? 3 : k === 'aqueduct' ? 1.5 + 0.25 * city.pop : 0;
    if (gain + defense <= 0) continue;
    scored.push({ k, s: (gain + defense) / buildDef(k).cost });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, 3);
  return top.length ? top[Math.floor(g.rng() * top.length)]!.k : null;
}

// The resources a city at t would hold close by (those its civ knows of; one it has no source of counts twice).
function resourcesNear(g: Game, owner: number, t: number): number {
  let n = 0;
  for (const x of g.tilesWithin(t, 2)) {
    const r = g.ownerOf(x) < 0 && g.known[owner]![x] ? g.resourceFor(x, owner) : null;
    if (r) n += g.hasResource(owner, r) ? 1 : 2;
  }
  return n;
}
function settlerTurn(g: Game, u: Unit, P: AiPolicy): void {
  if (g.turn <= 2 && g.canFoundCity(u.tile, u.owner)) { g.foundCity(u); return; }

  if (u.aiTarget == null || !g.canFoundCity(u.aiTarget, u.owner)) {
    const dist = g.tilesWithinMap(u.tile, Math.round(P.settleReach));
    const cand: { t: number; s: number }[] = [];
    for (const [t, d] of dist) {
      // (Only land it has explored: it settles where it has been to look.)
      if (g.known[u.owner]![t] && g.canFoundCity(t, u.owner)) cand.push({ t, s: g.siteScore(t) - P.settleDist * d + P.siteResource * resourcesNear(g, u.owner, t) });
    }
    cand.sort((a, b) => b.s - a.s);
    u.aiTarget = cand.slice(0, 6).find((c) => g.findPath(u, c.t))?.t ?? null;
  }
  if (u.aiTarget == null) {
    if (g.canFoundCity(u.tile, u.owner)) g.foundCity(u);
    return;
  }
  if (u.tile !== u.aiTarget) g.goTo(u, u.aiTarget);
  if (!u.dead && u.tile === u.aiTarget) g.foundCity(u);
}

// Where a worker's work serves: within its city's reach, or on a resource
// (which counts wherever it is).
const usefulWork = (g: Game, owner: number, t: number): boolean => {
  const c = g.cityById.get(g.tileCity[t]!);
  return !!g.resourceFor(t, owner) || (!!c && g.tilesWithin(c.tile, CITY_REACH).includes(t));
};

// A worker at work stays at it; else it goes to the best tile of its civ
// to improve (worked tiles first, then resources, then what it yields
// improved, nearer the better) and starts there. (Only where it serves:
// within its city's reach, or on a resource, which counts wherever it is.)
function workerTurn(g: Game, u: Unit): void {
  if (u.work !== null) return;
  const useful = (t: number) => usefulWork(g, u.owner, t);
  const here = g.improveTarget(u);
  if (here !== null && useful(here) && (u.aiTarget === null || u.aiTarget === here)) { g.improve(u, here); u.aiTarget = null; return; }
  const ok = (t: number) => g.ownerOf(t) === u.owner && !g.isWater(t) && g.improveBlock({ ...u, tile: t, moves: 1 }, t) === null && useful(t)
    && !g.units.some((v) => v !== u && v.owner === u.owner && (v.work === t || (v.type === 'worker' && v.aiTarget === t)));
  if (u.aiTarget === null || !ok(u.aiTarget)) {
    let best: number | null = null, bestS = -Infinity;
    for (const [t, d] of g.tilesWithinMap(u.tile, 8)) {
      if (!ok(t)) continue;
      const res = g.resourceFor(t, u.owner);
      const s = (g.use[t] === USE.rural ? 6 : 0) + (res ? pol(g, g.players[u.owner]!).workerResource : 0) + weigh('balanced', g.improvedYield(t, u.owner)) - weigh('balanced', g.workedYield(t, u.owner)) - 0.7 * d;
      if (s > bestS) { best = t; bestS = s; }
    }
    u.aiTarget = best;
  }
  if (u.aiTarget === null) {
    // Nothing to improve or mend: the roads between its civ's cities, the
    // nearest stretch still to lay. A worker with nothing left to build
    // and no road to lay is let go (its upkeep saved).
    // (Or a fort, now and then: by the city of its civ nearest a rival's, on its side toward that rival, where no citizen works.)
    if (u.charges > 0 && g.rng() < pol(g, g.players[u.owner]!).fortRate) {
      const spot = fortSpot(g, u.owner);
      if (spot !== null && g.approxDist(u.tile, spot) <= 10) {
        if (u.tile !== spot) g.goTo(u, spot);
        if (!u.dead && u.tile === spot && u.moves > 0) g.buildFort(u);
        return;
      }
    }
    const road = roadTarget(g, u);
    if (road === null) { if (u.charges <= 0) g.removeUnit(u); else u.fortified = true; return; }
    if (u.tile !== road) g.goTo(u, road);
    if (!u.dead && u.tile === road && u.moves > 0) g.buildRoad(u);
    return;
  }
  if (u.tile !== u.aiTarget) g.goTo(u, u.aiTarget);
  if (!u.dead && u.tile === u.aiTarget && u.moves > 0 && g.improve(u, u.tile)) u.aiTarget = null;
}

// Where a civ would build a fort: by its city nearest a rival's, the free tile next to it on that rival's side.
function fortSpot(g: Game, owner: number): number | null {
  let best: { c: City; r: City; d: number } | null = null;
  for (const c of g.cities) {
    if (c.owner !== owner) continue;
    for (const r of g.cities) {
      if (r.owner === owner || !g.known[owner]![r.tile]) continue;
      const d = g.approxDist(c.tile, r.tile);
      if (!best || d < best.d) best = { c, r, d };
    }
  }
  if (!best || best.d > 12) return null;
  const { c, r } = best;
  if (g.tiles[c.tile]!.neighbors.some((t) => g.fort[t])) return null;
  const free = g.tiles[c.tile]!.neighbors.filter((t) => !g.isWater(t) && g.relief[t] !== 'mountains' && g.ownerOf(t) === owner && g.use[t] === USE.wild && g.builtAt(t) === null && !g.wondersAt(t).length);
  return free.length ? free.reduce((a, b) => (g.approxDist(b, r.tile) < g.approxDist(a, r.tile) ? b : a)) : null;
}

// The city a missionary of a civ would go to from a tile: one it knows,
// not of its religion, not a holy city nor lately converted, of no civ it
// is at war with, that its faith can pay for; the more people and the
// nearer the better (its own a little before others').
function missionTarget(g: Game, id: number, from: number, faith: number): City | null {
  const mine = g.foundedBy(id);
  if (!mine) return null;
  const holy = new Set([...g.religions.values()].map((f) => f.holyCity));
  let best: City | null = null, bestS = 0;
  for (const c of g.cities) {
    if (c.religion === mine.religion || holy.has(c.id) || c.devout > g.turn || !g.known[id]![c.tile] || (c.owner !== id && g.atWar(id, c.owner)) || g.preachCost(c) > faith) continue;
    const s = (c.pop * (c.owner === id ? 1.3 : 1)) / (1 + g.approxDist(from, c.tile) / 8);
    if (s > bestS) { best = c; bestS = s; }
  }
  return best;
}
// A missionary's turn: it preaches if it can where it stands; else it goes toward the city it would convert, to stand beside it.
function missionaryTurn(g: Game, u: Unit): void {
  const here = g.preachTarget(u);
  if (here && g.preach(u, here)) return;
  const target = missionTarget(g, u.owner, u.tile, g.players[u.owner]!.faith);
  if (!target || u.moves <= 0) return;
  const spots = [target.tile, ...g.tiles[target.tile]!.neighbors].filter((t) => g.canStand(u, t) && !g.isForeignBlocked(t, u.owner) && !g.isEnemyOccupied(t, u.owner))
    .sort((a, b) => g.approxDist(a, u.tile) - g.approxDist(b, u.tile));
  for (const t of spots) {
    if (!g.findPath(u, t)) continue;
    g.goTo(u, t);
    break;
  }
  if (u.dead) return;
  const now = g.preachTarget(u);
  if (now) g.preach(u, now);
}

// The tiles each civ's roads should run on (roads.ts routeRoads between
// its own cities), worked out once a turn.
const roadPlans = new WeakMap<Game, { key: string; tiles: Map<number, Set<number>> }>();
function roadPlan(g: Game, owner: number): Set<number> {
  const key = `${g.turn}|${g.cities.length}`;
  let plan = roadPlans.get(g);
  if (!plan || plan.key !== key) {
    const tiles = new Map<number, Set<number>>();
    for (const r of routeRoads(g)) {
      const o = g.cityById.get(r.a)!.owner;
      if (g.cityById.get(r.b)!.owner !== o) continue;
      let set = tiles.get(o);
      if (!set) tiles.set(o, set = new Set());
      for (const t of r.tiles) set.add(t);
    }
    plan = { key, tiles };
    roadPlans.set(g, plan);
  }
  return plan.tiles.get(owner) ?? new Set();
}
// The nearest tile of its civ's road plan a worker could lay now (none other at it).
function roadTarget(g: Game, u: Unit): number | null {
  let best: number | null = null, bestD = Infinity;
  for (const t of roadPlan(g, u.owner)) {
    if (g.hasRoad(t) || g.roadBlock({ ...u, tile: t, moves: 1 }) !== null) continue;
    if (g.units.some((v) => v !== u && v.owner === u.owner && v.type === 'worker' && (v.work === t || v.goal === t))) continue;
    const d = g.approxDist(u.tile, t);
    if (d < bestD && d <= 12) { best = t; bestD = d; }
  }
  return best;
}

// An aircraft strikes the best target in its range it is likely to win
// against; else it waits in its city.
function airTurn(g: Game, u: Unit): void {
  // (It strikes what it can reach from its base, where the odds are best: a hurt unit, a garrison, an engine.)
  let best: number | null = null, bestS = 0.5;
  for (const t of g.tilesWithin(u.tile, unitDef(u.type).range ?? 1)) {
    if (!g.isEnemyOccupied(t, u.owner) || g.attackBlockAt(u, t) !== null) continue;
    const pv = g.combatPreview(u, t), odds = pv ? pv.atk / (pv.atk + pv.def) : 0.6;
    const s = odds + (pv && pv.defender.hp < 50 ? 0.15 : 0) + (g.cityByTile.has(t) ? 0.1 : 0);
    if (s > bestS) { best = t; bestS = s; }
  }
  if (best !== null) { g.goTo(u, best); return; }
  // Nothing in reach: it moves to the base of its civ's nearest the fighting (an enemy unit, else an enemy city), a hop at a time.
  if (u.hp < 50) return;
  const foe = (t: number) => g.isEnemyOccupied(t, u.owner);
  let front: number | null = null, frontD = Infinity;
  for (const v of g.units) if (v.owner !== u.owner && g.atWar(u.owner, v.owner) && g.known[u.owner]![v.tile]) { const d = g.approxDist(u.tile, v.tile); if (d < frontD) { front = v.tile; frontD = d; } }
  if (front === null) for (const c of g.cities) if (g.atWar(u.owner, c.owner) && g.known[u.owner]![c.tile]) { const d = g.approxDist(u.tile, c.tile); if (d < frontD) { front = c.tile; frontD = d; } }
  void foe;
  if (front === null) return;
  let base: number | null = null, baseD = frontD - 1;
  for (const c of g.cities) {
    if (c.owner !== u.owner || !g.canRebase(u, c.tile)) continue;
    const d = g.approxDist(c.tile, front);
    if (d < baseD) { base = c.tile; baseD = d; }
  }
  if (base !== null) g.goTo(u, base);
}
// A ship's turn. Hurt, it makes for port. Else it fires on what it
// reaches (a ship that shoots: the enemy's ships and embarked units
// first, then a garrison on the coast, its army's target above all), or
// closes with an enemy ship or an embarked unit it would likely beat.
// With nothing in reach it sails for where it is of use: the coast of the
// city its army is out to take; else the nearest enemy at sea it knows
// of; else an enemy port; and at peace it keeps to its own.
function seaTurn(g: Game, u: Unit): void {
  const T = unitDef(u.type), p = u.owner;
  const home = (): City | null => { let best: City | null = null, d = Infinity; for (const c of g.cities) if (c.owner === p && g.cityCoast(c)) { const x = g.approxDist(c.tile, u.tile); if (x < d) { best = c; d = x; } } return best; };
  if (u.hp < 50) { const h = home(); if (h && u.tile !== h.tile) { g.goTo(u, h.tile); if (u.tile !== h.tile) return; } u.fortified = true; return; }
  const op = operationOf(g, p), goal = op ? g.cityById.get(op.target) : undefined;
  const strike = (): boolean => {
    if (u.moves <= 0) return false;
    let best: number | null = null, bestS = 0, mode: 'ranged' | 'melee' = 'ranged';
    if (canShoot(u.type)) {
      for (const t of g.fireReach(u)) {
        if (!g.isEnemyOccupied(t, p) || g.attackBlockAt(u, t, 'ranged') !== null) continue;
        const pv = g.combatPreview(u, t, 'ranged');
        if (!pv) continue;
        const s = pv.atk / (pv.atk + pv.def) + (g.isWater(t) ? 0.3 : 0) + (goal && t === goal.tile ? 0.3 : 0) + (pv.defender.hp < 50 ? 0.2 : 0);
        if (s > bestS) { best = t; bestS = s; mode = 'ranged'; }
      }
    }
    if (best === null && canAssault(u.type)) {
      for (const t of g.tilesWithin(u.tile, Math.max(1, Math.floor(u.moves)))) {
        if (!g.isWater(t) || !g.isEnemyOccupied(t, p) || g.attackBlockAt(u, t, 'melee') !== null) continue;
        const pv = g.combatPreview(u, t, 'melee');
        if (!pv) continue;
        const odds = pv.atk / (pv.atk + pv.def);
        if (odds < 0.5 && pv.defender.hp > 40) continue;
        const path = g.findPath(u, t);
        if (!path || g.pathTurns(u, path) > 1) continue;
        if (odds > bestS) { best = t; bestS = odds; mode = 'melee'; }
      }
    }
    if (best === null) return false;
    if (mode === 'ranged') g.attack(u, best, 'ranged'); else g.goTo(u, best, 'melee');
    return true;
  };
  if (strike()) return;
  // Where to: a tile of water within its reach of the place, the nearest to it.
  const reach = canShoot(u.type) ? T.reach ?? 1 : 1;
  const toward = (place: number): boolean => {
    let best: number | null = null, bestD = Infinity;
    for (const [t, d] of g.tilesWithinMap(place, reach)) {
      if (d === 0 || !g.isWater(t) || !g.canStand(u, t) || g.isEnemyOccupied(t, p) || g.isForeignBlocked(t, p)) continue;
      const x = g.approxDist(t, u.tile);
      if (x < bestD) { best = t; bestD = x; }
    }
    if (best === null || best === u.tile) return best !== null;
    if (!g.findPath(u, best)) return false;
    g.goTo(u, best);
    return true;
  };
  const wars = g.players.filter((o) => o.alive && g.atWar(p, o.id)).map((o) => o.id);
  let went = false;
  if (wars.length) {
    if (goal && wars.includes(goal.owner) && g.cityCoast(goal)) went = toward(goal.tile);
    if (!went) {
      let foe: number | null = null, d = 12;
      for (const v of g.units) if (wars.includes(v.owner) && g.isWater(v.tile) && g.known[p]![v.tile]) { const x = g.approxDist(v.tile, u.tile); if (x < d) { foe = v.tile; d = x; } }
      if (foe !== null) went = toward(foe);
    }
    if (!went) {
      let port: City | null = null, d = 16;
      for (const c of g.cities) if (wars.includes(c.owner) && g.cityCoast(c) && g.known[p]![c.tile]) { const x = g.approxDist(c.tile, u.tile); if (x < d) { port = c; d = x; } }
      if (port) went = toward(port.tile);
    }
  }
  if (went) { if (!u.dead && u.moves > 0) strike(); return; }
  // (Nothing to do at sea: its own port, to hold it.)
  const h = home();
  if (h && g.approxDist(h.tile, u.tile) > 2 && g.findPath(u, h.tile)) g.goTo(u, h.tile); else u.fortified = true;
}

// ---- research, civics, government ----

// What an unlock is worth to this civ: units more to the warlike, buildings
// and wonders more to builders.
function unlockValue(g: Game, p: Player, d: { units?: readonly UnitKey[]; buildings?: readonly BuildingKey[]; wonders?: readonly string[]; effects?: readonly unknown[] }, tech: TechKey | null = null): number {
  const P = pol(g, p);
  const reveals = tech === null ? 0 : RESOURCE_KEYS.filter((r) => resourceDef(r).reveal === tech).length;
  // (A resource on its land that this tech would let it improve at last.)
  let improves = 0;
  if (tech !== null && P.techImprove > 0) {
    for (let t = 0; t < g.N && improves < 3; t++) {
      if (g.ownerOf(t) !== p.id || !g.resourceFor(t, p.id)) continue;
      const k = g.improvementAt(t, p.id);
      if (k && g.builtAt(t) !== k && g.improvementTech(p.id, k) === tech) improves++;
    }
  }
  return improves * P.techImprove + (d.units?.length ?? 0) * P.techUnits + (d.buildings?.length ?? 0) * P.techBuildings + (d.wonders?.length ?? 0) * P.techWonders
    + reveals * P.techReveal + (d.effects?.length ?? 0) * P.techEffects;
}

// The tech to research next: one it can start now, by worth per cost, with chance.
export function aiPickTech(g: Game, p: Player): TechKey | null {
  let best: TechKey | null = null, bestS = -Infinity;
  for (const k of TECH_KEYS) {
    const d = techDef(k);
    if (p.techs.has(k) || !d.needs.every((n) => p.techs.has(n))) continue;
    const s = (1 + unlockValue(g, p, d, k)) / d.cost ** pol(g, p).techCheap + 0.01 * g.rng();
    if (s > bestS) { best = k; bestS = s; }
  }
  return best;
}

// The politics next: a new government first, then policies.
export function aiPickPolitics(g: Game, p: Player): PoliticsKey | null {
  let best: PoliticsKey | null = null, bestS = -Infinity;
  for (const k of POLITICS_KEYS) {
    const d = politicsDef(k);
    if (p.politics.has(k) || !d.needs.every((n) => p.politics.has(n))) continue;
    const s = (1 + unlockValue(g, p, d) + 2 * (d.governments?.length ?? 0) + 0.6 * (d.policies?.length ?? 0)) / d.cost + 0.01 * g.rng();
    if (s > bestS) { best = k; bestS = s; }
  }
  return best;
}

// ---- identity ----

// How much a civ likes each path: a shuffle of its own (the seed and its
// id), the warlike leaning to the Martial and the builders to the rest.
const tasteCache = new Map<string, Record<PathKey, number>>();
export function pathTaste(g: Game, p: Player): Record<PathKey, number> {
  const key = `${g.seed}:${p.id}`;
  const hit = tasteCache.get(key);
  if (hit) return hit;
  const rand = mulberry32((g.seed * 31 + p.id * 977) ^ 0x1de);
  const w = warlike(g, p);
  const taste = Object.fromEntries(PATH_KEYS.map((k) => [k, rand() * 3
    + (w && (k === 'martial' || k === 'craft' || k === 'pastoral') ? 1.5 : 0)
    + (!w && (k === 'concord' || k === 'reason' || k === 'commerce' || k === 'heartland') ? 1 : 0)])) as Record<PathKey, number>;
  tasteCache.set(key, taste);
  return taste;
}
// Adopts every trait it can afford, best first: deeper in the paths it
// likes, an unfounded faith eagerly.
export function aiPickTraits(g: Game, p: Player): void {
  const taste = pathTaste(g, p);
  for (let guard = 0; guard < 6 && p.identityPoints >= g.nextTraitCost(p); guard++) {
    let best: TraitKey | null = null, bestS = -Infinity;
    for (const k of TRAIT_KEYS) {
      if (!g.canAdopt(p, k)) continue;
      const d = traitDef(k);
      // (Its own liking, less for a path whose opposite it likes better.)
      // (Faith draws them while a religion is still to be founded.)
      const faith = d.religion ? 2 : k === 'spirituality' && g.religions.size < 7 ? 1.5 : 0;
      const s = taste[d.path] - 0.5 * taste[PATHS[d.path].opposite] + 0.6 * d.tier + faith + 0.2 * g.rng();
      if (s > bestS) { best = k; bestS = s; }
    }
    if (!best || !g.adoptTrait(p, best)) return;
  }
}

// The government it likes best of those it has, and its policies: the best
// for its bent in each slot.
const GOV_ORDER: Record<'warlike' | 'builder', readonly GovernmentKey[]> = {
  warlike: ['fascism', 'communism', 'absoluteMonarchy', 'monarchy', 'oligarchy', 'autocracy', 'theocracy', 'merchantRepublic', 'constitutionalMonarchy', 'classicalRepublic', 'chiefdom'],
  builder: ['democracy', 'technocracy', 'communism', 'constitutionalMonarchy', 'merchantRepublic', 'theocracy', 'classicalRepublic', 'autocracy', 'monarchy', 'oligarchy', 'chiefdom'],
};
// (Later policies are stronger: they come later in the list.)
function policyScore(g: Game, p: Player, k: PolicyKey): number {
  const kind = policyDef(k).kind, P = pol(g, p);
  return (kind === 'military' ? P.policyMilitary : kind === 'economic' ? P.policyEconomic : P.policySocial) + (k === 'bureaucracy' ? 1 : 0)
    + 0.01 * POLITICS_KEYS.findIndex((c) => politicsDef(c).policies?.includes(k)) + 0.1 * ((k.length * 7 + p.id) % 5);
}
export function aiGovern(g: Game, p: Player): void {
  const have = g.governmentsOf(p);
  const want = GOV_ORDER[warlike(g, p) ? 'warlike' : 'builder'].find((k) => have.includes(k));
  if (want && want !== p.government) g.setGovernment(p, want);
  const options = g.policiesOf(p).sort((a, b) => policyScore(g, p, b) - policyScore(g, p, a));
  for (const slot of SLOT_KINDS) {
    p.policies[slot].forEach((_, i) => {
      const k = options.find((x) => fits(x, slot) && !SLOT_KINDS.some((s) => p.policies[s].includes(x)));
      if (k) g.setPolicy(p, slot, i, k);
    });
  }
}

// ---- diplomacy ----

// A civ's fighting strength: its fighting units' attack and defense, as hurt.
export function power(g: Game, owner: number): number {
  return g.units.reduce((s, u) => s + (u.owner === owner && !unitDef(u.type).civilian ? (Math.max(unitDef(u.type).melee, unitDef(u.type).rangedAtk ?? 0) + unitDef(u.type).rangedDef) * (0.5 + u.hp / 200) : 0), 0);
}

const PEACE_ASK_EVERY = 8; // turns between a civ's offers of peace to the same enemy
// War when much stronger than a civ it has met nearby (warlike civs sooner);
// peace when the war goes badly or has lasted.
function aiDiplomacy(g: Game, p: Player): void {
  const P = pol(g, p);
  const wars = g.players.filter((o) => o.alive && g.atWar(p.id, o.id));
  for (const o of wars) {
    const long = g.turn - g.relations[p.id]![o.id]!.since;
    // (Weaker than it will bear; or the war grown long and going nowhere for it: one it is winning it keeps up.)
    // (Refused, it does not ask again for a while: an offer every turn is noise.)
    const rel = g.relations[p.id]![o.id]!;
    if (g.turn - (rel.asked ?? -99) < PEACE_ASK_EVERY) continue;
    if (g.canMakePeace(p.id, o.id) && (1 / RANK_WORTH[standing(g, p.id, o.id).army] < P.peaceRatio || (long > 30 && gains(g, p.id, o.id) <= 0 && g.rng() < 0.15))) { rel.asked = g.turn; g.offerPeace(p.id, o.id); }
  }
  // (Its policy's turns are a Quick game's: at the game's pace.)
  if (wars.length || g.turn < P.warAfter * g.pace || g.rng() > P.warChance) return;
  if (planning(g, p)) return;
  if (!g.cities.some((c) => c.owner === p.id)) return;
  // The civ to fall on: the one it has most appetite for (appetite), if
  // that is enough. The war is planned, not declared: its army gathers
  // first (aiMilitary.ts), and declares it when ready.
  let pick: Player | null = null, bestS = 0;
  for (const o of g.players) {
    if (!o.alive || o.id === p.id || !g.met[p.id]![o.id]) continue;
    const a = appetite(g, p, o);
    if (a.near && a.want >= 1 && a.score > bestS) { pick = o; bestS = a.score; }
  }
  if (pick) planWar(g, p, pick.id);
}

// The policy a civ is taken to decide by: its own; the player's, the best there is.
const mind = (g: Game, p: Player): AiPolicy => (p.isHuman ? BEST() : pol(g, p));

// How two civs compare, as anyone who has met them can know it: not in
// figures but in five ranks (as Stellaris tells it), b against a, for
// each of army, techs, production and gold income. The Diplomacy sheet
// shows the ranks; the computer's civs decide by the ranks alone, never
// by a rival's exact figures: what the player cannot know, they do not.
export type Rank = 0 | 1 | 2 | 3 | 4;
export const RANKS = ['Pathetic', 'Inferior', 'Equivalent', 'Superior', 'Overwhelming'] as const;
// (Theirs over yours: under a half, under four fifths, within a quarter, under double, beyond.)
const RANK_CUTS = [0.5, 0.8, 1.25, 2] as const;
// What a rank is taken to be worth, when a decision needs a number.
const RANK_WORTH = [0.35, 0.65, 1, 1.6, 2.8] as const;
const rankOf = (theirs: number, mine: number): Rank => { const x = (theirs + 1) / (mine + 1); return (RANK_CUTS.findIndex((c) => x < c) + 5) % 5 as Rank; };
export interface Standing { army: Rank; tech: Rank; prod: Rank; gold: Rank }
export function standing(g: Game, a: number, b: number): Standing {
  const A = g.players[a]!, B = g.players[b]!;
  return { army: rankOf(power(g, b), power(g, a)), tech: rankOf(B.techs.size, A.techs.size), prod: rankOf(B.ledger.income.prod, A.ledger.income.prod), gold: rankOf(B.ledger.income.gold, A.ledger.income.gold) };
}
// A civ's appetite for a war on another: how much stronger it is (by rank), against
// what its policy asks (want: 1 and over, it would go), moved by what its
// faith would make of the fighting, a truce still running, and how they compare in techs
// and production; `near`: within reach; `score`: for choosing among
// several (nearer, and already at war with another, the better).
// (`react`: counting what o's own attitude toward it adds, a first strike
// or a wide berth; off when it is o's attitude that is being read, so the
// two do not chase each other.)
function appetite(g: Game, p: Player, o: Player, react = true): { want: number; near: boolean; score: number } {
  const P = mind(g, p), st = standing(g, p.id, o.id);
  const own = g.cities.filter((c) => c.owner === p.id);
  // (Their cities it has seen: one it has not found is out of its reach.)
  const d = g.cities.reduce((m, c) => (c.owner === o.id && g.known[p.id]![c.tile] ? Math.min(m, own.reduce((x, h) => Math.min(x, g.approxDist(c.tile, h.tile)), 99)) : m), 99);
  // (What faith would make of the fighting: its units' religions against
  // theirs, as its cities and theirs now follow them: the game's own figure, game.ts faithEdge.)
  const mineC = g.cities.filter((c) => c.owner === p.id), theirs = g.cities.filter((c) => c.owner === o.id && g.known[p.id]![c.tile]);
  void mineC; void theirs;
  // (And what such a war would cost its people's cohesion, if they are of its own religion: as much as its policy minds it.)
  const mine = g.faithOf(p.id), same = mine !== null && mine === g.faithOf(o.id);
  const faith = g.faithEdge(p.id, o.id) * (same ? Math.max(0, 1 - P.holyPeace * HOLY_STRIFE[Math.min(HOLY_STRIFE.length - 1, g.holyWars(p.id) + 1)]!) : 1);
  const truce = 1 - P.truceRespect * Math.min(1, g.truceLeft(p.id, o.id) / 10);
  const lead = (1 / RANK_WORTH[st.tech]) ** P.warTech * (1 / RANK_WORTH[st.prod]) ** P.warProd;
  const ratio = 1 / RANK_WORTH[st.army];
  const strike = react && attitude(g, o, p.id) === 'hostile' ? Math.max(0, 1 + P.warHostile) : 1;
  // (And how near o is to winning the game, as the Diplomacy sheet tells
  // anyone: the first capitals it holds of those a conquest takes, the
  // world's people in its faith by tenths, its era. A civ past half way
  // to a victory is one to stop, the more the nearer: stopLeader.)
  const near = Math.max(g.capitalsHeld(o.id) / g.capitalsToWin, Math.round(10 * g.faithShare(o.id)) / 10 / FAITH_VICTORY, 0.9 * (o.era / (ERAS.length - 1)));
  const stop = 1 + P.stopLeader * Math.max(0, Math.min(1, near) - 0.5) * 2;
  const want = (ratio * Math.max(0, faith) * Math.max(0, truce) * lead * strike * stop) / P.warRatio;
  return { want, near: d <= 14, score: want * (1 + 6 / d) * (g.players.some((x) => x.id !== p.id && g.atWar(o.id, x.id)) ? 1.3 : 1) };
}
// How a computer civ stands toward another, in broad: what the other may
// know of it (the Diplomacy sheet). From the same weighing its decisions
// are made by, so it is never a mask; its plans themselves stay its own.
export type Attitude = 'war' | 'hostile' | 'wary' | 'neutral' | 'friendly' | 'afraid';
export const ATTITUDES: Record<Attitude, { name: string; tells: string }> = {
  war: { name: 'At war', tells: 'You are at war.' },
  hostile: { name: 'Hostile', tells: 'It thinks itself the stronger, has you within reach and nothing holds it back.' },
  wary: { name: 'Wary', tells: 'It weighs its strength against yours, and is not far from liking what it sees.' },
  neutral: { name: 'Neutral', tells: 'It has no quarrel with you, and no bond.' },
  friendly: { name: 'Friendly', tells: 'A bond holds between you: a shared faith, or trade.' },
  afraid: { name: 'Afraid', tells: 'You are much the stronger, and it knows it.' },
};
// (The player's attitude, which no one can ask for, is read as if the
// player decided by the best policy there is: mind.)
export function attitude(g: Game, o: Player, toward: number): Attitude {
  if (g.atWar(o.id, toward)) return 'war';
  const P = mind(g, o), a = appetite(g, o, g.players[toward]!, false), st = standing(g, o.id, toward);
  if (a.near && a.want >= 1 && P.warChance > 0.005 && g.turn >= P.warAfter * g.pace) return 'hostile';
  if (st.army === 4) return 'afraid';
  const f = g.faithOf(o.id), bond = (f !== null && f === g.faithOf(toward)) || g.deals.some((d) => d.sides.some((s) => s.civ === o.id) && d.sides.some((s) => s.civ === toward));
  if (bond) return 'friendly';
  return a.near && a.want >= 0.7 ? 'wary' : 'neutral';
}

// Whether it accepts peace offered by `from`: losing, even, or weary.
export function aiAcceptsPeace(g: Game, p: Player, from: number): boolean {
  const long = g.turn - g.relations[p.id]![from]!.since;
  if (long < MIN_WAR) return false;
  // (Not while its army is out to take one of their cities and the war is young: it means to finish.)
  const op = operationOf(g, p.id), target = op ? g.cityById.get(op.target) : undefined;
  const them = standing(g, p.id, from).army;
  if (target && target.owner === from && long < 40 && them <= 2) return false;
  // (An equal or a stronger enemy: yes. A weaker one: only once the war has stopped paying.)
  return them >= 2 || (long > 25 && gains(g, p.id, from) <= 0);
}
// How a war is going for a civ of late: the cities it took from the other in the last WAR_MEMORY turns, less those it lost to it.
const WAR_MEMORY = 15;
function gains(g: Game, a: number, b: number): number {
  let n = 0;
  for (let i = g.events.length - 1; i >= 0; i--) {
    const e = g.events[i]!;
    if (e.turn < g.turn - WAR_MEMORY) break;
    if (e.kind !== 'cityCaptured') continue;
    if (e.player === a && e.data['from'] === b) n++; else if (e.player === b && e.data['from'] === a) n--;
  }
  return n;
}

// ---- trade ----

// What having resource r is worth to civ p a turn, in yield points: a
// luxury's empire bonus; a strategic more when something it can build needs
// it. Nothing if it has it already.
export function resourceWorth(g: Game, p: Player, r: ResourceKey): number {
  if (g.hasResource(p.id, r)) return 0;
  const d = resourceDef(r);
  if (d.kind === 'luxury') { const y = addOut(empireBonus(r, p.era), flat(g.effectsOf(p), 'luxury')); return OUTPUT_KEYS.reduce((s, k) => s + y[k], 0); }
  if (d.kind !== 'strategic') return 0;
  const needs = (k: BuildKey) => (k in UNITS ? unitDef(k as UnitKey).needs : k in BUILDINGS ? BUILDINGS[k as BuildingKey].resource : undefined);
  return [...g.unlocked(p)].some((k) => needs(k) === r) ? 6 : 2;
}
// What giving a spare copy away costs it: a little (it would rather keep
// its goods), more for a strategic to a civ stronger than itself.
const giveCost = (g: Game, p: Player, r: ResourceKey | null, to: number): number =>
  !r ? 0 : resourceDef(r).kind === 'strategic' && standing(g, p.id, to).army >= 3 ? 3 : 1;

// Whether it signs a deal: what it gets must beat what it gives by a point.
export function aiAcceptsDeal(g: Game, p: Player, sides: readonly [DealSide, DealSide]): boolean {
  const mine = sides.find((s) => s.civ === p.id), theirs = sides.find((s) => s.civ !== p.id);
  if (!mine || !theirs || g.dealBlock(sides) !== null) return false;
  const gain = (theirs.resource ? resourceWorth(g, p, theirs.resource) : 0) + theirs.gold;
  return gain - giveCost(g, p, mine.resource, theirs.civ) - mine.gold >= 1;
}

// Now and then, a trade with a civ it is at peace with: goods for goods,
// or its spares sold for gold a turn, or theirs bought. To the human, an
// offer to answer (one a turn at most).
function aiTrade(g: Game, p: Player): void {
  if (g.rng() > 0.3) return;
  for (const o of g.players.filter((x) => g.canTrade(p.id, x.id))) {
    if (o.isHuman && (g.rng() > 0.3 || g.dealOffers.length)) continue;
    const byWorth = (to: Player) => (a: ResourceKey, b: ResourceKey) => resourceWorth(g, to, b) - resourceWorth(g, to, a);
    const give = g.tradeable(p.id, o.id).sort(byWorth(o))[0] ?? null;
    const get = g.tradeable(o.id, p.id).sort(byWorth(p))[0] ?? null;
    const side = (civ: number, resource: ResourceKey | null, gold = 0): DealSide => ({ civ, resource, gold });
    const wantGet = get !== null && resourceWorth(g, p, get) >= 2;
    if (give && wantGet) g.proposeDeal([side(p.id, give), side(o.id, get)]);
    else if (give) g.proposeDeal([side(p.id, give), side(o.id, null, Math.max(1, resourceWorth(g, o, give) - 2))]);
    else if (wantGet) {
      const pay = Math.max(1, Math.floor(resourceWorth(g, p, get) / 2));
      if (pay <= g.goldRate(p.id) / 3) g.proposeDeal([side(p.id, null, pay), side(o.id, get)]);
    }
  }
}
