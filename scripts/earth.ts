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
import { cornerGraph } from '../src/rivers.ts';
import { latLon, nearestTile } from '../src/geo.ts';
import type { Globe } from '../src/goldberg.ts';
import type { MapSizeKey } from '../src/rules.ts';
import { FLAT, HILLS, LAKE, LAND, MOUNTAINS, PAINTABLE_BIOMES, PAINTED, SEA, blank, load, store, type PaintFile, type Painting } from '../src/mapPaint.ts';
import { generateMap } from '../src/mapgen.ts';
import type { BiomeKey } from '../src/terrain.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const DATA = arg('data', ''), PREVIEW = arg('preview', '');
if (!DATA) { console.error('--data <dir with ne_50m_land.geojson and ne_50m_lakes.geojson>'); process.exit(1); }
const RAD = Math.PI / 180;
// The Earth is painted for one size of map, the large one: it is the only one with tiles enough for it. (A tile there is
// 2.67 degrees across; the drawings' characters are sized to it, three to a tile: CELL.)
const EARTH_SIZE: MapSizeKey = 'large';
const CELL = 0.875;

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
  { name: 'europe', at: [48, 14], reach: 15, by: 2.2 * CELL, to: [45, 15] },
  { name: 'nearEast', at: [28, 45], reach: 18, by: 1.2, from: ['europe', [36.6, 36.2]] },
  { name: 'russia', at: [58, 75], reach: 26, by: 0.8, from: ['europe', [56, 50]] },
  { name: 'india', at: [21, 79], reach: 13, by: 1.2, from: ['nearEast', [28, 62]] },
  { name: 'china', at: [32, 108], reach: 20, by: 1.05, from: ['india', [27, 92]] },
  { name: 'siberia', at: [62, 135], reach: 24, by: 1.0, from: ['china', [50, 120]] },
  { name: 'japan', at: [37, 138], reach: 7, by: 1.7, from: ['china', [34.5, 129.5]] },
  { name: 'indies', at: [0, 117], reach: 20, by: 1.25, from: ['china', [6, 101]] },
  { name: 'africa', at: [0, 18], reach: 34, by: 0.85, from: ['europe', [36.8, 10]] },
  // (The Horn and the Red Sea's southern shore at the Near East's size: they face Arabia across a sea that must stay narrow.
  // Egypt is the Near East's already, by nearness.)
  { name: 'nileHorn', at: [16, 40], reach: 12, by: 1.5, from: ['nearEast', [20, 39]] },
  // (Oceania set down by hand: the Old World, hung from a Europe drawn large and high, has sprawled south, and Java lies
  // where the Tropic of Capricorn should. So New Guinea goes east of Celebes, Australia under it at seven tenths of life
  // (its south coast would else be in the ice), New Zealand off its south-east.)
  { name: 'newGuinea', at: [-5.5, 141], reach: 8, by: 0.95, to: [-23, 160] },
  { name: 'australia', at: [-26, 135], reach: 20, by: 0.7, to: [-41, 150] },
  { name: 'newZealand', at: [-41, 173], reach: 7, by: 1.3, to: [-50, -176] },
  { name: 'northAmerica', at: [45, -100], reach: 32, by: 0.92, to: [46, -112] },
  { name: 'caribbean', at: [17, -82], reach: 13, by: 1.45, from: ['northAmerica', [27, -103]] },
  { name: 'southAmerica', at: [-15, -60], reach: 30, by: 0.85, from: ['caribbean', [8, -77]] },
  { name: 'greenland', at: [72, -40], reach: 14, by: 0.5, to: [78, -62] },
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
interface Laying { readonly name: string; readonly real: THREE.Vector3; readonly game: THREE.Vector3; readonly by: number; readonly reach: number }
const SETS = (() => {
  const out = new Map<string, Laying>();
  // (A real place as one piece draws it.)
  const draw = (s: Laying, x: THREE.Vector3): THREE.Vector3 => go(s.game, (s.real.angleTo(x) / RAD) * s.by, bearing(s.real, x));
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
const toRealV = (p: THREE.Vector3, sets: readonly Laying[] = SETS): THREE.Vector3 => {
  const sum = new THREE.Vector3();
  for (const s of sets) {
    const d = s.game.angleTo(p) / RAD, w = (s.reach * s.by / Math.max(d, 0.5)) ** EASE;
    sum.addScaledVector(go(s.real, d / s.by, bearing(s.game, p)), w);
  }
  return sum.normalize();
};
const toReal = (game: THREE.Vector3): LL => latLon(toRealV(game)) as unknown as LL;
// And the real one to the game's: the nearest piece's answer, then corrected until it comes back to the place asked for.
const toGame = (real: LL, sets: readonly Laying[] = SETS): THREE.Vector3 => {
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
// Africa's picture, and its laying. Three layings eased into one another by where a place really is: its northern shore
// as Europe's drawing lays it (it faces Europe across the sea and must run the sea's whole length); the Red Sea's shore
// and the Horn as Asia lays Arabia, so the sea between stays a narrow sea; the rest its own, narrowing little by little
// from the sea's length to its own waist at the Equator. Down, it runs from Europe's shore to the Horn where Asia sets
// it, and from there to the Cape at CAPE degrees south (far enough to keep its shape, not so far as the cold).
// (`inland`: without the Red Sea's laying, for a river's course: between the two layings its valley would be torn.)
const AFRICA = { centre: [-13, 20] as LL, cols: 160, rows: 104, cape: -45 };
let africaRows: { horn: number; south: number } | null = null;
function africaLaid(real: LL, inland: boolean): THREE.Vector3 {
  const [lat] = real, x = vec(real), ease = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
  const c = vec(AFRICA.centre), { cols, rows } = AFRICA;
  const cell = (p: THREE.Vector3): [number, number] => { const d = c.angleTo(p) / RAD, b = bearing(c, p); return [cols / 2 + (d * Math.sin(b)) / CELL, rows / 2 - (d * Math.cos(b)) / CELL]; };
  const own = SETS.find((q) => q.name === 'africa')!, europe = regionOf('europe'), asia = regionOf('asia');
  // (The Horn set a tile and a half further down than Arabia's laying puts it: the Gulf of Aden and Bab-el-Mandeb are
  // narrower than a tile, and laid as Arabia is the Horn came against it.)
  const asiaCell = (r: LL): [number, number] => { const at = cell(arabia(toGame(r, setsOf(asia)))); return [at[0], at[1] + 4.5 * ease((15 - r[0]) / 2.5)]; };
  const shoreAt = (lon: number) => cell(laid(europe, vec([33, lon])))[1];
  // (How far down the Horn's latitude and the Cape fall: where Asia sets Djibouti, and CAPE.)
  if (!africaRows) {
    const horn = asiaCell([12, 43.1])[1], cape = rows / 2 + (AFRICA.centre[0] - AFRICA.cape) / CELL;
    africaRows = { horn: (horn - shoreAt(43.1)) / 21, south: (cape - horn) / 46.5 };
  }
  // (How near the Red Sea and the Gulf of Aden: all Asia's laying within 4 degrees of their middle line, none of it 14 away.)
  const line: LL[] = [[30, 32.5], [27.5, 34], [20, 38.5], [15, 41.5], [12.5, 43.5], [12, 47], [12.3, 51.5]];
  let near = 99;
  if (!inland) for (let i = 0; i + 1 < line.length; i++) for (let f = 0; f <= 1; f += 0.1) near = Math.min(near, far(real, [line[i]![0] + (line[i + 1]![0] - line[i]![0]) * f, line[i]![1] + (line[i + 1]![1] - line[i]![1]) * f]));
  const e = cell(laid(europe, x)), a = cell(go(own.game, (own.real.angleTo(x) / RAD) * own.by, bearing(own.real, x)));
  const below = shoreAt(real[1]) + (lat > 12 ? (33 - lat) * africaRows.horn : 21 * africaRows.horn + (12 - lat) * africaRows.south);
  const horn = 1 - ease((near - 4) / 10), across = ease((35 - lat) / 38), down = ease((35 - lat) / 4);
  let col = e[0] + (a[0] - e[0]) * across, row = e[1] + (below - e[1]) * down;
  if (horn > 0) { const h = asiaCell(real); col = horn * h[0] + (1 - horn) * col; row = horn * h[1] + (1 - horn) * row; }
  const px = (col - cols / 2) * CELL, py = (rows / 2 - row) * CELL;
  return go(c, Math.hypot(px, py), Math.atan2(px, py));
}
const REGIONS: readonly Region[] = [
  // (Europe as it was drawn for the medium map, tile for tile: there a character was a degree, a third of a tile; here it
  // is CELL of one, a third of the large map's smaller tile. So Europe is as many tiles as it was, and takes less of the globe.)
  { name: 'europe', at: [48, 14], to: () => vec([45, 15]), by: 2.2 * CELL, middle: [48, 14], cols: 100, rows: 92, cell: CELL,
    keep: (r) => far(r, [48, 14]) <= 31 && r[0] >= 29.5 },
  // (Asia, traced through the pieces: all that lies east of the Red Sea, the Levant and Europe's drawing.)
  { name: 'asia', at: [35, 95], to: () => vec([0, 0]), by: 1, middle: [35, 95], centre: [21.0836, 115.2291], cols: 204, rows: 136, cell: CELL,
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
  { name: 'africa', at: [0, 18], to: () => vec([0, 0]), by: 1, middle: [3, 18], centre: AFRICA.centre, cols: AFRICA.cols, rows: AFRICA.rows, cell: CELL,
    forward: (real) => africaLaid(real, false),
    keep: (r) => {
      const [lat, lon] = r;
      if (lon < -26 || lon > 52 || lat < -36) return false;
      if (lat >= 30) return lon < 34.2 && lat < (lon < -1.9 ? 35.95 : lon < 11.5 ? 37.4 : 33.5);
      if (lat >= 12.4) return lon < 32.6 + 0.62 * (30 - lat);
      return true;
    } },
  // (The Americas, with Greenland: North America a little under life size, the Caribbean and Central America half as
  // large again, South America less; set across an Atlantic narrower than life, Alaska near Asia's last cape.)
  { name: 'americas', at: [15, -85], to: () => vec([0, 0]), by: 1, middle: [12, -88], cols: 170, rows: 196, cell: CELL,
    eased: ['northAmerica', 'caribbean', 'southAmerica', 'greenland'],
    keep: ([lat, lon]) => (lon >= -170 && lon <= -34 && lat > -57) || (lat >= 59 && lon > -75 && lon < -10 && !(lon > -27 && lat < 68)) },
  // (Australia with New Guinea, and New Zealand half as large again.)
  { name: 'oceania', at: [-25, 140], to: () => vec([0, 0]), by: 1, middle: [-24, 146], cols: 110, rows: 84, cell: CELL,
    eased: ['newGuinea', 'australia', 'newZealand'],
    keep: ([lat, lon]) => lon > 110 && lat < 1.5 && lat > -50 && (lon > 130.8 || lat < -10.5) },
];
const regionOf = (name: string): Region => { const r = REGIONS.find((x) => x.name === name); if (!r) throw new Error(`no region ${name}`); return r; };
// A region's own laying of the real world on the game's, and back; the middle of its picture on the game's globe.
const layOf = (r: Region): { real: THREE.Vector3; game: THREE.Vector3; by: number } => ({ real: vec(r.at), game: r.to(), by: r.by });
const setsOf = (r: Region): Laying[] => SETS.filter((s) => r.eased!.includes(s.name));
const laid = (r: Region, real: THREE.Vector3): THREE.Vector3 => { if (r.eased) return toGame(latLon(real) as unknown as LL, setsOf(r)); const l = layOf(r); return go(l.game, (l.real.angleTo(real) / RAD) * l.by, bearing(l.real, real)); };
const unlaid = (r: Region, game: THREE.Vector3): THREE.Vector3 => { if (r.eased) return toRealV(game, setsOf(r)); const l = layOf(r); return go(l.real, l.game.angleTo(game) / RAD / l.by, bearing(l.game, game)); };
const middleOf = (r: Region): THREE.Vector3 => (r.centre ? vec(r.centre) : laid(r, vec(r.middle)));
if (process.argv.includes('--centres')) for (const r of REGIONS) console.log(`${r.name}: its picture's middle is at ${latLon(laid(r, vec(r.middle))).map((x) => x.toFixed(4)).join(', ')} on the game's globe`);
// The point of the game's globe under a cell of a region's picture.
function cellGame(name: string, col: number, row: number): THREE.Vector3 {
  const r = regionOf(name), x = (col + 0.5 - r.cols / 2) * r.cell, y = (r.rows / 2 - row - 0.5) * r.cell;
  return go(middleOf(r), Math.hypot(x, y), Math.atan2(x, y));
}
// Arabia is drawn shorter than its tracing (asia.fix.py, which prints these numbers: from that row of Asia's picture
// down, that much as long): as traced it reached too far south beside Africa. A place Asia lays there, as the drawing has it.
const ARABIA = { row: 78, by: 0.5, cols: 62 };
function arabia(p: THREE.Vector3): THREE.Vector3 {
  const asia = regionOf('asia'), c = middleOf(asia), at = cellOf(c, p, asia.cols, asia.rows, asia.cell);
  if (!at || at[0] >= ARABIA.cols || at[1] <= ARABIA.row) return p;
  const x = (at[0] - asia.cols / 2) * asia.cell, y = (asia.rows / 2 - (ARABIA.row + (at[1] - ARABIA.row) * ARABIA.by)) * asia.cell;
  return go(c, Math.hypot(x, y), Math.atan2(x, y));
}
// The regions drawn so far for the large map (the others are being drawn again against Europe's new size).
const DRAWN: readonly string[] = ['europe', 'asia', 'africa', 'americas', 'oceania'];
const OVER_SEA: readonly string[] = ['americas', 'oceania'];
const PATCHES: Patch[] = [];
for (const r of REGIONS) {
  if (!DRAWN.includes(r.name)) continue;
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

// ---------- rivers ----------

// The great rivers, by real places from source to mouth (a tributary after the river it joins). They are the first
// drawing only: once scripts/earth/rivers.json is there (--absorb writes it from the medium map, with whatever was
// drawn or erased since in the map editor), the rivers are those, as places on the game's globe.
const RIVERS: readonly (readonly [string, ...LL[]])[] = [
  ['Danube', [48.1, 8.3], [48.4, 10], [48.9, 12.1], [48.3, 14.3], [48.2, 16.4], [47.5, 19.05], [45.8, 18.9], [44.8, 20.5], [44.6, 22.7], [43.7, 24.5], [44.1, 27.3], [45.2, 29.7]],
  ['Rhine', [46.7, 8.8], [47.6, 8.2], [49, 8.3], [50.4, 7.6], [51.2, 6.8], [51.95, 4.2]],
  ['Elbe', [50.1, 14.4], [51.05, 13.7], [52.1, 11.6], [53.55, 10], [53.9, 8.8]],
  ['Vistula', [50.05, 19.9], [52.2, 21], [53, 18.6], [54.35, 18.95]],
  ['Loire', [45.4, 4.1], [47.4, 2], [47.2, -1.6], [47.3, -2.3]],
  ['Rhône', [46.2, 6.1], [45.75, 4.85], [44, 4.8], [43.35, 4.8]],
  ['Po', [45.05, 7.7], [45.1, 10], [44.95, 12.4]],
  ['Tagus', [40.3, -2], [39.86, -4], [39.5, -8], [38.7, -9.3]],
  ['Dnieper', [55.2, 33.5], [54.5, 30.4], [50.45, 30.5], [48.5, 35], [46.6, 32.5]],
  ['Don', [53.9, 38.3], [51.7, 39.2], [49.5, 43.5], [47.2, 39.6]],
  ['Volga', [57.2, 32.6], [56.9, 35.9], [57.6, 39.9], [56.3, 44], [55.8, 49.1], [53.2, 50.1], [51.5, 46], [48.7, 44.5], [46.2, 48.1]],
  ['Nile', [4.85, 31.6], [9.5, 31.6], [15.6, 32.5], [17.7, 33.5], [19.5, 30.5], [21.8, 31], [24.1, 32.6], [26, 32.4], [29.8, 31.2], [31.45, 30.4]],
  ['Blue Nile', [11.6, 37.4], [10.3, 37], [11.2, 35.1], [13.5, 33.6], [15.6, 32.5]],
  ['Niger', [9.5, -10.7], [12.6, -8], [14.5, -4.2], [16.8, -3], [16.3, -0.05], [13.5, 2.1], [11.9, 3.6], [9, 4.8], [7.75, 6.75], [4.4, 6]],
  ['Congo', [-11.8, 27.5], [-5, 27], [0.5, 25.2], [2, 21], [0, 18.3], [-4.3, 15.3], [-6, 12.4]],
  ['Zambezi', [-11.4, 24.3], [-15.2, 23], [-17.9, 25.9], [-15.6, 30.4], [-16.2, 33.6], [-18.6, 36.3]],
  ['Orange', [-29, 29], [-30.7, 25.5], [-28.7, 20.5], [-28.6, 16.5]],
  ['Senegal', [11, -11.5], [14.4, -11.4], [16.5, -14.5], [16, -16.5]],
  ['Tigris', [38.4, 39.6], [37.9, 40.2], [36.3, 43.1], [33.3, 44.4], [31, 47.4], [30, 48.5]],
  ['Euphrates', [39.7, 40.3], [36.9, 38], [35.9, 39], [34.4, 40.9], [32.5, 44.4], [31, 47.4]],
  ['Indus', [32.5, 80], [34.1, 77.5], [35.7, 74.6], [33.9, 72.2], [30, 70.8], [27.7, 68.8], [24, 67.5]],
  ['Ganges', [30.9, 79], [29.9, 78.2], [27.5, 80], [25.4, 81.9], [25.6, 85.1], [24.8, 87.9], [23.7, 90.4], [22.3, 91]],
  ['Brahmaputra', [30.3, 82], [29.3, 88.9], [29.6, 94.9], [28.1, 95.3], [26.2, 91.7], [24.9, 89.6], [23.7, 90.4]],
  ['Amu Darya', [37.1, 71.5], [37.2, 67.3], [41.5, 60.6], [43.7, 59.2]],
  ['Yangtze', [33.4, 91], [31.5, 97.3], [26.5, 100.2], [28.8, 104.6], [29.6, 106.6], [30.7, 111.3], [30.6, 114.3], [32.05, 118.8], [31.4, 121.9]],
  ['Yellow River', [34.9, 96.3], [36, 103.8], [40.6, 108], [40.2, 111.2], [34.8, 110.3], [34.9, 113.6], [37.8, 119]],
  ['Mekong', [33, 94], [29.7, 98.1], [22, 100.8], [17.97, 102.6], [13.5, 105.9], [11.56, 104.9], [10, 106.6]],
  ['Irrawaddy', [27, 97.6], [24.3, 96.5], [21.97, 96.1], [18.8, 95.2], [16, 95.3]],
  ['Amur', [53.3, 121.5], [50.3, 127.5], [48.5, 135.1], [50.5, 137], [53.1, 140.8]],
  ['Ob', [51.95, 85.9], [55, 82.9], [58.3, 82.9], [61, 69], [66.5, 66.6], [66.9, 69.5]],
  ['Yenisei', [51.7, 94.4], [53.7, 91.4], [56, 92.9], [58.45, 92.2], [61.6, 90.1], [66, 87], [69.4, 86.2], [71.9, 82.6]],
  ['Mississippi', [47.2, -95.2], [44.9, -93.1], [41.5, -90.6], [38.6, -90.2], [35.1, -90], [32.3, -91], [30, -90.1], [29.2, -89.3]],
  ['Missouri', [45.9, -111.5], [47.5, -111.3], [48, -106], [46.8, -100.8], [42.5, -96.4], [39.1, -94.6], [38.6, -90.2]],
  ['Ohio', [40.4, -80], [38.3, -85.7], [37, -89.1]],
  ['St Lawrence', [44.2, -76.5], [45.5, -73.6], [46.8, -71.2], [48.5, -68.5]],
  ['Rio Grande', [37.7, -107], [35.1, -106.6], [31.8, -106.4], [29.3, -103], [27.5, -99.5], [25.9, -97.2]],
  ['Colorado', [40.2, -105.8], [38.5, -109.6], [36.9, -111.5], [36.1, -114.7], [32.7, -114.7], [31.8, -114.8]],
  ['Columbia', [50.2, -116], [47.9, -118.3], [46.2, -119.1], [45.7, -121.5], [46.2, -123.9]],
  ['Mackenzie', [61.2, -117], [62.8, -123], [65.3, -126.8], [67.4, -133.7], [69, -135]],
  ['Yukon', [60.7, -135], [64.1, -139.4], [66.5, -145.3], [64.7, -156], [62.6, -164.5]],
  ['Amazon', [-4.5, -73.5], [-3.7, -73.2], [-3.3, -67.9], [-3.1, -60], [-2.4, -54.7], [-1.5, -52], [-0.5, -50.5]],
  ['Madeira', [-10.4, -65.4], [-8.7, -63.9], [-5.8, -61.3], [-3.4, -58.8]],
  ['Orinoco', [3, -65.9], [6.2, -67.5], [7.9, -65], [8.1, -63.5], [8.6, -62.2], [9, -61]],
  ['Paraná', [-20, -51], [-24, -54.3], [-27.4, -55.9], [-27.5, -58.8], [-32.9, -60.7], [-34, -58.5]],
  ['São Francisco', [-20.2, -46.4], [-17.3, -44.9], [-12.2, -43.2], [-9.4, -40.5], [-10.4, -36.4]],
  ['Murray', [-36.8, 148.2], [-36.1, 146.9], [-34.2, 142.2], [-34.2, 140.7], [-35.4, 139.3]],
  ['Lena', [53.9, 108], [57.8, 108.1], [60.7, 114.9], [62, 129.7], [66.8, 123.4], [72.5, 127]],
];
// A real place on the game's globe, by whichever region draws it.
const layAny = (real: LL): THREE.Vector3 => {
  const africa = regionOf('africa'), europe = regionOf('europe');
  for (const name of ['americas', 'oceania']) { const reg = regionOf(name); if (reg.keep(real)) return laid(reg, vec(real)); }
  if (africa.keep(real)) return africaLaid(real, false);
  if (europe.keep(real)) { const p = laid(europe, vec(real)), at = cellOf(middleOf(europe), p, europe.cols, europe.rows, europe.cell); if (at && at[0] >= 0 && at[0] < europe.cols - 6 && at[1] >= 0 && at[1] < europe.rows) return p; }
  return arabia(laid(regionOf('asia'), vec(real)));
};
const riversKept = (): boolean => { try { readFileSync(new URL('./earth/rivers.json', import.meta.url)); return true; } catch { return false; } };
// The rivers as places on the game's globe, source to mouth: the kept ones, or failing those the great rivers laid down.
const riverWays = (): LL[][] => {
  if (!DRAWN.includes('asia') || !DRAWN.includes('africa')) return [];
  try { return (JSON.parse(readFileSync(new URL('./earth/rivers.json', import.meta.url), 'utf8')) as { rivers: LL[][] }).rivers; }
  catch {
    // (The Nile and the Blue Nile by Africa's inland laying alone: between it and the Red Sea's their valley would be torn.)
    return RIVERS.map(([name, ...pts]) => pts.map((p) => latLon(name.includes('Nile') ? africaLaid(p, true) : layAny(p)) as unknown as LL));
  }
};
// A way of places set on a globe's corners: from each place's nearest corner on to the next's by the shortest way along
// tile borders that have land on both sides (any border, if there is none); ended at the first corner that touches
// water or lies on a river set before it, and carried on to one if it stops short.
function riverOn(globe: Globe, paint: Painting, way: readonly LL[], taken: Set<number>, first: boolean): number[] {
  const g = cornerGraph(globe), T = globe.tris.length;
  const wet = (c: number) => globe.tris[c]!.some((t) => paint.terrain[t] !== LAND);
  const nearest = (p: THREE.Vector3): number => { let best = 0, bd = -2; for (let c = 0; c < T; c++) { const d = globe.triCenters[c]!.dot(p); if (d > bd) { bd = d; best = c; } } return best; };
  const walk = (from: number, done: (c: number) => boolean, dry: boolean, limit = 1e9): number[] | null => {
    const came = new Int32Array(T).fill(-1), steps = new Int32Array(T), queue = [from];
    came[from] = from;
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i]!;
      if (x !== from && done(x)) { const path = [x]; for (let y = x; y !== from;) { y = came[y]!; path.push(y); } return path.reverse(); }
      if (steps[x]! >= limit) continue;
      for (let k = 0; k < 3; k++) {
        const y = g.neighbors[x * 3 + k]!;
        if (y < 0 || came[y]! >= 0) continue;
        const ta = g.borderTiles[x * 6 + k * 2]!, tb = g.borderTiles[x * 6 + k * 2 + 1]!;
        if (dry && (paint.terrain[ta] !== LAND || paint.terrain[tb] !== LAND)) continue;
        // (Never between two mountains: a river in a cleft of peaks is drawn badly, and none runs so.)
        if (paint.relief[ta] === MOUNTAINS && paint.relief[tb] === MOUNTAINS) continue;
        came[y] = x; steps[y] = steps[x]! + 1; queue.push(y);
      }
    }
    return null;
  };
  let out = [nearest(vec(way[0]!))];
  for (const place of way.slice(1)) {
    const to = nearest(vec(place)), from = out[out.length - 1]!;
    if (to === from) continue;
    const leg = walk(from, (c) => c === to, true) ?? walk(from, (c) => c === to, false);
    if (leg) out.push(...leg.slice(1));
  }
  // (No corner twice: where the way comes back to a corner it has passed (it overshot a place and turned), the loop is dropped.)
  const once: number[] = [];
  for (const c of out) { const at = once.indexOf(c); if (at >= 0) once.length = at; once.push(c); }
  out = once;
  // (A river that rises in a lake leaves it first: its end is looked for from where it is clear of the water.)
  // (Only when a river is first laid down from its real course: one kept from the map is already clear.)
  if (first) { const clear = Math.max(1, out.findIndex((c) => !wet(c)) + 1); out = out.slice(Math.max(0, clear - 2)); }
  // (It ends at the sea or on another river; a lake on its way it passes by, and ends in one only if that is where its way stops.)
  const salt = (c: number) => globe.tris[c]!.some((t) => paint.terrain[t] === SEA);
  const end = out.findIndex((c, i) => i > 1 && (salt(c) || taken.has(c)));
  if (end > 0) out = out.slice(0, end + 1);
  else if (!wet(out[out.length - 1]!) && !taken.has(out[out.length - 1]!)) { const on = walk(out[out.length - 1]!, (c) => wet(c) || taken.has(c), true, 8); if (on) out.push(...on.slice(1)); }
  return out;
}

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
      if (total * 2 <= pts.length) continue; // (mostly outside the picture or left blank)
      const wet = (count.get('o') ?? 0) * 2 > total;
      // (An earlier region's tile is kept; but the New World's land is laid over the open sea of the Old World's pictures,
      // whose edges reach out over where it lies.)
      if (drawn[t.id] && !(OVER_SEA.includes(patch.name) && drawn[t.id] === 4 && land * 2 >= total && !wet)) continue;
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
  if (arg('show', '')) {
    const reg = regionOf(arg('show', ''));
    for (let r = 0; r < reg.rows; r++) {
      let line = '';
      for (let q = 0; q < reg.cols; q++) { const t = nearestTile(globe, cellGame(reg.name, q, r)); line += paint.terrain[t] === SEA ? '.' : paint.terrain[t] === LAKE ? 'o' : paint.relief[t] === MOUNTAINS ? '^' : paint.relief[t] === HILLS ? 'h' : '#'; }
      console.log(line);
    }
  }
  // --where <tile,tile...>: where tiles of the medium globe fall in each region's picture, and what is drawn there.
  if (arg('where', '')) {
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
  if (arg('tileAt', '')) { const [n, c, r] = arg('tileAt', '').split(','); console.log(`  tileAt ${nearestTile(globe, cellGame(n!, Number(c), Number(r)))}`); }
  if (process.env['PROBE']) for (const [name, lat, lon] of JSON.parse(process.env['PROBE']) as [string, number, number][]) {
    const t = tileAt([lat, lon]), back = toReal(globe.tiles[t]!.center), at = latLon(globe.tiles[t]!.center);
    console.log(`  ${name} [${lat}, ${lon}]: tile ${t} at game ${at[0].toFixed(1)}, ${at[1].toFixed(1)}; its middle is really ${back[0].toFixed(1)}, ${back[1].toFixed(1)}; share ${share[t]!.toFixed(2)} lake ${lake[t]!.toFixed(2)} terrain ${paint.terrain[t]}`);
  }
  // (A lake that touches the sea is the sea: on a smaller globe a lake drawn near a coast can come to lie against it.)
  for (let again = true; again;) {
    again = false;
    for (const t of globe.tiles) if (paint.terrain[t.id] === LAKE && t.neighbors.some((x) => paint.terrain[x] === SEA)) { paint.terrain[t.id] = SEA; again = true; }
  }
  // The rivers.
  const fromFile = riversKept();
  const taken = new Set<number>();
  for (const way of riverWays()) {
    const r = riverOn(globe, paint, way, taken, !fromFile);
    if (r.length < 3) continue;
    paint.rivers.push(r);
    for (const c of r) taken.add(c);
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

// Real places, by which a region's corrections find their way in its tracing (<region>.marks.json).
const MARKS: readonly (readonly [string, number, number])[] = [
  ['Lisbon', 38.7, -9.1], ['Gibraltar', 36.1, -5.3], ['Paris', 48.9, 2.3], ['London', 51.5, -0.1], ['Rome', 41.9, 12.5], ['Athens', 38, 23.7], ['Istanbul', 41, 29], ['Moscow', 55.8, 37.6],
  ['Batumi', 41.6, 41.6], ['Baku', 40.4, 49.9], ['Astrakhan', 46.3, 48], ['Iskenderun', 36.6, 36.2], ['Beirut', 33.9, 35.5], ['Limassol', 34.7, 33], ['Suez', 30, 32.5], ['Aqaba', 29.5, 35],
  ['Jeddah', 21.5, 39.2], ['Aden', 12.8, 45], ['Salalah', 17, 54.1], ['Muscat', 23.6, 58.4], ['Musandam', 26.3, 56.3], ['BandarAbbas', 27.2, 56.3], ['Doha', 25.3, 51.5], ['Kuwait', 29.4, 48],
  ['Basra', 30.5, 47.8], ['Tehran', 35.7, 51.4], ['Kabul', 34.5, 69.2], ['Karachi', 24.9, 67], ['Mumbai', 19.1, 72.9], ['Delhi', 28.6, 77.2], ['Srinagar', 34.1, 74.8], ['Kathmandu', 27.7, 85.3],
  ['Lhasa', 29.7, 91.1], ['Kolkata', 22.6, 88.4], ['Kanyakumari', 8.1, 77.5], ['Chennai', 13.1, 80.3], ['Colombo', 6.9, 79.9], ['Jaffna', 9.7, 80], ['Dondra', 5.9, 80.6], ['Yangon', 16.8, 96.2],
  ['Bangkok', 13.7, 100.5], ['Kra', 10.3, 99], ['Penang', 5.4, 100.3], ['Singapore', 1.3, 103.8], ['Medan', 3.6, 98.7], ['Aceh', 5.6, 95.3], ['Lampung', -5.6, 105.3], ['Jakarta', -6.2, 106.8],
  ['Surabaya', -7.3, 112.7], ['Pontianak', 0, 109.3], ['Kuching', 1.5, 110.3], ['Sandakan', 5.8, 118.1], ['Banjarmasin', -3.3, 114.6], ['Makassar', -5.1, 119.4], ['Manado', 1.5, 124.8],
  ['Manila', 14.6, 121], ['Aparri', 18.4, 121.6], ['Davao', 7.1, 125.6], ['Hanoi', 21, 105.8], ['Saigon', 10.8, 106.7], ['Haikou', 20, 110.3], ['HongKong', 22.3, 114.2], ['Taipei', 25, 121.5],
  ['Kaohsiung', 22.6, 120.3], ['Shanghai', 31.2, 121.5], ['Qingdao', 36.1, 120.4], ['Beijing', 39.9, 116.4], ['Dalian', 38.9, 121.6], ['Seoul', 37.6, 127], ['Busan', 35.1, 129], ['Pyongyang', 39, 125.8],
  ['Vladivostok', 43.1, 131.9], ['Fukuoka', 33.6, 130.4], ['Kagoshima', 31.6, 130.6], ['Hiroshima', 34.4, 132.5], ['Osaka', 34.7, 135.5], ['Tokyo', 35.7, 139.7], ['Niigata', 37.9, 139], ['Sendai', 38.3, 140.9],
  ['Aomori', 40.8, 140.7], ['Sapporo', 43.1, 141.3], ['Wakkanai', 45.4, 141.7], ['Kushiro', 43, 144.4], ['Sakhalin', 50, 142.8], ['Amur', 53.1, 140.7], ['Magadan', 59.6, 150.8], ['Kamchatka', 56, 160],
  ['Lopatka', 51, 156.7], ['Anadyr', 64.7, 177.5], ['Uelen', 66.2, -169.8], ['Tiksi', 71.6, 128.9], ['Taymyr', 76, 100], ['Yamal', 70, 70], ['Omsk', 55, 73.4], ['Irkutsk', 52.3, 104.3], ['Urumqi', 43.8, 87.6],
  ['Almaty', 43.2, 76.9], ['Ulaanbaatar', 47.9, 106.9], ['Chengdu', 30.6, 104.1], ['Kunming', 25, 102.7], ['Tashkent', 41.3, 69.3], ['Aral', 45, 60], ['Balkhash', 46.5, 75], ['Baikal', 53.5, 108],
  ['Tangier', 35.8, -5.8], ['Algiers', 36.75, 3.05], ['Tunis', 36.8, 10.2], ['Tripoli', 32.9, 13.2], ['Benghazi', 32.1, 20.1], ['Alexandria', 31.2, 29.9], ['Cairo', 30, 31.2], ['Aswan', 24.1, 32.9],
  ['Khartoum', 15.6, 32.5], ['Massawa', 15.6, 39.5], ['Djibouti', 11.6, 43.1], ['Guardafui', 11.8, 51.2], ['Mogadishu', 2, 45.3], ['Mombasa', -4, 39.7], ['Dar', -6.8, 39.3], ['Maputo', -26, 32.6],
  ['Durban', -29.9, 31], ['CapeTown', -33.9, 18.4], ['Luanda', -8.8, 13.2], ['Douala', 4, 9.7], ['Lagos', 6.5, 3.4], ['Accra', 5.6, -0.2], ['Dakar', 14.7, -17.4], ['Casablanca', 33.6, -7.6],
  ['Antananarivo', -18.9, 47.5], ['Kinshasa', -4.3, 15.3], ['Victoria', -1, 33], ['Addis', 9, 38.7],
  ['Anchorage', 61.2, -149.9], ['Nome', 64.5, -165.4], ['Vancouver', 49.3, -123.1], ['Victoria BC', 49.6, -125.5], ['SanFrancisco', 37.8, -122.4], ['LosAngeles', 34, -118.2], ['CaboSanLucas', 22.9, -109.9],
  ['Mazatlan', 23.2, -106.4], ['MexicoCity', 19.4, -99.1], ['Veracruz', 19.2, -96.1], ['Merida', 21, -89.6], ['Cancun', 21.2, -86.8], ['Guatemala', 14.6, -90.5], ['Managua', 12.1, -86.3],
  ['Panama', 9, -79.5], ['Houston', 29.8, -95.4], ['NewOrleans', 30, -90.1], ['Miami', 25.8, -80.2], ['Jacksonville', 30.3, -81.7], ['NewYork', 40.7, -74], ['Boston', 42.4, -71.1], ['Halifax', 44.6, -63.6],
  ['StJohns', 47.6, -52.7], ['Quebec', 46.8, -71.2], ['Chicago', 41.9, -87.6], ['Winnipeg', 49.9, -97.1], ['Churchill', 58.8, -94.2], ['Iqaluit', 63.7, -68.5], ['Nuuk', 64.2, -51.7], ['Denver', 39.7, -105],
  ['Havana', 23.1, -82.4], ['Santiago de Cuba', 20, -75.8], ['Kingston', 18, -76.8], ['PortAuPrince', 18.6, -72.3], ['SantoDomingo', 18.5, -69.9], ['SanJuan', 18.4, -66.1], ['Nassau', 25.1, -77.3],
  ['Cartagena', 10.4, -75.5], ['Caracas', 10.5, -66.9], ['Trinidad', 10.5, -61.3], ['Bogota', 4.7, -74.1], ['Quito', -0.2, -78.5], ['Lima', -12, -77], ['LaPaz', -16.5, -68.1], ['Santiago', -33.5, -70.7],
  ['PuntaArenas', -53.2, -70.9], ['BuenosAires', -34.6, -58.4], ['Rio', -22.9, -43.2], ['Salvador', -13, -38.5], ['Recife', -8.1, -34.9], ['Belem', -1.4, -48.5], ['Manaus', -3.1, -60], ['Cayenne', 4.9, -52.3],
  ['Darwin', -12.5, 130.8], ['CapeYork', -10.7, 142.5], ['Cairns', -16.9, 145.8], ['Brisbane', -27.5, 153], ['Sydney', -33.9, 151.2], ['Melbourne', -37.8, 145], ['Hobart', -42.9, 147.3], ['Adelaide', -34.9, 138.6],
  ['Perth', -32, 115.9], ['Broome', -18, 122.2], ['AliceSprings', -23.7, 133.9], ['PortMoresby', -9.5, 147.2], ['Jayapura', -2.5, 140.7], ['Sorong', -0.9, 131.3], ['Merauke', -8.5, 140.4],
  ['Auckland', -36.8, 174.8], ['Wellington', -41.3, 174.8], ['Christchurch', -43.5, 172.6], ['Invercargill', -46.4, 168.4],
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
      // (What is not the region's is left blank where it is another's to draw: sea drawn there would drown the other's land.)
      const others = !kept && (!reg.eased || REGIONS.some((o) => o !== reg && o.keep(real)));
      // (A lake is a lake: left as sea, an inland sea is joined to the ocean by the game.)
      a += others ? ' ' : lake ? 'o' : !on ? '.' : relief === MOUNTAINS ? '^' : relief === HILLS ? 'h' : '#';
      b += others ? ' ' : !on ? '.' : '-ItTcspFRmdvMJ'[biome ? PAINTABLE_BIOMES.indexOf(biome as typeof PAINTABLE_BIOMES[number]) + 1 : 7]!;
    }
    land.push(a); kinds.push(b);
  }
  // (Where real places fall in it: <name>.marks.json, which the corrections are placed by, so they follow the tracing if it is laid anew.)
  {
    const marks: Record<string, [number, number]> = {};
    for (const [label, lat, lon] of MARKS) {
      if (!reg.keep([lat, lon]) && !reg.eased && !reg.forward) continue;
      const g = reg.forward ? reg.forward([lat, lon]) : laid(reg, vec([lat, lon])), d = c.angleTo(g) / RAD, b = bearing(c, g);
      const q = Math.floor(cols / 2 + (d * Math.sin(b)) / cell), r = Math.floor(rows / 2 - (d * Math.cos(b)) / cell);
      if (q >= 0 && r >= 0 && q < cols && r < rows) marks[label] = [q, r];
    }
    writeFileSync(new URL(`./earth/${reg.name}.marks.json`, import.meta.url), JSON.stringify(marks).replace(/\],/g, '],\n') + '\n');
  }
  // (And any asked for: --marks '[["name",lat,lon],...]')
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
  // (And where the regions drawn before it have land, in this picture: <name>.under.txt, by which its corrections keep
  // a strait between its land and theirs.)
  {
    const under: string[] = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let q = 0; q < cols; q++) {
        const p = cellGame(reg.name, q, r);
        let ch = '.';
        for (const patch of PATCHES) {
          if (patch.name === reg.name) continue;
          const at = cellOf(patch.to, p, Math.max(...patch.rows.map((x) => x.length)), patch.rows.length, patch.cell), was = at ? patch.rows[Math.floor(at[1])]?.[Math.floor(at[0])] : undefined;
          if (was && was !== '.' && was !== ' ' && was !== 'o') { ch = '#'; break; }
        }
        line += ch;
      }
      under.push(line);
    }
    writeFileSync(new URL(`./earth/${reg.name}.under.txt`, import.meta.url), under.join('\n') + '\n');
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
  const size: MapSizeKey = EARTH_SIZE, { paint: fresh, globe } = paintSize(size);
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
  // (And its rivers, as the places they run through: all of them, as they now stand.)
  writeFileSync(new URL('./earth/rivers.json', import.meta.url), JSON.stringify({ note: 'The rivers of the Earth map as places on the game\'s globe (latitude, longitude), source to mouth; written by scripts/earth.ts --absorb from the medium map.', rivers: edited.rivers.map((r) => r.map((c) => latLon(globe.triCenters[c]!).map((x) => Math.round(x * 100) / 100))) }).replace(/\]\],\[\[/g, ']],\n[[') + '\n');
  console.log(`${edited.rivers.length} rivers kept`);
  console.log(`${changed.size} tiles differ; ${[...changed].filter((t) => !owner.has(t)).length} lie under no drawing. Run again without --absorb to paint every size from the drawings.`);
  process.exit(0);
}

const file: PaintFile = {};
let failed = false;
for (const size of [EARTH_SIZE]) {
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
