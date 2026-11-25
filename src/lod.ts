import * as THREE from 'three';

// Coarser models of a model, for when it is small on screen.
//
// A triangle smaller than a pixel still costs its vertices, and the GPU
// shades in blocks of 2 × 2 pixels: several triangles in one block shade
// it several times over (devViews.ts shows where). So a model drawn a few
// pixels tall is drawn in a model made for that size: the same shape, in
// the triangles that size can show.

// A model with its vertices gathered on a grid of `cells` to its longest
// side (vertex clustering: Rossignac & Borrel): all of a cell's vertices
// become one, at their middle, and the triangles that close up are dropped,
// as are those that come to lie on another. Vertices are only gathered with
// their like: of one colour (so a tunic's edge stays where it is; colours
// `tint` apart or less are one) and with the same values of the attributes
// named in `keep` (a figure's limbs, say, each moving on its own). Every
// other attribute is taken from the vertex nearest the cell's middle;
// normals are left out (zero: the shaders shade such faces flat, as made).
export function clustered(model: THREE.BufferGeometry, cells: number, keep: readonly string[] = [], tint = 0.12): THREE.BufferGeometry {
  const pos = model.getAttribute('position'), col = model.getAttribute('color');
  model.computeBoundingBox();
  const box = model.boundingBox!, size = box.getSize(new THREE.Vector3());
  const cell = Math.max(size.x, size.y, size.z, 1e-9) / cells;
  const kept = keep.map((k) => model.getAttribute(k)).filter((a) => a !== undefined);
  const cluster = new Map<string, { verts: number[]; x: number; y: number; z: number }>();
  const of = new Int32Array(pos.count), order: { verts: number[]; x: number; y: number; z: number }[] = [];
  for (let i = 0; i < pos.count; i++) {
    let key = `${Math.floor((pos.getX(i) - box.min.x) / cell)},${Math.floor((pos.getY(i) - box.min.y) / cell)},${Math.floor((pos.getZ(i) - box.min.z) / cell)}`;
    if (col) key += `|${Math.round(col.getX(i) / tint)},${Math.round(col.getY(i) / tint)},${Math.round(col.getZ(i) / tint)}`;
    for (const a of kept) for (let c = 0; c < a.itemSize; c++) key += `|${a.getComponent(i, c).toFixed(3)}`;
    let c = cluster.get(key);
    if (!c) { c = { verts: [], x: 0, y: 0, z: 0 }; cluster.set(key, c); order.push(c); }
    c.verts.push(i); c.x += pos.getX(i); c.y += pos.getY(i); c.z += pos.getZ(i);
    of[i] = order.indexOf(c);
  }
  // (Each cell's vertex: at its middle, the rest as the vertex nearest it.)
  const rep = order.map((c) => {
    const n = c.verts.length; c.x /= n; c.y /= n; c.z /= n;
    let best = c.verts[0]!, d = Infinity;
    for (const v of c.verts) { const dd = (pos.getX(v) - c.x) ** 2 + (pos.getY(v) - c.y) ** 2 + (pos.getZ(v) - c.z) ** 2; if (dd < d) { d = dd; best = v; } }
    return best;
  });
  const index: number[] = [], seen = new Set<string>(), at = (k: number) => (model.index ? model.index.getX(k) : k);
  const count = model.index ? model.index.count : pos.count;
  for (let k = 0; k + 2 < count; k += 3) {
    const a = of[at(k)]!, b = of[at(k + 1)]!, c = of[at(k + 2)]!;
    if (a === b || b === c || a === c) continue;
    const id = [a, b, c].sort((p, q) => p - q).join(',');
    if (seen.has(id)) continue;
    seen.add(id);
    index.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(model.attributes)) {
    const arr = new Float32Array(order.length * attr.itemSize);
    order.forEach((c, i) => {
      for (let k = 0; k < attr.itemSize; k++) arr[i * attr.itemSize + k] = name === 'normal' ? 0 : name === 'position' ? [c.x, c.y, c.z][k]! : attr.getComponent(rep[i]!, k);
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
  }
  out.setIndex(index);
  out.userData = model.userData;
  return out;
}

export const triangles = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
