// The saved game every version of the rules is held to (test/golden.test.ts,
// scripts/golden.ts). A game some way in, with cities, armies and wars,
// every civ in the player's hands from there on (no computer plays: how
// the computer thinks may change freely, an old save plays on under it
// all the same); and what is done to it from there: a war band is set at the
// gates of every other civ's first city, every unit that can strike an
// enemy next to it does, in the order of their making, and the
// turn ends, some turns running. What that comes to, to the last number,
// is the rules' fingerprint: the world made from its seed, the state read
// back, growth, production, research, upkeep, borders, healing, battle.
import { createHash } from 'node:crypto';
import { Game } from '../src/game.ts';
import { digest, loadGame, saveGame } from '../src/save.ts';

export const GOLDEN_SEED = 11, GOLDEN_AT = 70, GOLDEN_MORE = 12;
export const goldenPath = (version: number): URL => new URL(`./saves/v${version}.json`, import.meta.url);

// The saved game itself, made anew (scripts/golden.ts writes it down).
export function goldenSave(): string {
  const g = new Game({ size: 'small', seed: GOLDEN_SEED });
  for (const p of g.players) p.isHuman = false;
  for (let i = 0; i < GOLDEN_AT; i++) g.endTurn();
  for (const p of g.players) p.isHuman = true;
  return saveGame(g);
}

// Played on from the save as said above: its fingerprint.
export function goldenPrint(save: string): string {
  const g = loadGame(save);
  const alive = g.players.filter((p) => p.alive);
  // (Everyone at war with whoever stands nearest in the list: there is fighting whatever the save's wars were.)
  for (let i = 0; i + 1 < alive.length; i += 2) {
    const a = alive[i]!.id, b = alive[i + 1]!.id;
    if (!g.atWar(a, b)) g.declareWar(a, b);
    // (And a war band of the one at the gates of the other's first city, so there is fighting, hand to hand and by fire.)
    const city = g.cities.find((c) => c.owner === b);
    if (city) for (const type of ['warrior', 'warrior', 'slinger', 'warrior', 'slinger'] as const) g.createUnit(type, a, g.tiles[city.tile]!.neighbors[0]!);
  }
  for (let turn = 0; turn < GOLDEN_MORE; turn++) {
    for (const u of [...g.units].sort((a, b) => a.id - b.id)) {
      if (u.dead || u.moves <= 0 || !g.canAttack(u)) continue;
      const foe = g.tiles[u.tile]!.neighbors.find((t) => g.isEnemyOccupied(t, u.owner) && g.attackBlockAt(u, t) === null);
      if (foe !== undefined) g.attack(u, foe);
    }
    g.endTurn();
    g.over = null;
  }
  return createHash('sha256').update(digest(g)).digest('hex');
}
