import { describe, it, expect } from 'vitest';
import { Game, slotOf } from '../src/game.ts';

// One unit per tile (game.ts).

// A game with no units, every player flagged human (no AI moves), and a
// patch of open land: a tile with six land neighbours, each with six too.
function setup(): { g: Game; t: number } {
  const g = new Game({ size: 'small', seed: 5 });
  for (const p of g.players) p.isHuman = true;
  for (const u of [...g.units]) g.removeUnit(u);
  const open = (x: number) => !g.isWater(x) && g.relief[x] !== 'mountains' && !g.cityByTile.has(x);
  const t = g.tiles.findIndex((tile) => open(tile.id) && tile.neighbors.every((n) => open(n) && g.tiles[n].neighbors.every(open)));
  return { g, t };
}
const standing = (g: Game, t: number, owner: number) => g.unitsAt(t).filter((u) => u.owner === owner);

describe('U1: one unit per tile', () => {
  it('a new unit on a taken tile is put on the nearest free one', () => {
    const { g, t } = setup();
    const a = g.createUnit('warrior', 0, t), b = g.createUnit('spearman', 0, t);
    expect(a.tile).toBe(t);
    expect(b.tile).not.toBe(t);
    expect(g.tiles[t].neighbors).toContain(b.tile);
  });
  it('a civilian shares a tile with a military unit, not with another civilian', () => {
    const { g, t } = setup();
    g.createUnit('warrior', 0, t);
    const s = g.createUnit('settler', 0, t), s2 = g.createUnit('settler', 0, t);
    expect(s.tile).toBe(t);
    expect(s2.tile).not.toBe(t);
  });
  it('no player ever has two units of a slot on a tile, whatever is made where', () => {
    const { g, t } = setup();
    for (let i = 0; i < 12; i++) g.createUnit(i % 3 ? 'warrior' : 'settler', 0, t);
    const seen = new Set<string>();
    for (const u of g.units) {
      const k = `${u.tile}|${slotOf(u.type)}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });
  it('a unit cannot be sent onto a tile its side holds, but swaps with a unit next to it', () => {
    const { g, t } = setup();
    const a = g.createUnit('warrior', 0, t), nb = g.tiles[t].neighbors[0]!;
    const b = g.createUnit('archer', 0, nb);
    const far = g.tiles[nb].neighbors.find((x) => x !== t && !g.tiles[t].neighbors.includes(x))!;
    const c = g.createUnit('spearman', 0, far);
    expect(g.findPath(a, far)).toBeNull(); // (held by c, two tiles away)
    g.goTo(a, nb);
    expect(a.tile).toBe(nb);
    expect(b.tile).toBe(t);
    expect(c.tile).toBe(far);
  });
  it('paths go round tiles the side holds', () => {
    const { g, t } = setup();
    const a = g.createUnit('warrior', 0, t);
    for (const n of g.tiles[t].neighbors.slice(0, 3)) g.createUnit('spearman', 0, n);
    const goal = g.tilesWithin(t, 2).find((x) => g.approxDist(x, t) > 1.5 && !g.unitsAt(x).length && !g.isWater(x))!;
    const path = g.findPath(a, goal);
    expect(path).not.toBeNull();
    for (const x of path!.slice(0, -1)) expect(standing(g, x, 0).length).toBe(0);
  });
});
