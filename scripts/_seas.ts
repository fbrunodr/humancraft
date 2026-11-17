// The seas of the painted Earth cut off from the ocean, per size (the game cuts a channel to each): where, and how large.
import { readFileSync } from 'node:fs';
import { globeFor } from '../src/globes.ts';
import { latLon } from '../src/geo.ts';
import { SEA, load, type PaintFile } from '../src/mapPaint.ts';
const f = JSON.parse(readFileSync(new URL('../src/maps/earth.json', import.meta.url), 'utf8')) as PaintFile;
for (const size of ['small', 'medium', 'large'] as const) {
  const g = globeFor(size), p = load(f[size]!, g.tiles.length), seen = new Int32Array(g.tiles.length).fill(-1), comps: number[][] = [];
  for (const t of g.tiles) {
    if (p.terrain[t.id] !== SEA || seen[t.id]! >= 0) continue;
    const comp = [t.id]; seen[t.id] = comps.length;
    for (let i = 0; i < comp.length; i++) for (const n of g.tiles[comp[i]!]!.neighbors) if (p.terrain[n] === SEA && seen[n]! < 0) { seen[n] = comps.length; comp.push(n); }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  console.log(`${size}: ${comps.slice(1).map((c) => `${c.length} tiles at ${latLon(g.tiles[c[0]!]!.center).map((x) => x.toFixed(0)).join(',')} (tile ${c[0]})`).join('; ') || 'none cut off'}`);
}
