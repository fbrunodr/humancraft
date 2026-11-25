import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WorldLabel, clickableLabels, disposeLabels, type LabelLine } from './worldLabel.ts';
import { makePropMaterial, instanceGeometry } from './propMaterial.ts';
import { ruralGeometry, ruralModelKind, isSmoothRural, isFloraRural, RURAL_MODELS, type RuralModel } from './rural/models.ts';
import { FIGURES, SPECIES_OF, FISH_PER_SHOAL, SWIMMERS, type KitModel } from './rural/kit.ts';
import { CREATURE_SCALE } from './creatures.ts';
import { CATALOG, CATALOG_KINDS, buildCatalogGeometry, triangles, type CatalogKind } from './propCatalog.ts';
import { BUILDINGS_CATALOG, BUILDING_KINDS, buildBuildingGeometry } from './buildingCatalog.ts';

// The catalog (dev tool, /gallery.html#catalog): every prop, city building
// and countryside model on its own, enlarged. (The terrains, with their
// plants and resources as the game draws them, are the terrain gallery's:
// terrainGallery.ts. This page's own board of them, drawn by its own means,
// drifted from the game and was removed.) Everything is ×100 here.

if (location.hash !== '#catalog') location.replace('terrain_gallery.html');

const SC = 100;
const PROP = 0.414 * SC;     // render.ts: 1.5 × PROP_SIZE
const BUDGET = 40;

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3e6);
scene.fog = new THREE.Fog(0x9fc3e6, 260, 900);
// (Near plane no closer than the walk eye needs: depth precision for the far rows.)
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
const controls = new OrbitControls(camera, canvas);
clickableLabels(canvas, camera, () => world);
controls.enableDamping = true;
// The mouse as in the world view: drag moves over the ground, right-drag (or
// Shift+drag) rotates and tilts, the wheel zooms.
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.screenSpacePanning = false;
controls.minDistance = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.01;

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6a5a40, 1.3));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);

// The game's flora material (clump normals, leaf cards), at full saturation.
// (Its clock: the leaves' sway, the beasts' walk.)
const clock = { value: 0 };
const propMat = makePropMaterial(0, 1, undefined, { time: clock, flat: { value: 1 } });
// The game's material for the countryside's models; the smooth one for the
// kit's people, animals and plants.
const ruralMat = makePropMaterial(0.32, 0.8);
const smoothMat = makePropMaterial(0.25, 0.85, undefined, undefined, true, clock);
const matOf = (m: RuralModel) => (isFloraRural(ruralModelKind(m)) ? propMat : isSmoothRural(ruralModelKind(m)) ? smoothMat : ruralMat);
const world = new THREE.Group();
scene.add(world);

// ---------- geometry ----------
const geoCache = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
};
const catalogGeo = (kind: CatalogKind, leaf?: number) =>
  cached(`${kind}|${leaf ?? ''}`, () => buildCatalogGeometry(kind, leaf === undefined ? undefined : { leaf }));

// ---------- scene pieces ----------
// A model's stand: a hexagon of plain ground.
function hex(color: number, at: THREE.Vector3, r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 6, Math.PI / 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.position.copy(at);
  m.receiveShadow = true;
  return m;
}
// A label standing on the ground (a sign in the scene; click it to focus).
const LABEL = 1;
function label(title: string, sub: string, at: THREE.Vector3, onClick: () => void, subColor?: string): WorldLabel {
  const lines: LabelLine[] = [{ text: title, bold: true }, { text: sub, small: true, ...(subColor ? { color: subColor } : {}) }];
  const o = new WorldLabel(lines, LABEL);
  o.userData['title'] = title;
  o.onClick = onClick;
  o.position.copy(at).setY(at.y + o.scale.y / 2 + 0.1);
  world.add(o);
  return o;
}

function clearWorld(): void {
  disposeLabels(world);
  world.clear();
}

// ---------- state ----------
type Cam = 'map' | 'close' | 'ground';
const state = { focus: 0 };
let patches: { center: THREE.Vector3; label: WorldLabel; mix: string }[] = [];

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const info = $<HTMLSpanElement>('#info'), mixPanel = $<HTMLDivElement>('#mix');

function buildCatalog(): void {
  const cols = 8, gap = 10, rowGap = 13;
  const LAYER_SCALE = { Canopy: 4, Understory: 6, Ground: 10, Accent: 6 } as const;
  patches = [];
  CATALOG_KINDS.forEach((kind, i) => {
    const center = new THREE.Vector3((i % cols) * gap, 0, Math.floor(i / cols) * rowGap);
    const e = CATALOG[kind];
    const scale = LAYER_SCALE[e.layer];
    world.add(hex(0xb9b39a, center, 3.2));
    const geo = catalogGeo(kind);
    const mesh = new THREE.Mesh(geo, propMat);
    mesh.position.copy(center);
    mesh.scale.setScalar(PROP * scale);
    mesh.rotation.y = 0.6;
    mesh.castShadow = true;
    world.add(mesh);
    const tris = triangles(geo);
    const div = label(e.name, `${e.layer} ×${scale} · ${tris} tris`,
      center.clone().add(new THREE.Vector3(0, 0, 4.4)), () => { state.focus = i; refreshFocus(); setCam('close'); }, tris > BUDGET ? '#ff8a80' : undefined);
    patches.push({ center, label: div, mix: '' });
  });
  // City buildings (buildingCatalog.ts) after the flora.
  BUILDING_KINDS.forEach((kind, j) => {
    const i = CATALOG_KINDS.length + j;
    const center = new THREE.Vector3((i % cols) * gap, 0, Math.floor(i / cols) * rowGap);
    const e = BUILDINGS_CATALOG[kind];
    const scale = 6;
    world.add(hex(0xb9b39a, center, 3.2));
    const geo = cached(`b|${kind}`, () => buildBuildingGeometry(kind));
    const mesh = new THREE.Mesh(geo, propMat);
    mesh.position.copy(center);
    mesh.scale.setScalar(PROP * scale);
    mesh.rotation.y = 0.6;
    mesh.castShadow = true;
    world.add(mesh);
    const tris = triangles(geo);
    const div = label(e.name, `Building ×${scale} · ${tris} tris`,
      center.clone().add(new THREE.Vector3(0, 0, 4.4)), () => { state.focus = i; refreshFocus(); setCam('close'); });
    patches.push({ center, label: div, mix: '' });
  });
  // The countryside's animals and people (rural/kit.ts), smooth-shaded, at
  // one scale (a person 3 units tall), so their sizes compare true.
  // (With them, the swimmers: the shoals and the whale, raised out of the water they swim under.)
  const figures: KitModel[] = [...[...FIGURES].filter((k) => k !== 'ploughTeam' && k !== 'haycart'), ...SWIMMERS];
  const FIG_SCALE = 3 / (1.72 * CREATURE_SCALE);
  figures.forEach((kind, j) => {
    const i = CATALOG_KINDS.length + BUILDING_KINDS.length + j;
    const center = new THREE.Vector3((i % cols) * gap, 0, Math.floor(i / cols) * rowGap);
    world.add(hex(0xb9b39a, center, 3.2));
    const geo = cached(`r|${kind}`, () => ruralGeometry(ruralModelKind(kind)));
    const mesh = new THREE.InstancedMesh(instanceGeometry(geo, 1), smoothMat, 1);
    geo.computeBoundingBox();
    const lift = Math.max(0, -geo.boundingBox!.min.y) * FIG_SCALE;
    mesh.setMatrixAt(0, new THREE.Matrix4().compose(center.clone().setY(center.y + lift), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6), new THREE.Vector3().setScalar(FIG_SCALE)));
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    // (Their coats and clothes: a typical colour, as an instance takes in the game.)
    const coat = new THREE.Color(SPECIES_OF[kind] ? ({ horse: 0x7a4a2a, cow: 0x6a4a32, pied: 0x2a2622, ox: 0x5a4a3a, sheep: 0xece6da, mouflon: 0x8a5a34, deer: 0x9a6a40, stag: 0x8a5a34, elephant: 0x8c8680, fox: 0xc8642a } as const)[SPECIES_OF[kind]!] : 0x8a6a48);
    (mesh.geometry.getAttribute('leafTint') as THREE.InstancedBufferAttribute).setXYZ(0, coat.r, coat.g, coat.b);
    mesh.castShadow = true;
    world.add(mesh);
    const tris = triangles(geo);
    const per = (FISH_PER_SHOAL as Partial<Record<KitModel, number>>)[kind];
    const what = per ? `Fish · ${tris} tris (${per} × ${tris / per})` : `${SPECIES_OF[kind] || kind === 'whale' ? 'Animal' : 'Person'} · ${tris} tris`;
    const div = label(per ? `${kind[0]!.toUpperCase()}${kind.slice(1, -'Shoal'.length)} shoal` : kind[0]!.toUpperCase() + kind.slice(1), what,
      center.clone().add(new THREE.Vector3(0, 0, 4.4)), () => { state.focus = i; refreshFocus(); setCam('close'); });
    patches.push({ center, label: div, mix: '' });
  });
  // Then the rest of the countryside: its works, machines, plants and the
  // resources' models (rural/models.ts), each fitted to its hex (the label
  // says how much it was enlarged against the people's scale).
  const rest = RURAL_MODELS.filter((k) => !(SWIMMERS as readonly string[]).includes(k) && (!FIGURES.has(k as KitModel) || k === 'ploughTeam' || k === 'haycart'));
  rest.forEach((kind, j) => {
    const i = CATALOG_KINDS.length + BUILDING_KINDS.length + figures.length + j;
    const center = new THREE.Vector3((i % cols) * gap, 0, Math.floor(i / cols) * rowGap);
    world.add(hex(0xb9b39a, center, 3.2));
    const geo = cached(`r|${kind}`, () => ruralGeometry(ruralModelKind(kind)));
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3()), fit = 4.5 / Math.max(size.x, size.y, size.z);
    const mesh = new THREE.InstancedMesh(instanceGeometry(geo, 1), matOf(kind), 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6), new THREE.Vector3().setScalar(fit)));
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    // (Leaf parts: a typical colour, as an instance takes in the game.)
    const leaf = new THREE.Color(isFloraRural(ruralModelKind(kind)) ? 0x6a8a3a : 0xb0a080);
    (mesh.geometry.getAttribute('leafTint') as THREE.InstancedBufferAttribute).setXYZ(0, leaf.r, leaf.g, leaf.b);
    mesh.castShadow = true;
    world.add(mesh);
    const tris = triangles(geo);
    const div = label(kind[0]!.toUpperCase() + kind.slice(1), `Countryside ×${(fit / FIG_SCALE).toFixed(1)} · ${tris} tris`,
      center.clone().add(new THREE.Vector3(0, 0, 4.4)), () => { state.focus = i; refreshFocus(); setCam('close'); });
    patches.push({ center, label: div, mix: `<h4>${kind}</h4>` });
  });
  info.textContent = `${CATALOG_KINDS.length} props, ${BUILDING_KINDS.length} buildings, ${figures.length} animals and people and ${rest.length} countryside models, enlarged (×N in each label) to be visible. Budget ${BUDGET} triangles · drag move · right-drag or Shift+drag rotate & tilt · WASD move · Q/E rotate · T/G tilt · Z/X zoom`;
}

function refreshFocus(): void {
  patches.forEach((p, i) => p.label.setStyle({ focus: i === state.focus }));
  mixPanel.innerHTML = patches[state.focus]?.mix ?? '';
}

function rebuild(): void {
  clearWorld();
  buildCatalog();
  refreshFocus();
  // Sun and shadows over everything shown.
  const box = new THREE.Box3();
  for (const p of patches) box.expandByPoint(p.center);
  const mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const ext = Math.max(size.x, size.z) / 2 + 10;
  sun.position.copy(mid).add(new THREE.Vector3(ext * 0.6, ext * 1.4, ext * 0.9));
  sun.target.position.copy(mid);
  Object.assign(sun.shadow.camera, { left: -ext * 1.3, right: ext * 1.3, top: ext * 1.3, bottom: -ext * 1.3, near: 1, far: ext * 5 });
  sun.shadow.camera.updateProjectionMatrix();
  setCam('map');
}

const ROW_GAP = 13;
function setCam(c: Cam): void {
  const box = new THREE.Box3();
  for (const p of patches) box.expandByPoint(p.center);
  const mid = box.getCenter(new THREE.Vector3());
  const f = patches[state.focus]?.center ?? mid;
  if (c === 'map') {
    // Start on the top rows, seen at a low angle; pan (drag) to see the rest.
    const top = new THREE.Vector3(mid.x, 0, box.min.z + ROW_GAP * 1.2);
    camera.position.copy(top).add(new THREE.Vector3(0, 22, 42));
    controls.target.copy(top);
  } else if (c === 'close') {
    camera.position.copy(f).add(new THREE.Vector3(0, 7 * 0.55, 7));
    controls.target.copy(f).setY(1.5);
  } else {
    camera.position.copy(f).add(new THREE.Vector3(0, 0.6, 5));
    controls.target.copy(f).setY(1.2);
  }
  controls.update();
}

// ---------- UI ----------
$('#terrains').addEventListener('click', () => { location.href = 'terrain_gallery.html'; });
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-cam]'))
  b.addEventListener('click', () => setCam(b.dataset['cam'] as Cam));

// Keyboard camera, as in the game: W A S D move over the ground (Shift =
// faster), Q / E rotate around the view's center, Z / X zoom in / out.
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 't', 'g', 'z', 'x', 'shift']);
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.has(k)) { keys.add(k); e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function keyboardCamera(dt: number): void {
  if (keys.size === 0) return;
  const key = (k: string) => (keys.has(k) ? 1 : 0);
  const offset = camera.position.clone().sub(controls.target);
  const rot = key('q') - key('e');
  if (rot !== 0) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * 1.6 * dt);
  // T / G: tilt toward the horizon / back down (as in the world view).
  const tilt = key('t') - key('g');
  if (tilt !== 0) {
    const s = new THREE.Spherical().setFromVector3(offset);
    s.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, s.phi + tilt * 0.9 * dt));
    offset.setFromSpherical(s);
  }
  const zoom = key('x') - key('z');
  if (zoom !== 0) offset.multiplyScalar(Math.exp(zoom * 1.6 * dt));
  // Movement scales with the distance, so it feels the same at every zoom.
  const fwd = key('w') - key('s'), side = key('d') - key('a');
  if (fwd !== 0 || side !== 0) {
    const forward = offset.clone().setY(0).negate();
    if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1);
    forward.normalize();
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0));
    const step = offset.length() * 0.9 * dt * (keys.has('shift') ? 2.5 : 1) / Math.hypot(fwd, side);
    controls.target.addScaledVector(forward, fwd * step).addScaledVector(right, side * step);
  }
  camera.position.copy(controls.target).add(offset);
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
rebuild();
const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  clock.value = time / 1000;
  timer.update(time);
  keyboardCamera(Math.min(0.1, timer.getDelta()));
  controls.update();
  renderer.render(scene, camera);
});
// (Dev: focus the model whose label is `title`, close up: __gallery.focus('Oak').)
(window as unknown as { __gallery: unknown }).__gallery = {
  focus: (title: string) => { const i = patches.findIndex((p) => p.label.userData['title'] === title || p.mix.includes(`<h4>${title}`)); if (i >= 0) { state.focus = i; refreshFocus(); setCam('close'); } return i; },
};
