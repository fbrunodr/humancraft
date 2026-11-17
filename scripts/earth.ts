// Paints the Earth map (src/maps/earth.json) from the real coastlines, as
// strategy games draw the Earth: not to scale, but to be played on.
//   npx tsx scripts/earth.ts --data <dir> [--preview <dir>]
//
// <dir> holds Natural Earth's outlines (public domain), as GeoJSON:
//   ne_50m_land.geojson, ne_50m_lakes.geojson
//   from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
//
// A tile of the game's globe is some 300 km across: to scale, Europe is a
// dozen tiles, Japan two, Cuba none, and the Pacific a third of the world.
// So the real Earth is laid on the game's in pieces (PIECES below), each
// keeping its shape but drawn at its own size: Europe, Japan, the
// Caribbean and the Indies larger, Africa, Siberia and the Americas a
// little smaller, the oceans whatever is left between.
// Each tile is land if enough of it is, sampled at many points, through the
// pieces, against the real coastline; then straits are opened and islands
// set down by name (STRAITS, ISLANDS), since at this scale a channel or an
// island is narrower than a tile and a count of points can't tell. Its
// hills, mountains and biomes are the true-scale painting's
// (scripts/earth/trueScale.json, painted by hand), read through the warp.
// CHECKS says what must come out joined and what apart; a failure stops it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { globeFor } from '../src/globes.ts';
import { latLon, nearestTile } from '../src/geo.ts';
import type { Globe } from '../src/goldberg.ts';
import { MAP_SIZES, type MapSizeKey } from '../src/rules.ts';
import { FLAT, HILLS, LAKE, LAND, MOUNTAINS, PAINTABLE_BIOMES, PAINTED, SEA, blank, load, store, type PaintFile, type Painting } from '../src/mapPaint.ts';
import { generateMap } from '../src/mapgen.ts';
import type { BiomeKey } from '../src/terrain.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const DATA = arg('data', ''), PREVIEW = arg('preview', '');
if (!DATA) { console.error('--data <dir with ne_50m_land.geojson and ne_50m_lakes.geojson>'); process.exit(1); }
const RAD = Math.PI / 180;

// ---------- points ----------

type LL = readonly [lat: number, lon: number];
const vec = ([lat, lon]: LL): THREE.Vector3 => new THREE.Vector3(Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.sin(lat * RAD), -Math.cos(lat * RAD) * Math.sin(lon * RAD));

// ---------- the warp ----------

// The world in pieces, each drawn at its own size and set down where the
// whole reads best: within a piece the land keeps its shape (every
// distance from the piece's middle multiplied alike, north still north),
// so India is India's triangle and Italy a boot, however large or small;
// between pieces the map eases from one to the other.
//   at     the piece's middle, really
//   reach  how far round it the piece holds (degrees, really)
//   by     how many times as large it is drawn
//   to     where its middle is set on the game's globe; or
//   from   another piece and a real place the two share (a strait, a
//          border): this piece is set so that place falls where the other puts it
interface Piece { readonly name: string; readonly at: LL; readonly reach: number; readonly by: number; readonly to?: LL; readonly from?: readonly [string, LL] }
const PIECES: readonly Piece[] = [
  // (Europe as its drawing has it, REGIONS below: 2.2 times life size. What lies round it eases down from that:
  // the Near East half as large again as life, India and Japan a little over, the rest about life size, Siberia less.)
  { name: 'europe', at: [48, 14], reach: 26, by: 2.2, to: [40, 15] },
  { name: 'nearEast', at: [30, 45], reach: 15, by: 1.5, from: ['europe', [36.6, 36.2]] },
  { name: 'russia', at: [58, 75], reach: 26, by: 0.85, from: ['europe', [56, 50]] },
  { name: 'india', at: [21, 79], reach: 13, by: 1.25, from: ['nearEast', [28, 62]] },
  { name: 'china', at: [32, 108], reach: 20, by: 1.05, from: ['india', [27, 92]] },
  { name: 'siberia', at: [62, 135], reach: 24, by: 1.05, from: ['china', [50, 120]] },
  { name: 'japan', at: [37, 138], reach: 7, by: 1.7, from: ['china', [34.5, 129.5]] },
  { name: 'indies', at: [0, 117], reach: 20, by: 1.25, from: ['china', [6, 101]] },
  { name: 'africa', at: [0, 18], reach: 34, by: 0.8, from: ['europe', [36.8, 10]] },
  // (The Horn and the Red Sea's southern shore at the Near East's size: they face Arabia across a sea that must stay narrow.
  // Egypt is the Near East's already, by nearness.)
  { name: 'nileHorn', at: [16, 40], reach: 12, by: 1.5, from: ['nearEast', [20, 39]] },
  { name: 'australia', at: [-26, 135], reach: 22, by: 0.95, from: ['indies', [-10, 135]] },
  { name: 'newZealand', at: [-41, 173], reach: 7, by: 1.5, from: ['australia', [-36, 156]] },
  { name: 'northAmerica', at: [45, -100], reach: 32, by: 0.95, to: [44, -110] },
  { name: 'caribbean', at: [17, -82], reach: 13, by: 1.45, from: ['northAmerica', [27, -103]] },
  { name: 'southAmerica', at: [-15, -60], reach: 30, by: 0.85, from: ['caribbean', [8, -77]] },
  { name: 'greenland', at: [72, -40], reach: 14, by: 0.55, to: [78, -70] },
  { name: 'antarctica', at: [-85, 0], reach: 25, by: 0.5, to: [-87, 0] },
];
// The point `far` degrees from p on the compass bearing `bearing` (radians, clockwise from north).
const north = new THREE.Vector3(0, 1, 0);
const frame = (p: THREE.Vector3): { e: THREE.Vector3; n: THREE.Vector3 } => {
  const e = north.clone().cross(p);
  if (e.lengthSq() < 1e-12) e.set(0, 0, -1); else e.normalize();
  return { e, n: p.clone().cross(e).normalize() };
};
const bearing = (p: THREE.Vector3, q: THREE.Vector3): number => { const { e, n } = frame(p); return Math.atan2(q.dot(e), q.dot(n)); };
const go = (p: THREE.Vector3, far: number, b: number): THREE.Vector3 => {
  const { e, n } = frame(p), dir = n.multiplyScalar(Math.cos(b)).addScaledVector(e, Math.sin(b));
  return p.clone().multiplyScalar(Math.cos(far * RAD)).addScaledVector(dir, Math.sin(far * RAD)).normalize();
};
interface Set { readonly name: string; readonly real: THREE.Vector3; readonly game: THREE.Vector3; readonly by: number; readonly reach: number }
const SETS = (() => {
  const out = new Map<string, Set>();
  // (A real place as one piece draws it.)
  const draw = (s: Set, x: THREE.Vector3): THREE.Vector3 => go(s.game, (s.real.angleTo(x) / RAD) * s.by, bearing(s.real, x));
  for (const p of PIECES) {
    const real = vec(p.at);
    let game: THREE.Vector3;
    if (p.to) game = vec(p.to);
    else {
      const parent = out.get(p.from![0]);
      if (!parent) throw new Error(`${p.name}: ${p.from![0]} is not set before it`);
      // (From where the parent puts the shared place, back along the way from that place to this piece's middle.)
      const shared = vec(p.from![1]), q = draw(parent, shared);
      game = go(q, (shared.angleTo(real) / RAD) * p.by, bearing(shared, real));
    }
    out.set(p.name, { name: p.name, real, game, by: p.by, reach: p.reach });
  }
  return [...out.values()];
})();
// The game's globe to the real one: each piece's own answer, weighed by how near its middle the point is (within its reach, all but its own).
const EASE = 4;
const toRealV = (p: THREE.Vector3, sets: readonly Set[] = SETS): THREE.Vector3 => {
  const sum = new THREE.Vector3();
  for (const s of sets) {
    const d = s.game.angleTo(p) / RAD, w = (s.reach * s.by / Math.max(d, 0.5)) ** EASE;
    sum.addScaledVector(go(s.real, d / s.by, bearing(s.game, p)), w);
  }
  return sum.normalize();
};
const toReal = (game: THREE.Vector3): LL => latLon(toRealV(game)) as unknown as LL;
// And the real one to the game's: the nearest piece's answer, then corrected until it comes back to the place asked for.
const toGame = (real: LL, sets: readonly Set[] = SETS): THREE.Vector3 => {
  const x = vec(real);
  let best = sets[0]!, bw = -1;
  for (const s of sets) { const w = s.reach / Math.max(s.real.angleTo(x) / RAD, 0.5); if (w > bw) { bw = w; best = s; } }
  let p = go(best.game, (best.real.angleTo(x) / RAD) * best.by, bearing(best.real, x));
  for (let i = 0; i < 30; i++) {
    const back = toRealV(p, sets), off = back.angleTo(x) / RAD;
    if (off < 0.01) break;
    // (As far the other way as it fell short, at this piece's size.)
    p = go(p, off * best.by * 0.8, bearing(back, x));
  }
  return p;
};

// ---------- the real coastline ----------

interface Ring { readonly pts: readonly (readonly [number, number])[]; readonly box: readonly [number, number, number, number] }
interface Shape { readonly rings: readonly Ring[]; readonly box: readonly [number, number, number, number]; readonly name: string }
const shapes = (file: string): Shape[] => {
  const json = JSON.parse(readFileSync(`${DATA}/${file}`, 'utf8')) as { features: { properties: { name?: string | null }; geometry: { type: string; coordinates: unknown } }[] };
  const out: Shape[] = [];
  for (const f of json.features) {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as [number, number][][][];
    for (const poly of polys) {
      const rings = poly.map((pts): Ring => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return { pts, box: [x0, y0, x1, y1] };
      });
      out.push({ rings, box: rings[0]!.box, name: f.properties.name ?? '' });
    }
  }
  return out;
};
const inRing = (r: Ring, x: number, y: number): boolean => {
  let inside = false;
  const p = r.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!, [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const within = (list: readonly Shape[], [lat, lon]: LL): boolean => {
  for (const s of list) {
    if (lon < s.box[0] || lon > s.box[2] || lat < s.box[1] || lat > s.box[3]) continue;
    if (!inRing(s.rings[0]!, lon, lat)) continue;
    if (!s.rings.slice(1).some((h) => inRing(h, lon, lat))) return true;
  }
  return false;
};
const COAST = shapes('ne_50m_land.geojson');
// (The lakes large enough to be a tile: the rest are land.)
const LAKES = shapes('ne_50m_lakes.geojson').filter((s) => (s.box[2] - s.box[0]) * (s.box[3] - s.box[1]) > 3);

// ---------- what is set by hand ----------

// A tile is land with this share of it on land (under half: islands and
// peninsulas narrower than a tile are kept, and the lands are a little
// fuller than life; the straits this closes are opened by name below).
const LAND_SHARE = 0.36, LAKE_SHARE = 0.4;

// Ranges the true-scale painting is too coarse for, once magnified: mountains or hills along each line.
const RANGES: readonly (readonly [string, typeof MOUNTAINS | typeof HILLS, ...LL[]])[] = [
  ['the Alps', MOUNTAINS, [44.2, 7.0], [46.0, 8.5], [46.6, 10.8], [47.2, 13.4]],
  ['the Pyrenees', MOUNTAINS, [42.9, -1.2], [42.6, 0.6], [42.5, 2.0]],
  ['the Caucasus', MOUNTAINS, [43.4, 41.0], [42.8, 44.0], [41.6, 47.0]],
  ['the Scandes', MOUNTAINS, [61.2, 8.0], [63.5, 11.5], [66.0, 14.5], [68.2, 17.5]],
  ['the Carpathians', HILLS, [49.3, 20.0], [48.2, 24.0], [46.0, 25.6], [45.4, 23.5]],
  ['the Apennines', HILLS, [44.3, 9.8], [43.0, 12.6], [41.6, 14.2], [40.2, 16.0]],
  ['the Dinaric Alps', HILLS, [45.2, 15.0], [43.6, 18.0], [42.2, 19.8]],
  ['the Balkan range and the Pindus', HILLS, [42.8, 24.6], [41.2, 22.0], [39.6, 21.2]],
  ['the Massif Central', HILLS, [45.2, 3.0]],
  ['the Highlands', HILLS, [57.2, -4.6]],
  ['the Meseta\'s sierras', HILLS, [40.6, -4.2], [37.2, -3.2]],
  ['the Japanese Alps', MOUNTAINS, [36.2, 137.7]],
  ['the Sierra Madre and the highlands of Guatemala', HILLS, [17.0, -96.5], [15.2, -91.2], [13.8, -88.0]],
];

// Biomes set by name, where the game's climate (dry at the horse latitudes) is wrong of the real place.
const BIOMES: readonly (readonly [string, BiomeKey, ...LL[]])[] = [
  ['the American South', 'temperateForest', [30.5, -84.0], [28.0, -81.6], [26.2, -81.0], [31.0, -88.5], [30.5, -91.5], [32.5, -86.0], [33.5, -81.5], [30.2, -94.5], [32.0, -92.0]],
  ['southern China', 'monsoonForest', [24.0, 113.0], [26.0, 117.5], [23.5, 108.5], [27.5, 111.5]],
];

// Sea where the count of points would close it (real places; the tile each falls in).
const STRAITS: readonly (readonly [string, ...LL[]])[] = [
  ['the Straits of Florida', [24.0, -81.0], [23.9, -79.6]],
  ['the Yucatán Channel', [21.8, -85.8]],
  ['the Windward Passage', [20.0, -73.9]],
  ['the Mona Passage', [18.4, -67.9]],
  ['the Channel', [50.3, -0.8], [51.1, 1.6]],
  ['the Irish Sea', [53.6, -5.0]],
  ['the Strait of Gibraltar', [35.95, -5.5]],
  ['the Øresund and the Belts', [55.6, 11.2], [56.6, 11.6]],
  ['the Strait of Messina', [38.0, 15.9]],
  ['the Strait of Bonifacio and the Tyrrhenian', [41.3, 10.4]],
  ['the Aegean', [38.0, 25.2]],
  ['the Bosporus', [41.1, 29.1]],
  ['Bab-el-Mandeb', [12.6, 43.4]],
  ['the Strait of Hormuz', [26.5, 56.4]],
  ['the Palk Strait', [9.8, 79.6]],
  ['the Strait of Malacca', [3.2, 100.4], [5.5, 98.8], [1.4, 102.8]],
  ['the Sunda Strait', [-6.2, 105.6]],
  ['the Karimata Strait', [-1.8, 108.0]],
  ['the Java Sea', [-5.3, 110.5], [-5.2, 114.0]],
  ['the Makassar Strait', [-1.0, 118.4], [-4.0, 118.0]],
  ['the Molucca Sea', [0.0, 126.0]],
  ['the Banda and Arafura Seas', [-5.5, 131.0], [-9.0, 133.0]],
  ['the Torres Strait', [-10.2, 142.3]],
  ['the Sulu Sea', [8.5, 120.5]],
  ['the Luzon Strait', [20.5, 121.4]],
  ['the Taiwan Strait', [24.4, 119.4]],
  ['the Korea Strait', [34.2, 129.3]],
  ['the Sea of Japan', [39.5, 134.0]],
  ['the Tsugaru Strait', [41.4, 140.4]],
  ['La Pérouse Strait', [45.7, 142.0]],
  ['the Tatar Strait', [50.5, 141.2]],
  ['the Bering Strait', [65.8, -169.0]],
  ['the Bass Strait', [-39.8, 146.0]],
  ['the Cook Strait', [-41.2, 174.5]],
  ['the Mozambique Channel', [-17.5, 41.5]],
  ['the Davis Strait and Baffin Bay', [66.0, -58.0], [63.0, -56.0], [70.5, -62.0], [74.0, -66.0], [76.5, -72.0]],
  ['the Nares Strait', [78.3, -73.5], [79.8, -70.0], [81.6, -63.5]],
  ['the Gulf of California', [27.0, -111.2]],
  ['the Persian Gulf', [27.5, 51.3]],
  ['the Red Sea', [20.5, 38.5], [25.5, 35.6], [16.0, 41.0]],
  ['the Adriatic', [43.2, 15.2], [41.6, 17.6]],
];
// Land where the count of points would drown it.
const ISLANDS: readonly (readonly [string, ...LL[]])[] = [
  ['Cuba', [22.2, -80.0], [21.4, -77.6], [22.6, -82.6]],
  ['Hispaniola', [18.9, -71.0]],
  ['Jamaica', [18.1, -77.3]],
  ['Puerto Rico', [18.2, -66.4]],
  ['Britain', [52.4, -1.4], [54.6, -2.4], [57.0, -4.2]],
  ['Ireland', [53.2, -8.0]],
  ['Iceland', [64.9, -18.6]],
  ['Sicily', [37.6, 14.2]],
  ['Sardinia', [40.1, 9.1]],
  ['Corsica', [42.2, 9.1]],
  ['Crete', [35.2, 24.9]],
  ['Cyprus', [35.0, 33.2]],
  ['Jutland', [56.0, 9.3]],
  ['Sri Lanka', [7.8, 80.7]],
  ['Taiwan', [23.7, 121.0]],
  ['Hainan', [19.2, 109.7]],
  ['Honshu', [36.2, 138.6], [34.8, 134.4], [39.2, 141.0]],
  ['Kyushu', [32.6, 130.9]],
  ['Shikoku', [33.7, 133.5]],
  ['Hokkaido', [43.4, 142.8]],
  ['Sakhalin', [50.0, 142.9]],
  ['Korea', [36.5, 127.8]],
  ['Luzon', [16.6, 121.2]],
  ['Mindanao', [7.8, 125.0]],
  ['Sumatra', [0.2, 101.2], [-3.2, 103.6], [3.4, 98.0]],
  ['Java', [-7.3, 108.4], [-7.6, 111.6]],
  ['Borneo', [0.6, 114.2]],
  ['Sulawesi', [-2.2, 120.6]],
  ['Timor', [-9.0, 125.2]],
  ['New Guinea', [-5.2, 141.2]],
  ['Malaya', [4.4, 102.0], [2.4, 103.0]],
  ['Tasmania', [-42.0, 146.6]],
  ['New Zealand, the North Island', [-38.6, 176.0]],
  ['New Zealand, the South Island', [-43.9, 170.6]],
  ['Madagascar', [-19.4, 46.8]],
  ['Hawaii', [19.6, -155.5]],
  ['Newfoundland', [48.6, -56.2]],
  ['Panama', [8.6, -80.0], [9.2, -79.2], [8.4, -81.4]],
  ['Sinai and Suez', [30.4, 32.4]],
  ['the Bosporus\'s shores', [41.2, 28.0], [40.9, 30.2]],
  ['Florida', [27.6, -81.4]],
  ['Yucatán', [19.6, -89.2]],
  ['Denmark\'s isles', [55.4, 11.9]],
];
// What must be joined by land, and what must not.
const CHECKS: readonly (readonly [boolean, string, LL, string, LL])[] = [
  [false, 'Cuba', [22.2, -80.0], 'Florida', [27.6, -81.4]],
  [false, 'Cuba', [22.2, -80.0], 'Yucatán', [19.6, -89.2]],
  [false, 'Cuba', [22.2, -80.0], 'Hispaniola', [18.9, -71.0]],
  [false, 'Britain', [52.4, -1.4], 'France', [47.0, 2.4]],
  [false, 'Britain', [52.4, -1.4], 'Ireland', [53.2, -8.0]],
  [false, 'Spain', [40.0, -3.6], 'Morocco', [32.5, -6.0]],
  [false, 'Sicily', [37.6, 14.2], 'Italy', [41.6, 13.9]],
  [false, 'Sardinia', [40.1, 9.1], 'Italy', [41.6, 13.9]],
  [false, 'Sri Lanka', [7.8, 80.7], 'India', [20.0, 78.0]],
  [false, 'Sumatra', [-3.2, 103.6], 'Malaya', [4.4, 102.0]],
  [false, 'Sumatra', [0.2, 101.2], 'Java', [-7.3, 108.4]],
  [false, 'Borneo', [0.6, 114.2], 'Sumatra', [0.2, 101.2]],
  [false, 'Borneo', [0.6, 114.2], 'Java', [-7.6, 111.6]],
  [false, 'Borneo', [0.6, 114.2], 'Sulawesi', [-2.2, 120.6]],
  [false, 'Borneo', [0.6, 114.2], 'Mindanao', [7.8, 125.0]],
  [false, 'New Guinea', [-5.2, 141.2], 'Australia', [-25.0, 134.0]],
  [false, 'New Guinea', [-5.2, 141.2], 'Sulawesi', [-2.2, 120.6]],
  [false, 'Luzon', [16.6, 121.2], 'Taiwan', [23.7, 121.0]],
  [false, 'Taiwan', [23.7, 121.0], 'China', [30.0, 112.0]],
  [false, 'Honshu', [36.2, 138.6], 'Korea', [36.5, 127.8]],
  [false, 'Honshu', [36.2, 138.6], 'Hokkaido', [43.4, 142.8]],
  [false, 'Hokkaido', [43.4, 142.8], 'Siberia', [60.0, 120.0]],
  [false, 'Alaska', [64.0, -150.0], 'Siberia', [60.0, 120.0]],
  [false, 'Tasmania', [-42.0, 146.6], 'Australia', [-25.0, 134.0]],
  [false, 'Madagascar', [-19.4, 46.8], 'Africa', [0.0, 25.0]],
  [false, 'Arabia', [23.0, 45.0], 'Ethiopia', [9.0, 39.0]],
  [false, 'Greenland', [72.0, -40.0], 'Canada', [55.0, -100.0]],
  [true, 'Korea', [36.5, 127.8], 'China', [30.0, 112.0]],
  [true, 'Malaya', [4.4, 102.0], 'China', [30.0, 112.0]],
  [true, 'Italy', [41.6, 13.9], 'France', [47.0, 2.4]],
  [true, 'Spain', [40.0, -3.6], 'France', [47.0, 2.4]],
  [true, 'Jutland', [56.0, 9.3], 'France', [47.0, 2.4]],
  [true, 'Greece', [39.4, 22.0], 'France', [47.0, 2.4]],
  [true, 'Anatolia', [39.0, 33.0], 'Arabia', [23.0, 45.0]],
  [true, 'Egypt', [27.0, 30.0], 'Arabia', [23.0, 45.0]],
  [true, 'India', [20.0, 78.0], 'China', [30.0, 112.0]],
  [true, 'Florida', [27.6, -81.4], 'Canada', [55.0, -100.0]],
  [true, 'Yucatán', [19.6, -89.2], 'Canada', [55.0, -100.0]],
  [true, 'Brazil', [-10.0, -52.0], 'Canada', [55.0, -100.0]],
  [true, 'Sweden', [60.0, 15.0], 'France', [47.0, 2.4]],
];

// ---------- drawn by hand ----------

// A region drawn by hand over what the coastlines gave (scripts/earth/<name>.txt):
// a picture in characters, north up, each character CELL degrees of the
// game's globe, its middle over a real place. '.' sea, '#' land, 'h'
// hills, '^' mountains, 'o' lake, ' ' as the coastlines gave it. A tile
// takes what most of the characters under it say.
// (Its biomes in a second picture of the same size, scripts/earth/<name>.biomes.txt, in mapPaint.ts's letters:
// t tundra, T taiga, F temperate forest, R temperate rainforest, p prairie, s steppe, m mediterranean, d hot desert...)
//   to    where the picture's middle is set on the game's globe
//   cell  degrees of the game's globe to a character
// TRACED: whether what is not drawn is filled from the real coastlines (the pieces above). While the
// world is being drawn region by region it is not: what is not drawn yet is sea.
const TRACED = false;
interface Patch { readonly name: string; readonly to: THREE.Vector3; readonly cell: number; readonly rows: readonly string[]; readonly biomes: readonly string[] }
// The regions drawn, in the order they are laid down (a later one only where the earlier left blank). Each was
// begun from a tracing (--draft <name>): the real coastline at `by` times life size, the real place `at`
// set down at `to` on the game's globe, the picture's middle over the real place `middle`; `keep` says
// what of the real world belongs to the region.
interface Region {
  readonly name: string; readonly at: LL; readonly to: () => THREE.Vector3; readonly by: number; readonly middle: LL;
  readonly cols: number; readonly rows: number; readonly cell: number; readonly keep: (real: LL) => boolean;
  readonly centre?: LL; // where its picture's middle lies on the game's globe, once it is drawn: fixed, whatever the pieces become
  readonly forward?: (real: LL) => THREE.Vector3; // its own laying of the real world on the game's (traced by going through the real world, not the picture)
  readonly eased?: readonly string[]; // traced through these of the pieces above (its size easing into its neighbours'), not at one size about `at`
}
const far = (a: LL, b: LL): number => vec(a).angleTo(vec(b)) / RAD;
const REGIONS: readonly Region[] = [
  { name: 'europe', at: [48, 14], to: () => vec([40, 15]), by: 2.2, middle: [48, 14], cols: 100, rows: 92, cell: 1,
    keep: (r) => far(r, [48, 14]) <= 31 && r[0] >= 29.5 },
  // (Asia, traced through the pieces: all that lies east of the Red Sea, the Levant and Europe's drawing.)
  { name: 'asia', at: [35, 95], to: () => vec([0, 0]), by: 1, middle: [35, 95], centre: [12.5612, 125.4194], cols: 180, rows: 120, cell: 1,
    eased: ['europe', 'nearEast', 'russia', 'india', 'china', 'siberia', 'japan', 'indies'],
    keep: (r) => {
      const [lat, lon] = r;
      if (lon < 0 ? lon > -168 : lon < 26) return false;           // (as far east as the Bering Strait)
      if (lat < -11.5) return false;                               // (Australia is not Asia's)
      if (lat < 30 && lat >= 12.4 && lon < 32.6 + 0.62 * (30 - lat)) return false; // (Africa, west of the Red Sea)
      if (lat < 12.4 && lon < 52) return false;                    // (the Horn of Africa)
      if (lat >= 30 && lat < 31.6 && lon < 34.2) return false;     // (the Nile's delta)
      if (lat < 1.5 && lon > 130.8) return false;                  // (New Guinea goes with Australia)
      return true;
    } },
  // (Africa, with Madagascar. Three layings eased into one another by where a place really is: its northern shore as
  // Europe's drawing lays it (2.2 times life: it faces Europe across the sea and must run the sea's whole length), the
  // rest at three quarters of life hung from Tunis, and the Red Sea's shore and the Horn as the Near East is laid (half as
  // large again), so they face Arabia across a narrow sea. West of the Red Sea; Sicily, Crete, Cyprus and Spain are Europe's.)
  { name: 'africa', at: [0, 18], to: () => vec([0, 0]), by: 1, middle: [3, 18], centre: [-9.9, 14.2], cols: 136, rows: 124, cell: 1,
    forward: (real) => {
      const [lat] = real, x = vec(real), ease = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
      const set = (n: string) => SETS.find((q) => q.name === n)!, lay = (q: Set) => go(q.game, (q.real.angleTo(x) / RAD) * q.by, bearing(q.real, x));
      // (How near the Red Sea and the Gulf of Aden: all the Horn's laying within 4 degrees of their middle line, none of it 14 away.)
      const line: LL[] = [[30, 32.5], [27.5, 34], [20, 38.5], [15, 41.5], [12.5, 43.5], [12, 47], [12.3, 51.5]];
      let near = 99;
      for (let i = 0; i + 1 < line.length; i++) for (let f = 0; f <= 1; f += 0.1) near = Math.min(near, far(real, [line[i]![0] + (line[i + 1]![0] - line[i]![0]) * f, line[i]![1] + (line[i + 1]![1] - line[i]![1]) * f]));
      // (Eased in the picture, across and down apart. Across: Europe's size gives way only little by little down to the
      // Equator, so the continent narrows evenly from the sea's whole length to its own waist. Down: Europe's size on the
      // shore itself; from there to the Horn's latitude nearly life size (Arabia, drawn half as large again, reaches that
      // far south beside it, and the Red Sea must stay a sea between two shores); below that seven tenths, which keeps
      // the Cape out of the cold.)
      const c = vec([-9.9, 14.2]), cols = 136, rows = 124;
      const cell = (p: THREE.Vector3): [number, number] => { const d = c.angleTo(p) / RAD, b = bearing(c, p); return [cols / 2 + d * Math.sin(b), rows / 2 - d * Math.cos(b)]; };
      const europe = regionOf('europe'), e = cell(laid(europe, x)), a = cell(lay(set('africa')));
      const shore = cell(laid(europe, vec([33, real[1]])))[1], below = shore + (lat > 12 ? (33 - lat) * 0.95 : 21 * 0.95 + (12 - lat) * 0.72);
      const h = cell(toGame(real, setsOf(regionOf('asia'))));
      const horn = 1 - ease((near - 4) / 10), across = ease((35 - lat) / 38), down = ease((35 - lat) / 4);
      const col = horn * h[0] + (1 - horn) * (e[0] + (a[0] - e[0]) * across), row = horn * h[1] + (1 - horn) * (e[1] + (below - e[1]) * down);
      const px = col - cols / 2, py = rows / 2 - row;
      return go(c, Math.hypot(px, py), Math.atan2(px, py));
    },
    keep: (r) => {
      const [lat, lon] = r;
      if (lon < -26 || lon > 52 || lat < -36) return false;
      if (lat >= 30) return lon < 34.2 && lat < (lon < -1.9 ? 35.95 : lon < 11.5 ? 37.4 : 33.5);
      if (lat >= 12.4) return lon < 32.6 + 0.62 * (30 - lat);
      return true;
    } },
];
const regionOf = (name: string): Region => { const r = REGIONS.find((x) => x.name === name); if (!r) throw new Error(`no region ${name}`); return r; };
// A region's own laying of the real world on the game's, and back; the middle of its picture on the game's globe.
const layOf = (r: Region): { real: THREE.Vector3; game: THREE.Vector3; by: number } => ({ real: vec(r.at), game: r.to(), by: r.by });
const setsOf = (r: Region): Set[] => SETS.filter((s) => r.eased!.includes(s.name));
const laid = (r: Region, real: THREE.Vector3): THREE.Vector3 => { if (r.eased) return toGame(latLon(real) as unknown as LL, setsOf(r)); const l = layOf(r); return go(l.game, (l.real.angleTo(real) / RAD) * l.by, bearing(l.real, real)); };
const unlaid = (r: Region, game: THREE.Vector3): THREE.Vector3 => { if (r.eased) return toRealV(game, setsOf(r)); const l = layOf(r); return go(l.real, l.game.angleTo(game) / RAD / l.by, bearing(l.game, game)); };
const middleOf = (r: Region): THREE.Vector3 => (r.centre ? vec(r.centre) : laid(r, vec(r.middle)));
if (process.argv.includes('--centres')) for (const r of REGIONS) console.log(`${r.name}: its picture's middle is at ${latLon(laid(r, vec(r.middle))).map((x) => x.toFixed(4)).join(', ')} on the game's globe`);
// The point of the game's globe under a cell of a region's picture.
function cellGame(name: string, col: number, row: number): THREE.Vector3 {
  const r = regionOf(name), x = (col + 0.5 - r.cols / 2) * r.cell, y = (r.rows / 2 - row - 0.5) * r.cell;
  return go(middleOf(r), Math.hypot(x, y), Math.atan2(x, y));
}
const PATCHES: Patch[] = [];
for (const r of REGIONS) {
  const read = (f: string): string[] => { try { return readFileSync(new URL(`./earth/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !l.startsWith(';')); } catch { return []; } };
  // (And over the drawing, what was changed by hand in the map editor since (<name>.hand.txt, .hand.biomes.txt: --absorb
  // writes them): the last word, whatever the tracing and its corrections say.)
  const over = (base: string[], hand: string[]): string[] => base.map((row, i) => { const h = hand[i] ?? ''; return Array.from(row.padEnd(r.cols), (ch, j) => (h[j] && h[j] !== ' ' ? h[j] : ch)).join(''); });
  const rows = read(`${r.name}.txt`);
  if (rows.length) PATCHES.push({ name: r.name, to: middleOf(r), cell: r.cell, rows: over(rows.slice(0, r.rows), read(`${r.name}.hand.txt`)), biomes: over(read(`${r.name}.biomes.txt`).slice(0, r.rows), read(`${r.name}.hand.biomes.txt`)) });
}
// Where a point of the game's globe falls in a picture whose middle is at c: [column, row] (fractions), or null if behind it.
const cellOf = (c: THREE.Vector3, p: THREE.Vector3, cols: number, rows: number, cell: number): [number, number] | null => {
  const d = c.angleTo(p) / RAD;
  if (d > 85) return null;
  const b = bearing(c, p);
  return [cols / 2 + (d * Math.sin(b)) / cell, rows / 2 - (d * Math.cos(b)) / cell];
};

// ---------- painting a size ----------

// (Its biomes as the game makes them of it, the climate's where none was
// painted: a land keeps the climate it really has, wherever the warp sets
// it down. Europe drawn large reaches further north than it lies.)
const trueScale = (() => {
  const file = JSON.parse(readFileSync(new URL('./earth/trueScale.json', import.meta.url), 'utf8')) as PaintFile;
  const globe = globeFor('large'), paint = load(file.large!, globe.tiles.length);
  PAINTED.earth = file;
  const made = generateMap(globe, 1, 'large', 'earth');
  if (!made) throw new Error('the true-scale Earth could not be made');
  const biome = made.biome.map((b, t) => paint.biome[t] ?? ((PAINTABLE_BIOMES as readonly string[]).includes(b) ? (b as BiomeKey) : null));
  return { globe, paint: { ...paint, biome } };
})();

function paintSize(size: MapSizeKey): { paint: Painting; globe: Globe; notes: string[] } {
  const globe = globeFor(size), n = globe.tiles.length, paint = blank(n), notes: string[] = [];
  const tileAt = (real: LL): number => nearestTile(globe, toGame(real));
  // Land, by the share of each tile's points on land.
  const share = new Float32Array(n), lake = new Float32Array(n);
  for (const t of globe.tiles) {
    const pts = [t.center];
    for (let i = 0; i < t.corners.length; i++) {
      const a = globe.triCenters[t.corners[i]!]!, b = globe.triCenters[t.corners[(i + 1) % t.corners.length]!]!;
      for (const f of [0.45, 0.85]) pts.push(t.center.clone().lerp(a, f).normalize());
      pts.push(t.center.clone().lerp(a.clone().add(b).multiplyScalar(0.5), 0.7).normalize());
    }
    let on = 0, wet = 0;
    for (const p of pts) { const real = toReal(p); if (within(COAST, real)) { on++; if (within(LAKES, real)) wet++; } }
    share[t.id] = on / pts.length;
    lake[t.id] = wet / pts.length;
  }
  for (let t = 0; t < n; t++) paint.terrain[t] = !TRACED ? SEA : lake[t]! >= LAKE_SHARE ? LAKE : share[t]! >= LAND_SHARE ? LAND : SEA;
  // (And the lakes the true-scale painting has, where they really lie.)
  for (const t of globe.tiles) {
    if (!TRACED || paint.terrain[t.id] !== LAND) continue;
    const s = nearestTile(trueScale.globe, vec(toReal(t.center)));
    if (trueScale.paint.terrain[s] === LAKE && t.neighbors.every((x) => share[x]! >= LAND_SHARE)) paint.terrain[t.id] = LAKE;
  }
  // The regions drawn by hand.
  const drawn = new Uint8Array(n);
  for (const patch of PATCHES) {
    const c = patch.to, rows = patch.rows.length, cols = Math.max(...patch.rows.map((r) => r.length));
    const biomeAt = new Map<number, BiomeKey>();
    for (const t of globe.tiles) {
      const count = new Map<string, number>(), kinds = new Map<string, number>();
      const pts = [t.center, ...t.corners.map((i) => t.center.clone().lerp(globe.triCenters[i]!, 0.55).normalize())];
      for (const p of pts) {
        const at = cellOf(c, p, cols, rows, patch.cell);
        if (!at) continue;
        const ch = patch.rows[Math.floor(at[1])]?.[Math.floor(at[0])];
        if (ch && ch !== ' ') count.set(ch, (count.get(ch) ?? 0) + 1);
        const kind = patch.biomes[Math.floor(at[1])]?.[Math.floor(at[0])];
        if (kind && kind !== ' ' && kind !== '.') kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      }
      let total = 0, land = 0, best = '', bestN = 0;
      for (const [ch, k] of count) { total += k; if (ch !== '.' && ch !== 'o') land += k; if (k > bestN) { bestN = k; best = ch; } }
      if (total * 2 <= pts.length || drawn[t.id]) continue; // (mostly outside the picture or left blank; or an earlier region's)
      const wet = (count.get('o') ?? 0) * 2 > total;
      paint.terrain[t.id] = wet ? LAKE : land * 2 >= total ? LAND : SEA;
      drawn[t.id] = land * 2 >= total && !wet ? ((count.get('^') ?? 0) * 3 >= total ? 3 : ((count.get('h') ?? 0) + (count.get('^') ?? 0)) * 3 >= total ? 2 : 1) : 4;
      void best;
      const kind = [...kinds].sort((x, y) => y[1] - x[1])[0]?.[0], k = kind ? '-ItTcspFRmdvMJ'.indexOf(kind) : 0;
      if (k > 0) biomeAt.set(t.id, PAINTABLE_BIOMES[k - 1]!);
    }
    for (const [t, b] of biomeAt) if (paint.terrain[t] === LAND) paint.biome[t] = b;
  }
  // By hand: straits opened, islands set down (islands last: a strait never drowns one named).
  if (TRACED) for (const [, ...pts] of STRAITS) for (const p of pts) { const t = tileAt(p); if (!drawn[t]) paint.terrain[t] = SEA; }
  if (TRACED) for (const [, ...pts] of ISLANDS) for (const p of pts) { const t = tileAt(p); if (!drawn[t]) paint.terrain[t] = LAND; }
  // Hills, mountains and biomes: the true-scale painting's, where each tile really lies (the nearest land there).
  const src = trueScale;
  for (const t of globe.tiles) {
    if (paint.terrain[t.id] !== LAND || drawn[t.id]) continue;
    let s = nearestTile(src.globe, vec(toReal(t.center)));
    if (src.paint.terrain[s] !== LAND) {
      const near = src.globe.tiles[s]!.neighbors.filter((x) => src.paint.terrain[x] === LAND);
      if (!near.length) continue;
      s = near.reduce((a, b) => (src.globe.tiles[b]!.center.dot(vec(toReal(t.center))) > src.globe.tiles[a]!.center.dot(vec(toReal(t.center))) ? b : a));
    }
    paint.relief[t.id] = src.paint.relief[s]!;
    paint.biome[t.id] = src.paint.biome[s]!;
  }
  // (Where a region was drawn by hand, its hills and mountains are the drawing's.)
  for (let t = 0; t < n; t++) if (drawn[t]! >= 1 && drawn[t]! <= 3 && paint.terrain[t] === LAND) paint.relief[t] = drawn[t] === 3 ? MOUNTAINS : drawn[t] === 2 ? HILLS : FLAT;
  const handDrawn = (t: number) => drawn[t]! > 0;
  if (TRACED) for (const [, relief, ...line] of RANGES) {
    for (let i = 0; i < line.length; i++) {
      const a = line[i]!, b = line[Math.min(i + 1, line.length - 1)]!;
      for (let f = 0; f <= 1; f += 0.125) { const t = tileAt([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); if (paint.terrain[t] === LAND && !handDrawn(t) && paint.relief[t]! < relief) paint.relief[t] = relief; }
    }
  }
  // (Biomes the climate gets wrong at true scale: set by name.)
  if (TRACED) for (const [, biome, ...pts] of BIOMES) for (const p of pts) { const t = tileAt(p); if (paint.terrain[t] === LAND) paint.biome[t] = biome; }
  // (A mountain alone on a one-tile island or isthmus would shut it: hills there.)
  for (const t of globe.tiles) {
    if (paint.terrain[t.id] !== LAND || paint.relief[t.id] !== MOUNTAINS) continue;
    const land = t.neighbors.filter((x) => paint.terrain[x] === LAND);
    if (land.length <= 2) paint.relief[t.id] = HILLS;
  }
  // The checks: what must be apart is parted where the land between is
  // thinnest (the tile with the least land in it, on the way that has the
  // most), what must be joined is joined where the sea between is
  // shallowest (the most land in it); named islands are never cut.
  const kept = new Set<number>();
  for (const [, ...pts] of ISLANDS) for (const p of pts) kept.add(tileAt(p));
  const dry = (t: number) => paint.terrain[t] !== SEA;
  // (The way from a to b over tiles that pass, or null.)
  const way = (a: number, b: number, pass: (t: number) => boolean): number[] | null => {
    const came = new Int32Array(n).fill(-1), queue = [a];
    came[a] = a;
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i]!;
      if (x === b) { const path = [b]; for (let y = b; y !== a; ) { y = came[y]!; path.push(y); } return path; }
      for (const y of globe.tiles[x]!.neighbors) if (came[y]! < 0 && (y === b || pass(y))) { came[y] = x; queue.push(y); }
    }
    return null;
  };
  for (const [joined, an, a, bn, b] of TRACED ? CHECKS : []) {
    const ta = tileAt(a), tb = tileAt(b);
    // (Where a region is drawn by hand the drawing is the word: its places are not where the real ones fall.)
    if (drawn[ta] || drawn[tb]) continue;
    if (!dry(ta)) { notes.push(`${an} is under the sea`); continue; }
    if (!dry(tb)) { notes.push(`${bn} is under the sea`); continue; }
    // (A few tiles at most: a strait is narrow. More than that and it is the warp or the names that are wrong, and it says so.)
    for (let round = 0; round < 6; round++) {
      const now = way(ta, tb, dry);
      if ((now !== null) === joined) break;
      if (!joined) {
        // (The fullest way there is: the highest floor of land share that still joins them; its emptiest tile goes under.)
        let lo = 0, hi = 1;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (way(ta, tb, (t) => dry(t) && (kept.has(t) || share[t]! >= mid))) lo = mid; else hi = mid; }
        const path = way(ta, tb, (t) => dry(t) && (kept.has(t) || share[t]! >= lo))!;
        // (A named tile only if nothing else is left to cut: on the smallest globe two islands' names can touch.)
        const between = path.filter((t) => t !== ta && t !== tb).sort((x, y) => share[x]! - share[y]!);
        const cut = between.find((t) => !kept.has(t)) ?? between[0];
        if (cut !== undefined) kept.delete(cut);
        if (cut === undefined) { notes.push(`${an} and ${bn} should be apart, and only named land joins them`); break; }
        paint.terrain[cut] = SEA;
      } else {
        let lo = 0, hi = 1;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (way(ta, tb, (t) => dry(t) || share[t]! >= mid)) lo = mid; else hi = mid; }
        const path = way(ta, tb, (t) => dry(t) || share[t]! >= lo);
        if (!path) { notes.push(`${an} and ${bn} should be joined, and no land lies between`); break; }
        for (const t of path) if (!dry(t)) { paint.terrain[t] = LAND; kept.add(t); }
      }
    }
    if ((way(ta, tb, dry) !== null) !== joined) notes.push(`${an} and ${bn} should be ${joined ? 'joined' : 'apart'}`);
  }
  if (TRACED) for (const [name, ...pts] of ISLANDS) if (pts.every((p) => paint.terrain[tileAt(p)] !== LAND && !drawn[tileAt(p)])) notes.push(`${name} is not there`);
  // A sketch of a region as it stands, in the form it is drawn in (to start a drawing from): --sketch <real lat>,<real lon>,<columns>,<rows>
  const sk = arg('sketch', '');
  if (sk && size === 'large') {
    const [la, lo, cols, rows] = sk.split(',').map(Number) as [number, number, number, number], CELL = 1.5;
    const c = toGame([la, lo]);
    const marks = new Map<string, string>();
    for (const [ch, lat, lon] of JSON.parse(arg('marks', '[]')) as [string, number, number][]) { const at = cellOf(c, toGame([lat, lon]), cols, rows, CELL); if (at) marks.set(`${Math.floor(at[0])},${Math.floor(at[1])}`, ch); }
    const lines: string[] = [], marked: string[] = [];
    for (let r = 0; r < rows; r++) {
      let line = '', mline = '';
      for (let q = 0; q < cols; q++) {
        const x = (q + 0.5 - cols / 2) * CELL, y = (rows / 2 - r - 0.5) * CELL, d = Math.hypot(x, y);
        const t = nearestTile(globe, go(c, d, Math.atan2(x, y)));
        const ch = paint.terrain[t] === SEA ? '.' : paint.terrain[t] === LAKE ? 'o' : paint.relief[t] === MOUNTAINS ? '^' : paint.relief[t] === HILLS ? 'h' : '#';
        line += ch; mline += marks.get(`${q},${r}`) ?? (ch === '.' ? ' ' : ch === '#' ? ':' : ch);
      }
      lines.push(line); marked.push(mline);
    }
    console.log(lines.join('\n')); console.log('--- with the places marked ---'); console.log(marked.join('\n'));
  }
  // --show <region>: the world as painted (this size's tiles), seen through a region's picture: to find what the regions make together.
  if (arg('show', '') && size === arg('showSize', 'medium')) {
    const reg = regionOf(arg('show', ''));
    for (let r = 0; r < reg.rows; r++) {
      let line = '';
      for (let q = 0; q < reg.cols; q++) { const t = nearestTile(globe, cellGame(reg.name, q, r)); line += paint.terrain[t] === SEA ? '.' : paint.terrain[t] === LAKE ? 'o' : paint.relief[t] === MOUNTAINS ? '^' : paint.relief[t] === HILLS ? 'h' : '#'; }
      console.log(line);
    }
  }
  // --where <tile,tile...>: where tiles of the medium globe fall in each region's picture, and what is drawn there.
  if (arg('where', '') && size === 'medium') {
    for (const id of arg('where', '').split(',').map(Number)) {
      const t = globe.tiles[id]!, out: string[] = [];
      for (const patch of PATCHES) {
        const cols = Math.max(...patch.rows.map((x) => x.length)), at = cellOf(patch.to, t.center, cols, patch.rows.length, patch.cell);
        if (at) out.push(`${patch.name} (${Math.floor(at[0])},${Math.floor(at[1])}) '${patch.rows[Math.floor(at[1])]?.[Math.floor(at[0])] ?? ''}'`);
      }
      console.log(`  tile ${id}: ${['sea', 'land', 'lake'][paint.terrain[id]!]}; ${out.join('; ')}; next to ${t.neighbors.map((x) => `${x}${paint.terrain[x] === SEA ? '~' : ''}`).join(' ')}`);
    }
  }
  // --tileAt <region>,<col>,<row>: the medium globe's tile under a cell of a region's picture.
  if (arg('tileAt', '') && size === 'medium') { const [n, c, r] = arg('tileAt', '').split(','); console.log(`  tileAt ${nearestTile(globe, cellGame(n!, Number(c), Number(r)))}`); }
  if (process.env['PROBE']) for (const [name, lat, lon] of JSON.parse(process.env['PROBE']) as [string, number, number][]) {
    const t = tileAt([lat, lon]), back = toReal(globe.tiles[t]!.center), at = latLon(globe.tiles[t]!.center);
    console.log(`  ${name} [${lat}, ${lon}]: tile ${t} at game ${at[0].toFixed(1)}, ${at[1].toFixed(1)}; its middle is really ${back[0].toFixed(1)}, ${back[1].toFixed(1)}; share ${share[t]!.toFixed(2)} lake ${lake[t]!.toFixed(2)} terrain ${paint.terrain[t]}`);
  }
  return { paint, globe, notes };
}

// ---------- a picture of it ----------

// The globe seen from over a real place, as far round as `reach` degrees.
function picture(globe: Globe, paint: Painting, c: THREE.Vector3, reach: number, px = 900): string {
  const up = new THREE.Vector3(0, 1, 0);
  const east = up.clone().cross(c).normalize(), north = c.clone().cross(east).normalize();
  const k = px / 2 / Math.sin(reach * RAD);
  const color = (t: number): string => {
    if (paint.terrain[t] === SEA) return '#27456e';
    if (paint.terrain[t] === LAKE) return '#4f86c6';
    const b = paint.biome[t], r = paint.relief[t];
    const base = b === 'hotDesert' ? '#d8c38a' : b === 'coldDesert' ? '#b9ad8c' : b === 'jungle' ? '#2f7a3a' : b === 'monsoonForest' ? '#4a8c44' : b === 'savanna' ? '#b5b060' : b === 'tundra' ? '#a9b3a0' : b === 'iceSheet' ? '#eef2f5'
      : b === 'taiga' ? '#4d7560' : b === 'steppe' ? '#b6b47a' : b === 'mediterranean' ? '#9aa05c' : b === 'prairie' ? '#9cb86a' : b === 'temperateRainforest' ? '#3f7d55' : '#6f9e55';
    return r === MOUNTAINS ? '#6b5d55' : r === HILLS ? new THREE.Color(base).lerp(new THREE.Color('#7a6248'), 0.35).getStyle() : base;
  };
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-px / 2} ${-px / 2} ${px} ${px}"><rect x="${-px / 2}" y="${-px / 2}" width="${px}" height="${px}" fill="#0b1220"/>`;
  for (const t of globe.tiles) {
    if (t.center.angleTo(c) > reach * RAD) continue;
    const pts = t.corners.map((i) => { const p = globe.triCenters[i]!; return `${(p.dot(east) * k).toFixed(1)},${(-p.dot(north) * k).toFixed(1)}`; }).join(' ');
    out += `<polygon points="${pts}" fill="${color(t.id)}" stroke="#0b1220" stroke-width="0.6"/>`;
  }
  return out + '</svg>';
}
const VIEWS: readonly (readonly [string, LL, number])[] = [
  ['europe', [50, 12], 42], ['namerica', [45, -100], 45], ['caribbean', [22, -85], 40], ['indies', [5, 118], 45], ['japan', [38, 132], 32],
  ['africa', [5, 20], 60], ['americas', [10, -80], 75], ['asia', [35, 90], 65], ['pacific', [0, -160], 80], ['oceania', [-28, 150], 45],
];

// ---------- a draft to draw over ----------

// --draft <name>: the region as the real coastlines give it, in the form a drawing takes
// (scripts/earth/<name>.draft.txt and .draft.biomes.txt), to be corrected by hand into <name>.txt.
if (arg('draft', '')) {
  const reg = regionOf(arg('draft', '')), { cols, rows, cell } = reg;
  const c = middleOf(reg), land: string[] = [], kinds: string[] = [];
  if (reg.forward) {
    // (Traced by going through the real world, every eighth of a degree, and marking where each place falls in the picture.)
    const grid = Array.from({ length: rows }, () => new Array<string>(cols).fill('.')), kind = Array.from({ length: rows }, () => new Array<string>(cols).fill('.'));
    for (let lat = -60; lat <= 80; lat += 0.125) for (let lon = -180; lon < 180; lon += 0.125) {
      const real: LL = [lat, lon];
      if (!reg.keep(real) || !within(COAST, real)) continue;
      const at = cellOf(c, reg.forward(real), cols, rows, cell);
      if (!at || at[0] < 0 || at[1] < 0 || at[0] >= cols || at[1] >= rows) continue;
      const q = Math.floor(at[0]), r = Math.floor(at[1]), v = vec(real);
      if (within(LAKES, real)) { grid[r]![q] = 'o'; kind[r]![q] = '.'; continue; }
      if (grid[r]![q] !== '.') continue;
      let t = nearestTile(trueScale.globe, v);
      if (trueScale.paint.terrain[t] !== LAND) t = trueScale.globe.tiles[t]!.neighbors.find((n) => trueScale.paint.terrain[n] === LAND) ?? t;
      const relief = trueScale.paint.terrain[t] === LAND ? trueScale.paint.relief[t] : FLAT, biome = trueScale.paint.terrain[t] === LAND ? trueScale.paint.biome[t] : null;
      grid[r]![q] = relief === MOUNTAINS ? '^' : relief === HILLS ? 'h' : '#';
      kind[r]![q] = '-ItTcspFRmdvMJ'[biome ? PAINTABLE_BIOMES.indexOf(biome as typeof PAINTABLE_BIOMES[number]) + 1 : 7]!;
    }
    for (let r = 0; r < rows; r++) { land.push(grid[r]!.join('')); kinds.push(kind[r]!.join('')); }
  } else for (let r = 0; r < rows; r++) {
    let a = '', b = '';
    for (let q = 0; q < cols; q++) {
      const v = unlaid(reg, cellGame(reg.name, q, r)), real = latLon(v) as unknown as LL;
      const kept = reg.keep(real), lake = kept && within(LAKES, real), on = kept && within(COAST, real) && !lake;
      let t = nearestTile(trueScale.globe, v);
      if (on && trueScale.paint.terrain[t] !== LAND) t = trueScale.globe.tiles[t]!.neighbors.find((n) => trueScale.paint.terrain[n] === LAND) ?? t;
      const relief = trueScale.paint.terrain[t] === LAND ? trueScale.paint.relief[t] : FLAT, biome = trueScale.paint.terrain[t] === LAND ? trueScale.paint.biome[t] : null;
      // (What is not the region's is left blank: another region's to draw.)
      // (A lake is a lake: left as sea, an inland sea is joined to the ocean by the game.)
      a += !kept && !reg.eased ? ' ' : lake ? 'o' : !on ? '.' : relief === MOUNTAINS ? '^' : relief === HILLS ? 'h' : '#';
      b += !kept && !reg.eased ? ' ' : !on ? '.' : '-ItTcspFRmdvMJ'[biome ? PAINTABLE_BIOMES.indexOf(biome as typeof PAINTABLE_BIOMES[number]) + 1 : 7]!;
    }
    land.push(a); kinds.push(b);
  }
  // (Where real places fall in it, to find one's way: --marks '[["name",lat,lon],...]')
  for (const [label, lat, lon] of JSON.parse(arg('marks', '[]')) as [string, number, number][]) {
    const g = reg.forward ? reg.forward([lat, lon]) : laid(reg, vec([lat, lon])), d = c.angleTo(g) / RAD, b = bearing(c, g);
    console.log(`${label}: column ${Math.floor(cols / 2 + (d * Math.sin(b)) / cell)}, row ${Math.floor(rows / 2 - (d * Math.cos(b)) / cell)}`);
  }
  // (And where the regions drawn before it lie in it: '+' on the sea where an earlier drawing has land.)
  if (process.argv.includes('--under')) {
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let q = 0; q < cols; q++) {
        const p = cellGame(reg.name, q, r);
        let under = false;
        for (const patch of PATCHES) {
          if (patch.name === reg.name) continue;
          const at = cellOf(patch.to, p, Math.max(...patch.rows.map((x) => x.length)), patch.rows.length, patch.cell), ch = at ? patch.rows[Math.floor(at[1])]?.[Math.floor(at[0])] : undefined;
          if (ch && ch !== '.' && ch !== ' ') under = true;
        }
        line += under ? (land[r]![q] === '.' ? '+' : '*') : land[r]![q];
      }
      console.log(line);
    }
  }
  writeFileSync(new URL(`./earth/${reg.name}.draft.txt`, import.meta.url), land.join('\n') + '\n');
  writeFileSync(new URL(`./earth/${reg.name}.draft.biomes.txt`, import.meta.url), kinds.join('\n') + '\n');
  process.exit(0);
}

// ---------- all sizes ----------

// --absorb: the medium map as it stands in src/maps/earth.json was changed by hand in the map editor. Its differences
// from what the drawings give are written into the drawings' hand layers (every character under a changed tile), so
// they outlast the next run and reach the other sizes too.
if (process.argv.includes('--absorb')) {
  const size: MapSizeKey = 'medium', { paint: fresh, globe } = paintSize(size);
  const edited = load((JSON.parse(readFileSync(new URL('../src/maps/earth.json', import.meta.url), 'utf8')) as PaintFile)[size]!, globe.tiles.length);
  const changed = new Set<number>();
  for (let t = 0; t < globe.tiles.length; t++) if (fresh.terrain[t] !== edited.terrain[t] || fresh.relief[t] !== edited.relief[t] || fresh.biome[t] !== edited.biome[t]) changed.add(t);
  // (Each changed tile belongs to the first drawing that says something there; failing that, the last that reaches it.)
  const owner = new Map<number, string>();
  for (const t of changed) {
    let last = '';
    for (const patch of PATCHES) {
      const reg = regionOf(patch.name), at = cellOf(patch.to, globe.tiles[t]!.center, reg.cols, reg.rows, reg.cell);
      if (!at || at[0] < 0 || at[1] < 0 || at[0] >= reg.cols || at[1] >= reg.rows) continue;
      last = patch.name;
      const ch = patch.rows[Math.floor(at[1])]?.[Math.floor(at[0])];
      if (ch && ch !== ' ') { owner.set(t, patch.name); break; }
    }
    if (!owner.has(t) && last) owner.set(t, last);
  }
  for (const patch of PATCHES) {
    const reg = regionOf(patch.name), path = (f: string) => new URL(`./earth/${patch.name}.${f}`, import.meta.url);
    const readOr = (f: string): string[][] => { let rows: string[] = []; try { rows = readFileSync(path(f), 'utf8').split('\n').filter((l) => !l.startsWith(';')); } catch { /* none yet */ } return Array.from({ length: reg.rows }, (_, i) => Array.from((rows[i] ?? '').padEnd(reg.cols).slice(0, reg.cols))); };
    const hand = readOr('hand.txt'), kinds = readOr('hand.biomes.txt');
    let n = 0, from = -1;
    for (let r = 0; r < reg.rows; r++) for (let q = 0; q < reg.cols; q++) {
      const t = from = nearestTile(globe, cellGame(patch.name, q, r), from);
      if (!changed.has(t) || owner.get(t) !== patch.name) continue;
      hand[r]![q] = edited.terrain[t] === SEA ? '.' : edited.terrain[t] === LAKE ? 'o' : edited.relief[t] === MOUNTAINS ? '^' : edited.relief[t] === HILLS ? 'h' : '#';
      const b = edited.biome[t];
      kinds[r]![q] = edited.terrain[t] !== LAND ? '.' : b ? '-ItTcspFRmdvMJ'[PAINTABLE_BIOMES.indexOf(b as typeof PAINTABLE_BIOMES[number]) + 1]! : ' ';
      n++;
    }
    if (!n) continue;
    writeFileSync(path('hand.txt'), `; ${patch.name}: what was changed by hand in the map editor (scripts/earth.ts --absorb), over ${patch.name}.txt. Blank: as the drawing has it.\n` + hand.map((row) => row.join('').trimEnd()).join('\n') + '\n');
    writeFileSync(path('hand.biomes.txt'), `; ${patch.name}: the biomes of what was changed by hand, over ${patch.name}.biomes.txt.\n` + kinds.map((row) => row.join('').trimEnd()).join('\n') + '\n');
    console.log(`${patch.name}: ${[...changed].filter((t) => owner.get(t) === patch.name).length} tiles changed by hand, ${n} characters`);
  }
  console.log(`${changed.size} tiles differ; ${[...changed].filter((t) => !owner.has(t)).length} lie under no drawing. Run again without --absorb to paint every size from the drawings.`);
  process.exit(0);
}

const file: PaintFile = {};
let failed = false;
for (const size of Object.keys(MAP_SIZES) as MapSizeKey[]) {
  const { paint, globe, notes } = paintSize(size);
  file[size] = store(paint);
  let land = 0, lakes = 0, hills = 0, mountains = 0;
  for (let t = 0; t < globe.tiles.length; t++) {
    if (paint.terrain[t] === LAND) { land++; if (paint.relief[t] === HILLS) hills++; else if (paint.relief[t] === MOUNTAINS) mountains++; else void FLAT; }
    else if (paint.terrain[t] === LAKE) lakes++;
  }
  console.log(`${size}: ${globe.tiles.length} tiles, land ${land} (${((100 * land) / globe.tiles.length).toFixed(0)}%), lakes ${lakes}, hills ${hills}, mountains ${mountains}`);
  for (const m of notes) { console.log(`  ! ${m}`); failed = true; }
  if (PREVIEW) {
    mkdirSync(PREVIEW, { recursive: true });
    for (const [name, over, reach] of VIEWS) writeFileSync(`${PREVIEW}/${size}_${name}.svg`, picture(globe, paint, toGame(over), reach));
    for (const p of PATCHES) writeFileSync(`${PREVIEW}/${size}_${p.name}.svg`, picture(globe, paint, p.to, 55));
    // (And the tile over each of those places, for looking at them in the game.)
    writeFileSync(`${PREVIEW}/${size}_views.json`, JSON.stringify({ ...Object.fromEntries(VIEWS.map(([name, over]) => [name, nearestTile(globe, toGame(over))])), ...Object.fromEntries(PATCHES.map((p) => [p.name, nearestTile(globe, p.to)])) }));
  }
}
if (failed && !process.argv.includes('--anyway')) { console.error('Not written: the checks above failed (--anyway to write it all the same).'); process.exit(1); }
writeFileSync(new URL('../src/maps/earth.json', import.meta.url), '{\n' + (Object.keys(file) as MapSizeKey[]).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(file[k])}`).join(',\n') + '\n}\n');
console.log('written to src/maps/earth.json');
