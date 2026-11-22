import * as THREE from 'three';

// Developer views of what a frame costs the GPU: two of the debug views
// (render.ts setView), offered on the dev tools' pages beside the others,
// and in the game when it is opened with ?dev (the key O goes round them):
//
//   overdraw   how many fragments were shaded at each pixel: everything
//              drawn there that passed the depth test when it was drawn,
//              one over another (the ground under a tree, the tree, a
//              cloud over it).
//   quads      how many triangles share each block of 2 × 2 pixels of what
//              is seen. A GPU shades whole blocks: a triangle that touches
//              one pixel of a block pays for all four. One triangle to a
//              block wastes nothing (blue); two, three and four (green,
//              yellow, red) shade the block that many times for the same
//              four pixels: triangles too small or too thin for where
//              they are on screen, the case for a coarser model there.
//
// Both draw the scene itself, its own vertex shaders and its own cut-outs,
// with only the colour written changed. For that every shader the renderer
// compiles is given a second ending (a wrapper round its main: the colour
// replaced when the uniform uDbg says so), and while a view is drawn the
// blending is ours whatever the materials ask. None of it is installed in
// the game without ?dev.
//
// A triangle's identity, for the quads: WebGL has no gl_PrimitiveID. A flat
// varying carries one vertex's number to the whole triangle; two triangles
// of a mesh's square share that vertex, so a second pass writes how a random
// number given to every vertex changes across the screen within the
// triangle (its own slope: the two triangles end at different vertices),
// and two pixels are of one triangle when both agree.
//
// The flat varying is taken from the triangle's first vertex
// (WEBGL_provoking_vertex), set once and for good: GL's own rule is the
// last, which Metal does not have, and Chrome on a Mac then rewrites the
// index buffers of every draw of every shader with a flat varying, on the
// CPU: with this ending on all of them, the whole scene, some hundreds of
// milliseconds a frame as the camera moved.

export type DevView = 'off' | 'overdraw' | 'quads';
export const DEV_VIEWS: readonly DevView[] = ['off', 'overdraw', 'quads'];
// (On a dev tool's page, any but the game's own; or asked for.)
export const devEnabled = (): boolean => !new URLSearchParams(location.search).has('nodev') && (new URLSearchParams(location.search).has('dev') || /\/(?!index\.)[\w-]+\.html$/.test(location.pathname));

const VERT_END = /* glsl */ `
flat out highp uint vDbgId;
out highp float vDbgR;
void main() {
  dbgMain();
  highp uint r = uint(gl_VertexID) * 747796405u + 2891336453u;
  r = ((r >> ((r >> 28u) + 4u)) ^ r) * 277803737u;
  vDbgR = float((r >> 22u) ^ r) / 4294967296.0;
  highp uint h = uint(gl_VertexID) * 2654435761u ^ uint(gl_InstanceID) * 2246822519u;
  h ^= floatBitsToUint(gl_Position.x) * 3266489917u ^ floatBitsToUint(gl_Position.y) * 668265263u ^ floatBitsToUint(gl_Position.w) * 374761393u;
  h ^= h >> 15u; h *= 2246822519u; h ^= h >> 13u;
  vDbgId = h | 1u;
}
`;
// (One layer of overdraw: LAYER of 255, so the count holds to 255 / LAYER layers.)
const LAYER = 4;
const FRAG_END = /* glsl */ `
flat in highp uint vDbgId;
in highp float vDbgR;
uniform int uDbg;
void main() {
  dbgMain();
  if (uDbg == 1) pc_fragColor = vec4(${LAYER}.0 / 255.0);
  else if (uDbg == 3) pc_fragColor = vec4(dFdx(vDbgR), dFdy(vDbgR), 0.0, 1.0);
  else if (uDbg == 2) pc_fragColor = vec4(float(vDbgId & 255u), float((vDbgId >> 8u) & 255u), float((vDbgId >> 16u) & 255u), float(vDbgId >> 24u)) / 255.0;
}
`;
const MAIN = /void\s+main\s*\(\s*(?:void)?\s*\)/;

const POST_FRAG = /* glsl */ `
precision highp float;
uniform highp sampler2D uCount, uIdA, uIdB;
uniform int uMode;
out vec4 outColor;
// (Unreal's scale, near enough: black, blue, green, yellow, red, purple, white.)
vec3 ramp(float x) {
  const vec3 c[7] = vec3[7](vec3(0.0), vec3(0.05, 0.1, 0.75), vec3(0.2, 0.85, 0.2), vec3(0.95, 0.9, 0.15), vec3(0.95, 0.2, 0.1), vec3(0.7, 0.2, 0.8), vec3(1.0));
  x = clamp(x, 0.0, 6.0);
  int i = int(min(floor(x), 5.0));
  return mix(c[i], c[i + 1], x - float(i));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uMode == 1) {
    // Layers: 1 blue, 2 green, 3 yellow, 4 red, 6 and more toward white.
    float n = texelFetch(uCount, p, 0).r * 255.0 / ${LAYER}.0;
    outColor = vec4(ramp(n < 4.5 ? n : 4.0 + (n - 4.0) / 3.0), 1.0);
    return;
  }
  // Triangles to this pixel's block of 2 × 2 (the blocks the GPU shades: on even pixels).
  ivec2 q = p - (p & 1);
  vec4 a[4];
  vec2 b[4];
  int n = 0;
  for (int i = 0; i < 4; i++) {
    ivec2 o = q + ivec2(i & 1, i >> 1);
    a[i] = texelFetch(uIdA, o, 0); b[i] = texelFetch(uIdB, o, 0).xy;
    if (a[i] == vec4(0.0)) continue;
    bool seen = false;
    for (int j = 0; j < i; j++) if (a[j] == a[i] && distance(b[j], b[i]) <= 0.08 * max(length(b[j]), length(b[i])) + 1e-7) seen = true;
    if (!seen) n++;
  }
  vec3 col = ramp(float(n));
  // (This pixel's own triangle a shade apart from its neighbour's, so the mesh shows.)
  col *= 0.82 + 0.18 * fract(dot(texelFetch(uIdA, p, 0).rgb, vec3(1.7, 3.1, 5.3)));
  outColor = vec4(texelFetch(uIdA, p, 0) == vec4(0.0) ? vec3(0.0) : col, 1.0);
}
`;

export interface DevStats { overdraw: number; quads: number }

export class DevViews {
  view: DevView = 'off';
  stats: DevStats | null = null;
  private mode = 0;       // uDbg for the programs bound from now on
  private blend: 'own' | 'add' | 'none' = 'own';
  private readonly locs = new WeakMap<WebGLProgram, WebGLUniformLocation | null>();
  private readonly count = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private readonly idA = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private readonly idB = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.FloatType });
  private readonly post: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>;
  private readonly cam = new THREE.OrthographicCamera();
  private readonly size = new THREE.Vector2();
  private statsAt = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const provoking = gl.getExtension('WEBGL_provoking_vertex') as { provokingVertexWEBGL(mode: number): void; FIRST_VERTEX_CONVENTION_WEBGL: number } | null;
    provoking?.provokingVertexWEBGL(provoking.FIRST_VERTEX_CONVENTION_WEBGL);
    gl.getExtension('EXT_color_buffer_float');
    // Every shader compiled from here on: its main wrapped.
    const shaderSource = gl.shaderSource.bind(gl);
    gl.shaderSource = (shader, src) => {
      const fragment = gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER;
      if (MAIN.test(src) && (!fragment || src.includes('pc_fragColor'))) src = src.replace(MAIN, 'void dbgMain()') + (fragment ? FRAG_END : VERT_END);
      shaderSource(shader, src);
    };
    // Every program bound: told which ending to take.
    const useProgram = gl.useProgram.bind(gl);
    gl.useProgram = (program) => {
      useProgram(program);
      if (!program) return;
      let loc = this.locs.get(program);
      if (loc === undefined) { loc = gl.getUniformLocation(program, 'uDbg'); this.locs.set(program, loc); }
      if (loc) gl.uniform1i(loc, this.mode);
    };
    // While a view is drawn the blending is ours: the materials' own calls do nothing.
    const wrap = <K extends 'blendFunc' | 'blendFuncSeparate' | 'blendEquation' | 'blendEquationSeparate'>(name: K) => {
      const f = (gl[name] as (...a: number[]) => void).bind(gl);
      (gl as unknown as Record<string, unknown>)[name] = (...a: number[]) => { if (this.blend === 'own') f(...a); };
    };
    wrap('blendFunc'); wrap('blendFuncSeparate'); wrap('blendEquation'); wrap('blendEquationSeparate');
    const enable = gl.enable.bind(gl), disable = gl.disable.bind(gl);
    gl.enable = (cap) => { if (cap !== gl.BLEND || this.blend === 'own') enable(cap); };
    gl.disable = (cap) => { if (cap !== gl.BLEND || this.blend === 'own') disable(cap); };
    this.setBlend = (b) => {
      this.blend = 'own';
      if (b === 'add') { enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); }
      else if (b === 'none') disable(gl.BLEND);
      this.blend = b;
    };
    this.post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
      uniforms: { uCount: { value: this.count.texture }, uIdA: { value: this.idA.texture }, uIdB: { value: this.idB.texture }, uMode: { value: 0 } },
      vertexShader: 'in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: POST_FRAG,
    }));
    this.post.frustumCulled = false;
  }

  private readonly setBlend: (b: DevViews['blend']) => void;

  set(v: DevView): void { this.view = v; if (v === 'off') this.stats = null; }

  // The scene into `target`, every fragment's colour replaced as `mode` says.
  private pass(scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget, mode: number, blend: 'add' | 'none'): void {
    const r = this.renderer;
    r.resetState(); // (every program is bound anew, and so told the mode)
    this.mode = mode;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear();
    this.setBlend(blend);
    r.render(scene, camera);
    this.setBlend('own');
    this.mode = 0;
    r.resetState();
  }

  // A frame of the current view, to the canvas. Its triangles.
  render(scene: THREE.Scene, camera: THREE.Camera): number {
    const r = this.renderer, size = r.getDrawingBufferSize(this.size);
    for (const t of [this.count, this.idA, this.idB]) if (t.width !== size.x || t.height !== size.y) t.setSize(size.x, size.y);
    // (No shadow map is drawn meanwhile: its depth material would take the ending too.)
    const shadows = r.shadowMap.needsUpdate, background = scene.background, clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    r.shadowMap.needsUpdate = false;
    scene.background = null;
    let tris = 0;
    if (this.view === 'overdraw') { this.pass(scene, camera, this.count, 1, 'add'); tris = r.info.render.triangles; }
    else {
      this.pass(scene, camera, this.idA, 2, 'none');
      tris = r.info.render.triangles;
      this.pass(scene, camera, this.idB, 3, 'none');
    }
    scene.background = background;
    r.setClearColor(clear, alpha);
    r.shadowMap.needsUpdate = shadows;
    const now = performance.now();
    if (now - this.statsAt > 2000) { this.statsAt = now; this.measure(size.x, size.y); }
    r.setRenderTarget(null);
    this.post.material.uniforms['uMode']!.value = this.view === 'overdraw' ? 1 : 2;
    r.render(this.post, this.cam);
    return tris;
  }

  // The frame in two numbers, over the pixels something is drawn at (a
  // sample: every third row of blocks, every third block): the fragments
  // shaded to a pixel, and the blocks shaded to a block seen.
  private measure(w: number, h: number): void {
    const r = this.renderer, STEP = 6;
    if (this.view === 'overdraw') {
      const buf = new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(this.count, 0, 0, w, h, buf);
      let sum = 0, n = 0;
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { const v = buf[(y * w + x) * 4]!; if (v > 0) { sum += v / LAYER; n++; } }
      this.stats = { overdraw: n ? sum / n : 0, quads: this.stats?.quads ?? 0 };
      return;
    }
    const a = new Uint32Array(w * h), b = new Float32Array(w * h * 4);
    r.readRenderTargetPixels(this.idA, 0, 0, w, h, new Uint8Array(a.buffer));
    r.readRenderTargetPixels(this.idB, 0, 0, w, h, b);
    const same = (p: number, q: number): boolean => {
      if (a[p] !== a[q]) return false;
      const px = b[p * 4]!, py = b[p * 4 + 1]!, qx = b[q * 4]!, qy = b[q * 4 + 1]!;
      return Math.hypot(px - qx, py - qy) <= 0.08 * Math.max(Math.hypot(px, py), Math.hypot(qx, qy)) + 1e-7;
    };
    let shaded = 0, seen = 0;
    for (let y = 0; y + 1 < h; y += STEP) for (let x = 0; x + 1 < w; x += STEP) {
      const i = [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1];
      let tris = 0, covered = 0;
      for (let k = 0; k < 4; k++) {
        if (a[i[k]!] === 0) continue;
        covered++;
        let dup = false;
        for (let j = 0; j < k; j++) if (a[i[j]!] !== 0 && same(i[j]!, i[k]!)) dup = true;
        if (!dup) tris++;
      }
      shaded += tris * 4; seen += covered;
    }
    this.stats = { overdraw: this.stats?.overdraw ?? 0, quads: seen ? shaded / seen : 0 };
  }
}
