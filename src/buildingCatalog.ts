import * as THREE from 'three';
import { CATALOG, buildCatalogGeometry, buildModel, cone, cyl, part, seg, tf, V, type CatalogKind, type Palette, type Tf } from './propCatalog.ts';
import { houseGeometry, isHouseKind, type HouseKind } from './houses.ts';
import { isWonderModelKind, wonderGeometry, type WonderModelKind } from './wonderModels.ts';
import { isRuralModelKind, ruralGeometry, type RuralModelKind } from './rural/models.ts';

// City models: houses, rural structures, quarter buildings and wonders,
// drawn as instanced props like the flora (render.ts) and shown in the prop
// gallery. Same rules as the flora catalog: low-poly primitives, no hidden
// faces, per-vertex colors; the roof is the "leaf" part so each instance can
// get its own roof color (terracotta, slate, thatch). Sizes are for the
// reference tile (edge 0.07) before the prop scale: a cottage is about a
// quarter of a fir's height.
//
// Materials are realistic and muted: buildings are told apart by their
// shapes, never by bright colors.

export interface BuildingEntry {
  name: string;
  leaf: number; // roof
  accent?: number;
  water?: 'float' | 'shore'; // float: on the water surface (boats); shore: on land or in shallow water
  build: (p: Palette) => THREE.BufferGeometry[];
}

const PLASTER = 0xcfc2a8;
const STONE = 0xb8b0a0;
const DARK_STONE = 0x8d877c;
const TIMBER = 0x7a5f45;
const IRON = 0x4a4744;
// A fort's side (its model's, before it is fitted to its tile: cityProps.ts fort).
export const FORT_SIDE = 0.06;

// Four walls (open box: no floor, the roof covers the top), w along x, d along z.
function walls(w: number, d: number, h: number, color: number, o: Tf = {}): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0).scale(w, h, d);
  return part(g, color, tf(o));
}

// A closed block (walls and a flat top).
function block(w: number, d: number, h: number, color: number, o: Tf = {}): THREE.BufferGeometry[] {
  return [walls(w, d, h, color, o), flat(w, d, color, { ...o, y: (o.y ?? 0) + h })];
}

// A flat roof or slab at height 0.
function flat(w: number, d: number, color: number, o: Tf = {}): THREE.BufferGeometry {
  return part(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), color, tf(o));
}

// A gable roof over w × d with its ridge along x, h high (6 triangles).
function gable(w: number, d: number, h: number, color: number, o: Tf = {}): THREE.BufferGeometry {
  const x = w / 2, z = d / 2;
  const p = [
    -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0, // front slope
    x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0, // back slope
    -x, 0, -z, -x, 0, z, -x, h, 0, // gables
    x, 0, z, x, 0, -z, x, h, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return part(g, color, tf(o));
}

// A hipped (pyramid) roof over w × d, h high (4 triangles).
function hip(w: number, d: number, h: number, color: number, o: Tf = {}): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0).scale(w, h, d);
  return part(g, color, tf(o));
}


// A house: walls plus a gable roof with a small overhang.
function house(w: number, d: number, h: number, roofH: number, wall: number, roof: number, o: Tf = {}): THREE.BufferGeometry[] {
  return [walls(w, d, h, wall, o), gable(w * 1.08, d * 1.18, roofH, roof, { ...o, y: (o.y ?? 0) + h })];
}

export const BUILDINGS_CATALOG = {
  // ---------- rural ----------
  farmstead: { name: 'Farmstead', leaf: 0x8a5a44, build: (p) => [
    ...house(0.0042, 0.003, 0.0024, 0.0016, PLASTER, p.leaf),
    ...house(0.0056, 0.0034, 0.0028, 0.002, TIMBER, 0x6a5a48, { x: 0.0004, z: -0.0048 }),
  ] },
  mineHead: { name: 'Mine head', leaf: 0x5a4a3a, build: (p) => [
    seg(V(-0.0016, 0, -0.0012), V(0, 0.0085, 0), 0.00035, 0.00025, 3, TIMBER),
    seg(V(0.0016, 0, -0.0012), V(0, 0.0085, 0), 0.00035, 0.00025, 3, TIMBER),
    seg(V(0, 0, 0.0018), V(0, 0.0085, 0), 0.00035, 0.00025, 3, TIMBER),
    ...house(0.0036, 0.0028, 0.0022, 0.0013, TIMBER, p.leaf, { x: 0.0045, z: 0.001 }),
    cone(0.0035, 0.0022, 6, 0x6e6458, { x: -0.0045, z: 0.0025 }),
  ] },
  quarryStones: { name: 'Quarry stones', leaf: STONE, build: (p) => [
    ...block(0.0034, 0.0024, 0.0016, p.leaf),
    ...block(0.0024, 0.002, 0.0011, p.leaf, { x: 0.0034, z: 0.0012, ry: 0.4 }),
    ...block(0.002, 0.0018, 0.0022, DARK_STONE, { x: -0.001, z: 0.0034, ry: 0.9 }),
  ] },
  lodge: { name: 'Hunting lodge', leaf: 0x5f6a48, build: (p) => [
    ...house(0.0046, 0.0032, 0.0022, 0.0019, TIMBER, p.leaf),
    cyl(0.0003, 0.0003, 0.0018, 3, 0x6a5038, { x: 0.004, z: 0.002, rz: 1.4 }),
  ] },
  stiltHut: { name: 'Stilt hut', leaf: 0xa89260, build: (p) => [
    cyl(0.0003, 0.0003, 0.0016, 3, TIMBER, { x: -0.0012, z: -0.001 }),
    cyl(0.0003, 0.0003, 0.0016, 3, TIMBER, { x: 0.0012, z: 0.001 }),
    ...house(0.0034, 0.0028, 0.0016, 0.0016, 0x9a805c, p.leaf, { y: 0.0016 }),
  ] },
  // ---------- Machu Picchu (on its summit, a wild tile), and a wonder's scaffolding ----------
  // The ruined city on its saddle: terraces stepping down the summit, green
  // on top, houses of grey granite under thatch round the plaza, the
  // Intihuatana on its knoll, Huayna Picchu's peak behind (within the
  // catalog's 120 triangles for a wonder: cityLook.test.ts).
  machuPicchu: { name: 'Machu Picchu', leaf: 0x9a8458, build: (p) => [
    ...([[0.024, 0.02, 0], [0.019, 0.016, 0.0018], [0.014, 0.012, 0.0036]] as const).flatMap(([w, d, y]) => [
      walls(w, d, 0.0018, 0xa49e8e, { y, z: 0.001 }), flat(w, d, y === 0.0036 ? 0x8aa060 : 0x7f9a52, { y: y + 0.0018, z: 0.001 }),
    ]),
    ...([[-0.0042, -0.0022, 0], [0.0042, -0.0024, 0], [-0.0046, 0.0036, Math.PI / 2], [0.0045, 0.0034, Math.PI / 2], [0, -0.0046, 0]] as const).flatMap(([x, z, ry]) => [
      walls(0.003, 0.0022, 0.0018, 0x9c968a, { x, y: 0.0054, z: z + 0.001, ry }), gable(0.0034, 0.0028, 0.0016, p.leaf, { x, y: 0.0072, z: z + 0.001, ry }),
    ]),
    walls(0.0014, 0.0014, 0.0012, 0x8d877c, { x: 0.0, y: 0.0054, z: 0.0035 }),
    cone(0.0065, 0.019, 5, 0x6f7a5a, { z: -0.012, x: 0.003 }),
  ] },
  scaffold: { name: 'Scaffolding', leaf: TIMBER, build: (p) => [
    ...[[-0.008, -0.008], [0.008, -0.008], [-0.008, 0.008], [0.008, 0.008]].map(([x, z]) => seg(V(x!, 0, z!), V(x! * 0.8, 0.012, z! * 0.8), 0.0003, 0.00025, 3, p.leaf)),
    seg(V(0.011, 0, 0.002), V(0.011, 0.02, 0.002), 0.00035, 0.0003, 3, IRON),
    seg(V(0.011, 0.02, 0.002), V(-0.004, 0.019, 0.002), 0.00025, 0.0002, 3, IRON),
  ] },
  // ---------- foundations (under buildings on slopes; stretched per instance, colored by civ) ----------
  foundation: { name: 'Foundation', leaf: 0x8d877c, build: (p) => [
    part(new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.06, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0).scale(0.01, 0.01, 0.01), p.leaf),
    flat(0.01, 0.01, p.leaf, { y: 0.01 }),
  ] },
  // ---------- war ----------
  ruins: { name: 'Ruins', leaf: 0x8d877c, build: (p) => [
    walls(0.006, 0.0045, 0.0022, p.leaf),
    ...block(0.0016, 0.0016, 0.0042, 0x9a948a, { x: 0.004, z: 0.003 }),
    cone(0.003, 0.0014, 5, 0x7f796f, { x: -0.004, z: -0.002 }),
    ...block(0.0035, 0.0012, 0.0012, p.leaf, { x: -0.001, z: 0.005, ry: 0.6 }),
  ] },
  // ---------- walls (around the center) ----------
  wallSegment: { name: 'Wall segment', leaf: 0xa49c8c, build: (p) => block(0.01, 0.0016, 0.0042, p.leaf) },
  // A gate where a road runs through the walls: two square towers flanking
  // the passage (0.005 wide, 0.0044 high), the wall walk over it.
  wallGate: { name: 'Wall gate', leaf: 0x6a625a, build: (p) => [
    ...[-1, 1].flatMap((s) => [...block(0.0034, 0.0032, 0.0066, 0xa49c8c, { x: s * 0.0042 }), hip(0.0038, 0.0036, 0.0022, p.leaf, { x: s * 0.0042, y: 0.0066 })]),
    ...block(0.005, 0.0024, 0.0016, 0xa49c8c, { y: 0.0044 }),
    part(new THREE.PlaneGeometry(0.005, 0.0024).rotateX(Math.PI / 2), 0x8a8274, tf({ y: 0.0044 })),
  ] },
  // ---------- a fort (game.ts fort): a tile's own stronghold ----------
  // A square of curtain walls, FORT_SIDE across, their walks crenellated;
  // a tower at each corner under a pyramid roof; a gatehouse in the front
  // wall (two taller towers, the passage between them under a lintel, its
  // doors of timber); the yard left open for the unit that holds it, but
  // for a lean-to barrack along the back wall, a stair up to the walk, a
  // well and a stack of stores in the corners. Stone, timber and slate:
  // told from a city's walls by its shape.
  fort: { name: 'Fort', leaf: 0x6a625a, build: (p) => {
    const S = FORT_SIDE, h = S / 2, wallH = 0.0078, thick = 0.0036, walk = 0.0011, tower = 0.0105, towerH = 0.0118;
    const WALL = 0xaaa293, TOWER = 0x9c9486, MERLON = 0xb4ac9c, DOOR = 0x5d4630;
    const out: THREE.BufferGeometry[] = [];
    // (The merlons of a stretch of wall walk: along x, or along z.)
    const merlons = (len: number, y: number, o: Tf, alongZ: boolean, n = Math.max(2, Math.round(len / 0.0058))) => {
      for (let k = 0; k < n; k++) {
        const u = -len / 2 + (len * (k + 0.5)) / n;
        out.push(...block(alongZ ? 0.0012 : 0.0026, alongZ ? 0.0026 : 0.0012, 0.0017, MERLON, { x: (o.x ?? 0) + (alongZ ? 0 : u), y, z: (o.z ?? 0) + (alongZ ? u : 0) }));
      }
    };
    const span = S - tower; // (a wall between two towers)
    // The back and the side walls: a wall, its walk, merlons along its outer edge.
    out.push(...block(span, thick, wallH, WALL, { z: -h }));
    merlons(span, wallH, { z: -h - thick / 2 + 0.0006 }, false);
    for (const sx of [-1, 1]) {
      out.push(...block(thick, span, wallH, WALL, { x: sx * h }));
      merlons(span, wallH, { x: sx * (h + thick / 2 - 0.0006) }, true);
    }
    // The front wall, in two, and the gatehouse between.
    const gate = 0.0066, flank = 0.0062, flankH = 0.0132, wing = (span - gate - 2 * flank) / 2;
    for (const sx of [-1, 1]) {
      const cx = sx * (gate / 2 + flank + wing / 2);
      out.push(...block(wing, thick, wallH, WALL, { x: cx, z: h }));
      merlons(wing, wallH, { x: cx, z: h + thick / 2 - 0.0006 }, false);
      // (A gate tower: taller than the wall, a slate cap, a slit of shadow to the front.)
      out.push(...block(flank, flank, flankH, TOWER, { x: sx * (gate / 2 + flank / 2), z: h }), hip(flank * 1.18, flank * 1.18, 0.0034, p.leaf, { x: sx * (gate / 2 + flank / 2), y: flankH, z: h }));
      out.push(part(new THREE.PlaneGeometry(0.0007, 0.003), 0x3a352f, tf({ x: sx * (gate / 2 + flank / 2), y: flankH * 0.62, z: h + flank / 2 + 0.00005 })));
    }
    // (The passage: a lintel over it carrying the walk, the doors set back in it, ajar.)
    out.push(...block(gate, thick * 1.25, wallH * 0.32, WALL, { y: wallH * 0.68, z: h }));
    out.push(part(new THREE.PlaneGeometry(gate, thick * 1.25).rotateX(Math.PI / 2), 0x847c70, tf({ y: wallH * 0.68, z: h })));
    for (const sx of [-1, 1]) out.push(part(new THREE.PlaneGeometry(gate * 0.5, wallH * 0.66), DOOR, tf({ x: sx * gate * 0.27, y: wallH * 0.33, z: h - 0.0006, ry: sx * 0.5 })).clone());
    // The corner towers.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(...block(tower, tower, towerH, TOWER, { x: sx * h, z: sz * h }), hip(tower * 1.16, tower * 1.16, 0.0042, p.leaf, { x: sx * h, y: towerH, z: sz * h }));
      out.push(part(new THREE.PlaneGeometry(0.0008, 0.0032), 0x3a352f, tf({ x: sx * (h + tower / 2 + 0.00005), y: towerH * 0.66, z: sz * h, ry: (sx * Math.PI) / 2 })));
    }
    // In the yard, out of the garrison's way: a lean-to barrack along the back wall,
    const hutW = S * 0.34, hutD = 0.0062, hutH = 0.0042;
    out.push(walls(hutW, hutD, hutH, PLASTER, { x: -S * 0.12, z: -h + thick / 2 + hutD / 2 }));
    out.push(part(new THREE.PlaneGeometry(hutW * 1.04, hutD * 1.25).rotateX(-Math.PI / 2 + 0.42), p.leaf, tf({ x: -S * 0.12, y: hutH + 0.0011, z: -h + thick / 2 + hutD / 2 })));
    // a stair up to the walk by the side wall,
    for (let k = 0; k < 5; k++) out.push(...block(0.0034, 0.0019, (wallH * (k + 1)) / 5, WALL, { x: h - thick / 2 - 0.0017, z: -S * 0.02 + k * 0.0019 }));
    // a well, and a stack of stores.
    out.push(cyl(0.0019, 0.0019, 0.0016, 7, STONE, { x: S * 0.27, z: S * 0.27 }), ...[-1, 1].map((sx) => cyl(0.00022, 0.00022, 0.0042, 3, TIMBER, { x: S * 0.27 + sx * 0.0019, z: S * 0.27 })),
      ...block(0.0046, 0.0005, 0.0005, TIMBER, { x: S * 0.27, y: 0.0042, z: S * 0.27 }));
    out.push(...block(0.0026, 0.0026, 0.0024, TIMBER, { x: -S * 0.3, z: S * 0.28 }), ...block(0.0022, 0.0022, 0.002, 0x8a6f52, { x: -S * 0.3 + 0.003, z: S * 0.28 + 0.0006, ry: 0.4 }),
      cyl(0.0012, 0.0012, 0.0026, 6, 0x6f5a44, { x: -S * 0.3 + 0.0004, z: S * 0.28 - 0.0032 }), cyl(0.0012, 0.0012, 0.0026, 6, 0x6f5a44, { x: -S * 0.3 - 0.0026, z: S * 0.28 - 0.0026 }));
    void walk;
    return out;
  } },
  wallTower: { name: 'Wall tower', leaf: 0x6a625a, build: (p) => [
    cyl(0.0022, 0.0022, 0.0062, 6, 0xa49c8c), cone(0.0027, 0.0028, 6, p.leaf, { y: 0.0062 }),
  ] },
  fishingBoat: { name: 'Fishing boat', leaf: 0xe6dfcf, water: 'float', build: (p) => [
    part(new THREE.ConeGeometry(0.0012, 0.0062, 4, 1, true).rotateZ(Math.PI / 2).scale(1, 0.55, 1), 0x6a4a32, tf({ y: 0.0003 })),
    cyl(0.00012, 0.00012, 0.0048, 3, TIMBER),
    part(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0.0012, 0, 0, 0.0047, 0, 0.0026, 0.0012, 0], 3)), p.leaf, tf({ x: 0.0002 })),
  ] },
} satisfies Record<string, BuildingEntry>;

export type BuildingKind = keyof typeof BUILDINGS_CATALOG;
export const BUILDING_KINDS = Object.keys(BUILDINGS_CATALOG) as BuildingKind[];
export const buildingEntry = (k: BuildingKind): BuildingEntry => BUILDINGS_CATALOG[k];

export const buildBuildingGeometry = (kind: BuildingKind, palette?: Partial<Palette>): THREE.BufferGeometry =>
  buildModel(BUILDINGS_CATALOG[kind], kind, palette);

// Any model a town places: a catalog building, or a lot model (a house,
// houses.ts, a wonder, wonderModels.ts, or a rural model, rural/models.ts:
// in tile steps, cached; the others at prop scale, built anew).
export type LotModelKind = HouseKind | WonderModelKind | RuralModelKind;
export const isLotModel = (k: string): k is LotModelKind => isHouseKind(k) || isWonderModelKind(k) || isRuralModelKind(k);
export type ModelKind = BuildingKind | LotModelKind;
// What a town places: a model, or a plant of the flora (its trees are its tile's own).
export type PlacedKind = ModelKind | CatalogKind;
export const isFloraModel = (k: PlacedKind): k is CatalogKind => k in CATALOG;
// Where a placed thing may stand on water (catalog buildings: boats, shore huts; none else).
// (The countryside's boats float; its fish and shells are at the surface.)
const AFLOAT = new Set(['rural|canoe', 'rural|sailboat', 'rural|trawler', 'rural|salmonShoal', 'rural|tunaShoal', 'rural|troutShoal', 'rural|whale', 'rural|crabRock', 'rural|coralBed', 'rural|oilSlick', 'rural|oilRig', 'rural|oysters', 'rural|boat', 'rural|raft']);
export const waterRule = (k: PlacedKind): BuildingEntry['water'] => (AFLOAT.has(k) ? 'float' : isFloraModel(k) || isLotModel(k) ? undefined : buildingEntry(k).water);
// Its geometry before scaling (the flora's and the catalog's at reference size; lot models in tile steps).
export const placedGeometry = (k: PlacedKind): THREE.BufferGeometry => (isFloraModel(k) ? buildCatalogGeometry(k) : modelGeometry(k));
export const modelGeometry = (kind: ModelKind, palette?: Partial<Palette>): THREE.BufferGeometry =>
  isHouseKind(kind) ? houseGeometry(kind) : isWonderModelKind(kind) ? wonderGeometry(kind) : isRuralModelKind(kind) ? ruralGeometry(kind) : buildBuildingGeometry(kind, palette);

// Roof colors by roof kind: an instance picks one (muted, realistic).
export const ROOFS = {
  terracotta: [0x8a5a44, 0x96604a, 0x7e5242, 0x9a6a52],
  slate: [0x5a5a5e, 0x63605c, 0x55524f],
  thatch: [0xa08a5a, 0x9a8458, 0x8f7c55],
} as const;
