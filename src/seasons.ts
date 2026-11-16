import * as THREE from 'three';
import type { BiomeKey, FeatureKey } from './terrain.ts';
import type { CatalogKind } from './propCatalog.ts';

// The seasons: a year of YEAR turns, for the eye only (no rule reads it).
// One number, the turn of the year (0 .. YEAR - 1), sets the latitude the
// sun stands over, and from it:
//   the sky and the sun's height where the camera looks (by how far that
//   place is from the sun's latitude: SKIES, sunHeight), seen from near the
//   ground (from afar the day's blue and a high sun, as ever: render.ts);
//   how the land looks (the terrain's and the plants' shaders, SEASON_GLSL:
//   each pixel by its own latitude and height).
// A game's year starts where its seed says (yearStart) and goes on a turn
// at a time.

export const YEAR = 32;
// The sun's latitude swings this far north and south of the equator (degrees).
export const TILT = 23;
// The land's seasons run this many turns behind the sun's (it warms after it).
export const LAG = 3;
// The latitude under the sun each turn of the year (degrees north): a
// sine, sampled once. Turn 0: the northern spring's equinox; 8: its midsummer.
export const DECLINATION: readonly number[] = Array.from({ length: YEAR }, (_, x) => TILT * Math.sin((2 * Math.PI * x) / YEAR));
// (Between two turns, as the view eases from one to the next: `x` any real number.)
export const declination = (x: number): number => {
  const k = ((x % YEAR) + YEAR) % YEAR, i = Math.floor(k), f = k - i;
  return DECLINATION[i]! * (1 - f) + DECLINATION[(i + 1) % YEAR]! * f;
};
// The turn of the year a game opens on, by its seed; and the turn of the year at a turn of the game.
export const yearStart = (seed: number): number => (Math.imul(seed | 0, 0x9e3779b1) >>> 8) % YEAR;
export const yearTurn = (seed: number, turn: number): number => (((yearStart(seed) + turn) % YEAR) + YEAR) % YEAR;
// The land's year as the shaders take it (radians): 0 as its spring begins in the north, a quarter turn on its midsummer.
export const landPhase = (x: number): number => (2 * Math.PI * (x - LAG)) / YEAR;

// ---- the sky ----
// By how far the place looked at is from the sun's latitude (degrees): at
// 0 the sun 40 degrees up in a gold and blue sky; at 45 the sunset, the sun
// at 27; at TWILIGHT and beyond a violet twilight, the sun at 15 (it never
// sets: the land would go dark). In between, smoothly (even curves through
// the three: flat at 0, so crossing the sun's latitude shows no kink).
export const TWILIGHT = 75;
export const sunDistance = (latitude: number, x: number): number => Math.min(TWILIGHT, Math.abs(latitude - declination(x)));
export const sunHeight = (d: number): number => 40 - 0.0075309 * d * d + 5.487e-7 * d ** 4;
// (Where among the three skies: 0, 1 at 45 degrees, 2 at TWILIGHT.)
export const skyStage = (d: number): number => 5.7156e-4 * d * d - 3.841e-8 * d ** 4;

// A sky: overhead; a third of the way up, away from the sun and toward it;
// at the horizon, likewise; the glow round the sun; the distance haze under
// it and what still water reflects of it.
export interface Sky { zenith: THREE.Color; midAway: THREE.Color; midSun: THREE.Color; lowAway: THREE.Color; lowSun: THREE.Color; glow: THREE.Color; haze: THREE.Color; water: THREE.Color }
const SKY_KEYS = ['zenith', 'midAway', 'midSun', 'lowAway', 'lowSun', 'glow', 'haze', 'water'] as const;
const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
export const SKIES: readonly [Sky, Sky, Sky] = [
  { zenith: c(0.17, 0.42, 0.63), midAway: c(0.5, 0.7, 0.8), midSun: c(0.8, 0.84, 0.72), lowAway: c(0.84, 0.87, 0.82), lowSun: c(1.0, 0.9, 0.58), glow: c(1.0, 0.95, 0.75), haze: c(0.8, 0.84, 0.8), water: c(0.74, 0.82, 0.84) },
  // (The sunset the game had all year round before the seasons.)
  { zenith: c(0.42, 0.52, 0.74), midAway: c(0.78, 0.67, 0.72), midSun: c(0.96, 0.63, 0.52), lowAway: c(0.96, 0.79, 0.66), lowSun: c(1.0, 0.77, 0.47), glow: c(1.0, 0.8, 0.52), haze: c(0.93, 0.74, 0.62), water: c(0.95, 0.72, 0.6) },
  { zenith: c(0.22, 0.25, 0.52), midAway: c(0.42, 0.33, 0.62), midSun: c(0.66, 0.36, 0.62), lowAway: c(0.56, 0.42, 0.66), lowSun: c(0.98, 0.42, 0.48), glow: c(1.0, 0.5, 0.5), haze: c(0.56, 0.44, 0.66), water: c(0.5, 0.4, 0.62) },
];
// The sky at a distance `d` from the sun's latitude, into `out`: a smooth curve through the three.
export function skyAt(d: number, out: Sky): Sky {
  const p = Math.min(2, Math.max(0, skyStage(d))), w = [((p - 1) * (p - 2)) / 2, -p * (p - 2), (p * (p - 1)) / 2] as const;
  const ch = (k: (typeof SKY_KEYS)[number], f: 'r' | 'g' | 'b') => Math.min(1, Math.max(0, SKIES[0][k][f] * w[0] + SKIES[1][k][f] * w[1] + SKIES[2][k][f] * w[2]));
  for (const k of SKY_KEYS) out[k].setRGB(ch(k, 'r'), ch(k, 'g'), ch(k, 'b'));
  return out;
}
export const newSky = (): Sky => skyAt(45, { zenith: c(0, 0, 0), midAway: c(0, 0, 0), midSun: c(0, 0, 0), lowAway: c(0, 0, 0), lowSun: c(0, 0, 0), glow: c(0, 0, 0), haze: c(0, 0, 0), water: c(0, 0, 0) });

// ---- the land ----
// How a biome's ground answers the year (a row of the terrain's tile table):
//   cold   how much it greens in its spring and goes to straw in its winter,
//          where winters are cold (by latitude: none by the equator, all of
//          it from 35 degrees); negative: the other way round, parched in
//          summer and green in winter (Mediterranean scrub);
//   rain   likewise by the tropics' rains (green in its summer, straw in its
//          winter), wherever it lies (but on the equator itself);
//   russet how much it turns russet in its autumn (leaf litter, tundra);
//   snow   how much of its winter's snow lies on it.
export interface GroundSeason { cold: number; rain: number; russet: number; snow: number }
const gs = (cold: number, rain: number, russet: number, snow: number): GroundSeason => ({ cold, rain, russet, snow });
const STILL = gs(0, 0, 0, 0);
export const BIOME_SEASON: Record<BiomeKey, GroundSeason> = {
  ocean: STILL, shallowSea: STILL, lake: STILL, seaIce: STILL,
  iceSheet: gs(0, 0, 0, 1),
  tundra: gs(0.9, 0, 0.8, 1),
  taiga: gs(0.5, 0, 0.6, 1),
  coldDesert: gs(0.1, 0, 0, 0.5),
  steppe: gs(0.7, 0, 0.2, 0.8),
  prairie: gs(1, 0, 0.3, 0.9),
  temperateForest: gs(0.7, 0, 1, 0.9),
  temperateRainforest: gs(0.15, 0, 0.25, 0.5),
  mediterranean: gs(-1, 0, 0, 0.2),
  hotDesert: STILL,
  savanna: gs(0, 1, 0, 0),
  monsoonForest: gs(0, 0.8, 0, 0),
  jungle: STILL,
};
// A tile's: its biome's, but a feature's own where it has one; mountains take all the snow that falls.
const FEATURE_SEASON: Partial<Record<FeatureKey, GroundSeason>> = { oasis: STILL, glacier: gs(0, 0, 0, 1), volcano: gs(0, 0, 0, 0.5) };
export function groundSeason(biome: BiomeKey, feature: FeatureKey | null, mountain: boolean): GroundSeason {
  const s = (feature && FEATURE_SEASON[feature]) ?? BIOME_SEASON[biome];
  return mountain && biome !== 'hotDesert' ? { ...s, snow: 1 } : s;
}

// How a plant answers the year (the plants' shader, by each one's own place):
//   0 not at all; 1 sheds its leaves in the cold (fresh in spring, gold and
//   red in autumn, bare in winter); 2 sheds them in the dry season; 3 grass
//   and herbs, green then straw, by the cold; 4 by the rains; 5 an
//   evergreen that carries the snow.
export const PLANT = { still: 0, cold: 1, dry: 2, grass: 3, rainGrass: 4, conifer: 5 } as const;
const PLANT_KIND: Partial<Record<CatalogKind, number>> = {
  beechMaple: PLANT.cold, oak: PLANT.cold, birch: PLANT.cold, willow: PLANT.cold, poplar: PLANT.cold, larch: PLANT.cold, baldCypress: PLANT.cold, berryBush: PLANT.cold, shrub: PLANT.cold,
  acacia: PLANT.dry, baobab: PLANT.dry,
  grassTuft: PLANT.grass, tallGrass: PLANT.grass, pampasGrass: PLANT.grass, flowers: PLANT.grass, fernClump: PLANT.grass, cottonGrass: PLANT.grass, reeds: PLANT.grass, cattail: PLANT.grass,
  fir: PLANT.conifer, spruce: PLANT.conifer, pine: PLANT.conifer, stonePine: PLANT.conifer, giantCedar: PLANT.conifer, cypress: PLANT.conifer, juniper: PLANT.conifer, araucaria: PLANT.conifer, kauri: PLANT.conifer,
};
// (In the lands of the rains, grass and trees follow them; a monsoon forest's trees shed in its dry season.)
const RAINY: ReadonlySet<BiomeKey> = new Set<BiomeKey>(['savanna', 'monsoonForest']);
export function plantSeason(kind: string, biome: BiomeKey): number {
  const k = PLANT_KIND[kind as CatalogKind] ?? PLANT.still;
  if (!RAINY.has(biome)) return k;
  return k === PLANT.grass ? PLANT.rainGrass : k === PLANT.cold || (biome === 'monsoonForest' && kind === 'jungleTree') ? PLANT.dry : k;
}

// The level of flat land, and a step of height (hills about one above it,
// mountains two): the higher, the longer the winter (relief.ts).
const LOW = 0.008, STEP = 0.006;
const v3 = (hex: number) => { const k = new THREE.Color(hex); return `vec3(${k.r.toFixed(4)}, ${k.g.toFixed(4)}, ${k.b.toFixed(4)})`; };
// (Colours, as the shaders work in: linear.)
export const SEASON_COLORS = { straw: v3(0xb8a268), fresh: v3(0xb7d96a), russet: v3(0xa0602c), gold: v3(0xd2a12a), red: v3(0xb8482a), twig: v3(0x6f6456), yellowed: v3(0xa89a52), snow: v3(0xeef2f6) };
// The season at a point of the globe `P` (world space, the globe at the origin), for both shaders.
// `uYear`: landPhase.
export const SEASON_GLSL = /* glsl */ `
uniform float uYear;
struct Season {
  float summer; // how far into its summer the place is: 1 midsummer, -1 midwinter
  float yr;     // where in its own year: 0 as spring begins, 0.25 midsummer, 0.5 as autumn begins, 0.75 midwinter
  float cold;   // how strongly the cold seasons show here (by latitude)
  float rain;   // and the rains' seasons
  float alt;    // height: 0 flat land, 1 hills, 2 mountains
  float warmth; // below about 0.1, snow lies
};
Season seasonAt(vec3 P) {
  vec3 up = normalize(P);
  float a = abs(degrees(asin(clamp(up.y, -1.0, 1.0)))), hemi = up.y < 0.0 ? -1.0 : 1.0;
  Season s;
  s.summer = hemi * sin(uYear);
  s.yr = fract(uYear / 6.2831853 + (hemi < 0.0 ? 0.5 : 0.0));
  s.cold = smoothstep(8.0, 35.0, a);
  s.rain = smoothstep(2.0, 12.0, a);
  s.alt = clamp((length(P) - 1.0 - ${LOW.toFixed(4)}) / ${STEP.toFixed(4)}, 0.0, 2.0);
  s.warmth = 1.0 - 1.05 * smoothstep(30.0, 65.0, a) + 0.55 * s.cold * s.summer - 0.3 * s.alt;
  return s;
}
// Where in the growing year (as Season.yr, but running on below 0 and past 0.75 into the winter), the
// season squeezed about midsummer by height: spring later up there, autumn sooner.
float seasonGrowing(Season s, float squeeze) { return 0.25 + (s.yr < 0.75 ? s.yr - 0.25 : s.yr - 1.25) * (1.0 + squeeze * s.alt); }
float seasonDormant(float y) { return max(smoothstep(0.42, 0.62, y), 1.0 - smoothstep(-0.14, 0.0, y)); }
float seasonFlush(float y) { return smoothstep(-0.08, 0.03, y) * (1.0 - smoothstep(0.08, 0.2, y)); }
float seasonAutumn(float y) { return smoothstep(0.4, 0.5, y) * (1.0 - smoothstep(0.58, 0.7, y)); }
// How much snow lies (n: noise, 0..1, to rag its edge; share: how much of it this ground takes).
float seasonSnow(Season s, float n, float share) { return smoothstep(0.12, -0.08, s.warmth + (n - 0.5) * 0.14 + (1.0 - share) * 0.12) * smoothstep(0.0, 0.3, share); }
`;
