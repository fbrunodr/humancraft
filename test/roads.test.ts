import { describe, expect, it } from 'vitest';
import { Game } from '../src/game.ts';
import { USE } from '../src/cities.ts';
import { linkCities, planRoads, roadLines, roadPiece } from '../src/roads.ts';
import { stressWorld } from '../src/sandbox.ts';

// A ready-made world's roads (the dev pages: no worker works there): linkCities.
describe('RD1: cities joined by road, the nearest first', () => {
  const g = new Game({ size: 'small', seed: 7, everyCiv: true });
  stressWorld(g);
  const laid = linkCities(g);
  const onRoad = (t: number) => g.hasRoad(t);
  // (Which tiles a walker reaches from `from`: by road alone, or over any land a road may run on.)
  const reach = (from: number, ok: (t: number) => boolean) => {
    const seen = new Set([from]), stack = [from];
    while (stack.length) for (const n of g.tiles[stack.pop()!]!.neighbors) if (!seen.has(n) && ok(n)) { seen.add(n); stack.push(n); }
    return seen;
  };
  const land = (t: number) => !g.isWater(t) && g.relief[t] !== 'mountains';

  it('lays roads, none on water (sea or lake) nor on mountains', () => {
    expect(g.cities.length).toBeGreaterThan(10);
    expect(laid).toBeGreaterThan(0);
    for (let t = 0; t < g.N; t++) if (g.road[t]) expect(land(t), `tile ${t}`).toBe(true);
  });
  it('joins every two cities that land joins, and no others', () => {
    for (const c of g.cities) {
      const byRoad = reach(c.tile, onRoad), byLand = reach(c.tile, land);
      for (const o of g.cities) expect(byRoad.has(o.tile), `${c.name} to ${o.name}`).toBe(byLand.has(o.tile));
    }
  });
  it('is drawn as it lies: every two road tiles side by side are joined by a stretch', () => {
    const joined = new Set<string>();
    for (const r of planRoads(g)) for (let k = 0; k + 1 < r.tiles.length; k++) joined.add([r.tiles[k]!, r.tiles[k + 1]!].sort((a, b) => a - b).join('-'));
    for (let t = 0; t < g.N; t++) {
      if (!onRoad(t)) continue;
      for (const n of g.tiles[t]!.neighbors) {
        // (Two cities' centers side by side have no road between them: their streets meet.)
        if (n > t && onRoad(n) && !(g.use[t] === USE.center && g.use[n] === USE.center && !g.road[t] && !g.road[n])) expect(joined.has(`${t}-${n}`), `${t}-${n}`).toBe(true);
      }
    }
  });
  it('lays the same roads again', () => {
    const before = Array.from(g.road);
    linkCities(g);
    expect(Array.from(g.road)).toEqual(before);
  });
});

// How a road tile lays its roads, by which of its sides join one: roadPiece.
describe('RD2: a road tile\'s piece', () => {
  it('uses every joined side once, whatever the sides: a main line, lines crossing it, branches, or a spur', () => {
    for (const around of [5, 6]) for (let mask = 0; mask < 1 << around; mask++) {
      const sides = Array.from({ length: around }, (_, i) => i).filter((i) => mask & (1 << i)), p = roadPiece(sides, around);
      const used = [...p.mains.flat(), ...p.branches.map((b) => b.side), ...(p.spur === null ? [] : [p.spur])].sort((a, b) => a - b);
      expect(used, `${around}: ${sides.join()}`).toEqual(sides);
      if (sides.length >= 2) expect(p.mains.length).toBeGreaterThan(0);
      for (const b of p.branches) expect(b.main).toBeLessThan(p.mains.length);
    }
  });
  it('takes the straightest pair for its main line, and a second pair straight across to cross it', () => {
    expect(roadPiece([0, 1, 3], 6).mains).toEqual([[0, 3]]);
    expect(roadPiece([0, 1, 3, 4], 6).mains).toEqual([[0, 3], [1, 4]]);
    expect(roadPiece([0, 1, 2], 6).mains).toEqual([[0, 2]]);
    expect(roadPiece([0, 1, 2], 6).branches).toHaveLength(1);
    expect(roadPiece([2], 6)).toEqual({ mains: [], branches: [], spur: 2 });
  });
});
describe('RD3: the roads as drawn', () => {
  const g = new Game({ size: 'small', seed: 7, everyCiv: true });
  stressWorld(g);
  linkCities(g);
  const lines = roadLines(g);
  it('every line runs unbroken, and ends on a city\'s side, within a junction, or at a road\'s end', () => {
    const step = g.globe.avgEdgeAngle;
    for (const l of lines) {
      expect(l.points.length).toBeGreaterThan(1);
      for (let k = 1; k < l.points.length; k++) expect(l.points[k]!.angleTo(l.points[k - 1]!)).toBeLessThan(0.2 * step);
    }
  });
  it('every road tile is drawn, and every city a road reaches is entered', () => {
    const near = (t: number) => lines.some((l) => l.points.some((p) => p.angleTo(g.tiles[t]!.center) < 0.5 * g.globe.avgEdgeAngle));
    for (let t = 0; t < g.N; t++) if (g.road[t]) expect(near(t), `tile ${t}`).toBe(true);
    const entered = new Set(lines.flatMap((l) => l.ends.filter((e): e is number => e !== null)));
    for (const c of g.cities) if (g.tiles[c.tile]!.neighbors.some((n) => g.road[n])) expect(entered.has(c.tile), c.name).toBe(true);
  });
});
