// A dev page (ship_preview.html): ships side by side on flat water, to look their models over.
//   ?ships=galley,frigate,transport,trireme   which (transport: an embarked unit's boat)
//   ?view=side|bow|top|three                   from where (default three-quarter)
import * as THREE from 'three';
import { unitModel, transportModel, RIG } from './unitModels.ts';
import type { UnitKey } from './rules.ts';

const q = new URLSearchParams(location.search);
const ships = (q.get('ships') ?? 'galley,frigate,transport').split(',');
const TEAM = new THREE.Color(q.get('color') ?? '#3b5bdb');
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(2);
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9db8cc');
scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a6a, 1.5));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
sun.position.set(-4, 7, 5);
scene.add(sun);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0x2f5f86, transparent: true, opacity: 0.86 }));
sea.rotation.x = -Math.PI / 2;
scene.add(sea);
const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
let x = 0;
const GAP = 2.6;
const widths: number[] = [];
const meshes = ships.map((k) => {
  const g = (k === 'transport' ? transportModel() : unitModel(k as UnitKey, 'Romans')).clone();
  // (The owner's colour, where the game's shader would paint it.)
  const limb = g.getAttribute('aLimb'), col = g.getAttribute('color');
  for (let i = 0; i < col.count; i++) if (Math.round(limb.getW(i)) & RIG.team) col.setXYZ(i, TEAM.r, TEAM.g, TEAM.b);
  g.computeBoundingBox();
  widths.push(g.boundingBox!.max.x - g.boundingBox!.min.x);
  return new THREE.Mesh(g, material);
});
// (Bows to the right, side on to a camera in front.)
meshes.forEach((m, i) => { x += i ? 5.2 : 0; m.position.x = x; m.rotation.y = Math.PI / 2; scene.add(m); });
void GAP; void widths;
// (A figure's height, for scale: a post 1 tall on a float.)
const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
post.position.set(-2.2, 0.5, 0);
scene.add(post);
const mid = x / 2, span = x + 5;
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
const view = q.get('view') ?? 'three';
const from = view === 'side' ? [mid, 1.4, span * 1.25] : view === 'bow' ? [mid + span * 1.1, 1.6, 0.6] : view === 'top' ? [mid, span * 1.5, 0.01] : [mid + span * 0.42, span * 0.36, span * 0.78];
camera.position.set(from[0]!, from[1]!, from[2]!);
camera.lookAt(mid, 0.7, 0);
renderer.render(scene, camera);
