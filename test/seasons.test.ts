import { describe, expect, it } from 'vitest';
import { YEAR, TILT, TWILIGHT, DECLINATION, declination, sunDistance, sunHeight, skyStage, yearStart, yearTurn, SKIES, newSky, skyAt, BIOME_SEASON } from '../src/seasons.ts';

describe('S1: the seasons', () => {
  it('the sun swings between the tropics over a year of 32 turns', () => {
    expect(DECLINATION).toHaveLength(YEAR);
    expect(Math.max(...DECLINATION)).toBeCloseTo(TILT, 6);
    expect(Math.min(...DECLINATION)).toBeCloseTo(-TILT, 6);
    expect(declination(0)).toBeCloseTo(0, 6);
    expect(declination(YEAR + 8)).toBeCloseTo(TILT, 6);
    expect(declination(7.5)).toBeCloseTo((DECLINATION[7]! + DECLINATION[8]!) / 2, 6);
  });
  it('the sun stands at 40, 27 and 15 degrees at 0, 45 and 75 from its latitude, falling all the way, level beyond', () => {
    expect(sunHeight(0)).toBeCloseTo(40, 3);
    expect(sunHeight(45)).toBeCloseTo(27, 1);
    expect(sunHeight(TWILIGHT)).toBeCloseTo(15, 1);
    for (let d = 1; d <= TWILIGHT; d++) expect(sunHeight(d)).toBeLessThan(sunHeight(d - 1));
    expect(sunDistance(80, 24)).toBe(TWILIGHT);
  });
  it('the sky passes through its three palettes there', () => {
    expect(skyStage(0)).toBeCloseTo(0, 6);
    expect(skyStage(45)).toBeCloseTo(1, 2);
    expect(skyStage(TWILIGHT)).toBeCloseTo(2, 2);
    for (let d = 1; d <= TWILIGHT; d++) expect(skyStage(d)).toBeGreaterThan(skyStage(d - 1));
    const s = newSky();
    for (const [d, k] of [[0, 0], [45, 1], [TWILIGHT, 2]] as const) expect(skyAt(d, s).lowSun.getHex()).toBe(SKIES[k].lowSun.getHex());
  });
  it('a game opens on the turn of the year its seed gives, and goes round', () => {
    for (const seed of [0, 1, 7, 480237, 2 ** 31 - 1]) {
      const x = yearStart(seed);
      expect(Number.isInteger(x) && x >= 0 && x < YEAR).toBe(true);
      expect(yearTurn(seed, YEAR)).toBe(x);
      expect(yearTurn(seed, 1)).toBe((x + 1) % YEAR);
    }
    expect(new Set(Array.from({ length: 200 }, (_, s) => yearStart(s))).size).toBeGreaterThan(20);
  });
  it('water takes no season', () => {
    for (const b of ['ocean', 'shallowSea', 'lake', 'seaIce'] as const) expect(BIOME_SEASON[b]).toEqual({ cold: 0, rain: 0, russet: 0, snow: 0 });
  });
});
