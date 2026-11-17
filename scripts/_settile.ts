// Sets one tile's biome on the large Earth (src/maps/earth.json): npx tsx scripts/_settile.ts <tile> <biome>
import { readFileSync, writeFileSync } from 'node:fs';
import { globeFor } from '../src/globes.ts';
import { load, store, type PaintFile } from '../src/mapPaint.ts';
import type { BiomeKey } from '../src/terrain.ts';
const url = new URL('../src/maps/earth.json', import.meta.url), f = JSON.parse(readFileSync(url, 'utf8')) as PaintFile, p = load(f.large!, globeFor('large').tiles.length);
p.biome[Number(process.argv[2])] = process.argv[3] as BiomeKey;
f.large = store(p);
writeFileSync(url, '{\n' + `  "large": ${JSON.stringify(f.large)}` + '\n}\n');
