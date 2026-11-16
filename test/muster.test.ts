import { describe, it, expect } from 'vitest';
import { Game, HUMAN } from '../src/game.ts';
import { civRoads } from '../src/roads.ts';
import { USE } from '../src/cities.ts';

// What a city may raise: settlers only from a city that can spare a
// citizen, and any unit only where it has a place to stand (the city, or
// a tile next to it). Losing either while it builds loses what was put in.

const fresh = () => {
  const g = new Game({ size: 'small', seed: 5 });
  for (const p of g.players) p.isHuman = true;
  const c = g.foundCity(g.units.find((u) => u.owner === HUMAN && u.type === 'settler')!)!;
  for (const u of g.units.filter((x) => x.owner === HUMAN)) g.removeUnit(u);
  return { g, c };
};
const turn = (g: Game) => { g.endTurn(); g.over = null; };

describe('M1: settlers leave with a citizen', () => {
  it('a city of one can\'t start settlers', () => {
    const { g, c } = fresh();
    expect(c.pop).toBe(1);
    expect(g.offers(c, 'settler')).toBe(true);
    expect(g.canBuild(c, 'settler')).toBe(false);
    expect(g.unitBlock(c, 'settler')).toMatch(/size 2/);
    c.pop = 2;
    expect(g.canBuild(c, 'settler')).toBe(true);
  });
  it('shrunk to one while building them, it loses what it put in and must build something else', () => {
    const { g, c } = fresh();
    c.pop = 2; c.building = 'settler'; c.prod = 20;
    c.pop = 1;
    turn(g);
    expect(c.building).toBeNull();
    expect(c.prod).toBe(0);
    expect(g.units.some((u) => u.owner === HUMAN && u.type === 'settler')).toBe(false);
  });
  it('done, the settlers take a citizen with them, and a city left with one builds no more', () => {
    const { g, c } = fresh();
    // (Grown to two: its second citizen at work on a tile.)
    c.growth = 1;
    expect(g.placeGrowth(c, g.growthOptions(c)[0]!)).toBe(true);
    expect(c.pop).toBe(2);
    c.building = 'settler'; c.prod = g.costOf('settler');
    turn(g);
    expect(g.units.filter((u) => u.owner === HUMAN && u.type === 'settler').length).toBe(1);
    expect(c.pop).toBe(1);
    expect(c.building).toBeNull();
  });
});

describe('M2: a unit needs a place to stand', () => {
  const ring = (g: Game, t: number) => g.tiles[t]!.neighbors;
  it('appears in the city, or next to it when one of its kind stands there', () => {
    const { g, c } = fresh();
    c.building = 'warrior'; c.prod = g.costOf('warrior');
    turn(g);
    const first = g.units.find((u) => u.owner === HUMAN && u.type === 'warrior')!;
    expect(first.tile).toBe(c.tile);
    c.building = 'warrior'; c.prod = g.costOf('warrior');
    turn(g);
    const second = g.units.find((u) => u.owner === HUMAN && u.type === 'warrior' && u !== first)!;
    expect(ring(g, c.tile)).toContain(second.tile);
  });
  it('with the city and every tile around it taken, it can\'t be started, bought or finished', () => {
    const { g, c } = fresh();
    c.building = 'warrior'; c.prod = 10;
    const spots = [c.tile, ...ring(g, c.tile)].filter((t) => g.musterTile(c, 'warrior') !== null && g.canStand({ type: 'warrior', owner: HUMAN }, t) && !g.isWater(t) && g.relief[t] !== 'mountains');
    for (const t of spots) { const u = g.createUnit('warrior', HUMAN, t); u.tile = t; }
    expect(g.musterTile(c, 'warrior')).toBeNull();
    expect(g.canBuild(c, 'warrior')).toBe(false);
    expect(g.offers(c, 'warrior')).toBe(true);
    expect(g.buyCost(c, 'gold')).toBeNull();
    // (A civilian is another kind: it still has room.)
    expect(g.canBuild(c, 'worker')).toBe(true);
    const before = g.units.length;
    turn(g);
    expect(c.building).toBeNull();
    expect(c.prod).toBe(0);
    expect(g.units.filter((u) => u.owner === HUMAN).length).toBe(before - g.units.filter((u) => u.owner !== HUMAN).length);
  });
  it('never further than the tiles next to the city', () => {
    const { g, c } = fresh();
    for (let i = 0; i < 12; i++) { c.building = 'warrior'; c.prod = g.costOf('warrior'); turn(g); }
    for (const u of g.units) if (u.owner === HUMAN) expect(u.tile === c.tile || ring(g, c.tile).includes(u.tile)).toBe(true);
    expect(g.units.filter((u) => u.owner === HUMAN).length).toBeLessThanOrEqual(1 + ring(g, c.tile).length);
  });
});

describe('M3: the computer\'s road plan', () => {
  it('joins a civ\'s cities with one way between any two: a tree, on land it may lay road on', () => {
    const g = new Game({ size: 'small', seed: 5 });
    for (let i = 0; i < 120 && !g.over; i++) g.endTurn();
    const plans = civRoads(g);
    for (const [owner, plan] of plans) {
      for (const t of plan) {
        expect(g.isWater(t)).toBe(false);
        expect(g.relief[t]).not.toBe('mountains');
        expect(g.use[t]).not.toBe(USE.center);
        const o = g.ownerOf(t);
        expect(o < 0 || o === owner || g.hasRoad(t)).toBe(true);
      }
    }
    expect([...plans.values()].some((p) => p.size > 0)).toBe(true);
  });
});
