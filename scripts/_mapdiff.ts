// What changed in src/maps/earth.json against the last commit, per size: the tiles whose land, relief or biome differ.

import { readFileSync } from 'node:fs';
import { globeFor } from '../src/globes.ts';
import { latLon } from '../src/geo.ts';
import { load, type PaintFile } from '../src/mapPaint.ts';
const old = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as PaintFile;
const now = JSON.parse(readFileSync(new URL('../src/maps/earth.json', import.meta.url), 'utf8')) as PaintFile;
for (const size of ['small', 'medium', 'large'] as const) {
  if (!old[size] || !now[size]) continue;
  const g = globeFor(size), a = load(old[size]!, g.tiles.length), b = load(now[size]!, g.tiles.length);
  const rows: string[] = [];
  let terrain = 0, relief = 0, biome = 0;
  for (let t = 0; t < g.tiles.length; t++) {
    const dt = a.terrain[t] !== b.terrain[t], dr = a.relief[t] !== b.relief[t], db = a.biome[t] !== b.biome[t];
    if (!dt && !dr && !db) continue;
    if (dt) terrain++; if (dr) relief++; if (db) biome++;
    const [la, lo] = latLon(g.tiles[t]!.center);
    rows.push(`${t} @${la.toFixed(0)},${lo.toFixed(0)}: ${['sea', 'land', 'lake'][a.terrain[t]!]}/${'fhm'[a.relief[t]!]}/${a.biome[t] ?? '-'} -> ${['sea', 'land', 'lake'][b.terrain[t]!]}/${'fhm'[b.relief[t]!]}/${b.biome[t] ?? '-'}`);
  }
  console.log(`${size}: ${rows.length} tiles changed (land/sea ${terrain}, relief ${relief}, biome ${biome})`);
  if (process.argv.includes('--list')) for (const r of rows) console.log('  ' + r);
}
