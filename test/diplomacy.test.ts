// Diplomacy (diplomacy.ts, deals.ts): what civs think of each other, said
// reason by reason; deals of two kinds, never mixed; open borders,
// defensive pacts; the United Nations and the victory by diplomacy.

import { describe, it, expect } from 'vitest';
import { Game, HUMAN, UN_TECH, UN_EVERY, UN_SHARE, MIN_WAR, VICTORIES } from '../src/game.ts';
import { regard, regardLevel, powerOf, moodOf, weigh, dealRoll, MEMOS, REGARD_CUTS, aiVote } from '../src/diplomacy.ts';
import { DEAL_TURNS, DEAL_MIN, type Offer } from '../src/deals.ts';

// Three civs with a city each, all met; the second and third played by the computer for what they sign.
const world = () => {
  const g = new Game({ size: 'small', seed: 5 });
  for (const p of g.players) p.isHuman = true;
  const cities = [0, 1, 2].map((id) => g.foundCity(g.units.find((u) => u.owner === id && u.type === 'settler')!)!);
  for (const a of [0, 1, 2]) for (const b of [0, 1, 2]) if (a !== b) g.met[a]![b] = 1;
  g.players[1]!.isHuman = false; g.players[2]!.isHuman = false;
  return { g, a: cities[0]!, b: cities[1]!, c: cities[2]! };
};
const turn = (g: Game) => { for (const p of g.players) p.isHuman = true; g.endTurn(); g.over = null; g.players[1]!.isHuman = false; g.players[2]!.isHuman = false; };
const reason = (g: Game, of: number, toward: number, text: string) => regard(g, of, toward).reasons.find((r) => r.text.includes(text))?.value ?? 0;

describe('D1: regard is a sum of named reasons', () => {
  it('the levels: Hateful, Hostile, Cautious, Friendly, Devoted, by the sum', () => {
    expect([-20, REGARD_CUTS[0], -5, REGARD_CUTS[1], 0, 2.9, 3, 7.9, 8, 30].map(regardLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const { g } = world();
    const r = regard(g, 1, HUMAN);
    expect(r.total).toBeCloseTo(r.reasons.reduce((s, x) => s + x.value, 0), 5);
    expect(r.level).toBe(regardLevel(r.total));
  });
  it('a shared state religion counts for, a rival creed against', () => {
    const { g, a, b } = world();
    const before = regard(g, 1, HUMAN).total;
    a.religions.add('hinduism'); b.religions.add('hinduism'); b.religions.add('judaism');
    g.setStateReligion(g.players[0]!, 'hinduism'); g.setStateReligion(g.players[1]!, 'hinduism');
    expect(reason(g, 1, HUMAN, 'We share the faith')).toBe(4);
    expect(regard(g, 1, HUMAN).total).toBeCloseTo(before + 4, 5);
    g.players[1]!.conversion = 0;
    g.setStateReligion(g.players[1]!, 'judaism');
    expect(reason(g, 1, HUMAN, 'rival creed')).toBe(-3);
  });
  it('a war declared is remembered, and fades with the turns; a broken truce besides', () => {
    const { g } = world();
    g.declareWar(HUMAN, 1);
    expect(reason(g, 1, HUMAN, MEMOS.declaredWar.text)).toBe(MEMOS.declaredWar.each);
    expect(reason(g, HUMAN, 1, MEMOS.declaredWar.text)).toBe(0); // (the one fallen on holds it against the other, not the other way)
    expect(reason(g, 1, HUMAN, 'We are at war')).toBe(-4);
    for (let i = 0; i < MIN_WAR; i++) turn(g);
    expect(g.makePeace(HUMAN, 1)).toBe(true);
    const kept = reason(g, 1, HUMAN, MEMOS.declaredWar.text);
    expect(kept).toBeGreaterThan(MEMOS.declaredWar.each);
    expect(kept).toBeLessThan(0);
    g.declareWar(HUMAN, 1);
    expect(reason(g, 1, HUMAN, MEMOS.brokeTruce.text)).toBe(MEMOS.brokeTruce.each);
  });
  it('a war on a civ\'s friend is held against the one that declared it', () => {
    const { g } = world();
    // (The third civ thinks the world of the second.)
    g.memos[2]![1]!.gift = 4; g.memos[2]![1]!.votedFor = 6; g.memoVersion++;
    expect(regard(g, 2, 1).level).toBeGreaterThanOrEqual(3);
    g.declareWar(HUMAN, 1);
    expect(reason(g, 2, HUMAN, MEMOS.warOnFriend.text)).toBe(MEMOS.warOnFriend.each);
  });
  it('a mood is read from regard and power together', () => {
    expect(moodOf(0, 0)).toBe('predatory');
    expect(moodOf(0, 4)).toBe('bitter');
    expect(moodOf(2, 2)).toBe('neutral');
    expect(moodOf(4, 2)).toBe('loyal');
    const { g } = world();
    expect(powerOf(g, 1, HUMAN).rank).toBeGreaterThanOrEqual(0);
  });
});

describe('D2: deals', () => {
  it('are settled at once or run for turns: never both', () => {
    const { g } = world();
    g.players[0]!.gold = 500;
    const mixed: Offer = { from: HUMAN, to: 1, give: [{ k: 'gold', n: 50 }], get: [{ k: 'openBorders' }, { k: 'openBorders' }] };
    expect(g.offerBlock(mixed)).toContain('not mixed');
    // (What binds both sides must stand on both.)
    expect(g.offerBlock({ from: HUMAN, to: 1, give: [{ k: 'openBorders' }], get: [] })).toContain('binds both sides');
    expect(g.offerBlock({ from: HUMAN, to: 1, give: [{ k: 'openBorders' }], get: [{ k: 'openBorders' }] })).toBeNull();
    expect(g.offerBlock({ from: HUMAN, to: 1, give: [{ k: 'gold', n: 5000 }], get: [] })).toContain('do not have');
  });
  it('a gift is taken and remembered; a civ gives nothing for nothing', () => {
    const { g } = world();
    g.players[0]!.gold = 500; g.players[1]!.gold = 500;
    expect(weigh(g, { from: HUMAN, to: 1, give: [], get: [{ k: 'gold', n: 100 }] }).chance).toBe(0);
    expect(g.propose({ from: HUMAN, to: 1, give: [], get: [{ k: 'gold', n: 100 }] })).toBe('declined');
    expect(g.propose({ from: HUMAN, to: 1, give: [{ k: 'gold', n: 200 }], get: [] })).toBe('signed');
    expect(g.players[1]!.gold).toBe(700);
    expect(reason(g, 1, HUMAN, MEMOS.gift.text)).toBeGreaterThan(0);
  });
  it('the odds of a deal: how it balances for the other, against what its regard asks', () => {
    const { g } = world();
    g.players[0]!.gold = 1000; g.players[1]!.gold = 1000;
    const swap = (give: number, get: number): Offer => ({ from: HUMAN, to: 1, give: [{ k: 'gold', n: give }], get: [{ k: 'gold', n: get }] });
    const even = weigh(g, swap(100, 100)), kind = weigh(g, swap(200, 100)), mean = weigh(g, swap(100, 200));
    expect(even.balance).toBeCloseTo(0);
    expect(kind.chance).toBeGreaterThan(even.chance);
    expect(mean.chance).toBeLessThan(even.chance);
    // (Liked better, the same deal is likelier; hated, it wants much the better of it.)
    g.memos[1]![0]!.gift = 4; g.memos[1]![0]!.votedFor = 6; g.memoVersion++;
    expect(weigh(g, swap(100, 100)).chance).toBeGreaterThan(even.chance);
    g.memos[1]![0] = { declaredWar: -8, razed: -6 }; g.memoVersion++;
    expect(regard(g, 1, HUMAN).level).toBe(0);
    expect(weigh(g, swap(100, 100)).chance).toBe(0);
    expect(weigh(g, swap(1000, 100)).chance).toBeGreaterThan(0.9);
    // (One draw a pair a turn: asking again changes nothing.)
    expect(dealRoll(g, HUMAN, 1)).toBe(dealRoll(g, HUMAN, 1));
    expect(dealRoll(g, HUMAN, 1)).not.toBe(dealRoll(g, HUMAN, 2));
  });
  it('a technology is taught for good, and may be taught on', () => {
    const { g } = world();
    g.players[0]!.techs.add('pottery');
    expect(g.offerBlock({ from: HUMAN, to: 1, give: [{ k: 'tech', tech: 'pottery' }], get: [] })).toBeNull();
    expect(g.propose({ from: HUMAN, to: 1, give: [{ k: 'tech', tech: 'pottery' }], get: [] })).toBe('signed');
    expect(g.players[1]!.techs.has('pottery')).toBe(true);
    expect(g.players[1]!.bought.has('pottery')).toBe(true);
    expect(g.offerBlock({ from: 1, to: 2, give: [{ k: 'tech', tech: 'pottery' }], get: [] })).toBeNull();
    // (Not one the taker could not research yet.)
    g.players[0]!.techs.add('writing');
    expect(g.offerBlock({ from: HUMAN, to: 2, give: [{ k: 'tech', tech: 'writing' }], get: [] })).toContain('rests on');
  });
  it('a map shows what the giver knows, and whom', () => {
    const { g } = world();
    const news = [...g.known[0]!].filter((x, t) => x && !g.known[1]![t]).length;
    expect(news).toBeGreaterThan(0);
    g.met[1]![2] = g.met[2]![1] = 0;
    g.propose({ from: HUMAN, to: 1, give: [{ k: 'map' }], get: [] });
    expect([...g.known[0]!].filter((x, t) => x && !g.known[1]![t]).length).toBe(0);
    expect(g.met[1]![2]).toBe(1);
  });
  it('a lasting deal runs its term, and either side may end it after the least', () => {
    const { g } = world();
    g.memos[1]![0]!.gift = 4; g.memoVersion++;
    expect(g.propose({ from: HUMAN, to: 1, give: [{ k: 'openBorders' }], get: [{ k: 'openBorders' }] })).toBe('signed');
    const t = g.deals[0]!;
    expect(t.until).toBe(g.turn + DEAL_TURNS);
    expect(g.cancelTreaty(t, HUMAN)).toBe(false);
    for (let i = 0; i < DEAL_MIN; i++) turn(g);
    expect(g.cancelTreaty(t, HUMAN)).toBe(true);
    expect(g.openBorders(HUMAN, 1)).toBe(false);
  });
});

describe('D3: borders and pacts', () => {
  it('at peace another civ\'s land is closed to armies without open borders; civilians pass; war opens it', () => {
    const { g, b } = world();
    const land = g.tiles[b.tile]!.neighbors.find((t) => !g.isWater(t) && g.relief[t] !== 'mountains' && g.ownerOf(t) === 1)!;
    expect(g.canEnter({ type: 'warrior', owner: HUMAN }, land)).toBe(false);
    expect(g.canEnter({ type: 'worker', owner: HUMAN }, land)).toBe(true);
    expect(g.canEnter({ type: 'missionary', owner: HUMAN }, land)).toBe(true);
    g.memos[1]![0]!.gift = 4; g.memoVersion++;
    g.propose({ from: HUMAN, to: 1, give: [{ k: 'openBorders' }], get: [{ k: 'openBorders' }] });
    expect(g.canEnter({ type: 'warrior', owner: HUMAN }, land)).toBe(true);
    // (The deal ended: a unit left there is sent home.)
    const w = g.createUnit('warrior', HUMAN, land);
    w.tile = land;
    for (let i = 0; i < DEAL_MIN; i++) turn(g);
    g.cancelTreaty(g.deals[0]!, HUMAN);
    turn(g);
    expect(g.closedTo(HUMAN, w.tile)).toBe(false);
    g.declareWar(HUMAN, 1);
    expect(g.canEnter({ type: 'warrior', owner: HUMAN }, land)).toBe(true);
  });
  it('a defensive pact: fall on one and the other goes to war with you; the aggressor loses its own pacts', () => {
    const { g } = world();
    g.memos[1]![2] = { gift: 4, votedFor: 6 }; g.memos[2]![1] = { gift: 4, votedFor: 6 }; g.memoVersion++;
    expect(g.propose({ from: 1, to: 2, give: [{ k: 'pact' }], get: [{ k: 'pact' }] })).toBe('signed');
    expect(g.pact(1, 2)).toBe(true);
    g.declareWar(HUMAN, 1);
    expect(g.atWar(HUMAN, 2)).toBe(true);
    // (Called to it: the third civ is not held to have declared it.)
    expect(reason(g, HUMAN, 2, MEMOS.declaredWar.text)).toBe(0);
    // (The pact itself stands: neither of the two went to war of its own will.)
    expect(g.pact(1, 2)).toBe(true);
    const h = world();
    h.g.memos[1]![2] = { gift: 4, votedFor: 6 }; h.g.memos[2]![1] = { gift: 4, votedFor: 6 }; h.g.memoVersion++;
    h.g.propose({ from: 1, to: 2, give: [{ k: 'pact' }], get: [{ k: 'pact' }] });
    h.g.declareWar(1, HUMAN);
    expect(h.g.pact(1, 2)).toBe(false);
    expect(h.g.atWar(2, HUMAN)).toBe(false);
  });
  it('no pact is sworn while either side is at war', () => {
    const { g } = world();
    g.declareWar(HUMAN, 2);
    expect(g.offerBlock({ from: HUMAN, to: 1, give: [{ k: 'pact' }], get: [{ k: 'pact' }] })).toContain('sworn in peace');
  });
});

describe('D4: the United Nations', () => {
  it('founded with the tech; everyone meets; the council votes every few turns', () => {
    const { g } = world();
    expect(g.un.since).toBeNull();
    g.met[0]![3] = 0;
    (g as unknown as { learn(p: unknown, k: string): void }).learn(g.players[1]!, UN_TECH);
    expect(g.un.since).toBe(g.turn);
    expect(g.met[0]![3]).toBe(1);
    expect(g.un.next).toBe(g.turn + UN_EVERY);
  });
  it('no one votes for itself; a candidate with three fifths of the rest of the world\'s votes wins by diplomacy', () => {
    expect(Object.keys(VICTORIES)).toContain('diplomacy');
    const { g, a, b, c } = world();
    for (const p of g.players.slice(3)) { for (const u of g.units.filter((x) => x.owner === p.id)) g.removeUnit(u); p.alive = false; }
    a.pop = 10; b.pop = 6; c.pop = 4;
    expect(g.unCandidates()).toEqual([0, 1]);
    expect(g.unNeeds(0)).toBe(Math.ceil(UN_SHARE * 10));
    // (The computer's civs vote only for a friend.)
    expect(aiVote(g, g.players[2]!, [0, 1])).toBeNull();
    g.memos[2]![0] = { gift: 4, votedFor: 6 }; g.memos[1]![0] = { gift: 4, votedFor: 6 }; g.memoVersion++;
    expect(aiVote(g, g.players[2]!, [0, 1])).toBe(0);
    expect(aiVote(g, g.players[1]!, [0, 1])).toBe(0);
    g.un = { since: g.turn, next: g.turn, last: null };
    g.endTurn();
    expect(g.un.last?.winner).toBe(0);
    expect(g.winner).toEqual({ player: 0, how: 'diplomacy' });
    expect(g.over).toBe('victory');
  });
  it('its own numbers elect no one', () => {
    const { g, a, b, c } = world();
    for (const p of g.players.slice(3)) { for (const u of g.units.filter((x) => x.owner === p.id)) g.removeUnit(u); p.alive = false; }
    a.pop = 30; b.pop = 3; c.pop = 2;
    g.ballot = 0;
    g.un = { since: g.turn, next: g.turn, last: null };
    g.endTurn();
    expect(g.un.last?.winner).toBeNull();
    expect(g.winner).toBeNull();
  });
});
