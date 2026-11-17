// Oddities in the painted Earth (src/maps/earth.json), per size: a land tile whose biome none of its land neighbours
// share; a flat tile ringed by hills and mountains; a mountain with no hill or mountain beside it; land with no biome painted.
//   npx tsx scripts/_mapodd.ts [--fix]   (--fix: sets each to what most of its neighbours are, and writes the file)
import { readFileSync, writeFileSync } from 'node:fs';
import { globeFor } from '../src/globes.ts';
import { latLon } from '../src/geo.ts';
import { FLAT, HILLS, LAND, MOUNTAINS, load, store, type PaintFile } from '../src/mapPaint.ts';
import type { BiomeKey } from '../src/terrain.ts';
const url = new URL('../src/maps/earth.json', import.meta.url), file = JSON.parse(readFileSync(url, 'utf8')) as PaintFile, fix = process.argv.includes('--fix');
for (const size of ['small', 'medium', 'large'] as const) {
  const g = globeFor(size), p = load(file[size]!, g.tiles.length), out: string[] = [];
  const at = (t: number) => latLon(g.tiles[t]!.center).map((x) => x.toFixed(0)).join(',');
  for (let pass = 0; pass < (fix ? 3 : 1); pass++) for (const t of g.tiles) {
    if (p.terrain[t.id] !== LAND) continue;
    const land = t.neighbors.filter((n) => p.terrain[n] === LAND);
    if (land.length < 2) continue;
    const count = new Map<BiomeKey | null, number>();
    for (const n of land) count.set(p.biome[n]!, (count.get(p.biome[n]!) ?? 0) + 1);
    const most = [...count].sort((a, b) => b[1] - a[1])[0]![0];
    const b = p.biome[t.id]!;
    if (b === null && most !== null) { out.push(`${t.id} @${at(t.id)}: no biome painted (neighbours ${most})`); if (fix) p.biome[t.id] = most; }
    else if (land.length >= 3 && !count.has(b) && most !== null) { out.push(`${t.id} @${at(t.id)}: ${b} alone among ${most}`); if (fix) p.biome[t.id] = most; }
    const high = land.filter((n) => p.relief[n]! >= HILLS).length;
    if (p.relief[t.id] === FLAT && land.length >= 5 && high === land.length) { out.push(`${t.id} @${at(t.id)}: flat, ringed by hills`); if (fix) p.relief[t.id] = HILLS; }
    if (p.relief[t.id] === MOUNTAINS && high === 0 && land.length >= 4) { out.push(`${t.id} @${at(t.id)}: a mountain alone on flat land`); if (fix) p.relief[t.id] = HILLS; }
  }
  console.log(`${size}: ${out.length} oddities`);
  if (process.argv.includes('--list')) for (const o of out) console.log('  ' + o);
  if (fix) file[size] = store(p);
}
if (fix) { writeFileSync(url, '{\n' + (['small', 'medium', 'large'] as const).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(file[k])}`).join(',\n') + '\n}\n'); console.log('written'); }
