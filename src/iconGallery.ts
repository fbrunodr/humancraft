// Icons (dev tool, /icons.html): every pictogram of the game (icons.ts), to
// look over and judge. What each resource, unit and yield is shown by, as
// the map draws it (its medallion, its flag: mapIcons.ts) and as the
// interface does (inline, small); then every pictogram by its key, at the
// sizes it is used, with what it stands for. A stand-in (a resource with no
// pictogram of its own, shown by the gem; units sharing their class's) is
// marked. "Find" keeps what matches.

import './style.css';
import './topbar.ts';
import { ICONS, YIELD_ICON, icon, resourceIcon, unitIcon, type IconKey } from './icons.ts';
import { RESOURCES, RESOURCE_KEYS, type ResourceKind } from './resources.ts';
import { UNITS, type UnitKey } from './rules.ts';
import { UNIT_CLASS } from './unitClasses.ts';
import { drawResourceIcon, drawUnitFlag, RESOURCE_COLORS, YIELD_COLOR } from './mapIcons.ts';

const css = document.createElement('style');
css.textContent = `
  #icons { position: fixed; inset: var(--topbar-h, 48px) 0 0 0; overflow: auto; padding: 18px 22px 60px; }
  #icons h2 { margin: 26px 0 4px; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text); }
  #icons h2:first-child { margin-top: 0; }
  #icons p.note { margin: 0 0 12px; color: var(--muted); font-size: 12.5px; max-width: 80ch; }
  .igrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .icard { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255, 255, 255, 0.03); text-align: center; }
  .icard.standin { border-color: rgba(232, 169, 79, 0.6); }
  .icard canvas { width: 64px; height: 64px; }
  .icard .sizes { display: flex; align-items: flex-end; gap: 12px; min-height: 48px; color: #f4efe2; }
  .icard .sizes svg { display: block; fill: currentColor; }
  .icard b { font-size: 13px; }
  .icard small { color: var(--muted); font-size: 11.5px; line-height: 1.35; }
  .icard small.warn { color: #e8a94f; }
  .icard .inline { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .icard .inline svg { width: 14px; height: 14px; fill: currentColor; }
  #topbar input[type=search] { font: inherit; background: rgba(0, 0, 0, 0.35); color: var(--text); border: 1px solid var(--border); border-radius: 5px; padding: 4px 8px; width: 170px; }
  #count { color: var(--muted); }
`;
document.head.append(css);

const host = document.getElementById('icons')!;
const svg = (k: IconKey, px: number) => icon(k).replace('<svg ', `<svg width="${px}" height="${px}" `);
// (A cell of the map's atlas, drawn as the map draws it.)
const cell = (size: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  draw(ctx);
  return c;
};
function section(title: string, note: string): HTMLElement {
  const h = document.createElement('h2'), p = document.createElement('p'), grid = document.createElement('div');
  h.textContent = title; p.className = 'note'; p.textContent = note; grid.className = 'igrid';
  host.append(h, p, grid);
  return grid;
}
function card(grid: HTMLElement, o: { name: string; key: string; canvas?: HTMLCanvasElement; glyph: IconKey; note?: string; warn?: string; color?: string; sizes?: boolean }): void {
  const el = document.createElement('div');
  el.className = `icard${o.warn ? ' standin' : ''}`;
  el.dataset['find'] = `${o.name} ${o.key} ${o.glyph} ${o.note ?? ''}`.toLowerCase();
  if (o.canvas) el.append(o.canvas);
  el.insertAdjacentHTML('beforeend', `${o.sizes ? `<div class="sizes"${o.color ? ` style="color:${o.color}"` : ''}>${svg(o.glyph, 14)}${svg(o.glyph, 24)}${svg(o.glyph, 48)}</div>` : `<div class="inline"${o.color ? ` style="color:${o.color}"` : ''}>${icon(o.glyph)}<span style="color:var(--text)">in a panel</span></div>`}
    <b>${o.name}</b><small>pictogram: ${o.glyph}${o.note ? `<br>${o.note}` : ''}</small>${o.warn ? `<small class="warn">${o.warn}</small>` : ''}`);
  grid.append(el);
}

// What each pictogram stands for.
const uses = new Map<IconKey, string[]>();
const use = (k: IconKey, what: string) => { uses.set(k, [...(uses.get(k) ?? []), what]); };

// ---- the resources ----
const KIND_NAME: Record<ResourceKind, string> = { bonus: 'Bonus', luxury: 'Luxury', strategic: 'Strategic' };
for (const kind of ['bonus', 'luxury', 'strategic'] as const) {
  const grid = section(`${KIND_NAME[kind]} resources`, 'The medallion as it stands on the map, and the pictogram as a panel shows it.');
  for (const k of RESOURCE_KEYS.filter((r) => RESOURCES[r].kind === kind)) {
    const g = resourceIcon(k), own = (k as string) in ICONS || g !== 'gem';
    use(g, RESOURCES[k].name);
    card(grid, { name: RESOURCES[k].name, key: k, glyph: g, canvas: cell(96, (ctx) => drawResourceIcon(ctx, g, RESOURCE_COLORS[kind])), ...(own ? {} : { warn: 'no pictogram of its own: the gem stands in' }) });
  }
}

// ---- the units ----
{
  const grid = section('Units', 'The flag as it flies over the unit on the map (a soldier\'s round, a civilian\'s square), and the pictogram as a panel shows it. Most units share their class\'s pictogram.');
  for (const k of Object.keys(UNITS) as UnitKey[]) {
    const g = unitIcon(k), civilian = 'civilian' in UNITS[k] && UNITS[k].civilian === true;
    use(g, UNITS[k].name);
    card(grid, { name: UNITS[k].name, key: k, glyph: g, note: `class: ${UNIT_CLASS[k]}`, canvas: cell(128, (ctx) => drawUnitFlag(ctx, '#e03131', g, civilian, 1, 100, false, false)) });
  }
}

// ---- the yields ----
{
  const grid = section('Yields', 'Each in its own colour, as on the tiles and in the top bar.');
  for (const [y, g] of Object.entries(YIELD_ICON) as [keyof typeof YIELD_ICON, IconKey][]) {
    use(g, `${y} (yield)`);
    card(grid, { name: y[0]!.toUpperCase() + y.slice(1), key: y, glyph: g, color: YIELD_COLOR[y], sizes: true });
  }
}

// ---- every pictogram ----
{
  const grid = section('Every pictogram', 'By its key, at 14, 24 and 48 pixels, with what it stands for above. Those with nothing listed are used by the interface itself (buttons, lenses, sheets).');
  for (const k of Object.keys(ICONS) as IconKey[]) {
    const u = uses.get(k) ?? [];
    card(grid, { name: k, key: k, glyph: k, sizes: true, note: u.length ? `for: ${u.slice(0, 6).join(', ')}${u.length > 6 ? ` and ${u.length - 6} more` : ''}` : 'interface' });
  }
}

// ---- find ----
const find = document.getElementById('find') as HTMLInputElement, count = document.getElementById('count')!;
const filter = () => {
  const q = find.value.trim().toLowerCase();
  let shown = 0;
  for (const el of host.querySelectorAll<HTMLElement>('.icard')) { const on = !q || (el.dataset['find'] ?? '').includes(q); el.style.display = on ? '' : 'none'; if (on) shown++; }
  count.textContent = `${shown} shown · ${Object.keys(ICONS).length} pictograms`;
};
find.addEventListener('input', filter);
filter();
