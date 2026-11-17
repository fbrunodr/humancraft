// A game saved and loaded (src/save.ts) is the same game: its state the
// same to the last number, and played on it goes as the other does.
import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.ts';
import { saveGame, loadGame, saveInfo, digest, SAVE_VERSION } from '../src/save.ts';
import { RELEASE, VERSION } from '../src/version.ts';

const played = (seed: number, turns: number, speed: 'quick' | 'standard' = 'quick'): Game => {
  const g = new Game({ size: 'small', seed, speed });
  for (const p of g.players) p.isHuman = false;
  for (let i = 0; i < turns; i++) g.endTurn();
  return g;
};

describe('SV1: saved and loaded', () => {
  for (const [seed, turns, more] of [[5, 40, 25], [9, 110, 30]] as const) {
    it(`seed ${seed}: the loaded game is the saved one, and goes on as it would have (${turns} turns, then ${more} more)`, () => {
      const a = played(seed, turns), text = saveGame(a);
      const b = loadGame(text);
      expect(digest(b)).toBe(digest(a));
      expect(saveGame(b)).toBe(text);
      expect(b.turn).toBe(a.turn);
      expect(b.explored).toBe(b.known[0]); // (the world's own views are kept, not copies)
      for (let i = 0; i < more; i++) { a.endTurn(); b.endTurn(); }
      expect(b.events.length).toBe(a.events.length);
      expect(digest(b)).toBe(digest(a));
      // (And saved again and loaded again, still.)
      expect(digest(loadGame(saveGame(b)))).toBe(digest(a));
    });
  }
  it('a save says what it is; one of another version is refused, said so', () => {
    const g = played(5, 3, 'standard'), text = saveGame(g);
    expect(saveInfo(text)).toEqual({ version: SAVE_VERSION, release: RELEASE, made: VERSION, turn: g.turn, civ: g.players[0]!.name, current: true });
    expect(loadGame(text).pace).toBe(1.5);
    const old = text.replace(`"version":${SAVE_VERSION}`, `"version":${SAVE_VERSION + 1}`);
    expect(saveInfo(old)?.current).toBe(false);
    expect(() => loadGame(old)).toThrow(/version/);
    expect(() => loadGame('{"nothing":1}')).toThrow(/not a saved game/);
    expect(saveInfo('garbage')).toBeNull();
  });
});
