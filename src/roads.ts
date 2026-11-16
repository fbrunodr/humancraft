// Roads between cities (design doc "Cities: Feel & Play", city look v1).
// A road is where one was laid, tile by tile (game.ts road: by workers),
// and on a city's own tile; road tiles next to each other join. Routes
// (what the computer's workers plan, what the dev pages lay) take the
// cheapest land way: flat open ground is cheap, forests and hills cost
// more, mountains and water are never crossed (rivers run on tile edges,
// so they never block a route). Pure: the same world gives the same roads.

import * as THREE from 'three';
import type { Game } from './game.ts';
import { USE } from './cities.ts';

export const ROAD_HALF_WIDTH = 0.03; // half width of a road between cities (tile steps)
const MAX_ROUTE = 14;         // tiles: no planned link between two cities longer than this (as the crow flies)

export interface Road {
  a: number;      // city ids (-1: a stretch the workers laid)
  b: number;
  tiles: number[]; // from a's center to b's center
}

// Cost of stepping onto a tile (undefined: impassable).
function stepCost(g: Game, t: number): number | undefined {
  if (g.isWater(t)) return undefined;
  const r = g.relief[t];
  if (r === 'mountains') return undefined; // (no one walks them, and no road is laid there)
  return g.moveCost(t) + (r === 'hills' ? 1 : 0);
}

// The roads as they are: those laid on the tiles (game.ts road: by the
// workers), each stretch from a city or a fork to the next. A tile's road
// joins every road beside it: two roads side by side are one.
export function planRoads(g: Game): Road[] {
  const nbrs = (t: number) => g.tiles[t]!.neighbors.filter((n) => g.hasRoad(n));
  const stop = (t: number) => g.use[t] === USE.center || nbrs(t).length !== 2;
  const seen = new Set<number>(), key = (a: number, b: number) => (a < b ? a * g.N + b : b * g.N + a);
  const roads: Road[] = [];
  const walk = (a: number, b: number) => {
    const tiles = [a, b];
    seen.add(key(a, b));
    for (let prev = a, cur = b; !stop(cur); ) {
      const next = nbrs(cur).find((n) => n !== prev)!;
      if (seen.has(key(cur, next))) break;
      seen.add(key(cur, next));
      tiles.push(next);
      prev = cur; cur = next;
    }
    roads.push({ a: -1, b: -1, tiles });
  };
  const nodes: number[] = [];
  for (let t = 0; t < g.N; t++) if (g.road[t] === 1 || (g.use[t] === USE.center && nbrs(t).length)) nodes.push(t);
  // (From the cities, the ends and the forks first; then what is left: rings.)
  for (const t of nodes) if (stop(t)) for (const n of nbrs(t)) if (!seen.has(key(t, n))) walk(t, n);
  for (const t of nodes) for (const n of nbrs(t)) if (!seen.has(key(t, n))) walk(t, n);
  return roads;
}

// Where a civ's roads would best run (what the computer's workers lay):
// its own cities joined with the least road. The nearest two (by the
// cheapest land route) first, then the next nearest not yet joined
// through others, until none is left to join (Kruskal's way, as
// linkCities below); each route following the roads there are and those
// already planned, which cost next to nothing, so the network forks
// rather than running two roads side by side. No second way between two
// cities already joined: a worker's charges are few, and a road joins a
// city to the rest whichever way it runs. Never over water, mountains or
// another civ's land (unless a road runs there already); no single link
// longer than MAX_ROUTE as the crow flies. The tiles, per civ.
export function civRoads(g: Game): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const owners = [...new Set(g.cities.map((c) => c.owner))].sort((a, b) => a - b);
  for (const owner of owners) {
    const cities = g.cities.filter((c) => c.owner === owner).sort((a, b) => a.id - b.id);
    const plan = new Set<number>();
    out.set(owner, plan);
    if (cities.length < 2) continue;
    // (Its workers lay road on its own land and no one's.)
    const open = (t: number): number | undefined => {
      const o = g.ownerOf(t);
      return o >= 0 && o !== owner && !g.hasRoad(t) ? undefined : stepCost(g, t);
    };
    const links: { a: number; b: number; d: number }[] = [];
    for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) {
      if (g.approxDist(cities[i]!.tile, cities[j]!.tile) > MAX_ROUTE) continue;
      const r = route(g, cities[i]!.tile, cities[j]!.tile, open);
      if (r) links.push({ a: i, b: j, d: r.cost });
    }
    links.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
    const group = cities.map((_, i) => i), find = (i: number): number => { while (group[i] !== i) i = group[i] = group[group[i]!]!; return i; };
    for (const { a, b } of links) {
      const ra = find(a), rb = find(b);
      if (ra === rb) continue;
      const r = route(g, cities[a]!.tile, cities[b]!.tile, (t) => { const c = open(t); return c === undefined ? undefined : g.hasRoad(t) || plan.has(t) ? 0.2 : c; });
      if (!r) continue;
      group[ra] = rb;
      for (const t of r.tiles) if (g.use[t] !== USE.center) plan.add(t);
    }
  }
  return out;
}

// Every city joined by road to every other it can reach by land, with the
// least road: the cities nearest each other (by the cheapest land route)
// joined first, then the next nearest that aren't yet joined through
// others, until none is left to join (Kruskal's way; cities with the sea,
// a lake or a mountain range wholly between them stay apart). A route goes
// along roads already laid where it can, so the network forks rather than
// running two roads side by side. Laid on the tiles as workers lay them
// (game.ts road), in place of whatever roads there were: for the dev pages'
// ready-made worlds, where no worker ever works. Returns how many tiles.
export function linkCities(g: Game): number {
  const cities = [...g.cities].sort((a, b) => a.id - b.id);
  g.road.fill(0);
  // (From a tile over all the land it reaches: the cost to each tile, and the way back.)
  const spread = (from: number, cost: (t: number) => number | undefined, until = -1): { dist: Float64Array; came: Int32Array } => {
    const dist = new Float64Array(g.N).fill(Infinity), came = new Int32Array(g.N).fill(-1);
    const heap: [number, number][] = [[0, from]];
    dist[from] = 0;
    const push = (e: [number, number]) => { let i = heap.push(e) - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= e[0]) break; heap[i] = heap[p]!; i = p; } heap[i] = e; };
    const pop = (): [number, number] => {
      const top = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1]![0] < heap[c]![0]) c++; if (heap[c]![0] >= last[0]) break; heap[i] = heap[c]!; i = c; }
        heap[i] = last;
      }
      return top;
    };
    while (heap.length) {
      const [d, t] = pop();
      if (d > dist[t]!) continue;
      if (t === until) break;
      for (const n of g.tiles[t]!.neighbors) {
        const c = cost(n);
        if (c === undefined) continue;
        if (d + c < dist[n]!) { dist[n] = d + c; came[n] = t; push([d + c, n]); }
      }
    }
    return { dist, came };
  };
  const land = (t: number) => stepCost(g, t);
  const links: { a: number; b: number; d: number }[] = [];
  cities.forEach((c, i) => {
    const { dist } = spread(c.tile, land);
    for (let j = i + 1; j < cities.length; j++) { const d = dist[cities[j]!.tile]!; if (Number.isFinite(d)) links.push({ a: i, b: j, d }); }
  });
  links.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
  const group = cities.map((_, i) => i), find = (i: number): number => { while (group[i] !== i) i = group[i] = group[group[i]!]!; return i; };
  let laid = 0;
  for (const { a, b } of links) {
    const ra = find(a), rb = find(b);
    if (ra === rb) continue;
    group[ra] = rb;
    // (Along the roads there are, where they serve: they cost next to nothing to follow.)
    const to = cities[b]!.tile, { came } = spread(cities[a]!.tile, (t) => { const c = land(t); return c === undefined ? undefined : g.hasRoad(t) ? 0.2 : c; }, to);
    for (let t = came[to]!; t >= 0 && t !== cities[a]!.tile; t = came[t]!) if (g.use[t] !== USE.center && !g.road[t]) { g.road[t] = 1; laid++; }
  }
  g.roadVersion++;
  return laid;
}

// Cheapest land route between two tiles (Dijkstra with a distance bound,
// `cost` the price of stepping onto a tile, undefined: no way), or null.
function route(g: Game, from: number, to: number, cost: (t: number) => number | undefined): { tiles: number[]; cost: number } | null {
  const limit = g.approxDist(from, to) * 2 + 4;
  const dist = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  const open: [number, number][] = [[0, from]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]![0] < open[bi]![0]) bi = i;
    const [d, t] = open.splice(bi, 1)[0]!;
    if (t === to) break;
    if (d > (dist.get(t) ?? Infinity)) continue;
    for (const n of g.tiles[t].neighbors) {
      if (g.approxDist(n, from) > limit) continue;
      const c = n === to ? 1 : cost(n);
      if (c === undefined) continue;
      const nd = d + c;
      if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); came.set(n, t); open.push([nd, n]); }
    }
  }
  if (!came.has(to)) return null;
  const tiles = [to];
  for (let t = to; t !== from; ) { t = came.get(t)!; tiles.push(t); }
  return { tiles: tiles.reverse(), cost: dist.get(to)! };
}

// The roads as drawn: each road tile lays its own piece, by which of its
// sides join a road (a road tile's, a city's center). Every road crosses a
// tile's side at its middle, square to it, so the pieces of neighbouring
// tiles always meet; within a tile:
//   one side     a spur to the tile's middle;
//   two sides    one curve from the one to the other (straight across, a
//                wide bend, a tight one);
//   three or more  the two sides lying straightest are the main line, drawn
//                as those two alone; two more straight across from each
//                other make a second line, crossing it; every other side
//                is a branch, curving round to run into a main line along
//                it, as a railway's points do.
// (Thirteen pieces in all on a hex, turned and mirrored.)
// The pieces are strung into lines from tile to tile (the main lines and
// the plain curves; a line's texture runs on along it). A junction's other
// pieces are lines of their own, at a `level` (render.ts lays each a hair
// under or over the main line: a branch under it, its bed showing beside
// the main line's and its rails going in under them; a second line over
// it). A line ends at the middle of the side where it reaches a city
// (`ends`: that city's tile, at the start and the end, or null); the city's
// layout carries it on to its streets, through a gate in its walls
// (cityProps.ts approach).
export interface RoadLine { a: number; b: number; points: THREE.Vector3[]; ends: [number | null, number | null]; level: number }

// A tile's piece: its main lines (pairs of sides), its branches (a side, the main line it joins and which
// end of it it heads for) and its spur (a lone side). Sides: indices into the tile's neighbours.
export interface RoadPiece { mains: [number, number][]; branches: { side: number; main: number; toward: 0 | 1 }[]; spur: number | null }
export function roadPiece(sides: readonly number[], around: number): RoadPiece {
  const apart = (i: number, j: number) => Math.min((j - i + around) % around, (i - j + around) % around), straight = Math.floor(around / 2);
  let left = [...sides];
  const take = (gap: number): [number, number] | null => {
    for (let x = 0; x < left.length; x++) for (let y = x + 1; y < left.length; y++) if (apart(left[x]!, left[y]!) === gap) {
      const pair: [number, number] = [left[x]!, left[y]!];
      left = left.filter((v) => v !== pair[0] && v !== pair[1]);
      return pair;
    }
    return null;
  };
  const mains: [number, number][] = [];
  if (sides.length >= 2) for (let gap = straight; gap >= 1 && !mains.length; gap--) { const m = take(gap); if (m) mains.push(m); }
  // (More lines straight across, on a hex: they cross the first.)
  if (around % 2 === 0) for (let m = mains.length ? take(straight) : null; m; m = take(straight)) mains.push(m);
  // (A branch joins the main line it meets most gently, heading for that line's further end.)
  const branches = !mains.length ? [] : left.map((side) => {
    let best = 0, score = -1;
    mains.forEach((m, k) => { const sc = Math.max(apart(side, m[0]), apart(side, m[1])); if (sc > score) { score = sc; best = k; } });
    const m = mains[best]!;
    return { side, main: best, toward: (apart(side, m[0]) >= apart(side, m[1]) ? 0 : 1) as 0 | 1 };
  });
  return { mains, branches, spur: !mains.length && sides.length === 1 ? sides[0]! : null };
}

export function roadLines(g: Game): RoadLine[] {
  const city = (t: number) => g.use[t] === USE.center;
  const edgeMid = (a: number, b: number) => {
    const tl = g.tiles[a]!, i = tl.neighbors.indexOf(b), k = tl.corners.length;
    return g.globe.triCenters[tl.corners[i]!]!.clone().add(g.globe.triCenters[tl.corners[(i + 1) % k]!]!).normalize();
  };
  // (A cubic curve on the globe, in SAMPLES steps.)
  const SAMPLES = 10;
  const bez = (c: readonly THREE.Vector3[], u: number) => {
    const v = 1 - u;
    return c[0]!.clone().multiplyScalar(v * v * v).addScaledVector(c[1]!, 3 * v * v * u).addScaledVector(c[2]!, 3 * v * u * u).addScaledVector(c[3]!, u * u * u).normalize();
  };
  const sample = (c: readonly THREE.Vector3[]) => Array.from({ length: SAMPLES + 1 }, (_, k) => bez(c, k / SAMPLES));
  // Each road tile's pieces: their points, and the sides they end on (null: an end within the tile).
  interface Laid { t: number; points: THREE.Vector3[]; sides: [number | null, number | null]; level: number; strung: boolean }
  const laid: Laid[] = [];
  for (let t = 0; t < g.N; t++) {
    if (!g.road[t] || city(t)) continue;
    const tile = g.tiles[t]!, c = tile.center, around = tile.neighbors.length;
    const sides = tile.neighbors.flatMap((n, i) => (g.hasRoad(n) ? [i] : []));
    const mid = (i: number) => edgeMid(t, tile.neighbors[i]!);
    // (Into the tile from a side's middle, square to the side: along the line of the two tiles' centers.)
    const inward = (i: number) => { const m = mid(i), d = c.clone().sub(g.tiles[tile.neighbors[i]!]!.center); return d.addScaledVector(m, -d.dot(m)).normalize(); };
    const reach = (i: number) => mid(i).angleTo(c);
    const apart = (i: number, j: number) => Math.min((j - i + around) % around, (i - j + around) % around);
    const curve = (i: number, j: number): THREE.Vector3[] => {
      const gap = apart(i, j), k = (2 * gap === around ? 0.5 : gap >= 2 ? 0.62 : 0.42);
      return [mid(i), mid(i).addScaledVector(inward(i), k * reach(i)), mid(j).addScaledVector(inward(j), k * reach(j)), mid(j)];
    };
    const piece = roadPiece(sides, around);
    if (!sides.length) {
      // (A road on its own tile, joined to nothing: a short length of it across the middle.)
      const d = tile.neighbors[0]!, a = c.clone().lerp(edgeMid(t, d), 0.3).normalize(), b = c.clone().multiplyScalar(2).sub(a).normalize();
      laid.push({ t, points: [a, c.clone(), b], sides: [null, null], level: 0, strung: false });
    }
    if (piece.spur !== null) laid.push({ t, points: [mid(piece.spur), mid(piece.spur).lerp(c, 0.5).normalize(), c.clone()], sides: [piece.spur, null], level: 0, strung: true });
    const curves = piece.mains.map(([i, j]) => curve(i, j));
    piece.mains.forEach(([i, j], k) => laid.push({ t, points: sample(curves[k]!), sides: [i, j], level: k, strung: k === 0 }));
    piece.branches.forEach((br, k) => {
      // (Into the main line a little past its middle, along it, toward the end it heads for.)
      const mc = curves[br.main]!, u = br.toward === 1 ? 0.56 : 0.44, at = bez(mc, u);
      const along = bez(mc, u + 0.03).sub(bez(mc, u - 0.03)).normalize().multiplyScalar(br.toward === 1 ? 1 : -1), far = 0.5 * reach(br.side);
      laid.push({ t, points: sample([mid(br.side), mid(br.side).addScaledVector(inward(br.side), far), at.clone().addScaledVector(along, -0.9 * far), at]), sides: [br.side, null], level: -1 - 0.3 * k, strung: false });
    });
  }
  // The pieces that run on from tile to tile, strung into lines: each end on a side meets the piece of the tile beyond it.
  const key = (a: number, b: number) => (a < b ? a * g.N + b : b * g.N + a);
  const meet = new Map<number, { p: Laid; end: 0 | 1 }[]>();
  for (const p of laid) if (p.strung) for (const end of [0, 1] as const) {
    const sd = p.sides[end];
    if (sd === null) continue;
    const k = key(p.t, g.tiles[p.t]!.neighbors[sd]!), l = meet.get(k);
    if (l) l.push({ p, end }); else meet.set(k, [{ p, end }]);
  }
  const beyond = (p: Laid, end: 0 | 1): { p: Laid; end: 0 | 1 } | null => {
    const sd = p.sides[end];
    if (sd === null) return null;
    return meet.get(key(p.t, g.tiles[p.t]!.neighbors[sd]!))?.find((o) => o.p !== p) ?? null;
  };
  const cityAt = (p: Laid, end: 0 | 1): number | null => { const sd = p.sides[end]; if (sd === null) return null; const n = g.tiles[p.t]!.neighbors[sd]!; return city(n) ? n : null; };
  const out: RoadLine[] = [], done = new Set<Laid>();
  const string = (start: Laid, from: 0 | 1) => {
    // (From `start`, entered at its end `from`, on through its other end, and the next's, to the line's end.)
    const points: THREE.Vector3[] = [], first = cityAt(start, from);
    let last: number | null = null;
    for (let p: Laid | null = start, enter: 0 | 1 = from; p && !done.has(p); ) {
      done.add(p);
      const run = enter === 0 ? p.points : [...p.points].reverse();
      points.push(...(points.length ? run.slice(1) : run));
      const exit: 0 | 1 = enter === 0 ? 1 : 0, next: { p: Laid; end: 0 | 1 } | null = beyond(p, exit);
      last = cityAt(p, exit);
      p = next ? next.p : null;
      if (next) enter = next.end;
    }
    out.push({ a: -1, b: -1, points, ends: [first, last], level: 0 });
  };
  // (From each loose end first; then whatever is left: rings.)
  for (const p of laid) if (p.strung && !done.has(p)) for (const end of [0, 1] as const) if (!done.has(p) && !beyond(p, end)) string(p, end);
  for (const p of laid) if (p.strung && !done.has(p)) string(p, 0);
  for (const p of laid) if (!p.strung) out.push({ a: -1, b: -1, points: p.points, ends: [cityAt(p, 0), cityAt(p, 1)], level: p.level });
  return out;
}
