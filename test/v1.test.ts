import { describe, it, expect } from 'vitest';
import { Game, HUMAN, EMBARK_TECH, OCEAN_TECH, type City } from '../src/game.ts';
import { IMPROVEMENT_KEYS } from '../src/cities.ts';

// The rules version 1 brought (the user's list of 2026-11-27): workers
// improve only the tile they stand on, the water embarked; the deep ocean
// closed until Astronomy; a city founded on improved land builds over it;
// fire that does not reach a city's garrison.

function setup(seed = 5): { g: Game; city: City; nb: number } {
  const g = new Game({ size: 'small', seed });
  for (const p of g.players) p.isHuman = true;
  const city = g.foundCity(g.units.find((u) => u.owner === HUMAN && u.type === 'settler')!)!;
  for (const u of [...g.units]) g.removeUnit(u);
  const nb = g.tiles[city.tile]!.neighbors.find((n) => !g.isWater(n) && g.relief[n] !== 'mountains')!;
  const far = g.tiles.findIndex((t) => !g.isWater(t.id) && g.approxDist(t.id, city.tile) > 10);
  g.createUnit('settler', 1, far);
  return { g, city, nb };
}
const turn = (g: Game) => { g.endTurn(); g.over = null; };
// A coastal city of the player's with a tile of water of its own that takes fishing boats.
function coast(): { g: Game; city: City; water: number; shore: number } | null {
  for (const seed of [5, 7, 11, 13, 21, 34]) {
    const g = new Game({ size: 'small', seed });
    for (const p of g.players) p.isHuman = true;
    const s = g.units.find((u) => u.owner === HUMAN && u.type === 'settler')!;
    const site = g.tilesWithin(s.tile, 6).find((t) => g.canFoundCity(t, HUMAN) && g.tiles[t]!.neighbors.some((n) => g.biome[n] === 'shallowSea' && g.improvementAt(n, HUMAN) === 'boats'));
    if (site === undefined) continue;
    s.tile = site;
    const city = g.foundCity(s)!;
    for (const u of [...g.units]) if (u.owner === HUMAN) g.removeUnit(u);
    const water = g.tiles[site]!.neighbors.find((n) => g.biome[n] === 'shallowSea' && g.improvementAt(n, HUMAN) === 'boats' && g.tileCity[n] === city.id)!;
    const shore = g.tiles[water]!.neighbors.find((n) => !g.isWater(n) && g.relief[n] !== 'mountains' && n !== site) ?? site;
    return { g, city, water, shore };
  }
  return null;
}

describe('V1a: workers improve the tile they stand on', () => {
  it('fishing boats are built from the water, by a worker embarked there; never from the shore', () => {
    const c = coast();
    expect(c).not.toBeNull();
    const { g, water, shore } = c!;
    const p = g.players[HUMAN]!;
    p.techs.add('sailing'); p.techs.add('fishing');
    const w = g.createUnit('worker', HUMAN, shore);
    w.tile = shore;
    expect(g.improveTiles(w)).toEqual([shore]);
    expect(g.improveBlock(w, water)).toBe('A worker improves the tile it stands on.');
    // (No embarking yet: it cannot go there at all.)
    expect(g.canEnter(w, water)).toBe(false);
    p.techs.add(EMBARK_TECH);
    expect(g.canEnter(w, water)).toBe(true);
    w.tile = water; w.moves = 2;
    expect(g.improveBlock(w, water)).toBeNull();
    expect(g.improve(w)).toBe(true);
    for (let i = 0; i < 12 && w.work !== null; i++) turn(g);
    expect(g.builtAt(water)).toBe('boats');
  });
});

describe('V1b: the deep ocean', () => {
  it('is closed to ships and embarked units until Astronomy; the shallows and lakes are not', () => {
    const { g } = setup();
    const p = g.players[HUMAN]!;
    p.techs.add(EMBARK_TECH);
    const ocean = g.tiles.findIndex((t) => g.biome[t.id] === 'ocean'), shallow = g.tiles.findIndex((t) => g.biome[t.id] === 'shallowSea');
    expect(ocean).toBeGreaterThanOrEqual(0);
    for (const type of ['galley', 'warrior', 'settler'] as const) {
      expect(g.canEnter({ type, owner: HUMAN }, ocean)).toBe(false);
      expect(g.canEnter({ type, owner: HUMAN }, shallow)).toBe(true);
    }
    // (No way found across it: a ship beside the ocean goes round or not at all.)
    const edge = g.tiles.find((t) => g.biome[t.id] === 'shallowSea' && t.neighbors.some((n) => g.biome[n] === 'ocean'))!;
    const ship = g.createUnit('galley', HUMAN, edge.id);
    ship.tile = edge.id;
    const deep = edge.neighbors.find((n) => g.biome[n] === 'ocean')!;
    expect(g.findPath(ship, deep)).toBeNull();
    p.techs.add(OCEAN_TECH);
    expect(g.canEnter(ship, deep)).toBe(true);
    expect(g.findPath(ship, deep)).toEqual([deep]);
    expect(g.canEnter({ type: 'warrior', owner: HUMAN }, ocean)).toBe(true);
    // (Another civ without it: still closed.)
    expect(g.canEnter({ type: 'galley', owner: 1 }, ocean)).toBe(false);
  });
});

describe('V1c: a city founded on improved land', () => {
  it('builds over the improvement: nothing of it is left in the record', () => {
    const { g, city } = setup();
    const site = g.tiles.findIndex((t) => g.canFoundCity(t.id, HUMAN) && g.approxDist(t.id, city.tile) > 4 && g.approxDist(t.id, city.tile) < 8 && g.improvementAt(t.id, HUMAN) !== null);
    expect(site).toBeGreaterThanOrEqual(0);
    g.improved[site] = IMPROVEMENT_KEYS.indexOf(g.improvementAt(site, HUMAN)!);
    g.pillaged[site] = 2;
    g.fort[site] = 1;
    const s = g.createUnit('settler', HUMAN, site);
    s.tile = site;
    const c = g.foundCity(s);
    expect(c).not.toBeNull();
    expect(g.builtAt(site)).toBeNull();
    expect(g.pillaged[site]).toBe(0);
    expect(g.fort[site]).toBe(0);
  });
});

describe('V1d: fire into a city', () => {
  it('bows and guns do not reach its garrison; siege engines do, and blades take it', () => {
    const { g, city, nb } = setup();
    g.declareWar(1, 0);
    const held = g.createUnit('warrior', 0, city.tile);
    held.tile = city.tile;
    const a = g.createUnit('archer', 1, nb);
    a.tile = nb;
    expect(g.attackBlockAt(a, city.tile, 'ranged')).toBe('cannot fire into a city (siege weapons, ships and aircraft do)');
    // (A ship's guns and aircraft reach it.)
    expect(Game.breaches('galleass')).toBe(true);
    expect(Game.breaches('fighter')).toBe(true);
    expect(Game.breaches('gatlingGun')).toBe(false);
    g.attack(a, city.tile, 'ranged');
    expect(held.hp).toBe(100);
    // (Unless told otherwise an archer at a city's gates closes in: its fire is no use there.)
    expect(g.attackModeFor(a, city.tile)).toBe('melee');
    g.removeUnit(a);
    const c = g.createUnit('catapult', 1, nb);
    c.tile = nb;
    expect(g.attackBlockAt(c, city.tile, 'ranged')).toBeNull();
    for (let i = 0; i < 6 && held.hp === 100; i++) { c.moves = 1; g.attack(c, city.tile, 'ranged'); }
    expect(held.hp).toBeLessThan(100);
    // (In the field it is shot as ever.)
    g.removeUnit(c);
    const out = g.tiles[nb]!.neighbors.find((n) => n !== city.tile && !g.isWater(n) && g.relief[n] !== 'mountains')!;
    const w = g.createUnit('warrior', 0, out);
    w.tile = out;
    const b = g.createUnit('archer', 1, nb);
    b.tile = nb;
    expect(g.attackBlockAt(b, out, 'ranged')).toBeNull();
  });
  it('a garrison of archers still shoots out from the walls', () => {
    const { g, city, nb } = setup();
    g.declareWar(1, 0);
    const a = g.createUnit('archer', 0, city.tile);
    a.tile = city.tile;
    const w = g.createUnit('warrior', 1, nb);
    w.tile = nb;
    expect(g.attackBlockAt(a, nb, 'ranged')).toBeNull();
  });
});

describe('V1e: no commanders', () => {
  it('one military unit a tile, a civilian with it; a ship beside a unit embarked', () => {
    const { g, nb } = setup();
    const a = g.createUnit('warrior', HUMAN, nb), b = g.createUnit('warrior', HUMAN, nb), s = g.createUnit('settler', HUMAN, nb);
    expect(a.tile).toBe(nb);
    expect(b.tile).not.toBe(nb);
    expect(s.tile).toBe(nb);
    g.players[HUMAN]!.techs.add(EMBARK_TECH);
    const sea = g.tiles.findIndex((t) => g.biome[t.id] === 'shallowSea');
    const ship = g.createUnit('galley', HUMAN, sea);
    ship.tile = sea;
    expect(g.canStand({ type: 'warrior', owner: HUMAN }, sea)).toBe(true);
    expect(g.canStand({ type: 'galley', owner: HUMAN }, sea)).toBe(false);
  });
});
