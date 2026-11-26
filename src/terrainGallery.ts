// The terrain gallery (/terrain_gallery.html): every terrain and its
// variants, every feature, and every resource, wild and worked through its
// improvement's stages, as the game itself draws them. A world is generated
// as a game's is, and each entry flies to a tile of it there: nothing is
// drawn here by other means than the game's, so the two cannot drift apart.
// (An entry this world has no tile of opens a world that has.)
//
// A worked resource is staged on its own tile: a city of the first civ
// founded beside it, the tile given to it and improved, the civ knowing as
// many of the improvement's techs as the stage asks.

import './style.css';
import './topbar.ts';
import { Game, HUMAN } from './game.ts';
import { GlobeRenderer, type DebugView } from './render.ts';
import { mountSettings } from './settingsMenu.ts';
import { MAP_SIZES, tileCount, type MapSizeKey } from './rules.ts';
import { biomeDef, featureDef, terrainName, type BiomeKey, type FeatureKey } from './terrain.ts';
import { biomeVariant, featureVariant, floraLabel } from './flora.ts';
import { BIOME_FLORA, FEATURE_FLORA, realmsLabel } from './floraData.ts';
import { RESOURCES, RESOURCE_KEYS, RESOURCE_IMPROVEMENT, resourceDef, type ResourceKey } from './resources.ts';
import { IMPROVEMENTS, USE } from './cities.ts';
import { TECHS, STAGE_TECHS, type TechKey } from './techs.ts';
import { foundCity } from './sandbox.ts';

const isMapSize = (s: string): s is MapSizeKey => s in MAP_SIZES;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const params = new URLSearchParams(location.search);
const pSize = params.get('size') ?? '';
const size: MapSizeKey = isMapSize(pSize) ? pSize : 'medium';
const seed = Number(params.get('seed')) || 1;

// ---------- the entries ----------

// What a tile shows of each kind: its terrain's variant, its resource.
const terrainKey = (g: Game, t: number): string => {
  const f = g.feature[t], fv = f ? featureVariant(g.map, g.flora, t) : null;
  return f && fv ? `f|${f}|${fv.name}` : `b|${g.biome[t]}|${biomeVariant(g.map, g.flora, t).name}`;
};
interface Entry { key: string; group: string; title: string; sub: string; res?: ResourceKey; stage?: number }
const entries: Entry[] = [];
for (const b of Object.keys(BIOME_FLORA) as BiomeKey[]) for (const v of BIOME_FLORA[b].variants) {
  entries.push({ key: `b|${b}|${v.name}`, group: biomeDef(b).name, title: v.name, sub: `${realmsLabel(v)} · ${v.density} props a tile` });
}
for (const f of Object.keys(FEATURE_FLORA) as FeatureKey[]) for (const v of FEATURE_FLORA[f]!.variants) {
  entries.push({ key: `f|${f}|${v.name}`, group: featureDef(f).name, title: v.name, sub: `${realmsLabel(v)} · ${v.density} props a tile` });
}
for (const r of RESOURCE_KEYS) {
  const imp = RESOURCE_IMPROVEMENT[r], def = resourceDef(r);
  const yields = Object.entries(def.yields).filter(([, v]) => v).map(([k, v]) => `+${v} ${k === 'prod' ? 'production' : k}`).join(', ');
  entries.push({ key: `r|${r}|wild`, group: `Resource · ${def.name}`, title: 'wild', sub: `${def.kind} · ${yields}${def.reveal ? ` · revealed by ${TECHS[def.reveal].name}` : ''}`, res: r });
  for (let s = 0; s <= STAGE_TECHS(imp).length; s++) {
    entries.push({ key: `r|${r}|${s}`, group: `Resource · ${def.name}`, title: `${s}`, sub: `${IMPROVEMENTS[imp].name} · stage ${s}: ${s === 0 ? 'before its techs' : STAGE_TECHS(imp).slice(0, s).map((k) => TECHS[k].name).join(', ')}`, res: r, stage: s });
  }
}

// Where each entry can be seen in a world: the tile of it most among its
// own kind (a resource's: one with dry land beside it, for its city).
function tilesOf(g: Game): Map<string, number> {
  const best = new Map<string, [number, number]>();
  const offer = (key: string, t: number, score: number) => { const b = best.get(key); if (!b || score > b[1]) best.set(key, [t, score]); };
  const keys = Array.from({ length: g.N }, (_, t) => terrainKey(g, t));
  for (let t = 0; t < g.N; t++) {
    const nb = g.tiles[t]!.neighbors;
    offer(keys[t]!, t, nb.filter((n) => keys[n] === keys[t]).length + (g.relief[t] === 'flat' ? 0.5 : 0));
    const r = g.resources[t];
    if (r) offer(`r|${r}`, t, nb.filter((n) => !g.isWater(n) && g.relief[n] !== 'mountains').length);
  }
  return new Map([...best].map(([k, [t]]) => [k, t]));
}
const placeKey = (e: Entry) => (e.res ? `r|${e.res}` : e.key);

// ---------- the world ----------

const game = new Game({ size, seed, script: 'continents' });
game.units.length = 0;
game.cities.length = 0;
game.explored.fill(1);
game.visible.fill(1);
// (The first civ knows of every hidden resource: the wild ones show.)
const reveals = new Set<TechKey>(RESOURCE_KEYS.flatMap((r) => (RESOURCES[r].reveal ? [RESOURCES[r].reveal!] : [])));
const knows = (extra: readonly TechKey[] = []) => { const p = game.players[HUMAN]!; p.techs.clear(); for (const k of [...reveals, ...extra]) p.techs.add(k); };
knows();
const here = tilesOf(game);
// (Where the rest are: the first other worlds, by seed, that have them.)
const away = new Map<string, number>();
{
  const missing = new Set(entries.map(placeKey).filter((k) => !here.has(k)));
  for (let s = 1; s <= 24 && missing.size; s++) {
    if (s === seed) continue;
    const there = tilesOf(new Game({ size, seed: s, script: 'continents' }));
    for (const k of [...missing]) if (there.has(k)) { away.set(k, s); missing.delete(k); }
  }
}

const view = new GlobeRenderer($<HTMLCanvasElement>('c'), game);
view.syncWorld(null);
mountSettings(view);
if (import.meta.env.DEV) Object.assign(window, { __globe: { game, view } });
$('hint').textContent = `${MAP_SIZES[size].name} · seed ${seed}`;

const sizeEl = $<HTMLSelectElement>('size'), seedEl = $<HTMLInputElement>('seed');
sizeEl.innerHTML = (Object.keys(MAP_SIZES) as MapSizeKey[])
  .map((k) => `<option value="${k}"${k === size ? ' selected' : ''}>${MAP_SIZES[k].name} (${tileCount(MAP_SIZES[k].n).toLocaleString()} tiles)</option>`).join('');
seedEl.value = String(seed);
const open = (s: number, key: string | null) => {
  const url = new URL(location.href);
  url.searchParams.set('size', sizeEl.value);
  url.searchParams.set('seed', String(s));
  url.hash = key ? encodeURIComponent(key) : '';
  location.href = url.toString();
  if (s === seed && sizeEl.value === size) location.reload();
};
$('catalog').addEventListener('click', () => { location.href = 'gallery.html#catalog'; });
$('generate').addEventListener('click', () => open(Number(seedEl.value) || 1, current?.key ?? null));

// ---------- a worked resource, staged ----------

let staged: { tile: number; city: ReturnType<typeof foundCity> } | null = null;
function unstage(): void {
  if (!staged) return;
  if (staged.city) game.destroyCity(staged.city);
  game.improved[staged.tile] = -1;
  staged = null;
  knows();
}
// The tile owned by a city founded beside it and improved, its civ at that stage. False where no city can stand near.
function stage(t: number, r: ResourceKey, s: number): boolean {
  const imp = RESOURCE_IMPROVEMENT[r];
  knows(STAGE_TECHS(imp).slice(0, s));
  const near = game.tiles[t]!.neighbors, further = near.flatMap((n) => game.tiles[n]!.neighbors).filter((n) => n !== t && !near.includes(n));
  let city: ReturnType<typeof foundCity> = null;
  // (Only where a city may stand, and never on the tile itself: a settler set down on water is put ashore
  // on the nearest land, which may be this tile, and its city then stood on the improvement.)
  for (const n of [...near, ...further]) {
    if (game.isWater(n) || !game.canFoundCity(n, HUMAN)) continue;
    city = foundCity(game, n, HUMAN);
    if (city && city.tile !== t) break;
    if (city) { game.destroyCity(city); city = null; }
  }
  if (!city) return false;
  game.tileCity[t] = city.id;
  game.use[t] = USE.rural;
  game.build(t, imp);
  game.useVersion++;
  staged = { tile: t, city };
  return true;
}

// ---------- the list ----------

const list = $('entries'), about = $('about');
let current: Entry | null = null;
{
  let html = '', group = '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!, gone = !here.has(placeKey(e)), cls = gone ? ' class="away"' : '';
    if (e.group !== group) { if (group.startsWith('Resource')) html += '</div>'; group = e.group; html += `<h4>${esc(group)}</h4>${e.res ? '<div class="stages">' : ''}`; }
    html += `<button data-i="${i}"${cls} title="${esc(e.sub)}${gone ? (away.has(placeKey(e)) ? ` · in the world of seed ${away.get(placeKey(e))}` : ' · in none of the first worlds') : ''}">${esc(e.title)}</button>`;
  }
  list.innerHTML = html + '</div>';
}
function show(e: Entry, fly = true): void {
  const key = placeKey(e), t = here.get(key);
  if (t === undefined) { const s = away.get(key); if (s !== undefined) open(s, e.key); return; }
  unstage();
  let note = '';
  if (e.res && e.stage !== undefined) {
    if (!stage(t, e.res, e.stage)) note = ' · no room for a city beside it in this world';
    else if (game.stageAt(t) !== e.stage) note = ` · shown at stage ${game.stageAt(t)}: a tech that reveals it is one of its improvement's`;
  }
  current = e;
  view.syncWorld(null);
  view.syncOverlay(null, t, null);
  if (fly) view.lookAt(t, 1.05);
  list.querySelectorAll('button').forEach((b) => b.classList.toggle('active', entries[Number(b.dataset['i'])] === e));
  list.querySelector('button.active')?.scrollIntoView({ block: 'nearest' });
  about.innerHTML = `<b>${esc(e.group)}${e.res ? '' : ` · ${esc(e.title)}`}</b>${e.res ? ` · ${e.stage === undefined ? 'wild' : `stage ${e.stage}`}` : ''}<br><small>${esc(e.sub)}${esc(note)} · tile ${t}</small>`;
  about.classList.remove('hidden');
  history.replaceState(null, '', `#${encodeURIComponent(e.key)}`);
}
list.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-i]');
  if (b) { show(entries[Number(b.dataset['i'])]!); b.blur(); }
});
const step = (d: number) => {
  let i = current ? entries.indexOf(current) : -1;
  for (let n = 0; n < entries.length; n++) { i = (i + d + entries.length) % entries.length; if (here.has(placeKey(entries[i]!))) { show(entries[i]!); return; } }
};

// Hover: what the tile is.
const info = $('tileinfo');
view.onTileHover = (t) => {
  if (t < 0) { info.classList.add('hidden'); return; }
  const variant = floraLabel(game.map, game.flora, t), r = game.resources[t];
  info.innerHTML = `<b>${esc(terrainName(game.terrainAt(t)))}</b>${variant ? ` <small>${esc(variant)}</small>` : ''}<br><small>tile ${t}${r ? ` · ${esc(resourceDef(r).name)}` : ''}</small>`;
  info.classList.remove('hidden');
};

const VIEWS: DebugView[] = ['normal', 'paint', 'overdraw', 'quads'];
const setView = (m: DebugView) => {
  view.setView(m);
  document.querySelectorAll<HTMLButtonElement>('#views [data-view]').forEach((b) => b.classList.toggle('active', b.dataset['view'] === m));
};
document.querySelectorAll<HTMLButtonElement>('#views [data-view]').forEach((b) => b.addEventListener('click', () => { setView(b.dataset['view'] as DebugView); b.blur(); }));
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) { if (e.key === 'Enter' && e.target === seedEl) open(Number(seedEl.value) || 1, current?.key ?? null); return; }
  if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
  else if (e.key === 'j' || e.key === 'J') setView(VIEWS[(VIEWS.indexOf(view.view) + 1) % VIEWS.length]!);
}, true);

// (The entry the address names, or the first there is.)
{
  const want = decodeURIComponent(location.hash.slice(1));
  const first = entries.find((e) => e.key === want && here.has(placeKey(e))) ?? entries.find((e) => here.has(placeKey(e)));
  if (first) show(first);
}
