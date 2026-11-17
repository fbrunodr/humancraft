import * as THREE from 'three';
import { globeFor } from '../src/globes.ts';
import { latLon } from '../src/geo.ts';
import { PAINTED, paintingFor } from '../src/mapPaint.ts';
const RAD = Math.PI / 180, [size, to, cols, rows, cell, ...ids] = process.argv.slice(2);
const [la, lo] = to!.split(',').map(Number) as [number, number];
const c = new THREE.Vector3(Math.cos(la * RAD) * Math.cos(lo * RAD), Math.sin(la * RAD), -Math.cos(la * RAD) * Math.sin(lo * RAD));
const globe = globeFor(size as 'medium'), paint = paintingFor(PAINTED.earth, size as 'medium');
const e = new THREE.Vector3(0, 1, 0).cross(c).normalize(), n = c.clone().cross(e).normalize();
const at = (p: THREE.Vector3) => { const d = c.angleTo(p) / RAD, b = Math.atan2(p.dot(e), p.dot(n)); return [Math.floor(Number(cols) / 2 + (d * Math.sin(b)) / Number(cell)), Math.floor(Number(rows) / 2 - (d * Math.cos(b)) / Number(cell))]; };
for (const id of ids.map(Number)) {
  const t = globe.tiles[id]!;
  console.log(`tile ${id}: game ${latLon(t.center).map((x) => x.toFixed(1))}; cell (col,row) ${at(t.center)}; terrain ${paint.terrain[id]}; neighbours ${t.neighbors.map((x) => `${x}:${paint.terrain[x]}@${at(globe.tiles[x]!.center)}`).join(' ')}`);
}
