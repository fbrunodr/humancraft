// Religion (religion.ts), Civ IV's in the main: a city holds several and
// loses none; missionaries alone carry them, with Civ IV's odds; a state
// religion or a secular state; each religion's own buildings; tithes to
// the holder of the holy city. And the victories.

import { describe, it, expect } from 'vitest';
import { Game, HUMAN, VICTORIES, TRUCE_TURNS } from '../src/game.ts';
import { spreadChance, RELIGION_KEYS, STATE_BONUS, SECULAR_BONUS, CONVERSION_TURNS, CONVERSION_COST, MISSIONARIES_MOST, MISSIONARY_FAITH, TITHE, TEMPLE_TECH, CATHEDRAL_TECH } from '../src/religion.ts';
import { templeOf, cathedralOf, BUILDINGS } from '../src/cities.ts';
import { FINAL_TECH } from '../src/techs.ts';

const two = () => {
  const g = new Game({ size: 'small', seed: 5 });
  for (const p of g.players) p.isHuman = true;
  const a = g.foundCity(g.units.find((u) => u.owner === 0 && u.type === 'settler')!)!;
  const b = g.foundCity(g.units.find((u) => u.owner === 1 && u.type === 'settler')!)!;
  g.met[0]![1] = g.met[1]![0] = 1;
  return { g, a, b };
};
const turn = (g: Game) => { g.endTurn(); g.over = null; };

describe('F1: how a religion spreads', () => {
  it('Civ IV\'s odds: sure in a city with none; harder with each one held; harder in another civ\'s', () => {
    const n = RELIGION_KEYS.length;
    expect(n).toBe(7);
    expect(spreadChance(0, true)).toBe(100);
    expect(spreadChance(0, false)).toBe(100);
    expect(spreadChance(1, true)).toBe(40 + Math.floor((6 * 60) / 7));
    expect(spreadChance(1, false)).toBe(20 + Math.floor((6 * 80) / 7));
    expect(spreadChance(n - 1, true)).toBe(40 + Math.floor(60 / 7));
    for (let k = 1; k < n; k++) { expect(spreadChance(k, true)).toBeLessThan(spreadChance(k - 1, true)); expect(spreadChance(k, false)).toBeLessThan(spreadChance(k, true)); }
  });
  it('a missionary of a religion is raised with faith in a city holding it, three of one out at most; it preaches and is spent', () => {
    const { g, a, b } = two();
    const p = g.players[HUMAN]!;
    expect(g.missionaryBlock(HUMAN, a, 'hinduism')).toContain('does not hold');
    a.religions.add('hinduism');
    expect(g.missionaryBlock(HUMAN, a, 'hinduism')).toContain('faith');
    p.faith = 1000;
    const m = g.trainMissionary(HUMAN, a, 'hinduism')!;
    expect(m.religion).toBe('hinduism');
    expect(p.faith).toBe(1000 - g.paced(MISSIONARY_FAITH));
    // (Its own city holds it already; the other's, with no religion, takes it for sure.)
    expect(g.preachBlock(m, a)).toContain('already');
    m.tile = g.tiles[b.tile]!.neighbors.find((t) => !g.isWater(t))!;
    expect(g.preachChance(m, b)).toBe(100);
    expect(g.preach(m, b)).toBe(true);
    expect(m.dead).toBe(true);
    expect([...b.religions]).toEqual(['hinduism']);
    // (Three out at once, no more.)
    for (let i = 0; i < MISSIONARIES_MOST; i++) expect(g.trainMissionary(HUMAN, a, 'hinduism')).not.toBeNull();
    expect(g.missionaryBlock(HUMAN, a, 'hinduism')).toContain('out already');
  });
  it('a city keeps every religion it took: a second comes beside the first, and nothing but a missionary brings one', () => {
    const { g, a, b } = two();
    a.religions.add('hinduism'); a.religions.add('judaism');
    g.players[HUMAN]!.faith = 10000;
    b.religions.add('buddhism');
    // (Preached until it takes: the odds are under a hundred now.)
    for (let i = 0; i < 40 && !b.religions.has('judaism'); i++) {
      const m = g.trainMissionary(HUMAN, a, 'judaism')!;
      m.tile = b.tile;
      expect(g.preachChance(m, b)).toBe(spreadChance(b.religions.size, false));
      g.preach(m, b);
      expect(m.dead).toBe(true);
    }
    expect(b.religions.has('judaism')).toBe(true);
    expect(b.religions.has('buddhism')).toBe(true);
    // (Turns pass: a city beside one that holds a religion takes nothing from it.)
    const c = g.foundCity(g.units.find((u) => u.owner === 2 && u.type === 'settler')!)!;
    for (let i = 0; i < 30; i++) turn(g);
    expect(c.religions.size).toBe(0);
    expect(a.religions.size).toBe(2);
    // (No preaching to an enemy.)
    g.declareWar(0, 1);
    const m = g.trainMissionary(HUMAN, a, 'hinduism')!;
    m.tile = b.tile;
    expect(g.preachBlock(m, b)).toContain('enemy');
  });
});

describe('F2: the state and its religion', () => {
  it('a state religion: each city holding it makes more culture and cohesion; a secular state: for every religion a city holds', () => {
    const { g, a } = two();
    const p = g.players[HUMAN]!;
    const base = g.cityYields(a);
    a.religions.add('hinduism');
    // (Secular: a city's first religion counts for nothing, each one after it does.)
    expect(g.religionYield(a).culture).toBe(0);
    expect(g.setStateReligion(p, 'judaism')).toBe(false); // (no city of its own holds it)
    expect(g.setStateReligion(p, 'hinduism')).toBe(true);
    expect(p.conversion).toBe(0); // (its first costs nothing)
    expect(g.religionYield(a)).toMatchObject({ culture: STATE_BONUS.culture, cohesion: STATE_BONUS.cohesion });
    expect(g.cityYields(a).culture).toBeGreaterThan(base.culture);
    // (With two religions a state religion makes more of the city; with three, the same; with four, a secular state more.)
    const sum = (r: 'hinduism' | null) => { const y = g.religionYield(a, r); return y.culture + y.cohesion; };
    a.religions.add('judaism');
    expect(g.religionYield(a, null).culture).toBe(SECULAR_BONUS.culture);
    expect(sum(null)).toBeLessThan(sum('hinduism'));
    a.religions.add('islam');
    expect(sum(null)).toBe(sum('hinduism'));
    a.religions.add('buddhism');
    expect(sum(null)).toBeGreaterThan(sum('hinduism'));
    expect(STATE_BONUS.culture).toBe(2 * SECULAR_BONUS.culture);
    // (A city that does not hold the state's religion gets nothing from the others it holds.)
    expect(g.religionYield(a, 'taoism').culture).toBe(0);
  });
  it('changing it unsettles the people: less cohesion for ten turns, and no other change meanwhile', () => {
    const { g, a } = two();
    const p = g.players[HUMAN]!;
    a.religions.add('hinduism'); a.religions.add('judaism');
    a.buildings.add('monument'); a.buildings.add('forum');
    g.setStateReligion(p, 'hinduism');
    const calm = g.cityYields(a).cohesion;
    expect(g.setStateReligion(p, 'judaism')).toBe(true);
    expect(p.conversion).toBe(CONVERSION_TURNS);
    expect(g.cityYields(a).cohesion).toBeLessThanOrEqual(Math.ceil(calm * (1 - CONVERSION_COST)));
    expect(g.setStateReligion(p, null)).toBe(false);
    for (let i = 0; i < CONVERSION_TURNS; i++) turn(g);
    expect(p.conversion).toBe(0);
    expect(g.cityYields(a).cohesion).toBe(calm);
    // (Back to secular costs too.)
    expect(g.setStateReligion(p, null)).toBe(true);
    expect(p.conversion).toBe(CONVERSION_TURNS);
  });
  it('each religion has its own temple and cathedral, the same but for the name, built where it is held once the tech is known', () => {
    const { g, a } = two();
    const p = g.players[HUMAN]!;
    const temples = RELIGION_KEYS.map(templeOf), first = BUILDINGS[temples[0]!];
    for (const k of temples) { expect(BUILDINGS[k].cost).toBe(first.cost); expect(BUILDINGS[k].yields).toEqual(first.yields); }
    expect(new Set(temples.map((k) => BUILDINGS[k].name)).size).toBe(RELIGION_KEYS.length);
    a.religions.add('christianity');
    a.buildings.add('shrine');
    expect(g.canBuild(a, templeOf('christianity'))).toBe(false);
    p.techs.add(TEMPLE_TECH);
    expect(g.canBuild(a, templeOf('christianity'))).toBe(true);
    expect(g.canBuild(a, templeOf('islam'))).toBe(false);
    p.techs.add(CATHEDRAL_TECH);
    expect(g.canBuild(a, cathedralOf('christianity'))).toBe(false); // (its temple first)
    a.buildings.add(templeOf('christianity'));
    expect(g.canBuild(a, cathedralOf('christianity'))).toBe(true);
    // (A second religion: its temple beside the first.)
    a.religions.add('islam');
    expect(g.canBuild(a, templeOf('islam'))).toBe(true);
  });
  it('the holder of a holy city takes a tithe from every city holding its religion', () => {
    const { g, a, b } = two();
    g.religions.set('hinduism', { founder: 1, holyCity: b.id, turn: 1 });
    a.religions.add('hinduism'); b.religions.add('hinduism');
    turn(g);
    expect(g.players[1]!.ledger.tithes).toBe(2 * TITHE);
    expect(g.players[0]!.ledger.tithes).toBe(0);
    expect(g.holySeats(1)).toEqual(['hinduism']);
    b.owner = 0;
    expect(g.holySeats(0)).toEqual(['hinduism']);
  });
  it('faith no longer weighs in a fight', () => {
    const { g, a, b } = two();
    g.declareWar(0, 1);
    const nb = g.tiles[b.tile]!.neighbors.find((n) => !g.isWater(n) && g.relief[n] !== 'mountains')!;
    const w = g.createUnit('warrior', 0, a.tile);
    w.tile = nb;
    g.createUnit('warrior', 1, b.tile);
    const plain = g.combatPreview(w, b.tile, 'melee')!.atk;
    a.religions.add('hinduism'); b.religions.add('judaism');
    g.setStateReligion(g.players[0]!, 'hinduism'); g.setStateReligion(g.players[1]!, 'judaism');
    expect(g.combatPreview(w, b.tile, 'melee')!.atk).toBeCloseTo(plain);
  });
});

describe('V1: the game is won', () => {
  it('each way said in a line; none by religion', () => expect(Object.keys(VICTORIES)).not.toContain('religion'));
  it('by science: the first to discover the last technology', () => {
    const { g } = two();
    g.players[1]!.techs.add(FINAL_TECH);
    g.endTurn();
    expect(g.winner).toEqual({ player: 1, how: 'science' });
    expect(g.over).toBe('defeat');
  });
  it('by conquest: two thirds of the civs\' first capitals in one hand', () => {
    const { g, b } = two();
    const need = g.capitalsToWin;
    expect(need).toBe(Math.ceil((2 * g.players.length) / 3));
    expect(g.capitalsHeld(0)).toBe(1);
    const caps = [b];
    for (const p of g.players.slice(2)) { const s = g.units.find((u) => u.owner === p.id && u.type === 'settler'); const c = s && g.foundCity(s); if (c) caps.push(c); }
    for (let i = 0; i < need - 2; i++) caps[i]!.owner = 0;
    g.endTurn();
    expect(g.winner).toBeNull();
    caps[need - 2]!.owner = 0;
    g.endTurn();
    expect(g.winner).toEqual({ player: 0, how: 'conquest' });
  });
  it('on time: the best score when the last turn ends', () => {
    const g = new Game({ size: 'small', seed: 5, turnLimit: 3 });
    for (const p of g.players) p.isHuman = false;
    for (let t = 0; t < 5 && !g.winner; t++) g.endTurn();
    expect(g.winner?.how).toBe('time');
    expect(g.score(g.winner!.player)).toBe(Math.max(...g.players.map((p) => g.score(p.id))));
  });
  it('a truce can be broken, at a price: less cohesion for as long as it had to run', () => {
    const { g } = two();
    g.declareWar(0, 1);
    for (let t = 0; t < 9; t++) g.endTurn();
    expect(g.makePeace(0, 1)).toBe(true);
    expect(g.truceLeft(0, 1)).toBe(TRUCE_TURNS);
    g.declareWar(0, 1);
    expect(g.atWar(0, 1)).toBe(true);
    expect(g.players[0]!.dishonor).toBe(TRUCE_TURNS);
    expect(g.players[1]!.dishonor).toBe(0);
  });
});
