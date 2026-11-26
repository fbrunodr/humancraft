// Bakes a downloaded FBX model's triangles into a JSON the game reads (src/models/<name>.json):
//   npx tsx scripts/importFbx.mts <file.fbx> <name> [up: x|y|z, default z]
// Its positions alone (no texture, no normals: the game paints and shades it), turned to stand on y = 0
// with y up, its foot's middle at the origin, scaled to be 1 tall, in thousandths.
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
Object.assign(globalThis, { window: globalThis, self: globalThis, document: { createElementNS: () => ({}) } });
const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
const [file, name, up = 'z'] = process.argv.slice(2);
if (!file || !name) throw new Error('usage: importFbx.mts <file.fbx> <name> [up]');
const buf = readFileSync(file);
const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
const pts: THREE.Vector3[] = [];
obj.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    pts.push(up === 'z' ? new THREE.Vector3(x, z, -y) : up === 'x' ? new THREE.Vector3(-y, x, z) : new THREE.Vector3(x, y, z));
  }
});
const box = new THREE.Box3().setFromPoints(pts), h = box.max.y - box.min.y, c = box.getCenter(new THREE.Vector3());
const out = pts.flatMap((p) => [Math.round(((p.x - c.x) / h) * 1000), Math.round(((p.y - box.min.y) / h) * 1000), Math.round(((p.z - c.z) / h) * 1000)]);
writeFileSync(new URL(`../src/models/${name}.json`, import.meta.url), JSON.stringify({ source: file.split('/').pop(), triangles: pts.length / 3, positions: out }));
console.log(name, pts.length / 3, 'triangles');
