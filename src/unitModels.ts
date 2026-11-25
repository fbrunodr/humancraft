import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { part, seg, tf, V, type Tf } from './propCatalog.ts';
import { person, riderBody, handAt, elbowAt, hairShapes, headShell, heroicHead, HEROIC, HAIR_STYLE_KEYS, HIP, SHOULDER, HEAD_Y, HANG, HOLD, RAISE, SHIELD, GRIP2, GUN_R, GUN_L, type ArmPose, type Dress, type Part, type HairStyleKey } from './people.ts';
import { horseParts } from './creatures.ts';
import { gem, hull, plate, R, type V3 } from './lowpoly.ts';
import type { ArchCiv } from './architecture.ts';
import type { UnitKey } from './rules.ts';
import { mapFlat, LINEN, type Armor } from './unitSheet.ts';

// Unit figurines: painted miniatures, as the props and houses are, one model
// per unit type and civ. A model is one figure (a soldier, a rider on his
// horse, a settler) about 1 tall, standing on y = 0 and facing +z; the unit
// view (unitView.ts) shows it a dozen times over in formation.
//
// Besides its colours (a `color` attribute, as the props), each vertex says
// (packed: the GPU takes only so many attributes):
//   aLimb  how it moves: (side, pivot height, amplitude), turning about the
//          pivot. A side of +1 or -1 swings that way round on the march
//          (left and right legs, a horse's diagonal pairs, arms against the
//          legs); STRIKE thrusts forward in a fight (the weapon arm and its
//          weapon, the bow raised); 0 never moves. Its w: flags (RIG), 1 on
//          what is painted in the owner's colour (tunic, shield face, plume,
//          horse cloth: the instance colour, shaded by `color`), 2 on skin
//          (each figure's own skin tone), 4 on a limb's lower piece (shin,
//          forearm: bent at its middle joint), 8 on a weapon in hand
//          (turned at the grip to point as the figure aims);
//   aRig   the middle joint's y, z; the grip's y, z;
//   aRest  how far forward of upright the weapon points as made (radians).
// Hair is drawn apart (hairModel): each figure gets its own style and colour.
//
// Each civ dresses its soldiers its own way (GEAR): the shape of their
// shields and helmets, their legs bare or trousered.

export type Shield = 'round' | 'big round' | 'scutum' | 'kite' | 'oval' | 'pavise' | 'small';
export type Helmet = 'crest' | 'cone' | 'kettle' | 'hat' | 'feather' | 'turban' | 'cap' | 'beret' | 'none';
export interface Gear {
  shield: Shield;
  helmet: Helmet;
  legs: 'bare' | number; // bare (skin) or trousers of that colour
  skin: readonly number[]; // the tones the figures are drawn from
  hair: readonly number[]; // the hair colours, likewise (repeated: drawn more often)
}

const DARK = [0x1e1814, 0x2a1e16, 0x3a2a1e, 0x2a1e16] as const;
const BROWN = [0x2a1e16, 0x4a3422, 0x5e4430, 0x3a2a1e] as const;
const FAIR = [0xd8b868, 0xc9a050, 0xb8904a, 0x9a5a2e, 0x6e4c30, 0x4a3422, 0x5e4430] as const;
const NORSE = [0xe0c478, 0xd8b868, 0xc9a050, 0xb8904a, 0xa0502a, 0x8a6a48, 0x6e4c30] as const;
const TONES = {
  north: [0xf1d0b5, 0xe8bf9f, 0xdcb08c],
  south: [0xd8a982, 0xc99670, 0xb98460],
  west: [0xc48c64, 0xb07a52, 0x9c6a46],
  africa: [0x8a5a3a, 0x7a4c30, 0x6a4028],
  east: [0xe9c9a2, 0xdcb890, 0xd0a87e],
  america: [0xb9825a, 0xa87250, 0x966446],
} as const;

export const GEAR: Record<ArchCiv, Gear> = {
  Romans:      { shield: 'scutum',    helmet: 'crest',   legs: 'bare',   skin: TONES.south, hair: BROWN },
  Greeks:      { shield: 'big round', helmet: 'crest',   legs: 'bare',   skin: TONES.south, hair: BROWN },
  Egyptians:   { shield: 'oval',      helmet: 'cap',     legs: 'bare',   skin: TONES.west, hair: DARK },
  Babylonians: { shield: 'round',     helmet: 'cone',    legs: 'bare',   skin: TONES.west, hair: DARK },
  Persians:    { shield: 'pavise',    helmet: 'turban',  legs: 0x5a4a3a, skin: TONES.west, hair: DARK },
  Hebrews:     { shield: 'round',     helmet: 'cap',     legs: 'bare',   skin: TONES.west, hair: BROWN },
  Ethiopians:  { shield: 'round',     helmet: 'none',    legs: 'bare',   skin: TONES.africa, hair: DARK },
  Indians:     { shield: 'round',     helmet: 'turban',  legs: 0xe8e0cc, skin: TONES.west, hair: DARK },
  Chinese:     { shield: 'pavise',    helmet: 'hat',     legs: 0x3a3a40, skin: TONES.east, hair: DARK },
  Japanese:    { shield: 'small',     helmet: 'hat',     legs: 0x2e3440, skin: TONES.east, hair: DARK },
  Mongols:     { shield: 'small',     helmet: 'cone',    legs: 0x5a4632, skin: TONES.east, hair: DARK },
  Aztecs:      { shield: 'round',     helmet: 'feather', legs: 'bare',   skin: TONES.america, hair: DARK },
  English:     { shield: 'kite',      helmet: 'cone',    legs: 0x6a5a48, skin: TONES.north, hair: FAIR },
  French:      { shield: 'kite',      helmet: 'kettle',  legs: 0x4a4a52, skin: TONES.north, hair: FAIR },
  Germans:     { shield: 'oval',      helmet: 'cap',     legs: 0x5a4a38, skin: TONES.north, hair: FAIR },
  Spanish:     { shield: 'round',     helmet: 'kettle',  legs: 0x4a3a30, skin: TONES.south, hair: BROWN },
  Russians:    { shield: 'kite',      helmet: 'cone',    legs: 0x4a4038, skin: TONES.north, hair: FAIR },
  Vikings:     { shield: 'big round', helmet: 'cone',    legs: 0x6a5a48, skin: TONES.north, hair: NORSE },
};

// The shades the team colour is drawn in (multiplied by the owner's colour):
// cloth a touch darker than the paint on shields and plumes.
const CLOTH = 0xa4a4a4, PAINT = 0xffffff;
const METAL = 0x9a9ca2, WOOD = 0x7a5a3a, LEATHER = 0x6a4a30, RIM = 0x4a3a2c;
const HORSE = [0x6a4a32, 0x8a6a4a, 0x4a3a2e, 0xb8a888] as const;

// (`joint`: a limb's lower piece, bent at its middle joint at y, z;
// `grip`: a weapon held at y, z, pointing so far forward of upright as it
// is made (radians), turned there to point as the figure aims.)
// (`spin`: a rotor turning about the upright through its hub at (x, z), a
// propeller about the fore-and-aft line through its hub at (x, y), a wheel
// about the axle through its hub at (y, z): the hub kept where the grip is
// (aRig.zw).)
type Tag = { support?: boolean; team?: boolean; skin?: boolean; limb?: readonly [number, number, number]; joint?: readonly [number, number]; grip?: readonly [number, number, number]; spin?: { readonly axis: 'x' | 'y' | 'z'; readonly at: readonly [number, number] } };
export const RIG = { team: 1, skin: 2, joint: 4, grip: 8, spinY: 16, spinZ: 32, spinX: 64, skirt: 128, blend: 256, support: 512 } as const;
const wheelSpin = (y: number, z = 0): Tag => ({ spin: { axis: 'x', at: [y, z] } });
function tag(g: THREE.BufferGeometry, t: Tag = {}): THREE.BufferGeometry {
  if (g.getAttribute('leafMask')) g.deleteAttribute('leafMask');
  const n = g.getAttribute('position').count;
  const flags = (t.team ? RIG.team : 0) + (t.skin ? RIG.skin : 0) + (t.joint ? RIG.joint : 0) + (t.grip ? RIG.grip : 0) + (t.support ? RIG.support : 0) + (t.spin ? RIG[t.spin.axis === 'x' ? 'spinX' : t.spin.axis === 'y' ? 'spinY' : 'spinZ'] : 0);
  const limb = new Float32Array(n * 4), rig = new Float32Array(n * 4), rest = new Float32Array(n).fill(t.grip?.[2] ?? 0);
  const [s, pivot, amp] = t.limb ?? [0, 0, 0], [jy, jz] = t.joint ?? [0, 0], [gy, gz] = t.spin?.at ?? t.grip ?? [0, 0];
  for (let i = 0; i < n; i++) { limb.set([s, pivot, amp, flags], i * 4); rig.set([jy, jz, gy, gz], i * 4); }
  // (A body that bends smoothly (an `aBlend` attribute: its corners' weights): each corner swung as much as it hangs from its
  // limb, and bent at the joint as much as it hangs from the lower piece (aRig.z: RIG.blend).)
  const blend = g.getAttribute('aBlend');
  if (blend) {
    for (let i = 0; i < n; i++) {
      limb[i * 4 + 2]! *= blend.getX(i);
      if (t.joint) { limb[i * 4 + 3]! += RIG.blend; rig[i * 4 + 2] = blend.getY(i); rig[i * 4 + 3] = blend.getX(i); }
    }
    g.deleteAttribute('aBlend');
  }
  g.setAttribute('aLimb', new THREE.BufferAttribute(limb, 4));
  g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
  g.setAttribute('aRest', new THREE.BufferAttribute(rest, 1));
  return g;
}
const shape = (geo: THREE.BufferGeometry, color: number, o: Tf, t?: Tag) => tag(part(geo, color, tf(o)), t);
const ball = (r: number, color: number, o: Tf, t?: Tag) => shape(new THREE.OctahedronGeometry(r, 0), color, o, t);
const box = (w: number, h: number, d: number, color: number, o: Tf, t?: Tag) => shape(new THREE.BoxGeometry(w, h, d), color, o, t);
// How much thicker than life what a figure holds is made (heroic
// proportions: people.ts HEROIC), while its weapons are being made (1 else).
let WK = 1;
const arming = (on: boolean) => { WK = on ? HEROIC.weapon : 1; };
// (Low-poly: a rod is three-sided whatever `n` asks; a thick one four.)
const rod = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, n: number, color: number, t?: Tag) => tag(seg(a, b, r0 * WK, r1 * WK, Math.min(n, r0 * WK > 0.015 ? 4 : 3), color), t);
// A low-poly piece (lowpoly.ts) tagged.
const lp = (g: THREE.BufferGeometry, o: Tf = {}, t?: Tag) => { g.deleteAttribute('leafMask'); return tag(g.applyMatrix4(tf(o)), t); };
const point = (h: number, r: number, n: number, color: number, o: Tf, t?: Tag) => lp(hull([R([0, 0, 0], r * WK), R([0, h, 0], 0, 0)], n, color, { side: [0, 0, 1] }), o, t);
// A blade from `a` to its tip at `b`, flat (its faces to the sides, x;
// its edges fore and aft), a diamond in section: `w` wide at the hilt,
// narrowing to the point; a leaf-shaped head (a spear's) swells first.
const blade = (a: THREE.Vector3, b: THREE.Vector3, w: number, color: number, t?: Tag, leaf = false) => {
  const at = (k: number): V3 => { const p = a.clone().lerp(b, k); return [p.x, p.y, p.z]; };
  const k = WK, rings = leaf ? [R(at(0), 0.006 * k, w * 0.45 * k), R(at(0.35), 0.005 * k, w * k), R(at(1), 0, 0)] : [R(at(0), 0.0045 * k, w * k), R(at(0.82), 0.004 * k, w * 0.8 * k), R(at(1), 0, 0)];
  return lp(hull(rings, 4, color, { side: [0, 0, 1], turn: 0, caps: [true, false] }), {}, t);
};
// A sabre's blade from the grip `g`: one piece, leaning forward and curving back to its point, its cutting edge the
// outside of the curve, to the front (flat as a blade is: its faces to the sides).
const sabre = (g: THREE.Vector3, t?: Tag) => {
  const at = (y: number, z: number): V3 => [g.x, g.y + y, g.z + z], k = WK;
  return lp(hull([R(at(0.045, 0.02), 0.0045 * k, 0.019 * k), R(at(0.19, 0.105), 0.0045 * k, 0.021 * k), R(at(0.33, 0.16), 0.004 * k, 0.018 * k), R(at(0.45, 0.18), 0, 0)],
    4, METAL, { side: [0, 0, 1], turn: 0, caps: [true, false] }), {}, t);
};
// A sword's hilt at the grip `g`, the blade pointing along `dir`: the
// crossguard (across the edges, as the blade is flat: blade), the grip, the pommel.
const hilt = (g: THREE.Vector3, dir: THREE.Vector3, len: number, color: number, t?: Tag) => {
  // (The crossguard across the blade's edges, in its plane: fore and aft, square to the blade.)
  const d = dir.clone().normalize(), guard = g.clone().addScaledVector(d, 0.04), cross = 0.045 * WK, pom = 0.016 * WK;
  const edge = V(0, -d.z, d.y).normalize().multiplyScalar(cross);
  return [rod(guard.clone().sub(edge), guard.clone().add(edge), 0.009, 0.009, 4, color, t), rod(g.clone().addScaledVector(d, -len), guard, 0.011, 0.011, 4, LEATHER, t),
    lp(gem([g.x - d.x * (len + 0.012), g.y - d.y * (len + 0.012), g.z - d.z * (len + 0.012)], [pom, pom, pom], color, 4), {}, t)];
};

// Whether the model being built has the finer bodies (unitModel's `fine`), and whose it is (its faces: unitSheet.ts).
let FINE = true, CIV: ArchCiv = 'Romans';
// The march: legs swing from the hip, arms against them from the shoulder.
export const LEG_AMP = 0.45;
const LEG = (side: number) => [side, HIP, LEG_AMP] as const;
const ARM = (side: number) => [-side, SHOULDER, 0.35] as const;
// An arm that doesn't swing, and what it holds (a staff, a banner): hung
// from the shoulder all the same, so it goes with the body as one (the
// units' shader bends whatever hangs from a shoulder wholly with it).
const STILL_ARM = [0, SHOULDER, 0] as const;
// In a fight: the weapon arm thrusts (and its weapon with it) about the shoulder.
export const STRIKE = 2;
// How far a fighting arm (cutting: a sword's, a club's; thrusting: a spear's, a lance's) swings from the shoulder, per unit of its pose's arm (unitAnim.ts cutArm).
export const REACH = 1.5;
const HIT = (pivot: number, amp: number) => [STRIKE, pivot, amp] as const;
// In a fight: the shield arm raises its shield to ward off a blow (or arrows) about the shoulder.
export const GUARD = 3;
const GUARD_ARM = [GUARD, SHOULDER, 1.25] as const;
// How far a long gun's arms (both, together) swing from the shoulders, per unit of its pose's arm (unitAnim.ts LUNGE).
export const GUN_REACH = 0.9;
// A long gun's other arm, its hand under the barrel: swung as the gun
// arm is, then bent to hold the gun wherever it points (RIG.support: the
// units' shader reaches it there, unitView.ts).
const SUPPORT_ARM = [STRIKE, SHOULDER, GUN_REACH] as const;
// How far an archer's bow arm swings from the shoulder, per unit of its pose's arm (unitAnim.ts bowPose).
export const BOW_REACH = 0.4;
// An archer's string hand drawing back to the cheek (raised from the shoulder, bent at the elbow).
export const DRAW = 4;
const DRAW_ARM = [DRAW, SHOULDER, 1.45] as const;
// Whether a unit's weapon is whirled before it is loosed (a sling).
export const whirls = (type: UnitKey): boolean => type === 'slinger';
// Whether a type's figures carry a bow (at close quarters they lay about them with it).
// Whether a type's figures fight with a blade or a club, cutting (the rest thrust: spears, pikes, lances).
const CUTTERS: ReadonlySet<UnitKey> = new Set<UnitKey>(['warrior', 'swordsman', 'longswordsman', 'manAtArms', 'cavalry']);
export const cuts = (type: UnitKey): boolean => CUTTERS.has(type);
// Whether a type's figures fight with a spear, a pike or a lance, thrusting.
const THRUSTERS: ReadonlySet<UnitKey> = new Set<UnitKey>(['spearman', 'pikeman', 'horseman', 'knight', 'lancer']);
export const thrusts = (type: UnitKey): boolean => THRUSTERS.has(type);
// Whether a type's figures carry a musket or a rifle, fighting at close quarters with its bayonet.
const BAYONETS: ReadonlySet<UnitKey> = new Set<UnitKey>(['musketman', 'rifleman', 'greatWarInfantry', 'infantry', 'marine', 'paratrooper']);
export const bayonets = (type: UnitKey): boolean => BAYONETS.has(type);
// Whether a type's figures carry their weapon in both hands, across the body (a long gun, a machine gun, a crossbow: the
// gun rig, people.ts GUN_R, GUN_L): they turn their shoulders to aim it, and at close quarters lunge with it.
const LONG_ARMS: ReadonlySet<UnitKey> = new Set<UnitKey>([...BAYONETS, 'crossbowman', 'machineGun', 'specialForces']);
export const longArms = (type: UnitKey): boolean => LONG_ARMS.has(type);
export const bowman = (type: UnitKey): boolean => type === 'archer' || type === 'compositeBowman' || type === 'horseArcher';
// Whether a type's figures draw a bow on foot, the string to the cheek (unitAnim.ts: a horse archer's bow is drawn as it rides).
export const draws = (type: UnitKey): boolean => type === 'archer' || type === 'compositeBowman';

// The firearms, each its unit's own: a flintlock musket; a percussion rifle with a sword bayonet; a bolt-action rifle; a
// self-loading rifle; a submachine gun with a drum; an assault rifle; a silenced carbine with a sight; a light machine gun.
type Gun = 'musket' | 'rifle' | 'boltRifle' | 'selfLoader' | 'smg' | 'assaultRifle' | 'carbine' | 'mg';
const GUN_KINDS: ReadonlySet<string> = new Set<Gun>(['musket', 'rifle', 'boltRifle', 'selfLoader', 'smg', 'assaultRifle', 'carbine', 'mg']);
const isGun = (h: Hold): h is Gun => GUN_KINDS.has(h);
type Hold = 'spear' | 'pike' | 'club' | 'sword' | 'longsword' | 'bow' | 'recurve' | 'sling' | 'crossbow' | Gun | 'staff' | 'pilgrim' | 'hoe' | 'banner' | 'none';

// How far forward of upright each weapon is made to point (radians): a
// spear upright, a sword a little forward (what is held in both hands lies through them: figure).
const REST_PITCH: Record<Hold, number> = {
  spear: 0, pike: 0, club: 0.23, sword: 0.25, longsword: 0.31, bow: 0, recurve: 0, sling: Math.PI, crossbow: 0.4, musket: 0.4, rifle: 0.4, boltRifle: 0.4, selfLoader: 0.4, smg: 0.4, assaultRifle: 0.4, carbine: 0.4, mg: 0.4, staff: 0, pilgrim: 0, hoe: 0, banner: 0, none: 0,
};
// A body (people.ts) tagged for the units' shader.
// (A skirt follows the legs (RIG.skirt; the shader: unitView.ts): each
// vertex as much as it is down from the waist (aRig.y: none at and above
// the hips, fully at the hem); its sides (aRig.x: how near the side line
// it is) with their own leg, its front with whichever leg is forward, its
// back a little behind whichever is back (the knee kicks the shin further);
// all of it crouched with the thighs. So it spreads with the stride, and no
// leg gets past it.)
const tagged = (parts: readonly Part[]): THREE.BufferGeometry[] => parts.map((p) => {
  const g = tag(p.geo, { team: p.tag === 'team', skin: p.tag === 'skin', ...(p.limb ? { limb: p.limb } : {}), ...(p.joint ? { joint: p.joint } : {}), ...(p.limb === SUPPORT_ARM ? { support: true } : {}) });
  if (p.skirt !== undefined && p.limb && p.limb[2] > 0) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute, limb = g.getAttribute('aLimb') as THREE.BufferAttribute, rig = g.getAttribute('aRig') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      limb.setXYZW(i, x >= 0 ? 1 : -1, HIP, p.limb[2], limb.getW(i) + RIG.skirt);
      rig.setXY(i, Math.max(0, 1 - Math.abs(pos.getZ(i)) / 0.05), Math.max(0, Math.min(1, (HIP - y) / (HIP - p.skirt))));
    }
  }
  return g;
});
const v3 = (p: THREE.Vector3) => V(p.x, p.y, p.z);

// A figure on foot (people.ts), dressed for its civ and armed. `hold`:
// what the right hand carries (it then stops swinging); `shield`: on the
// left arm, or none; `pack`: a bundle on the back. `female`: a woman's
// build (a civilian's skirt to the ankles). `modern`: a modern soldier
// (trousers, a steel helmet whatever the civ wore).
// (The figure faces +z: its right hand is at -x.)
// `still`: standing (in a chariot), its legs never swinging; `helmetAs`,
// `shieldAs`: the unit's own headgear or shield whatever its civ's.
function figure(gear0: Gear, hold: Hold, shield: boolean, opts: { armor?: Armor; helmet?: boolean; pack?: boolean; quiver?: boolean; female?: boolean; civilian?: boolean; modern?: boolean; still?: boolean; robe?: boolean; helmetAs?: Helmet; shieldAs?: Shield } = {}): THREE.BufferGeometry[] {
  const gear1: Gear = opts.modern ? { ...gear0, legs: 0x4a4e44, helmet: 'kettle' } : gear0;
  const gear: Gear = { ...gear1, helmet: opts.helmetAs ?? gear1.helmet, shield: opts.shieldAs ?? gear1.shield };
  const f = opts.female === true;
  const dress: Dress = {
    fine: FINE, heroic: true, broad: opts.civilian !== true, female: f, skirt: opts.modern ? 'none' : opts.robe || (opts.civilian && f) ? 'ankle' : 'knee', legs: gear.legs,
    // (`robe`: a gown to the ankles and long sleeves, whoever wears it: a missionary's.)
    sleeves: gear.legs === 'bare' && !opts.modern && !opts.robe ? 'short' : 'long',
    // (Painted from the units' sheet; before the modern uniform, the skirt and sleeves undyed.)
    painted: FINE, civ: CIV, ...(opts.modern ? {} : { undyed: LINEN }), ...(opts.armor ? { armor: opts.armor } : {}),
  };
  // The arms: the right one carries the weapon, the left the shield (or the bow).
  const bow = hold === 'bow' || hold === 'recurve', longGun = isGun(hold) || hold === 'crossbow', twoHands = longGun || hold === 'longsword';
  // (A sling hangs from the lowered hand until it is whirled; a two-handed sword's grip in both hands.)
  const armR: ArmPose = hold === 'none' || bow || hold === 'sling' ? HANG : hold === 'longsword' ? GRIP2 : longGun ? GUN_R : HOLD;
  const armL: ArmPose = shield ? SHIELD : bow ? RAISE : hold === 'longsword' ? GRIP2 : longGun ? GUN_L : twoHands ? HOLD : HANG;
  const strike = hold === 'sling' ? HIT(SHOULDER, 1.4) : hold === 'spear' || hold === 'pike' || hold === 'club' || hold === 'sword' || hold === 'longsword' ? HIT(SHOULDER, REACH)
    : twoHands ? HIT(SHOULDER, GUN_REACH) : null;
  const bowUp = HIT(SHOULDER, BOW_REACH); // (an archer raises his bow to loose: from where he holds it forward)
  const freeL = !shield && !bow && !twoHands;
  const swing = {
    legs: (side: number) => (opts.still ? [0, HIP, 0] as const : LEG(side)),
    arms: (side: number) => (side === -1 ? (hold === 'none' ? ARM(-1) : bow ? DRAW_ARM : strike ?? STILL_ARM) : shield ? GUARD_ARM : freeL ? ARM(1) : bow ? bowUp : hold === 'longsword' ? strike ?? STILL_ARM : longGun ? SUPPORT_ARM : STILL_ARM),
  };
  const out = tagged(person(dress, armL, armR, swing));
  const hR = handAt(-1, armR, f), hL = handAt(1, armL, f), eR = elbowAt(-1, armR, f), eL = elbowAt(1, armL, f);
  // (What the right hand holds goes with its forearm: bent at the elbow.)
  // (A long gun's rest: as it lies through both hands.)
  const rest = longGun ? Math.atan2(hL.z - hR.z, hL.y - hR.y) : REST_PITCH[hold];
  const w: Tag = strike ? { limb: strike, joint: [eR.y, eR.z], grip: [hR.y, hR.z, rest] } : {};
  // (A bow points where its arrow would fly: square to its limbs, level as it is made.)
  const bowTag: Tag = { limb: bowUp, joint: [eL.y, eL.z], grip: [hL.y, hL.z, Math.PI / 2] };
  const up = (d: number) => v3(hR).add(V(0, d, 0));
  arming(true);
  // (A spear's head on its socket, a cap on its butt.)
  const socketed = (lo: number, hi: number) => [rod(up(hi - 0.05), up(hi + 0.01), 0.014, 0.011, 4, METAL, w), rod(up(lo - 0.035), up(lo), 0.004, 0.012, 4, METAL, w)];
  if (hold === 'spear') out.push(rod(up(-0.42), up(0.86), 0.012, 0.011, 5, WOOD, w), ...socketed(-0.42, 0.85), blade(up(0.84), up(1.0), 0.026, METAL, w, true));
  if (hold === 'pike') out.push(rod(up(-0.4), up(1.25), 0.012, 0.011, 5, WOOD, w), ...socketed(-0.4, 1.24), blade(up(1.23), up(1.38), 0.022, METAL, w, true));
  // (A club: a grip, swelling to a knobbed head.)
  if (hold === 'club') { const c = (dx: number, dy: number, dz: number): V3 => [hR.x + dx, hR.y + dy, hR.z + dz]; out.push(lp(hull([R(c(0, -0.05, -0.02), 0.011 * WK), R(c(-0.008, 0.12, 0.03), 0.015 * WK), R(c(-0.016, 0.25, 0.065), 0.03 * WK), R(c(-0.02, 0.31, 0.08), 0.022 * WK)], 6, WOOD), {}, w)); }
  if (hold === 'sword') { const d = V(0, 0.36, 0.09), g0 = v3(hR).add(V(0, 0, 0.01)); out.push(...hilt(g0, d, 0.035, METAL, w), blade(g0.clone().addScaledVector(d.clone().normalize(), 0.045), g0.clone().add(d).add(V(0, 0.04, 0.01)), 0.022, METAL, w)); }
  // (A two-handed sword, its grip between both hands, the long blade up and forward.)
  if (hold === 'longsword') {
    const g = v3(hR).add(v3(hL)).multiplyScalar(0.5);
    const d = V(0, 0.57, 0.19);
    out.push(...hilt(g.clone().add(V(0, 0.01, 0)), d, 0.07, METAL, w), blade(g.clone().add(V(0, 0.05, 0.015)), g.clone().add(V(0, 0.64, 0.21)), 0.026, METAL, w));
  }
  // (A sling hanging from the hand: its cords and the stone's pouch.)
  if (hold === 'sling') out.push(rod(v3(hR), v3(hR).add(V(0.01, -0.21, 0.02)), 0.004, 0.004, 3, 0xb8a888, w), ball(0.025, 0x8a7a62, { x: hR.x + 0.01, y: hR.y - 0.23, z: hR.z + 0.02 }, w));
  if (hold === 'staff') out.push(rod(up(-0.42), up(0.6), 0.013, 0.011, 5, WOOD, { limb: STILL_ARM }));
  // (A pilgrim's staff: taller than its bearer, a knob at its head, a bronze bell hung under it on a cord, a gourd tied lower down.)
  if (hold === 'pilgrim') out.push(rod(up(-0.42), up(0.82), 0.014, 0.011, 5, WOOD, { limb: STILL_ARM }), ball(0.024, WOOD, { x: hR.x, y: hR.y + 0.84, z: hR.z }, { limb: STILL_ARM }),
    rod(up(0.76), up(0.69).add(V(0, 0, 0.035)), 0.003, 0.003, 3, 0xb8a888, { limb: STILL_ARM }), ball(0.026, 0xb08a3c, { x: hR.x, y: hR.y + 0.665, z: hR.z + 0.037 }, { limb: STILL_ARM }),
    ball(0.034, 0xa8894e, { x: hR.x, y: hR.y + 0.44, z: hR.z + 0.03 }, { limb: STILL_ARM }));
  // (A worker's hoe: its shaft upright in the hand, the iron blade at its top, bent forward.)
  if (hold === 'hoe') out.push(rod(up(-0.42), up(0.62), 0.013, 0.011, 5, WOOD, { limb: STILL_ARM }), box(0.07, 0.016, 0.1, IRON, { x: hR.x, y: hR.y + 0.6, z: hR.z + 0.05 }, { limb: STILL_ARM }));
  // (A gun or a crossbow, carried muzzle up and across the body, through both hands: the right at its grip, the left
  // further up it. Straight, so it points true however it is aimed. Far off (the plain figure), a stock and a barrel.)
  if (isGun(hold) || hold === 'crossbow') {
    if (FINE) out.push(...(hold === 'crossbow' ? crossbow(v3(hR), v3(hL), w) : firearm(hold, v3(hR), v3(hL), w)));
    else {
      const d = v3(hL).sub(v3(hR)).normalize(), at = (k: number) => v3(hR).addScaledVector(d, k), long = hold === 'musket' || hold === 'rifle' || hold === 'boltRifle' || hold === 'selfLoader';
      out.push(rod(at(-0.2), at(0.1), 0.022, 0.017, 5, hold === 'carbine' || hold === 'mg' ? GUNMETAL : WOOD, w), rod(at(0.1), at(long ? 0.55 : 0.36), 0.011, 0.011, 5, long ? METAL : GUNMETAL, w));
    }
  }
  if (hold === 'banner') {
    // A tall pole with the owner's banner hanging from a crossbar, a finial on top.
    out.push(rod(up(-0.42), up(1.22), 0.016, 0.014, 5, WOOD, { limb: STILL_ARM }), rod(up(1.1).add(V(0, 0, -0.22)), up(1.1).add(V(0, 0, 0.22)), 0.01, 0.01, 4, WOOD, { limb: STILL_ARM }),
      lp(plate([[0, 0.21], [0.44, 0.21], [0.44, -0.21], [0, -0.21]], PAINT), { x: hR.x, y: hR.y + 0.88, z: hR.z - 0.22, ry: -Math.PI / 2 }, { team: true, limb: STILL_ARM }), ball(0.03, 0xd8b440, { x: hR.x, y: hR.y + 1.24, z: hR.z }, { limb: STILL_ARM }));
  }
  if (hold === 'bow') {
    // A bow in the left hand: two limbs bent forward from the grip, and the string.
    const g = v3(hL);
    out.push(rod(g, g.clone().add(V(0, 0.36, -0.06)), 0.011, 0.007, 4, WOOD, bowTag), rod(g, g.clone().add(V(0, -0.36, -0.06)), 0.011, 0.007, 4, WOOD, bowTag),
      rod(g.clone().add(V(0, 0.36, -0.06)), g.clone().add(V(0, -0.36, -0.06)), 0.003, 0.003, 3, 0xd8d0c0, bowTag));
  }
  if (hold === 'recurve') {
    // A short composite bow: the limbs out from the grip, their tips curled forward, and the string.
    const g = v3(hL), tip = (s: number) => g.clone().add(V(0, 0.28 * s, 0.03));
    out.push(...[1, -1].flatMap((s) => [rod(g, g.clone().add(V(0, 0.15 * s, -0.05)), 0.011, 0.009, 4, 0x5a3a22, bowTag), rod(g.clone().add(V(0, 0.15 * s, -0.05)), tip(s), 0.009, 0.005, 3, 0x5a3a22, bowTag)]),
      rod(tip(1), tip(-1), 0.003, 0.003, 3, 0xd8d0c0, bowTag));
  }
  arming(false);
  if (opts.quiver) out.push(lp(hull([R([0, 0, 0], 0.032), R([0, 0.3, 0], 0.036)], 4, LEATHER, { caps: [true, false] }), { x: 0.06, y: 0.5, z: -0.09, rz: -0.35 }),
    ...[0].map((dx) => rod(V(0.06 + dx - 0.1, 0.78, -0.09), V(0.06 + dx - 0.12, 0.84, -0.095), 0.006, 0.006, 3, 0xd8d0c0)));
  if (opts.pack) out.push(box(0.2, 0.22, 0.1, 0x9a8462, { y: 0.62, z: -0.11 }), rod(V(-0.11, 0.77, -0.1), V(0.11, 0.77, -0.1), 0.022, 0.022, 4, 0x6a5440));
  // (The shield goes with its forearm.)
  if (shield) out.push(...shieldOf(gear.shield, hL, { limb: GUARD_ARM, joint: [eL.y, eL.z] }, HEROIC.shield));
  if (opts.helmet) out.push(...helmetOf(gear.helmet));
  return out;
}

// ---- guns and crossbows ----
// What is held in both hands is made about the line through them: `k` along it from the right hand (the muzzle
// ahead), `v` up from it as the gun is levelled (its sights up, its trigger down), `s` out to the figure's left.
// (Its section, v and s, heroic as every weapon: WK.)
const WALNUT = 0x5a3e28, BIRCH = 0x8a6238, BRASS = 0xb8923a, BLUED = 0x3c4048, POLYMER = 0x232527, STRAP = 0x4a3826, CANVAS = 0x7c7a58, BRIGHT = 0xb4b6ba;
type Station = readonly [k: number, lo: number, hi: number, half: number];
function smith(hR: THREE.Vector3, hL: THREE.Vector3, t: Tag) {
  const u = hL.clone().sub(hR).normalize(), side = V(1, 0, 0).addScaledVector(u, -u.x).normalize(), top = u.clone().cross(side), K = WK;
  const at = (k: number, v = 0, s = 0) => hR.clone().addScaledVector(u, k).addScaledVector(top, v * K).addScaledVector(side, s * K);
  // (A solid through four-cornered rings, its ends closed, each face flat and turned outward.)
  const solid = (rings: readonly (readonly THREE.Vector3[])[], color: number) => {
    const pos: number[] = [], mid = (ps: readonly THREE.Vector3[]) => ps.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / ps.length);
    const quad = (q: readonly THREE.Vector3[], inside: THREE.Vector3) => {
      const [a, b, c, d] = q as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
      const out = b.clone().sub(a).cross(d.clone().sub(a)).dot(mid(q).sub(inside)) >= 0;
      for (const p of out ? [a, b, c, a, c, d] : [a, c, b, a, d, c]) pos.push(p.x, p.y, p.z);
    };
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = rings[i]!, b = rings[i + 1]!, inside = mid([...a, ...b]);
      for (let j = 0; j < 4; j++) quad([a[j]!, a[(j + 1) % 4]!, b[(j + 1) % 4]!, b[j]!], inside);
      if (i === 0) quad(a, inside);
      if (i + 2 === rings.length) quad(b, inside);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return tag(part(g, color), t);
  };
  // (A beam along the gun: its section at each station, from `lo` to `hi`, `half` wide each way about `s`.)
  const beam = (st: readonly Station[], color: number, s = 0) => solid(st.map(([k, lo, hi, half]) => [at(k, lo, s - half), at(k, hi, s - half), at(k, hi, s + half), at(k, lo, s + half)]), color);
  // (A post from one point of the gun's upright plane to another (k, v), `th` thick each way in it: a grip, a magazine.)
  const post = (pts: readonly (readonly [number, number])[], th: number, half: number, color: number, s = 0) => solid(pts.map(([k, v], i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, d = at(b[0], b[1]).sub(at(a[0], a[1])).normalize(), n = d.cross(side).normalize().multiplyScalar(th * K);
    const c = at(k, v, s), l = side.clone().multiplyScalar(half * K);
    return [c.clone().sub(n).sub(l), c.clone().add(n).sub(l), c.clone().add(n).add(l), c.clone().sub(n).add(l)];
  }), color);
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, n: number, color: number) => tag(seg(a, b, r0 * K, r1 * K, n, color), t);
  // (A drum: a closed cylinder about `axis`.)
  const drum = (c: THREE.Vector3, axis: THREE.Vector3, r: number, h: number, n: number, color: number) =>
    tag(part(new THREE.CylinderGeometry(r * K, r * K, h * K, n), color, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis), V(1, 1, 1))), t);
  // (A bayonet's blade: flat, its edges up and down.)
  const knife = (k0: number, k1: number, v: number, w: number, s = 0) => {
    const a = at(k0, v, s), b = at(k1, v, s), e = top.clone().multiplyScalar(w * K), l = side.clone().multiplyScalar(0.0035 * K), m = a.clone().lerp(b, 0.78);
    return solid([[a.clone().sub(e).sub(l), a.clone().add(e).sub(l), a.clone().add(e).add(l), a.clone().sub(e).add(l)], [m.clone().sub(e).sub(l), m.clone().add(e).sub(l), m.clone().add(e).add(l), m.clone().sub(e).add(l)],
      [b.clone().sub(l.clone().multiplyScalar(0.2)), b.clone().add(e.clone().multiplyScalar(0.15)), b.clone().add(l.clone().multiplyScalar(0.2)), b.clone().sub(e.clone().multiplyScalar(0.15))]], BRIGHT);
  };
  return { at, beam, post, tube, drum, knife, side, top };
}
function firearm(kind: Gun, hR: THREE.Vector3, hL: THREE.Vector3, t: Tag): THREE.BufferGeometry[] {
  const { at, beam, post, tube, drum, knife, side, top } = smith(hR, hL, t);
  const band = (k: number, lo: number, hi: number, half: number, color: number, len = 0.014) => beam([[k, lo, hi, half], [k + len, lo, hi, half]], color);
  const sling = (k0: number, v0: number, k1: number, v1: number, color: number) => beam([[k0, v0 - 0.006, v0, 0.005], [(k0 + k1) / 2, (v0 + v1) / 2 - 0.016, (v0 + v1) / 2 - 0.01, 0.005], [k1, v1 - 0.006, v1, 0.005]], color);
  switch (kind) {
    // (A flintlock: a fish-tailed butt, the lock and its cock on the right, brass furniture, the ramrod under the
    // barrel, a socket bayonet off to the side of the muzzle.)
    case 'musket': return [
      beam([[-0.25, -0.064, 0.004, 0.011], [-0.09, -0.016, 0.011, 0.011], [0.04, -0.014, 0.011, 0.011], [0.44, -0.01, 0.006, 0.009]], WOOD),
      tube(at(-0.06, 0.017), at(0.6, 0.014), 0.0078, 0.0066, 4, METAL),
      beam([[-0.045, -0.004, 0.016, 0.003], [0.035, -0.002, 0.013, 0.003]], IRON, -0.0125),
      beam([[-0.042, 0.016, 0.036, 0.003], [-0.02, 0.022, 0.05, 0.003]], IRON, -0.011),
      beam([[-0.055, -0.031, -0.025, 0.004], [0.02, -0.03, -0.024, 0.004]], BRASS),
      band(0.19, -0.013, 0.025, 0.012, BRASS), band(0.37, -0.011, 0.023, 0.011, BRASS),
      tube(at(0.05, -0.018), at(0.48, -0.013), 0.003, 0.003, 3, BRIGHT),
      tube(at(0.575, 0.014, 0), at(0.575, 0.014, -0.016), 0.004, 0.004, 3, BRIGHT), tube(at(0.57, 0.014, -0.016), at(0.8, 0.014, -0.016), 0.0052, 0.0008, 3, BRIGHT),
    ];
    // (A percussion rifle: a slimmer, darker stock, iron bands, a hammer, a leaf sight, a sling, a long sword bayonet.)
    case 'rifle': return [
      beam([[-0.23, -0.05, 0.006, 0.01], [-0.08, -0.015, 0.011, 0.01], [0.04, -0.013, 0.011, 0.01], [0.41, -0.009, 0.007, 0.008]], WALNUT),
      tube(at(-0.05, 0.016), at(0.55, 0.013), 0.0072, 0.006, 4, BLUED),
      beam([[-0.04, 0.01, 0.03, 0.003], [-0.018, 0.016, 0.044, 0.003]], IRON, -0.01),
      beam([[-0.05, -0.029, -0.024, 0.0035], [0.015, -0.028, -0.023, 0.0035]], IRON),
      band(0.16, -0.012, 0.023, 0.011, IRON), band(0.3, -0.011, 0.022, 0.0105, IRON), band(0.4, -0.01, 0.021, 0.01, IRON),
      beam([[0.07, 0.022, 0.034, 0.003], [0.082, 0.022, 0.03, 0.003]], IRON),
      sling(-0.17, -0.046, 0.3, -0.012, STRAP),
      beam([[0.5, -0.016, 0.004, 0.006], [0.515, -0.016, 0.004, 0.006]], BRASS), knife(0.515, 0.8, -0.006, 0.0085),
    ];
    // (A bolt-action rifle: a pistol-gripped stock, wood over the barrel almost to the muzzle, the bolt's handle
    // out to the right, a box magazine, a knife bayonet.)
    case 'boltRifle': return [
      beam([[-0.22, -0.05, 0.004, 0.011], [-0.1, -0.022, 0.008, 0.011], [-0.05, -0.027, 0.01, 0.011], [0, -0.014, 0.014, 0.011], [0.42, -0.011, 0.021, 0.0095]], BIRCH),
      beam([[-0.065, 0.01, 0.026, 0.0065], [0.045, 0.014, 0.027, 0.0065]], BLUED),
      tube(at(-0.03, 0.019, -0.005), at(-0.04, 0.002, -0.03), 0.0035, 0.0035, 3, BRIGHT), drum(at(-0.042, -0.002, -0.032), side, 0.007, 0.012, 4, BRIGHT),
      beam([[0.008, -0.031, -0.014, 0.007], [0.052, -0.028, -0.014, 0.007]], BLUED),
      band(0.25, -0.013, 0.022, 0.011, BLUED), band(0.405, -0.012, 0.023, 0.0105, BLUED, 0.02),
      tube(at(0.42, 0.012), at(0.5, 0.012), 0.0066, 0.006, 4, BLUED),
      sling(-0.16, -0.045, 0.25, -0.013, CANVAS),
      knife(0.44, 0.67, -0.008, 0.008),
    ];
    // (A self-loading rifle: a half stock, the receiver bare on top, the barrel and its gas cylinder out ahead
    // of the wood, a hooded foresight, a short bayonet.)
    case 'selfLoader': return [
      beam([[-0.2, -0.048, 0.004, 0.011], [-0.09, -0.02, 0.01, 0.011], [-0.04, -0.027, 0.012, 0.011], [0.02, -0.016, 0.013, 0.012], [0.27, -0.012, 0.012, 0.01]], WOOD),
      beam([[-0.075, 0.012, 0.028, 0.0072], [0.1, 0.013, 0.027, 0.0072]], BLUED),
      beam([[0.1, 0.012, 0.025, 0.008], [0.3, 0.012, 0.023, 0.007]], WOOD),
      tube(at(0.27, 0.017), at(0.5, 0.017), 0.006, 0.0056, 4, BLUED), tube(at(0.27, 0.003), at(0.465, 0.005), 0.0052, 0.0052, 3, BLUED),
      band(0.452, -0.004, 0.025, 0.007, BLUED), beam([[0.474, 0.022, 0.038, 0.0045], [0.49, 0.022, 0.038, 0.0045]], BLUED),
      sling(-0.15, -0.044, 0.24, -0.012, CANVAS),
      knife(0.47, 0.6, -0.004, 0.0075),
    ];
    // (A submachine gun: a short wooden butt and fore-end, a pistol grip, a drum under the receiver, a stubby
    // barrel in its cooling jacket.)
    case 'smg': return [
      beam([[-0.2, -0.05, 0, 0.01], [-0.07, -0.012, 0.016, 0.01]], WALNUT),
      beam([[-0.085, 0, 0.03, 0.009], [0.15, 0.004, 0.03, 0.009]], BLUED),
      post([[0.002, 0.004], [-0.018, -0.046]], 0.011, 0.008, WALNUT),
      beam([[0.08, -0.016, 0.006, 0.0105], [0.21, -0.012, 0.008, 0.0095]], WALNUT),
      drum(at(0.045, -0.03), side, 0.034, 0.022, 7, BLUED),
      tube(at(0.15, 0.018), at(0.3, 0.018), 0.0062, 0.0062, 4, BLUED), tube(at(0.2, 0.018), at(0.34, 0.018), 0.0098, 0.0098, 5, IRON),
      beam([[0.12, 0.03, 0.04, 0.003], [0.132, 0.03, 0.04, 0.003]], BLUED),
    ];
    // (An assault rifle: wooden butt, grip and handguard about a stamped receiver, a long curved magazine, the
    // gas tube over the barrel, a foresight post, a short bayonet.)
    case 'assaultRifle': return [
      beam([[-0.21, -0.046, 0.006, 0.009], [-0.065, -0.004, 0.02, 0.009]], BIRCH),
      beam([[-0.075, 0, 0.029, 0.008], [0.1, 0.002, 0.029, 0.008]], BLUED),
      post([[0.002, 0.004], [-0.02, -0.046]], 0.01, 0.007, BIRCH),
      post([[0.05, 0.002], [0.06, -0.045], [0.082, -0.085]], 0.012, 0.0055, IRON),
      beam([[0.1, -0.01, 0.025, 0.0092], [0.24, -0.008, 0.023, 0.0085]], BIRCH),
      tube(at(0.24, 0.011), at(0.43, 0.011), 0.006, 0.006, 4, BLUED), tube(at(0.24, 0.025), at(0.345, 0.025), 0.0042, 0.0042, 3, BLUED),
      beam([[0.335, 0.011, 0.04, 0.003], [0.35, 0.011, 0.04, 0.003]], BLUED),
      knife(0.4, 0.53, -0.002, 0.007),
    ];
    // (A silenced carbine: black throughout, a sliding butt on its tube, a straight magazine, a railed handguard
    // with a grip under it, a sight on top, the fat silencer ahead.)
    case 'carbine': return [
      tube(at(-0.17, 0.016), at(-0.055, 0.016), 0.006, 0.006, 4, IRON), beam([[-0.195, -0.032, 0.03, 0.007], [-0.16, -0.02, 0.03, 0.007]], POLYMER),
      beam([[-0.06, 0, 0.031, 0.0082], [0.08, 0, 0.031, 0.0082]], POLYMER),
      post([[0.002, 0.004], [-0.016, -0.045]], 0.01, 0.007, POLYMER),
      post([[0.045, 0.002], [0.056, -0.062]], 0.011, 0.0055, IRON),
      beam([[0.08, 0.001, 0.031, 0.0088], [0.24, 0.003, 0.029, 0.0088]], IRON),
      post([[0.155, 0.002], [0.152, -0.04]], 0.008, 0.007, POLYMER),
      beam([[-0.012, 0.031, 0.054, 0.0062], [0.05, 0.031, 0.054, 0.0062]], 0x34383a),
      tube(at(0.24, 0.016), at(0.29, 0.016), 0.0052, 0.0052, 4, BLUED), tube(at(0.285, 0.016), at(0.42, 0.016), 0.0105, 0.0105, 6, POLYMER),
    ];
    // (A light machine gun: a wooden butt, a deep receiver with the pan of cartridges flat on top, the barrel in
    // a fat cooling jacket, a bipod's legs folded back under it.)
    case 'mg': return [
      beam([[-0.23, -0.052, 0.01, 0.01], [-0.085, -0.008, 0.022, 0.01]], WALNUT),
      beam([[-0.09, -0.005, 0.031, 0.0105], [0.1, -0.004, 0.031, 0.0105]], GUNMETAL),
      post([[0.002, 0.002], [-0.018, -0.046]], 0.011, 0.008, WALNUT),
      drum(at(0.03, 0.04), top, 0.042, 0.016, 8, IRON),
      tube(at(0.1, 0.014), at(0.43, 0.014), 0.0145, 0.0145, 6, IRON), tube(at(0.42, 0.014), at(0.48, 0.014), 0.007, 0.0085, 4, GUNMETAL),
      band(0.36, -0.002, 0.03, 0.016, GUNMETAL, 0.012),
      tube(at(0.366, -0.004, -0.012), at(0.2, -0.01, -0.016), 0.0038, 0.0038, 3, GUNMETAL), tube(at(0.366, -0.004, 0.012), at(0.2, -0.01, 0.016), 0.0038, 0.0038, 3, GUNMETAL),
    ];
  }
}
// A crossbow, spanned and loaded: the tiller, its long trigger lever underneath, the steel bow across its
// front (bent back to the string), the string drawn to the nut, the bolt on top, a stirrup at the nose.
function crossbow(hR: THREE.Vector3, hL: THREE.Vector3, t: Tag): THREE.BufferGeometry[] {
  const { at, beam, tube } = smith(hR, hL, t);
  // (The bow just ahead of the left hand, at the chest as it is carried.)
  const N = 0.215, bow: readonly (readonly [number, number])[] = [[N, 0], [N - 0.008, 0.06], [N - 0.03, 0.112], [N - 0.063, 0.152]], tip = bow[bow.length - 1]!, NUT = 0.03, STRING = 0xd8d0c0;
  return [
    beam([[-0.27, -0.034, 0.006, 0.01], [-0.1, -0.015, 0.012, 0.01], [N + 0.015, -0.01, 0.012, 0.009]], WOOD),
    beam([[-0.2, -0.038, -0.033, 0.003], [-0.03, -0.022, -0.017, 0.003]], IRON),
    ...[1, -1].flatMap((sd) => [
      ...bow.slice(1).map((p, i) => tube(at(bow[i]![0], 0.002, sd * bow[i]![1]), at(p[0], 0.002, sd * p[1]), 0.0068 - i * 0.001, 0.0058 - i * 0.001, 3, METAL)),
      tube(at(tip[0], 0.004, sd * tip[1]), at(NUT, 0.015, 0), 0.002, 0.002, 3, STRING),
    ]),
    tube(at(NUT, 0.017), at(N + 0.025, 0.017), 0.003, 0.003, 3, BIRCH), tube(at(N + 0.02, 0.017), at(N + 0.06, 0.017), 0.0062, 0.0006, 3, METAL),
    tube(at(N + 0.015, 0, -0.018), at(N + 0.06, 0, -0.016), 0.003, 0.003, 3, IRON), tube(at(N + 0.015, 0, 0.018), at(N + 0.06, 0, 0.016), 0.003, 0.003, 3, IRON), tube(at(N + 0.06, 0, -0.019), at(N + 0.06, 0, 0.019), 0.003, 0.003, 3, IRON),
  ];
}

// The shield on the left forearm, its face painted (team), standing
// forward: a flat polygon (both faces drawn) and its boss.
// (`t`: how it moves, with the arm.)
// (`k`: larger, about where it is held (heroic proportions).)
function shieldOf(s: Shield, hand: THREE.Vector3, t: Tag = {}, k = 1): THREE.BufferGeometry[] {
  // (In front of the fingers that grip it.)
  const at: Tf = { x: hand.x - 0.02, y: hand.y + 0.02, z: hand.z + 0.062 };
  const o = new THREE.Vector3(at.x, at.y, at.z), m = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
  return shieldShape(s, at, t).map((g) => (k === 1 ? g : g.applyMatrix4(m)));
}
function shieldShape(s: Shield, at: Tf, t: Tag): THREE.BufferGeometry[] {
  const face: Tag = { ...t, team: true };
  // (A round or oval shield dished, as they were made: its face (painted)
  // rising from the rim to the boss at its middle, a dark rim round its
  // edge (rawhide or iron); a flat one (a kite) a board with an edge.)
  const boss = (z = 0.008) => lp(gem([at.x ?? 0, at.y ?? 0, (at.z ?? 0) + z], [0.032, 0.032, 0.022], METAL, 6, [Math.PI / 2, 0, 0]), {}, t);
  const dished = (r: number, sy = 1, n = 8) => {
    const o = { turn: Math.PI / n, caps: [false, false] as const }, up = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2);
    return [mapFlat(lp(up(hull([R([0, 0, 0], r, r * sy), R([0, 0.016, 0], r * 0.62, r * 0.62 * sy), R([0, 0.024, 0], 0, 0)], n, PAINT, o)), at, face), 'round'),
      lp(up(hull([R([0, -0.006, 0], r * 1.03, r * sy * 1.03), R([0, 0.004, 0], r * 1.03, r * sy * 1.03)], n, RIM, o)), at, t), boss(0.02)];
  };
  switch (s) {
    case 'round': return dished(0.16);
    case 'big round': return dished(0.2);
    case 'small': return dished(0.11);
    case 'oval': return dished(0.12, 1.6);
    case 'scutum': return [mapFlat(shape(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 3, 1, true, -0.62, 1.24).rotateY(Math.PI), PAINT, { ...at, z: (at.z ?? 0) + 0.18, y: (at.y ?? 0) - 0.02 }, face), 'tall'), boss()];
    case 'pavise': return [mapFlat(box(0.26, 0.46, 0.025, PAINT, { ...at, y: (at.y ?? 0) - 0.03 }, face), 'tall')];
    case 'kite': return [mapFlat(lp(plate([[-0.12, 0.14], [0, 0.155], [0.12, 0.14], [0.11, -0.03], [0.06, -0.17], [0, -0.29], [-0.06, -0.17], [-0.11, -0.03]], PAINT, 0.012), at, face), 'kite'), boss()];
  }
}

// Helmets and headgear, on a head at HEAD_Y: shells over the head's own
// five-sided rings (people.ts headShell), so the head never shows through.
export const helmetModel = (h: Helmet): THREE.BufferGeometry[] => helmetOf(h);
// (Heroic: as large as the head it sits on, about the neck: people.ts heroicHead.)
const helmetOf = (h: Helmet): THREE.BufferGeometry[] => headgear(h).map((g) => heroicHead(g));
function headgear(h: Helmet): THREE.BufferGeometry[] {
  const Y = HEAD_Y;
  const shell = (levels: readonly (readonly [number, number])[], color: number, t?: Tag) => lp(headShell(levels, color), {}, t);
  // (A dome: the rim at the brow, round over the crown to a low point.)
  const DOME = [[-0.004, 1.16], [0.07, 1.3], [0.098, 0]] as const;
  const brim = (r: number, color: number, dy = 0) => lp(plate(Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * r, Math.sin(i * Math.PI / 3) * r] as const), color), { y: Y + dy, rx: -Math.PI / 2 });
  switch (h) {
    // (A crested helmet with cheek guards hanging beside the face.)
    case 'crest': return [shell(DOME, METAL), lp(plate([[-0.085, 0], [0.085, 0], [0.07, 0.075], [-0.07, 0.075]], PAINT), { y: Y + 0.085, ry: Math.PI / 2 }, { team: true }),
      ...[1, -1].map((s) => lp(plate([[-0.022, 0], [0.026, 0], [0.018, -0.055], [-0.012, -0.05]], METAL, 0.004), { x: s * 0.071, y: Y - 0.002, z: 0.022, ry: s * Math.PI / 2 }))];
    case 'cone': return [shell([[-0.004, 1.16], [0.07, 1.25], [0.17, 0]], METAL), lp(plate([[-0.006, 0], [0.006, 0], [0.006, -0.05], [-0.006, -0.05]], METAL), { y: Y + 0.005, z: 0.084 })];
    case 'kettle': return [shell(DOME, METAL), brim(0.135, METAL, 0.002)];
    case 'hat': return [shell([[0.0, 1.18], [0.07, 1.3], [0.12, 0]], 0xb8a070), brim(0.17, 0xb8a070, 0.006)];
    case 'feather': return [shell([[0.0, 1.14], [0.045, 1.14]], PAINT, { team: true }),
      ...[-0.05, -0.025, 0, 0.025, 0.05].map((x) => lp(plate([[-0.01, 0], [0.01, 0], [0, 0.16]], x === 0 ? 0xd8b440 : 0x3a8a6a), { x, y: Y + 0.04, z: -0.05, rz: -x * 3 }))];
    case 'turban': return [shell([[-0.004, 1.2], [0.03, 1.32], [0.075, 1.38], [0.105, 0]], 0xece6d6)];
    case 'cap': return [shell([[-0.004, 1.14], [0.07, 1.22], [0.09, 0]], 0xe6dcc4)];
    case 'beret': return [shell([[0.02, 1.16], [0.065, 1.3], [0.085, 0]], PAINT, { team: true })];
    case 'none': return [];
  }
}

// A rider on his horse (creatures.ts; the horse's legs swing in diagonal
// pairs), by style: a horseman's (a short spear and a small shield), a
// knight's (a couched lance, the horse in a long cloth, a helmet whatever
// the civ wears), a lancer's (a long lance with a pennant in the owner's
// colour, a plumed helmet), a cavalryman's (a sabre), a commander's (a cape
// and a plume in the owner's colour, no weapon).
export const HORSE_SCALE = 0.58;
const SEAT = 1.47 * HORSE_SCALE + 0.02;
type RiderStyle = 'horseman' | 'knight' | 'lancer' | 'cavalry' | 'officer';
const HEAVY_HELMET = (h: Helmet): Helmet => (h === 'none' || h === 'cap' || h === 'turban' || h === 'feather' || h === 'hat' ? 'kettle' : h);
// The horse (creatures.ts), turned to face +z, scaled, its coat painted
// (the creature's leaf parts), its legs swinging; `cloth`: the saddle cloth.
function mount(coat: number, cloth: boolean): THREE.BufferGeometry[] {
  const h = horseParts();
  const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(HORSE_SCALE, HORSE_SCALE, HORSE_SCALE));
  const paint = (g: THREE.BufferGeometry) => { coatIt(g, coat); return g.applyMatrix4(m); };
  const LEG_TOP = 1.05 * HORSE_SCALE, HORSE_LEG = (side: number) => [side, LEG_TOP, 0.4] as const;
  return [
    ...h.body.map((g) => tag(paint(g))),
    tag(paint(h.legs.fl), { limb: HORSE_LEG(1) }), tag(paint(h.legs.fr), { limb: HORSE_LEG(-1) }),
    tag(paint(h.legs.hl), { limb: HORSE_LEG(-1) }), tag(paint(h.legs.hr), { limb: HORSE_LEG(1) }),
    ...(cloth ? [shape(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 4, 1, true, -1.2, 2.4).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), CLOTH, { y: SEAT - 0.17, z: 0.02 }, { team: true })] : []),
  ];
}
function rider(gear: Gear, coat: number, female: boolean, style: RiderStyle): THREE.BufferGeometry[] {
  const heavy = style === 'knight';
  const out: THREE.BufferGeometry[] = [...mount(coat, !heavy), box(0.16, 0.05, 0.22, LEATHER, { y: SEAT - 0.03, z: 0.02 })];
  const dress: Dress = { fine: FINE, heroic: true, broad: true, female, legs: gear.legs, sleeves: 'long', painted: FINE, civ: CIV, undyed: LINEN, ...(heavy || style === 'lancer' ? { armor: 'plate' as const } : {}) };
  const armR: ArmPose = HOLD, armL: ArmPose = HOLD;
  // (The weapon arm strikes with its weapon: the same swing, bent at the same elbow.)
  const amp = style === 'officer' ? 0.6 : REACH, strike = HIT(SEAT + 0.3, amp);
  out.push(...tagged(riderBody(dress, SEAT, armL, armR, style === 'officer' ? undefined : strike)));
  const hR = handAt(-1, armR, female).add(V(0, SEAT - HIP, 0)), hL = handAt(1, armL, female).add(V(0, SEAT - HIP, 0)), eR = elbowAt(-1, armR, female).add(V(0, SEAT - HIP, 0));
  // (Turned in the hand to point as aimed (a lance couched as it charges), from how it is carried.)
  const rest = style === 'knight' || style === 'lancer' ? Math.atan2(0.75, 0.55) : style === 'cavalry' ? Math.atan2(0.18, 0.42) : Math.atan2(0.3, 0.7);
  const w: Tag = { limb: strike, joint: [eR.y, eR.z], grip: [hR.y, hR.z, rest] };
  const plume = (dy: number) => box(0.024, 0.11, 0.15, PAINT, { y: SEAT - HIP + HEAD_Y + 0.12 + dy }, { team: true });
  const lance = (len: number) => {
    const tip = hR.clone().add(V(0, 0.55, 0.75).multiplyScalar(len));
    return [rod(hR.clone().add(V(0, -0.15, -0.35)), tip, 0.011, 0.009, 5, WOOD, w), point(0.1, 0.02, 3, METAL, { x: tip.x, y: tip.y, z: tip.z, rx: 1.0 }, w)];
  };
  arming(true);
  switch (style) {
    case 'officer': out.push(lp(plate([[-0.12, 0.2], [0.12, 0.2], [0.14, -0.2], [-0.14, -0.2]], CLOTH), { y: SEAT + 0.12, z: -0.11, rx: 0.12 }, { team: true }), plume(gear.helmet === 'none' ? -0.03 : 0.04)); break;
    // (A sabre: one curved blade, a knuckle-guarded hilt.)
    case 'cavalry': out.push(...hilt(hR.clone(), V(0, 0.42, 0.18), 0.035, METAL, w), sabre(hR, w)); break;
    case 'knight': out.push(...lance(1), tag(caparison(), { team: true })); break;
    case 'lancer': {
      // (The pennant just below the lance's head.)
      out.push(...lance(1.25));
      const at = hR.clone().add(V(0, 0.55, 0.75).multiplyScalar(1.12));
      out.push(lp(plate([[0, 0], [0, -0.08], [-0.16, -0.04]], PAINT), { x: at.x, y: at.y, z: at.z, ry: Math.PI / 2 }, { ...w, team: true }),
        lp(plate([[-0.05, 0], [0.06, 0], [0.03, 0.06], [-0.07, 0.05]], PAINT), { y: RIDER_HEAD + HEAD_Y + 0.085, ry: Math.PI / 2 }, { team: true }));
      break;
    }
    case 'horseman':
      // (A short spear held high, a small shield on the rein arm.)
      out.push(rod(hR.clone().add(V(0, -0.2, -0.1)), hR.clone().add(V(0, 0.5, 0.2)), 0.011, 0.01, 4, WOOD, w), point(0.08, 0.02, 3, METAL, { x: hR.x, y: hR.y + 0.5, z: hR.z + 0.2, rx: 0.4 }, w),
        ...shieldOf('small', hL, {}, HEROIC.shield));
      break;
  }
  arming(false);
  const helmet = heavy || style === 'lancer' ? HEAVY_HELMET(gear.helmet) : gear.helmet;
  out.push(...helmetOf(helmet).map((g) => g.translate(0, RIDER_HEAD, 0)));
  return out;
}
// A horse archer: a rider (no lance) with a short bow raised, a quiver.
function horseArcher(gear: Gear, coat: number, female: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [...mount(coat, true), box(0.16, 0.05, 0.22, LEATHER, { y: SEAT - 0.03, z: 0.02 })];
  const armR: ArmPose = HOLD, armL: ArmPose = RAISE;
  const raise = HIT(SEAT + 0.3, 0.8), eL = elbowAt(1, armL, female).add(V(0, SEAT - HIP, 0));
  out.push(...tagged(riderBody({ fine: FINE, heroic: true, broad: true, female, legs: gear.legs, sleeves: 'long', painted: FINE, civ: CIV, undyed: LINEN }, SEAT, armL, armR, undefined, raise)));
  arming(true);
  const g = handAt(1, armL, female).add(V(0, SEAT - HIP, 0)), up: Tag = { limb: raise, joint: [eL.y, eL.z] };
  out.push(rod(g, g.clone().add(V(0, 0.26, -0.05)), 0.01, 0.007, 3, 0x5a3a22, up), rod(g, g.clone().add(V(0, -0.26, -0.05)), 0.01, 0.007, 3, 0x5a3a22, up), rod(g.clone().add(V(0, 0.26, -0.05)), g.clone().add(V(0, -0.26, -0.05)), 0.003, 0.003, 3, 0xd8d0c0, up),
    lp(hull([R([0, 0, 0], 0.03), R([0, 0.26, 0], 0.034)], 4, LEATHER, { caps: [true, false] }), { x: 0.12, y: SEAT - 0.1, z: -0.12, rz: -0.3 }));
  arming(false);
  out.push(...helmetOf(gear.helmet).map((h) => h.translate(0, RIDER_HEAD, 0)));
  return out;
}
// A chariot archer: the horse in the shafts, the two-wheeled car behind it
// (its front painted in the owner's colour), the archer standing in it, his
// bow raised (still: a figure stood back from its pivots can't swing).
const CAR_Z = -0.86, CAR_FLOOR = 0.3;
function chariot(gear: Gear, coat: number, female: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [...mount(coat, false),
    lp(plate([[-0.23, -0.18], [0.23, -0.18], [0.23, 0.18], [-0.23, 0.18]], WOOD), { y: CAR_FLOOR, z: CAR_Z, rx: -Math.PI / 2 }), lp(plate([[-0.23, 0], [0.23, 0], [0.2, 0.26], [-0.2, 0.26]], PAINT), { y: CAR_FLOOR, z: CAR_Z + 0.18 }, { team: true }),
    ...[1, -1].flatMap((s) => [lp(plate([[-0.18, 0], [0.18, 0], [0.18, 0.18], [-0.18, 0.18]], WOOD), { x: s * 0.22, y: CAR_FLOOR, z: CAR_Z, ry: Math.PI / 2 }),
      lp(plate(Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * 0.27, Math.sin(i * Math.PI / 3) * 0.27] as const), 0x5a4028), { x: s * 0.28, y: 0.27, z: CAR_Z, ry: Math.PI / 2 }, wheelSpin(0.27, CAR_Z)),
      rod(V(s * 0.16, CAR_FLOOR + 0.1, CAR_Z + 0.18), V(s * 0.17, 0.62, 0.25), 0.014, 0.014, 3, WOOD)]),
  ];
  const archer = figure(gear, 'bow', false, { female, still: true, quiver: true });
  // (Still in the car: nothing swings, nor turns in the hand (the bow kept
  // raised as it is made, not aimed); its other flags kept.)
  for (const g of archer) {
    const a = (g.getAttribute('aLimb') as THREE.BufferAttribute).array;
    for (let i = 0; i < a.length; i += 4) { a.fill(0, i, i + 3); if (Math.floor(a[i + 3]! / RIG.grip) % 2) a[i + 3]! -= RIG.grip; }
    g.translate(0, CAR_FLOOR, CAR_Z);
  }
  return [...out, ...archer];
}
// The knight's horse in its caparison: a cloth laid over its back,
// following its body (a little out from it), hanging down its flanks to
// the knees, open below; a darker band at its hem.
function caparison(): THREE.BufferGeometry {
  const S = HORSE_SCALE, keys = [[-0.8, 1.15, 0.3, 0.25], [-0.5, 1.15, 0.36, 0.29], [0.2, 1.1, 0.39, 0.3], [0.62, 1.15, 0.32, 0.24]] as const;
  const A = 6, pos: number[] = [], col: number[] = [], idx: number[] = [], c = new THREE.Color(CLOTH), hem = new THREE.Color(0x707070);
  keys.forEach(([x, y, a, b]) => {
    for (let j = 0; j <= A; j++) {
      const th = -1.95 + (3.9 * j) / A, drop = Math.max(0, Math.abs(th) - 1.3) * 0.5;
      // (Facing +z: the horse's length along z, its sides along x.)
      pos.push(Math.sin(th) * b * 1.12 * S, (y + Math.cos(th) * a * 1.12 - drop) * S, x * S);
      const k = Math.abs(th) > 1.5 ? hem : c;
      col.push(k.r, k.g, k.b);
    }
  });
  for (let i = 0; i < keys.length - 1; i++) for (let j = 0; j < A; j++) { const p = i * (A + 1) + j, q = p + A + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}
// (A creature's coat, its leaf-marked vertices, painted a colour.)
function coatIt(g: THREE.BufferGeometry, coat: number): void {
  const mask = g.getAttribute('leafMask'), col = g.getAttribute('color') as THREE.BufferAttribute, c = new THREE.Color(coat);
  if (!mask) return;
  for (let i = 0; i < col.count; i++) if (mask.getX(i) > 0.5) col.setXYZ(i, c.r * col.getX(i), c.g * col.getY(i), c.b * col.getZ(i));
  g.deleteAttribute('leafMask');
}

// ---- machines ----
// Guns and tanks: no one walks, no skin or hair; a little of the owner's
// colour on the carriage or hull. About a figure's height, longer. Built
// from a small kit (spoked and tyred wheels, tracks with their road wheels,
// barrels with their rings, plates cut to a side's profile), as the ships
// are from theirs; `FINE` off (seen from afar), the small parts are left out.
const IRON = 0x4a4d52, GUNMETAL = 0x2e3034, OLIVE = 0x5d6248, OLIVE_DARK = 0x474b38, TYRE = 0x1c1c1e, TRACK = 0x26272a, RUNNER = 0x3c4036, GLASS = 0x1c2a33, ROPE = 0xb7a070, BRONZE = 0x8c6a36;
// A plate or a block cut to a side's profile ([z, y] corners), `w` wide, its middle at x.
const slab = (pts: readonly (readonly [number, number])[], w: number, color: number, x = 0, t?: Tag) =>
  shape(new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), { depth: w, bevelEnabled: false }).rotateY(-Math.PI / 2), color, { x: x + w / 2 }, t);
// A drum across the model (its axle along x) at (x, y, z).
const drum = (x: number, y: number, z: number, r: number, w: number, n: number, color: number, t?: Tag) => shape(new THREE.CylinderGeometry(r, r, w, n), color, { x, y, z, rz: Math.PI / 2 }, t);
// A spoked wheel on the ground at x (its axle along x, at z): a felloe, eight spokes, a hub; it turns as the piece moves.
function spoked(x: number, r: number, z = 0, color = WOOD, w = 0.05): THREE.BufferGeometry[] {
  const t = wheelSpin(r, z);
  if (!FINE) return [drum(x, r, z, r, w, 8, color, t)];
  const rim = new THREE.LatheGeometry([[0.8 * r, -w / 2], [r, -w / 2], [r, w / 2], [0.8 * r, w / 2], [0.8 * r, -w / 2]].map(([a, b]) => new THREE.Vector2(a, b)), 10);
  return [
    shape(rim, color, { x, y: r, z, rz: Math.PI / 2 }, t),
    ...[0, 1, 2, 3].map((k) => box(w * 0.45, 1.64 * r, 0.16 * r, color, { x, y: r, z, rx: (k * Math.PI) / 4 }, t)),
    drum(x, r, z, 0.2 * r, w * 1.7, 6, IRON, t),
  ];
}
// A tyred wheel: the tyre, its steel disc a little proud of it.
const tyred = (x: number, r: number, z = 0, w = 0.09, disc = OLIVE_DARK): THREE.BufferGeometry[] =>
  [drum(x, r, z, r, w, 10, TYRE, wheelSpin(r, z)), ...(FINE ? [drum(x, r, z, 0.55 * r, w + 0.014, 6, disc, wheelSpin(r, z))] : [])];
// A track: its loop (`len` long, `h` high, `w` wide, at x; its ends raised off the ground), and on its outer
// side the road wheels along the ground and the two end wheels.
function track(x: number, len: number, h: number, w: number, z = 0, roads = 5): THREE.BufferGeometry[] {
  const L = len / 2, out = Math.sign(x) * (w / 2 + 0.006);
  const loop = slab([[-L + 0.14, 0], [L - 0.16, 0], [L, 0.55 * h], [L - 0.08, h], [-L + 0.08, h], [-L, 0.6 * h]].map(([a, b]) => [a! + z, b!] as const), w, TRACK, x);
  if (!FINE) return [loop];
  const r = 0.3 * h, wheel = (zz: number, y: number, k: number) => shape(new THREE.CircleGeometry(k, 8), RUNNER, { x: x + out, y, z: zz + z, ry: Math.sign(x) * Math.PI / 2 }, wheelSpin(y, zz + z));
  return [loop, ...Array.from({ length: roads }, (_, i) => wheel(-L + 0.2 + (i * (len - 0.44)) / (roads - 1), r + 0.01, r)), wheel(L - 0.1, 0.62 * h, 0.26 * h), wheel(-L + 0.1, 0.64 * h, 0.26 * h)];
}
// A gun's barrel from its breech end `at`, `len` long, raised `up` (radians) and tapering from r0 to r1: the tube,
// and where along it (and how thick) its rings, muzzle swell or brake go (`rings`: [share of its length, radius, length]).
function barrel(at: THREE.Vector3, len: number, up: number, r0: number, r1: number, color: number, rings: readonly (readonly [number, number, number])[] = [], n = 8, t?: Tag): THREE.BufferGeometry[] {
  const d = V(0, Math.sin(up), Math.cos(up)), tube = (s: number, l: number, a: number, b: number, sides: number) => { const m = at.clone().addScaledVector(d, s + l / 2); return shape(new THREE.CylinderGeometry(b, a, l, sides), color, { x: m.x, y: m.y, z: m.z, rx: Math.PI / 2 - up }, t); };
  return [tube(0, len, r0, r1, n), ...(FINE ? rings : rings.slice(-1)).map(([s, r, l]) => tube(s * len - l / 2, l, r, r, n))];
}

// A smoothbore cannon on its field carriage: two spoked wheels, the cheeks of the carriage running back into the
// trail (painted), the barrel between them with its muzzle swell, reinforce and cascabel.
function cannon(): THREE.BufferGeometry[] {
  const cheek = (x: number) => slab([[0.16, 0.3], [0.16, 0.43], [-0.12, 0.41], [-0.8, 0.07], [-0.84, 0], [-0.74, 0], [-0.12, 0.27]], 0.05, PAINT, x, { team: true });
  return [
    ...spoked(0.27, 0.28), ...spoked(-0.27, 0.28), drum(0, 0.28, 0, 0.03, 0.5, 5, IRON),
    cheek(0.1), cheek(-0.1), box(0.16, 0.05, 0.14, WOOD, { y: 0.1, z: -0.66 }),
    ...barrel(V(0, 0.44, -0.24), 0.95, 0.14, 0.1, 0.068, IRON, [[0.02, 0.108, 0.05], [0.42, 0.09, 0.04], [0.97, 0.085, 0.06]]),
    ...(FINE ? [ball(0.055, IRON, { y: 0.432, z: -0.3 }), drum(0, 0.47, 0.04, 0.03, 0.3, 5, IRON), box(0.03, 0.03, 0.34, IRON, { y: 0.2, z: -0.3, rx: 0.5 })] : []),
  ];
}
// A field gun (the artillery): steel-tyred spoked wheels, a box trail to its spade (painted), a shield in two
// folds with the gun through it, the barrel on its cradle with the recoil cylinder under it, the breech behind.
function artillery(): THREE.BufferGeometry[] {
  return [
    ...spoked(0.3, 0.26, 0, GUNMETAL, 0.06), ...spoked(-0.3, 0.26, 0, GUNMETAL, 0.06), drum(0, 0.26, 0, 0.03, 0.56, 5, GUNMETAL),
    slab([[0.1, 0.24], [0.1, 0.36], [-0.2, 0.34], [-0.95, 0.07], [-0.95, 0], [-0.86, 0], [-0.2, 0.22]], 0.16, PAINT, 0, { team: true }),
    box(0.26, 0.16, 0.03, GUNMETAL, { y: 0.02, z: -0.97, rx: 0.4 }),
    box(0.74, 0.34, 0.025, OLIVE, { y: 0.5, z: 0.06, rx: -0.08 }), box(0.74, 0.14, 0.025, OLIVE, { y: 0.73, z: 0.01, rx: -0.6 }),
    ...(FINE ? [box(0.74, 0.12, 0.025, OLIVE, { y: 0.28, z: 0.1, rx: 0.5 })] : []),
    box(0.16, 0.1, 0.5, OLIVE_DARK, { y: 0.45, z: 0.16, rx: -0.2 }),
    ...barrel(V(0, 0.48, -0.26), 1.2, 0.2, 0.062, 0.05, OLIVE, [[0.1, 0.075, 0.2], [0.985, 0.058, 0.04]]),
    ...barrel(V(0, 0.4, 0.0), 0.5, 0.2, 0.04, 0.04, GUNMETAL, [], 6),
    box(0.15, 0.16, 0.14, GUNMETAL, { y: 0.47, z: -0.3, rx: -0.2 }),
    ...(FINE ? [box(0.12, 0.03, 0.12, WOOD, { x: 0.17, y: 0.34, z: -0.34 }), box(0.12, 0.03, 0.12, WOOD, { x: -0.17, y: 0.34, z: -0.34 })] : []),
  ];
}
// A tank of the middle of the century: tracks on their road wheels, fenders over them, a hull with a sloped
// glacis (painted), a cast turret with its mantlet, cupola and hatch, a long gun.
function tank(): THREE.BufferGeometry[] {
  return [
    ...track(0.37, 1.56, 0.3, 0.2), ...track(-0.37, 1.56, 0.3, 0.2),
    box(0.56, 0.2, 1.36, OLIVE_DARK, { y: 0.19 }),
    slab([[-0.74, 0.3], [0.56, 0.3], [0.76, 0.36], [0.44, 0.56], [-0.56, 0.56], [-0.74, 0.47]], 0.6, PAINT, 0, { team: true }),
    ...[1, -1].map((s) => box(0.24, 0.025, 1.5, OLIVE, { x: s * 0.38, y: 0.325 })),
    shape(new THREE.CylinderGeometry(0.2, 0.27, 0.2, 8), OLIVE, { y: 0.66, z: -0.06, sz: 1.35 }),
    box(0.3, 0.16, 0.12, OLIVE_DARK, { y: 0.66, z: 0.3 }),
    ...barrel(V(0, 0.66, 0.34), 0.86, 0, 0.045, 0.036, GUNMETAL, [[0.97, 0.052, 0.07]]),
    ...(FINE ? [
      shape(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 6), OLIVE_DARK, { x: -0.1, y: 0.795, z: -0.12 }),
      box(0.14, 0.02, 0.14, OLIVE_DARK, { x: 0.11, y: 0.77, z: -0.1 }),
      box(0.3, 0.12, 0.16, OLIVE, { y: 0.64, z: -0.42 }),
      box(0.44, 0.02, 0.3, OLIVE_DARK, { y: 0.572, z: -0.4 }),
      rod(V(-0.2, 0.76, -0.3), V(-0.2, 1.1, -0.34), 0.006, 0.004, 3, GUNMETAL),
      box(0.05, 0.05, 0.3, WOOD, { x: 0.39, y: 0.365, z: -0.3 }),
    ] : []),
  ];
}
// A catapult (a mangonel): a timber frame on four plank wheels, uprights braced to it with the padded stop
// across them (painted), the skein of rope the arm is sprung from, the arm cocked back, its cup empty,
// a windlass behind; the arm swings in a fight.
function catapult(): THREE.BufferGeometry[] {
  const arm: Tag = { limb: HIT(0.24, 1.3) };
  const wheel = (s: number, z: number) => [drum(s * 0.29, 0.15, z, 0.15, 0.05, 8, WOOD, wheelSpin(0.15, z)), ...(FINE ? [drum(s * 0.29, 0.15, z, 0.045, 0.07, 5, IRON, wheelSpin(0.15, z))] : [])];
  return [
    ...[1, -1].flatMap((s) => [
      box(0.07, 0.08, 1.06, WOOD, { x: s * 0.22, y: 0.21 }), ...wheel(s, 0.36), ...wheel(s, -0.36),
      rod(V(s * 0.22, 0.24, 0.2), V(s * 0.22, 0.66, 0.18), 0.03, 0.026, 4, WOOD),
      rod(V(s * 0.22, 0.24, 0.5), V(s * 0.22, 0.6, 0.2), 0.02, 0.02, 4, WOOD),
      ...(FINE ? [rod(V(s * 0.22, 0.24, -0.12), V(s * 0.22, 0.5, 0.17), 0.018, 0.018, 4, WOOD)] : []),
    ]),
    box(0.5, 0.07, 0.07, WOOD, { y: 0.21, z: 0.46 }), box(0.5, 0.07, 0.07, WOOD, { y: 0.21, z: -0.46 }),
    box(0.52, 0.1, 0.09, PAINT, { y: 0.66, z: 0.18 }, { team: true }),
    drum(0, 0.24, 0, 0.055, 0.4, 6, ROPE),
    ...(FINE ? [drum(0, 0.3, -0.44, 0.04, 0.56, 5, WOOD), box(0.02, 0.16, 0.02, WOOD, { x: 0.27, y: 0.3, z: -0.44 }), box(0.02, 0.02, 0.16, WOOD, { x: -0.27, y: 0.3, z: -0.44 })] : []),
    rod(V(0, 0.24, 0), V(0, 0.36, -0.6), 0.03, 0.022, 4, WOOD, arm),
    shape(new THREE.CylinderGeometry(0.085, 0.05, 0.06, 6), WOOD, { y: 0.375, z: -0.64, rx: -0.2 }, arm),
  ];
}
// A counterweight trebuchet: a long base of beams, a trestle either side braced fore and aft to the axle, the
// long arm cocked low behind over its trough, the counterweight (painted, banded with iron)
// hung from its short end, a windlass; the arm swings over in a fight.
function trebuchet(): THREE.BufferGeometry[] {
  const arm: Tag = { limb: HIT(1.0, 1.5) };
  return [
    ...[1, -1].flatMap((s) => [
      box(0.08, 0.09, 1.4, WOOD, { x: s * 0.32, y: 0.045 }),
      rod(V(s * 0.32, 0.09, 0.52), V(s * 0.32, 1.02, 0), 0.034, 0.028, 4, WOOD), rod(V(s * 0.32, 0.09, -0.52), V(s * 0.32, 1.02, 0), 0.034, 0.028, 4, WOOD),
      rod(V(s * 0.32, 0.09, 0), V(s * 0.32, 1.0, 0), 0.026, 0.024, 4, WOOD),
      ...(FINE ? [rod(V(s * 0.32, 0.5, 0.28), V(s * 0.32, 0.5, -0.28), 0.018, 0.018, 4, WOOD)] : []),
    ]),
    box(0.74, 0.08, 0.08, WOOD, { y: 0.045, z: 0.64 }), box(0.74, 0.08, 0.08, WOOD, { y: 0.045, z: -0.64 }), box(0.74, 0.08, 0.08, WOOD, { y: 0.045 }),
    box(0.14, 0.02, 1.0, WOOD, { y: 0.1, z: -0.5 }),
    drum(0, 1.0, 0, 0.03, 0.76, 5, IRON),
    ...(FINE ? [drum(0, 0.22, -0.6, 0.045, 0.7, 5, WOOD), box(0.02, 0.2, 0.02, WOOD, { x: 0.36, y: 0.22, z: -0.6 }), box(0.02, 0.02, 0.2, WOOD, { x: -0.36, y: 0.22, z: -0.6 })] : []),
    rod(V(0, 1.28, 0.3), V(0, 0.3, -0.98), 0.04, 0.02, 4, WOOD, arm),
    rod(V(0, 1.26, 0.3), V(0, 1.12, 0.36), 0.014, 0.014, 3, IRON, arm),
    shape(new THREE.CylinderGeometry(0.14, 0.2, 0.3, 4), PAINT, { y: 0.97, z: 0.36, ry: Math.PI / 4 }, { team: true, ...arm }),
    ...(FINE ? [box(0.3, 0.03, 0.3, IRON, { y: 0.9, z: 0.36 }, arm), box(0.25, 0.03, 0.25, IRON, { y: 1.05, z: 0.36 }, arm)] : []),
  ];
}
// A Gatling gun on its carriage: two spoked wheels, the trail behind (painted), the cluster of barrels between
// its plates, the brass breech with its magazine standing on it and the crank at its side.
function gatling(): THREE.BufferGeometry[] {
  const up = 0.06, at = V(0, 0.46, -0.02);
  return [
    ...spoked(0.26, 0.27), ...spoked(-0.26, 0.27), drum(0, 0.27, 0, 0.028, 0.5, 5, IRON),
    slab([[0.08, 0.24], [0.08, 0.34], [-0.1, 0.33], [-0.7, 0.07], [-0.74, 0], [-0.64, 0], [-0.1, 0.22]], 0.13, PAINT, 0, { team: true }),
    box(0.06, 0.14, 0.06, IRON, { y: 0.38, z: 0.04 }),
    ...(FINE ? Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3, o = V(0.045 * Math.cos(a), 0.045 * Math.sin(a), 0); return barrel(at.clone().add(o), 0.62, up, 0.016, 0.016, GUNMETAL, [], 4)[0]!; })
      : barrel(at, 0.62, up, 0.06, 0.06, GUNMETAL, [], 6)),
    ...barrel(at, 0.62, up, 0.02, 0.02, GUNMETAL, [[0.3, 0.068, 0.02], [0.98, 0.068, 0.025]], 6),
    ...barrel(at.clone().add(V(0, -0.012, -0.24)), 0.25, up, 0.085, 0.085, BRONZE, [], 8),
    box(0.05, 0.2, 0.07, BRONZE, { y: 0.63, z: -0.12 }),
    ...(FINE ? [rod(V(0.085, 0.45, -0.16), V(0.17, 0.45, -0.16), 0.01, 0.01, 3, IRON), rod(V(0.17, 0.45, -0.16), V(0.17, 0.37, -0.16), 0.012, 0.012, 3, WOOD), box(0.2, 0.1, 0.12, WOOD, { y: 0.14, z: -0.5, rx: 0.4 })] : []),
  ];
}
// An anti-tank gun: low, on two tyred wheels, split trails to their spades, a shield in three folds (a band of
// the owner's colour along its top), a long barrel with a muzzle brake on its cradle.
function antiTank(): THREE.BufferGeometry[] {
  return [
    ...tyred(0.29, 0.18), ...tyred(-0.29, 0.18),
    ...[1, -1].flatMap((s) => [rod(V(s * 0.08, 0.24, -0.05), V(s * 0.36, 0.04, -0.8), 0.032, 0.026, 4, OLIVE), box(0.1, 0.12, 0.02, GUNMETAL, { x: s * 0.36, y: 0.03, z: -0.82, rx: 0.4 }),
      box(0.2, 0.34, 0.02, OLIVE, { x: s * 0.33, y: 0.36, z: 0.09, rx: -0.15, ry: s * -0.5 })]),
    box(0.44, 0.34, 0.02, OLIVE, { y: 0.36, z: 0.14, rx: -0.15 }), box(0.452, 0.045, 0.026, PAINT, { y: 0.55, z: 0.112, rx: -0.15 }, { team: true }),
    box(0.14, 0.09, 0.56, OLIVE_DARK, { y: 0.3, z: 0.22 }),
    ...barrel(V(0, 0.38, -0.2), 1.25, 0, 0.036, 0.026, GUNMETAL, [[0.06, 0.055, 0.16], [0.965, 0.046, 0.09]], 6),
    box(0.12, 0.12, 0.1, GUNMETAL, { y: 0.38, z: -0.24 }),
    ...(FINE ? [drum(0, 0.18, 0, 0.022, 0.5, 5, GUNMETAL), box(0.05, 0.1, 0.02, GUNMETAL, { x: -0.13, y: 0.5, z: 0.16, rx: -0.15 })] : []),
  ];
}
// A landship (the first tanks): tall rhomboid track frames the tracks run all the way round, their sides plated
// (a band of the owner's colour along each), the hull and its cab between them, a gun in a sponson on each
// flank, the exhaust on the roof.
function landship(): THREE.BufferGeometry[] {
  const rhomb: readonly (readonly [number, number])[] = [[-0.85, 0.3], [-0.62, 0], [0.6, 0], [0.9, 0.34], [0.62, 0.64], [-0.62, 0.64]];
  const inner = rhomb.map(([z, y]) => [z * 0.93 + 0.004, 0.32 + (y - 0.32) * 0.8] as const);
  return [
    ...[1, -1].flatMap((s) => [slab(rhomb, 0.18, TRACK, s * 0.29), slab(inner, 0.19, OLIVE, s * 0.29),
      box(0.012, 0.07, 0.86, PAINT, { x: s * 0.3925, y: 0.47 }, { team: true }),
      box(0.13, 0.2, 0.34, OLIVE, { x: s * 0.45, y: 0.31, z: 0.06 }), box(0.13, 0.03, 0.4, OLIVE_DARK, { x: s * 0.45, y: 0.425, z: 0.06 }),
      ...barrel(V(s * 0.47, 0.31, 0.2), 0.34, 0, 0.026, 0.022, GUNMETAL, [], 5)]),
    box(0.4, 0.42, 1.04, OLIVE, { y: 0.35 }),
    box(0.26, 0.14, 0.3, OLIVE, { y: 0.63, z: 0.14 }),
    ...(FINE ? [box(0.2, 0.03, 0.02, GLASS, { y: 0.65, z: 0.292 }), rod(V(0.08, 0.56, -0.2), V(0.08, 0.72, -0.2), 0.02, 0.02, 4, GUNMETAL), rod(V(-0.08, 0.56, -0.3), V(-0.08, 0.72, -0.3), 0.02, 0.02, 4, GUNMETAL),
      box(0.3, 0.02, 0.4, OLIVE_DARK, { y: 0.568, z: -0.28 })] : []),
  ];
}
// ---- later machines ----
// A field cannon: the cannon, smaller and lighter.
const fieldCannon = () => cannon().map((g) => g.applyMatrix4(new THREE.Matrix4().makeScale(0.78, 0.78, 0.78)));
// Modern armour: long and low, its tracks under side skirts (painted), a hull with a shallow glacis, a wedge
// of a turret with a long gun (its bore evacuator half way along), a machine gun and smoke dischargers on it.
function modernArmor(): THREE.BufferGeometry[] {
  return [
    ...track(0.38, 1.62, 0.25, 0.2, 0, 6), ...track(-0.38, 1.62, 0.25, 0.2, 0, 6),
    slab([[-0.78, 0.2], [0.52, 0.2], [0.8, 0.27], [0.36, 0.43], [-0.78, 0.43]], 0.6, OLIVE),
    ...[1, -1].map((s) => box(0.03, 0.15, 1.36, PAINT, { x: s * 0.495, y: 0.215, z: -0.04 }, { team: true })),
    slab([[-0.52, 0.44], [0.2, 0.44], [0.42, 0.5], [0.22, 0.62], [-0.52, 0.62]], 0.52, OLIVE_DARK),
    ...[1, -1].map((s) => slab([[-0.5, 0.45], [0.14, 0.45], [0.3, 0.5], [0.14, 0.6], [-0.5, 0.6]], 0.1, OLIVE, s * 0.31)),
    ...barrel(V(0, 0.53, 0.4), 1.12, 0, 0.042, 0.034, GUNMETAL, [[0.5, 0.055, 0.2], [0.985, 0.04, 0.03]]),
    box(0.22, 0.12, 0.1, GUNMETAL, { y: 0.53, z: 0.4 }),
    ...(FINE ? [
      shape(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 6), OLIVE, { x: -0.12, y: 0.645, z: -0.14 }), ...barrel(V(-0.12, 0.7, -0.12), 0.3, 0.04, 0.012, 0.01, GUNMETAL, [], 4),
      ...[1, -1].map((s) => box(0.05, 0.05, 0.1, GUNMETAL, { x: s * 0.33, y: 0.56, z: 0.2, rx: -0.5 })),
      box(0.4, 0.1, 0.14, OLIVE, { y: 0.52, z: -0.6 }), box(0.5, 0.015, 0.34, GUNMETAL, { y: 0.438, z: -0.56 }),
    ] : []),
  ];
}
// An armoured carrier (mechanized infantry): a boat-nosed hull on six wheels, its upper sides sloped in
// (painted), a small turret with its cannon, hatches on the roof, a door in its stern.
function apc(): THREE.BufferGeometry[] {
  return [
    ...[0.48, 0, -0.48].flatMap((z) => [...tyred(0.34, 0.15, z, 0.1), ...tyred(-0.34, 0.15, z, 0.1)]),
    slab([[-0.7, 0.16], [0.5, 0.16], [0.74, 0.34], [-0.7, 0.34]], 0.56, OLIVE),
    slab([[-0.7, 0.34], [0.74, 0.34], [0.5, 0.58], [-0.64, 0.58]], 0.66, PAINT, 0, { team: true }),
    shape(new THREE.CylinderGeometry(0.11, 0.14, 0.11, 6), OLIVE, { y: 0.635, z: 0.08 }),
    ...barrel(V(0, 0.64, 0.16), 0.42, 0.03, 0.018, 0.015, GUNMETAL, [[0.97, 0.022, 0.04]], 5),
    ...(FINE ? [
      box(0.5, 0.07, 0.02, GLASS, { y: 0.5, z: 0.592, rx: 0.78 }),
      box(0.18, 0.015, 0.2, OLIVE_DARK, { x: 0.16, y: 0.586, z: -0.3 }), box(0.18, 0.015, 0.2, OLIVE_DARK, { x: -0.16, y: 0.586, z: -0.3 }),
      box(0.3, 0.3, 0.015, OLIVE_DARK, { y: 0.36, z: -0.706 }),
      ...[1, -1].map((s) => box(0.03, 0.05, 0.06, GUNMETAL, { x: s * 0.24, y: 0.42, z: 0.7 })),
    ] : []),
  ];
}
// Rocket artillery: a tracked chassis with an armoured cab in front (painted), and on a turntable behind it
// the launcher: a box of rockets raised to the sky, their tubes open at its face.
function rocketArtillery(): THREE.BufferGeometry[] {
  const tilt = -0.5, at = V(0, 0.72, -0.22), fwd = V(0, Math.sin(-tilt), Math.cos(-tilt)), upv = V(0, Math.cos(-tilt), -Math.sin(-tilt));
  return [
    ...track(0.32, 1.4, 0.22, 0.18), ...track(-0.32, 1.4, 0.22, 0.18),
    box(0.5, 0.14, 1.3, OLIVE_DARK, { y: 0.17 }), box(0.76, 0.03, 1.36, OLIVE, { y: 0.255 }),
    slab([[0.2, 0.27], [0.68, 0.27], [0.68, 0.4], [0.56, 0.52], [0.2, 0.52]], 0.6, PAINT, 0, { team: true }),
    ...(FINE ? [box(0.5, 0.1, 0.02, GLASS, { y: 0.455, z: 0.628, rx: 0.78 }), box(0.012, 0.1, 0.22, GLASS, { x: 0.303, y: 0.44, z: 0.4 }), box(0.012, 0.1, 0.22, GLASS, { x: -0.303, y: 0.44, z: 0.4 })] : []),
    shape(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 8), OLIVE_DARK, { y: 0.31, z: -0.3 }),
    ...[1, -1].map((s) => box(0.05, 0.3, 0.12, OLIVE_DARK, { x: s * 0.2, y: 0.48, z: -0.3 })),
    box(0.5, 0.3, 0.84, OLIVE, { x: at.x, y: at.y, z: at.z, rx: tilt }),
    ...(FINE ? [-0.16, 0, 0.16].flatMap((x) => [-0.075, 0.075].map((u) => { const p = at.clone().addScaledVector(fwd, 0.424).addScaledVector(upv, u); return box(0.11, 0.1, 0.012, 0x151515, { x, y: p.y, z: p.z, rx: tilt }); })) : []),
  ];
}
// A mobile SAM: a truck on three axles, its cab painted, and on the bed a turntable with two missiles on their
// rails raised to the sky, a radar's panel behind the cab.
function mobileSAM(): THREE.BufferGeometry[] {
  const tilt = -0.55;
  const missile = (x: number) => [
    lp(hull([R([x, 0, -0.42], 0.045), R([x, 0, 0.3], 0.045), R([x, 0, 0.46], 0, 0)], 5, 0xe8e6e0, { side: [1, 0, 0] }), { y: 0.78, z: -0.22, rx: tilt }),
    ...(FINE ? [box(0.16, 0.012, 0.12, 0x9a2a22, { x, y: 0.585, z: -0.52, rx: tilt }), box(0.012, 0.16, 0.12, 0x9a2a22, { x, y: 0.585, z: -0.52, rx: tilt }), box(0.03, 0.03, 0.8, OLIVE_DARK, { x, y: 0.715, z: -0.2, rx: tilt })] : []),
  ];
  return [
    ...[0.5, -0.16, -0.5].flatMap((z) => [...tyred(0.3, 0.14, z, 0.1), ...tyred(-0.3, 0.14, z, 0.1)]),
    box(0.5, 0.07, 1.4, OLIVE_DARK, { y: 0.27 }),
    slab([[0.3, 0.31], [0.72, 0.31], [0.72, 0.46], [0.62, 0.62], [0.3, 0.62]], 0.58, PAINT, 0, { team: true }),
    ...(FINE ? [box(0.48, 0.12, 0.02, GLASS, { y: 0.545, z: 0.677, rx: 0.56 }), box(0.012, 0.11, 0.2, GLASS, { x: 0.293, y: 0.53, z: 0.48 }), box(0.012, 0.11, 0.2, GLASS, { x: -0.293, y: 0.53, z: 0.48 }),
      box(0.3, 0.2, 0.02, OLIVE, { y: 0.78, z: 0.26, rx: -0.25 }), rod(V(0, 0.62, 0.28), V(0, 0.72, 0.27), 0.02, 0.02, 4, OLIVE_DARK)] : []),
    box(0.6, 0.04, 0.9, OLIVE, { y: 0.325, z: -0.24 }),
    shape(new THREE.CylinderGeometry(0.17, 0.2, 0.1, 8), OLIVE_DARK, { y: 0.395, z: -0.26 }),
    box(0.1, 0.24, 0.14, OLIVE_DARK, { y: 0.52, z: -0.3 }),
    ...missile(0.13), ...missile(-0.13),
  ];
}

// ---- ships ----
// Ships sit on the water (y = 0 the waterline), bow to +z. Each is built a size that is easy to draw at (a
// galley 3.3 long, a battleship 5.6) and then brought down to SHIP_SCALE: on the map a ship is a model beside
// a city, not as large as one.
const SHIP_SCALE = 0.43;
const HULL_WOOD = 0x6a4a30, DECK = 0x9a7a52, SAIL = 0xe8e0cc, DARK_HULL = 0x2a2c30;
const STEEL = 0x8f969c, STEEL_DARK = 0x6c7379, STEEL_DECK = 0x5c6268, BOOT = 0x6e2f2a;
const gun = (x: number, y: number, z: number, len: number, ry = 0) => shape(new THREE.CylinderGeometry(0.03, 0.035, len, 5), GUNMETAL, { x, y, z, rx: Math.PI / 2, ry });

// ---- a ship's kit: a hull with lines to it, bellied sails, rigging ----
// A hull's lines (model units; y = 0 the waterline, bow to +z): its length and beam, how deep it draws,
// its freeboard amidships and how much higher the deck rises at the bow and the stern (its sheer), and
// how wide its stern is cut off (a share of the beam: a transom; little: a pointed stern).
interface Lines { readonly len: number; readonly beam: number; readonly draught: number; readonly free: number; readonly bow: number; readonly stern: number; readonly transom: number }
const STATIONS = 12, BULWARK = 0.07;
const facets = (pts: readonly THREE.Vector3[], color: number, t?: Tag): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flatMap((q) => [q.x, q.y, q.z])), 3));
  g.computeVertexNormals();
  return shape(g, color, {}, t);
};
// (A four-sided face as two triangles, wound to look out along `out`.)
const face = (into: THREE.Vector3[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3): void => {
  const n = b.clone().sub(a).cross(d.clone().sub(a));
  if (n.dot(out) >= 0) into.push(a, b, c, a, c, d); else into.push(a, d, c, a, c, b);
};
function linesOf(L: Lines) {
  const z = (t: number) => (t - 0.5) * L.len;
  // (Half the beam: out from the transom to full by a third of the way, in to the stem over the last half, fuller than a wedge.)
  const half = (t: number) => Math.max(0.012, (L.beam / 2) * (L.transom + (1 - L.transom) * Math.sin(Math.min(1, t / 0.32) * Math.PI / 2)) * (t <= 0.52 ? 1 : Math.pow(Math.max(0, 1 - ((t - 0.52) / 0.48) ** 2), 0.75)));
  const deck = (t: number) => L.free + L.stern * Math.max(0, 1 - t / 0.4) ** 2 + L.bow * Math.max(0, (t - 0.6) / 0.4) ** 2;
  const keel = (t: number) => -L.draught * (t > 0.72 ? 1 - 0.9 * ((t - 0.72) / 0.28) ** 2 : 1) * (t < 0.15 ? 0.55 + 0.45 * (t / 0.15) : 1);
  // A section's points up one side (s: +1 or -1): the keel, the turn of the bilge, the waterline, the rail.
  const side = (t: number, s: number): THREE.Vector3[] => { const b = half(t), k = keel(t); return [V(0, k, z(t)), V(s * b * 0.62, k * 0.55, z(t)), V(s * b * 0.97, 0.01, z(t)), V(s * b, deck(t), z(t))]; };
  const tOf = (zz: number) => zz / L.len + 0.5;
  return { z, half, deck, keel, side, floor: (zz: number) => deck(tOf(zz)) - BULWARK, wide: (zz: number) => half(tOf(zz)) };
}
// The hull: its bottom (`below`), its topsides, its transom and its deck (inside a low bulwark).
function hullOf(L: Lines, color: number, below: number, deckColor: number): THREE.BufferGeometry[] {
  const f = linesOf(L), bottom: THREE.Vector3[] = [], top: THREE.Vector3[] = [], planks: THREE.Vector3[] = [];
  for (let i = 0; i < STATIONS; i++) {
    const t0 = i / STATIONS, t1 = (i + 1) / STATIONS;
    for (const s of [1, -1]) {
      const a = f.side(t0, s), b = f.side(t1, s), out = V(s, -0.4, 0);
      face(bottom, a[0]!, b[0]!, b[1]!, a[1]!, out);
      face(bottom, a[1]!, b[1]!, b[2]!, a[2]!, out);
      face(top, a[2]!, b[2]!, b[3]!, a[3]!, V(s, 0, 0));
    }
    const y0 = f.deck(t0) - BULWARK, y1 = f.deck(t1) - BULWARK, w0 = f.half(t0) * 0.94, w1 = f.half(t1) * 0.94;
    face(planks, V(-w0, y0, f.z(t0)), V(w0, y0, f.z(t0)), V(w1, y1, f.z(t1)), V(-w1, y1, f.z(t1)), V(0, 1, 0));
  }
  // (The transom: the section at the stern, closed.)
  const l = f.side(0, -1), r = f.side(0, 1), aft = V(0, 0, -1), stern: THREE.Vector3[] = [];
  face(stern, l[3]!, r[3]!, r[2]!, l[2]!, aft); face(stern, l[2]!, r[2]!, r[1]!, l[1]!, aft); stern.push(l[1]!, r[1]!, l[0]!);
  return [facets(bottom, below), facets(top, color), facets(stern, color), facets(planks, deckColor)];
}
// A band along the hull's sides, a little proud of them: from `lo` to `hi` of the way up from the waterline
// to the rail, over the stations t0..t1 (a wale, a line of gun ports' paint, the owner's colour).
function strake(L: Lines, lo: number, hi: number, color: number, t?: Tag, t0 = 0, t1 = 1): THREE.BufferGeometry {
  const f = linesOf(L), out: THREE.Vector3[] = [];
  const at = (tt: number, s: number, k: number) => { const q = f.side(tt, s); return q[2]!.clone().lerp(q[3]!, k).add(V(s * 0.014, 0, 0)); };
  for (let i = 0; i < STATIONS; i++) {
    const a = Math.max(t0, i / STATIONS), b = Math.min(t1, (i + 1) / STATIONS);
    if (b <= a) continue;
    for (const s of [1, -1]) face(out, at(a, s, lo), at(b, s, lo), at(b, s, hi), at(a, s, hi), V(s, 0, 0));
  }
  return facets(out, color, t);
}
// A square sail, bellied by the wind from astern: `w` wide at its foot (a little narrower at its head), `h`
// high, its foot at `y` on the mast at `z`.
function sail(w: number, h: number, y: number, z: number, color: number, t?: Tag): THREE.BufferGeometry {
  const out: THREE.Vector3[] = [], U = 4, W = 3;
  const at = (i: number, j: number) => { const u = i / U, v = j / W; return V((u - 0.5) * w * (1 - 0.12 * v), y + v * h, z + 0.05 + 0.16 * w * Math.sin(u * Math.PI) * (0.35 + 0.65 * Math.sin((0.15 + 0.85 * (1 - v)) * Math.PI * 0.75))); };
  for (let i = 0; i < U; i++) for (let j = 0; j < W; j++) face(out, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), V(0, 0, 1));
  return facets(out, color, t);
}
// A mast stepped on the deck at `z`, `h` tall, square-rigged: a yard and a sail to each of `sails` (its
// foot's height up the mast and its own height, as shares of the mast; its width; whether it is the owner's).
function rigged(z: number, deckY: number, h: number, sails: readonly (readonly [at: number, tall: number, wide: number, team?: boolean])[], r = 0.03): THREE.BufferGeometry[] {
  return [rod(V(0, deckY, z), V(0, deckY + h, z), r, r * 0.45, 5, WOOD),
    ...sails.flatMap(([at, tall, wide, team]) => [
      rod(V(-wide / 2 * 0.92, deckY + (at + tall) * h, z + 0.03), V(wide / 2 * 0.92, deckY + (at + tall) * h, z + 0.03), 0.014, 0.014, 3, WOOD),
      sail(wide, tall * h, deckY + at * h, z, team ? PAINT : SAIL, team ? { team: true } : undefined)])];
}
// (A stay or a shroud: a thin dark line.)
const line = (a: THREE.Vector3, b: THREE.Vector3) => rod(a, b, 0.005, 0.005, 3, 0x3a342c);
// A flag flying from `at`, toward the stern.
// (A hair off the middle line: never in the plane of a sail set fore and aft.)
const ensign = (at: THREE.Vector3, w = 0.34, h = 0.2) => lp(plate([[0, 0], [w, -h * 0.15], [w * 0.95, -h * 0.95], [0, -h]], PAINT), { x: at.x + 0.02, y: at.y, z: at.z, ry: Math.PI / 2 }, { team: true });
// A lateen: a mast at `z`, a long yard slung aslant across it, a three-cornered sail fore and aft under the yard.
// (`x`: how far off the middle line its sail hangs: two lateens overlapping, seen from abeam, are given planes of their own.)
function lateen(z: number, deckY: number, h: number, len: number, team = false, x = 0.03): THREE.BufferGeometry[] {
  const lo = V(x, deckY + h * 0.3, z + len * 0.5), hi = V(x, deckY + h * 1.18, z - len * 0.5), clew = V(x, deckY + h * 0.22, z - len * 0.48);
  return [rod(V(0, deckY, z), V(0, deckY + h, z), 0.028, 0.014, 5, WOOD), rod(lo, hi, 0.014, 0.01, 3, WOOD), facets([lo, hi, clew], team ? PAINT : SAIL, team ? { team: true } : undefined)];
}
// Oars out of both sides at each of `zs`, from `y` on the hull down to the water `reach` out.
const oarBank = (f: ReturnType<typeof linesOf>, zs: readonly number[], y: number, reach = 0.62) =>
  [1, -1].flatMap((s) => zs.map((z) => rod(V(s * f.wide(z) * 0.95, y, z), V(s * (f.wide(z) + reach), -0.03, z - 0.14), 0.009, 0.014, 3, WOOD)));
// A galley's ends: the bronze ram at the waterline and the stem rising over it; the stern curling up and
// forward over the helmsman, his awning, the two steering oars.
function galleyEnds(L: Lines): THREE.BufferGeometry[] {
  const f = linesOf(L), h = L.len / 2, k = L.beam / 0.66, aft = -h + 0.4, y = f.floor(aft);
  return [
    lp(hull([R([0, -0.02, h - 0.15], 0.07 * k, 0.05 * k), R([0, -0.03, h + 0.15], 0.045 * k, 0.03 * k), R([0, -0.03, h + 0.36], 0, 0)], 4, 0xb08a3c, { side: [1, 0, 0] })),
    lp(hull([R([0, 0.3, h - 0.07], 0.035), R([0, 0.6, h + 0.05], 0.03), R([0, 0.82, h - 0.03], 0.02), R([0, 0.9, h - 0.15], 0, 0)], 4, HULL_WOOD, { side: [1, 0, 0] })),
    lp(hull([R([0, 0.4, -h + 0.03], 0.045), R([0, 0.8, -h - 0.13], 0.04), R([0, 1.12, -h + 0.03], 0.03), R([0, 1.2, -h + 0.29], 0.022), R([0, 1.1, -h + 0.45], 0, 0)], 4, HULL_WOOD, { side: [1, 0, 0] })),
    box(0.5 * k, 0.02, 0.5, 0xb8553a, { y: y + 0.42, z: aft }),
    ...[1, -1].flatMap((s) => [rod(V(s * 0.22 * k, y, aft + 0.23), V(s * 0.22 * k, y + 0.42, aft + 0.23), 0.012, 0.012, 3, WOOD), rod(V(s * 0.22 * k, y, aft - 0.23), V(s * 0.22 * k, y + 0.42, aft - 0.23), 0.012, 0.012, 3, WOOD),
      rod(V(s * 0.3 * k, 0.36, aft - 0.05), V(s * 0.42 * k, -0.2, aft - 0.37), 0.014, 0.03, 3, WOOD)]),
  ];
}
// Shields hung along the rail, one at each of `zs`, in the owner's colour.
const shields = (L: Lines, zs: readonly number[]) => { const f = linesOf(L); return [1, -1].flatMap((s) => zs.map((z) =>
  lp(plate([[-0.06, -0.07], [0.06, -0.07], [0.075, 0], [0.06, 0.07], [-0.06, 0.07], [-0.075, 0]], PAINT), { x: s * (f.wide(z) + 0.02), y: f.deck(z / L.len + 0.5) - 0.04, z: z + 0.12, ry: Math.PI / 2 }, { team: true }))); };
// A castle on the deck round `z`: a platform on its posts with a low wall about it, notched.
function castle(f: ReturnType<typeof linesOf>, z: number, w: number, d: number, h: number, color: number): THREE.BufferGeometry[] {
  const y = f.floor(z) + h;
  return [box(w, 0.05, d, color, { y, z }), box(w * 0.96, 0.02, d * 0.96, DECK, { y: y + 0.035, z }),
    ...[1, -1].flatMap((s) => [box(0.04, 0.14, d, color, { x: s * w / 2, y: y + 0.09, z }), box(w, 0.14, 0.04, color, { y: y + 0.09, z: z + s * d / 2 }),
      ...[-0.3, 0.3].map((k) => box(0.05, 0.06, d * 0.22, color, { x: s * w / 2, y: y + 0.19, z: z + k * d })),
      ...[1, -1].map((e) => rod(V(s * w * 0.42, f.floor(z), z + e * d * 0.42), V(s * w * 0.42, y, z + e * d * 0.42), 0.02, 0.02, 4, color))])];
}

// A galley: a long, low, narrow hull under oars, its stern curling up over the helmsman, a bronze ram at the
// waterline, one mast with a square sail in the owner's colour, shields along the rail.
function galleyShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 3.3, beam: 0.66, draught: 0.15, free: 0.2, bow: 0.22, stern: 0.3, transom: 0.3 }, f = linesOf(L);
  const zs = Array.from({ length: 9 }, (_, i) => -0.95 + i * 0.25);
  return [...hullOf(L, HULL_WOOD, 0x4a3524, DECK), strake(L, 0.55, 0.85, 0x8a2f24), ...galleyEnds(L), ...oarBank(f, zs, 0.16), ...shields(L, zs),
    ...rigged(0.15, f.floor(0.15), 1.55, [[0.32, 0.56, 1.35, true]]), line(V(0, f.floor(0.15) + 1.55, 0.15), V(0, 0.55, 1.6)), line(V(0, f.floor(0.15) + 1.55, 0.15), V(0, 0.6, -1.5))];
}
// A trireme: a longer galley with its oars in two banks along an outrigger, a small foresail raked over the
// bow before the mainsail, the same ram and curling stern.
function triremeShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 3.9, beam: 0.74, draught: 0.16, free: 0.27, bow: 0.2, stern: 0.3, transom: 0.3 }, f = linesOf(L);
  const zs = Array.from({ length: 12 }, (_, i) => -1.2 + i * 0.22);
  return [...hullOf(L, HULL_WOOD, 0x4a3524, DECK), strake(L, 0.4, 0.66, 0x8a2f24), strake(L, 0.84, 0.98, PAINT, { team: true }), ...galleyEnds(L),
    ...oarBank(f, zs, 0.22, 0.66), ...oarBank(f, zs.map((z) => z + 0.11), 0.1, 0.5),
    // (The eye painted on each bow.)
    ...[1, -1].map((s) => ball(0.045, 0xf0ead8, { x: s * f.wide(1.5), y: 0.22, z: 1.5 })),
    ...rigged(0.1, f.floor(0.1), 1.8, [[0.3, 0.56, 1.6, true]]),
    rod(V(0, f.floor(1.35), 1.35), V(0, f.floor(1.35) + 0.95, 1.62), 0.02, 0.012, 4, WOOD), sail(0.75, 0.5, f.floor(1.35) + 0.42, 1.52, SAIL),
    line(V(0, f.floor(0.1) + 1.8, 0.1), V(0, 0.6, 1.9)), line(V(0, f.floor(0.1) + 1.8, 0.1), V(0, 0.6, -1.8))];
}
// A cog: a deep, round, high-sided trader built for war, a castle at each end, one tall mast with a great
// square sail in the owner's colour and a top to fight from, a rudder hung on the sternpost.
function cogShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 2.9, beam: 1.16, draught: 0.3, free: 0.56, bow: 0.26, stern: 0.26, transom: 0.34 }, f = linesOf(L), y = f.floor(0.05), top = y + 2.35;
  return [...hullOf(L, HULL_WOOD, 0x4a3524, DECK), strake(L, 0.3, 0.42, 0x4a3524), strake(L, 0.62, 0.74, 0x4a3524),
    ...castle(f, -1.0, 0.86, 0.72, 0.36, 0x7a5a3a), ...castle(f, 1.02, 0.6, 0.5, 0.3, 0x7a5a3a),
    rod(V(0, 0.3, 1.38), V(0, 1.0, 1.52), 0.035, 0.025, 4, HULL_WOOD), box(0.03, 0.62, 0.2, HULL_WOOD, { y: 0.12, z: -1.5 }),
    ...rigged(0.05, y, 2.35, [[0.22, 0.56, 1.75, true]], 0.04),
    // (The top; stays to the stem and the stern; shrouds.)
    shape(new THREE.CylinderGeometry(0.12, 0.09, 0.12, 6), 0x7a5a3a, { y: top - 0.2, z: 0.05 }), lp(plate([[0, 0], [0.4, -0.03], [0, -0.07]], PAINT), { y: top + 0.04, z: 0.05, ry: Math.PI / 2 }, { team: true }),
    line(V(0, top - 0.2, 0.05), V(0, 1.0, 1.52)), line(V(0, top - 0.2, 0.05), V(0, f.floor(-1.0) + 0.5, -1.36)),
    ...[1, -1].flatMap((s) => [-0.25, -0.05].map((dz) => line(V(0, top - 0.2, 0.05), V(s * f.wide(dz), f.deck(dz / L.len + 0.5), dz)))),
    ...[-0.35, 0.5].map((z) => box(0.3, 0.05, 0.3, 0x4a3a2a, { y: f.floor(z) + 0.025, z }))];
}
// A caravel: a light, fine-lined explorer, low forward and rising to a quarterdeck aft; a square sail on the
// foremast in the owner's colour, lateens on the main and the mizzen, a bowsprit.
function caravelShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 3.2, beam: 0.9, draught: 0.26, free: 0.42, bow: 0.14, stern: 0.3, transom: 0.6 }, f = linesOf(L);
  return [...hullOf(L, HULL_WOOD, 0x4a3524, DECK), strake(L, 0.45, 0.58, 0x4a3524), strake(L, 0.82, 0.95, PAINT, { team: true }),
    box(0.72, 0.2, 0.95, HULL_WOOD, { y: f.floor(-1.05) + 0.1, z: -1.05 }), box(0.68, 0.02, 0.93, DECK, { y: f.floor(-1.05) + 0.21, z: -1.05 }),
    ...[1, -1].map((s) => box(0.03, 0.1, 0.95, HULL_WOOD, { x: s * 0.35, y: f.floor(-1.05) + 0.26, z: -1.05 })),
    box(0.6, 0.2, 0.04, 0x8a6a42, { y: 0.52, z: -1.62 }), ...[-0.15, 0.15].map((x) => box(0.12, 0.1, 0.02, 0x1c2a36, { x, y: 0.54, z: -1.645 })),
    ...rigged(0.95, f.floor(0.95), 1.9, [[0.2, 0.42, 1.25, true], [0.66, 0.24, 0.85]]), ...lateen(-0.1, f.floor(-0.1), 1.75, 1.7, false, 0.025), ...lateen(-1.15, f.floor(-1.15) + 0.2, 1.2, 1.1, false, 0.055),
    rod(V(0, f.floor(1.4) + 0.05, 1.35), V(0, 0.9, 2.2), 0.022, 0.012, 4, WOOD), line(V(0, f.floor(0.95) + 1.9, 0.95), V(0, 0.9, 2.2)),
    ...[1, -1].map((s) => line(V(0, f.floor(0.95) + 1.3, 0.95), V(s * f.wide(0.7), f.deck(0.7 / L.len + 0.5), 0.7))),
    rod(V(0, f.floor(-1.05) + 0.2, -1.55), V(0, f.floor(-1.05) + 0.72, -1.68), 0.01, 0.01, 3, WOOD), ensign(V(0, f.floor(-1.05) + 0.7, -1.7), 0.3, 0.18)];
}
// A galleass: a great galley carrying guns. Oars along a long hull, a round gun tower over the bow, a
// castle aft, three lateen sails (the main in the owner's colour).
function galleassShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 4.0, beam: 1.0, draught: 0.22, free: 0.38, bow: 0.16, stern: 0.3, transom: 0.55 }, f = linesOf(L);
  const zs = Array.from({ length: 9 }, (_, i) => -1.0 + i * 0.26);
  return [...hullOf(L, HULL_WOOD, 0x4a3524, DECK), strake(L, 0.3, 0.5, 0x8a2f24), strake(L, 0.8, 0.95, PAINT, { team: true }), ...oarBank(f, zs, 0.24, 0.7),
    // (The gun tower, its guns ahead and to the sides; the spur under it.)
    shape(new THREE.CylinderGeometry(0.3, 0.33, 0.3, 8), 0x7a5a3a, { y: f.floor(1.45) + 0.15, z: 1.45 }), shape(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 8), 0x5a4230, { y: f.floor(1.45) + 0.32, z: 1.45 }),
    gun(0, f.floor(1.45) + 0.16, 1.82, 0.3), ...[1, -1].flatMap((s) => [gun(s * 0.2, f.floor(1.45) + 0.16, 1.74, 0.26, s * 0.5), gun(s * 0.34, f.floor(1.45) + 0.16, 1.5, 0.2, s * Math.PI / 2)]),
    lp(hull([R([0, 0.05, 1.9], 0.05, 0.04), R([0, 0.04, 2.3], 0, 0)], 4, HULL_WOOD, { side: [1, 0, 0] })),
    ...[1, -1].flatMap((s) => [-0.6, 0.2].map((z) => gun(s * (f.wide(z) + 0.05), 0.3, z + 0.13, 0.18, s * Math.PI / 2))),
    ...castle(f, -1.5, 0.8, 0.8, 0.26, 0x7a5a3a),
    ...lateen(0.85, f.floor(0.85), 1.5, 1.5, false, 0.02), ...lateen(-0.15, f.floor(-0.15), 1.8, 1.8, true, 0.05), ...lateen(-1.2, f.floor(-1.2) + 0.3, 1.15, 1.1, false, 0.08),
    rod(V(0, f.floor(-1.5) + 0.3, -1.9), V(0, f.floor(-1.5) + 0.85, -2.02), 0.01, 0.01, 3, WOOD), ensign(V(0, f.floor(-1.5) + 0.83, -2.04), 0.3, 0.18)];
}

// A square-rigged man-of-war: a dark hull with a band of ochre along each gun deck, the ports open and the
// guns run out; a quarterdeck and a stern gallery with its windows and lantern; on each of three masts a
// course, a topsail in the owner's colour and a topgallant (`royals`: one more over them); a spanker, jibs
// to the bowsprit, a pennant at the main and the ensign aft.
function manOfWar(L: Lines, o: { readonly bands: readonly (readonly [number, number])[]; readonly ports: readonly number[]; readonly masts: readonly (readonly [number, number])[]; readonly royals?: boolean; readonly dark?: number; readonly canvas?: number; readonly tiers?: number }): THREE.BufferGeometry[] {
  const f = linesOf(L), DARK = o.dark ?? 0x2e2620, OCHRE = 0xc9a03c, h = L.len / 2, canvas = o.canvas ?? SAIL, tiers = o.tiers ?? 1;
  const top = (i: number) => V(0, f.floor(o.masts[i]![0]) + o.masts[i]![1], o.masts[i]![0]);
  const sprit = V(0, L.free + 0.45, h + 0.8), aft = -h + 0.65, k = L.beam / 1.08;
  const suit = (i: number, wide: number): [number, number, number, boolean?][] => [...(i < 2 ? [[0.13, 0.31, wide] as [number, number, number]] : []), [0.48, 0.26, wide * 0.8, true],
    [0.77, o.royals ? 0.14 : 0.18, wide * 0.56], ...(o.royals ? [[0.93, 0.1, wide * 0.4] as [number, number, number]] : [])];
  const sails = (i: number, wide: number) => { const [z, tall] = o.masts[i]!; return rigged(z, f.floor(z), tall, suit(i, wide), i === 1 ? 0.034 : 0.028).map((g, n) => (canvas !== SAIL && n > 0 && n % 2 === 0 ? recolor(g, SAIL, canvas) : g)); };
  return [
    ...hullOf(L, DARK, 0x6a5a48, DECK), ...o.bands.map(([lo, hi]) => strake(L, lo, hi, OCHRE, undefined, 0.04, 0.9)), strake(L, 0.86, 0.95, PAINT, { team: true }, 0, 0.94),
    // (The ports' lids open, and the guns.)
    ...o.bands.flatMap(([lo, hi], d) => [1, -1].flatMap((s) => o.ports.flatMap((z0) => { const z = z0 + d * 0.12, y = 0.01 + ((lo + hi) / 2) * (f.deck(z / L.len + 0.5) - 0.01); return [box(0.02, 0.1, 0.12, 0x14110e, { x: s * (f.wide(z) * 0.99 + 0.012), y, z }), gun(s * (f.wide(z) + 0.06), y, z, 0.2, s * Math.PI / 2)]; }))),
    // (The quarterdeck and its deck; the forecastle.)
    box(0.84 * k, 0.16, 1.15, DARK, { y: f.floor(aft) + 0.08, z: aft }), box(0.8 * k, 0.02, 1.13, DECK, { y: f.floor(aft) + 0.17, z: aft }), box(0.7 * k, 0.1, 0.5, DARK, { y: f.floor(h - 0.55) + 0.05, z: h - 0.55 }),
    // (The stern gallery: a tier of windows to a deck, the lantern over them.)
    ...Array.from({ length: tiers }, (_, t) => [box(0.74 * k, 0.24, 0.05, OCHRE, { y: L.free + t * 0.27, z: -h - 0.02 }), ...[-0.24, 0, 0.24].map((x) => box(0.15 * k, 0.12, 0.02, 0x1c2a36, { x: x * k, y: L.free + 0.02 + t * 0.27, z: -h - 0.05 }))]).flat(),
    rod(V(0, L.free + tiers * 0.27 - 0.02, -h - 0.01), V(0, L.free + tiers * 0.27 + 0.2, -h - 0.05), 0.012, 0.012, 3, GUNMETAL), ball(0.05, 0xe8c860, { y: L.free + tiers * 0.27 + 0.25, z: -h - 0.05 }),
    // (A hatch, and the ship's boat amidships.)
    box(0.3, 0.04, 0.34, 0x4a3a2a, { y: f.floor(0.65) + 0.02, z: 0.65 }), lp(hull([R([0, 0, -0.26], 0.05, 0.08), R([0, 0, 0], 0.06, 0.11), R([0, 0.01, 0.3], 0, 0)], 4, 0xd8d0bc, { side: [1, 0, 0] }), { y: f.floor(-0.45) + 0.07, z: -0.45 }),
    ...sails(0, 1.5 * k), ...sails(1, 1.7 * k), ...sails(2, 1.3 * k),
    // (The spanker on its gaff and boom, fore and aft behind the mizzen.)
    // (As long as the room from the mizzen to the stern allows: on a short ship it ran out past the stern, through the ensign.)
    ...(() => { const z = o.masts[2]![0], y = f.floor(z), n = Math.min(1.1, z + h + 0.1), u = n / 1.1; return [rod(V(0, y + 0.34 + 0.71 * u, z - 0.05), V(0, y + 0.34 + 0.96 * u, z - 0.05 - 0.95 * u), 0.012, 0.012, 3, WOOD), rod(V(0, y + 0.34, z - 0.05), V(0, y + 0.36, z - 0.05 - n), 0.014, 0.014, 3, WOOD),
      lp(plate([[0, 0], [n, 0.02], [0.95 * u, 0.96 * u], [0, 0.71 * u]], canvas), { y: y + 0.34, z: z - 0.05, ry: Math.PI / 2 })]; })(),
    // (The bowsprit and its jibs.)
    rod(V(0, f.floor(h - 0.25) + 0.05, h - 0.3), sprit, 0.026, 0.014, 4, WOOD),
    ...(() => { const [z, tall] = o.masts[0]!, y = f.floor(z); return [facets([V(0.01, y + tall * 0.9, z + 0.06), V(0.01, y + tall * 0.42, z + 0.06), sprit.clone().lerp(V(0, y + tall * 0.42, z), 0.12)], canvas),
      facets([V(-0.01, y + tall * 0.66, z + 0.08), V(-0.01, y + tall * 0.3, z + 0.08), sprit.clone().lerp(V(0, y + tall * 0.3, z), 0.42)], canvas)]; })(),
    // (Stays from mast to mast and to the bowsprit; shrouds down to the rail.)
    line(top(0), sprit), line(top(1), top(0)), line(top(2), top(1)), line(top(2), V(0, L.free + 0.3, -h)),
    ...o.masts.flatMap(([z, tall], i) => [1, -1].flatMap((s) => [line(V(0, f.floor(z) + tall * 0.62, z), V(s * f.wide(z - 0.28), f.deck((z - 0.28) / L.len + 0.5), z - 0.28)), ...(i < 2 ? [line(V(0, f.floor(z) + tall * 0.62, z), V(s * f.wide(z - 0.12), f.deck((z - 0.12) / L.len + 0.5), z - 0.12))] : [])])),
    lp(plate([[0, 0], [0.55, -0.035], [0, -0.07]], PAINT), { y: top(1).y + 0.02, z: o.masts[1]![0], ry: Math.PI / 2 }, { team: true }),
    rod(V(0, L.free + tiers * 0.27, -h + 0.03), V(0, L.free + tiers * 0.27 + 0.56, -h - 0.13), 0.01, 0.01, 3, WOOD), ensign(V(0, L.free + tiers * 0.27 + 0.54, -h - 0.15)),
  ];
}
// (A piece's colour changed where it is `from`: a privateer's dark canvas.)
function recolor(g: THREE.BufferGeometry, from: number, to: number): THREE.BufferGeometry {
  const a = new THREE.Color(from), b = new THREE.Color(to), col = g.getAttribute('color');
  for (let i = 0; i < col.count; i++) if (Math.abs(col.getX(i) - a.r) + Math.abs(col.getY(i) - a.g) + Math.abs(col.getZ(i) - a.b) < 0.01) col.setXYZ(i, b.r, b.g, b.b);
  return g;
}
const frigateShip = () => manOfWar({ len: 4.3, beam: 1.08, draught: 0.3, free: 0.5, bow: 0.14, stern: 0.26, transom: 0.72 }, { bands: [[0.36, 0.66]], ports: [-1.25, -0.8, -0.35, 0.1, 0.55, 1.0], masts: [[1.25, 2.5], [0.1, 2.95], [-1.15, 2.3]] });
// A ship of the line: a frigate's elder, broader and higher, two decks of guns, two tiers of stern windows, royals over her topgallants.
const lineShip = () => manOfWar({ len: 5.0, beam: 1.36, draught: 0.36, free: 0.74, bow: 0.14, stern: 0.3, transom: 0.76 }, { bands: [[0.2, 0.42], [0.54, 0.76]], ports: [-1.6, -1.15, -0.7, -0.25, 0.2, 0.65, 1.1], masts: [[1.5, 2.8], [0.15, 3.3], [-1.35, 2.6]], royals: true, tiers: 2 });
// A privateer: a fast, low, black raider, lighter than a frigate, one deck of a few guns, her canvas dark.
const privateerShip = () => manOfWar({ len: 3.6, beam: 0.9, draught: 0.26, free: 0.4, bow: 0.14, stern: 0.2, transom: 0.66 }, { bands: [[0.4, 0.66]], ports: [-0.85, -0.4, 0.05, 0.5], masts: [[1.05, 2.2], [0.05, 2.6], [-1.0, 2.0]], dark: 0x1e1a18, canvas: 0x4a4a4c });

// ---- steel ----
// A funnel at `z` on a deck at `y`, raked a little aft, its top blacked, a band of the owner's colour round it.
function funnel(z: number, y: number, h: number, r: number, color = STEEL_DARK, x = 0): THREE.BufferGeometry[] {
  const rake = 0.1;
  return [shape(new THREE.CylinderGeometry(r * 0.9, r, h, 8), color, { x, y: y + h / 2, z, rx: -rake }), shape(new THREE.CylinderGeometry(r * 0.93, r * 0.93, h * 0.14, 8), 0x1a1a1c, { x, y: y + h * 0.95, z: z - rake * h * 0.45, rx: -rake }),
    shape(new THREE.CylinderGeometry(r * 0.96, r * 0.98, h * 0.16, 8), PAINT, { x, y: y + h * 0.68, z: z - rake * h * 0.18, rx: -rake }, { team: true })];
}
// A gun turret on a deck at `y`: its barbette, its house (sloped to the front), `guns` barrels (`aft`: trained astern).
function gunTurret(z: number, y: number, k: number, guns: number, aft = false, x = 0): THREE.BufferGeometry[] {
  const d = aft ? -1 : 1;
  return [shape(new THREE.CylinderGeometry(0.17 * k, 0.18 * k, 0.07 * k, 8), STEEL_DARK, { x, y: y + 0.035 * k, z }),
    lp(hull([R([0, 0, -0.2 * k], 0.085 * k, 0.19 * k), R([0, 0, 0.1 * k], 0.085 * k, 0.2 * k), R([0, -0.02 * k, 0.26 * k], 0.05 * k, 0.13 * k)], 4, STEEL, { side: [1, 0, 0] }), { x, y: y + 0.15 * k, z, ry: aft ? Math.PI : 0 }),
    ...Array.from({ length: guns }, (_, i) => { const gx = x + (i - (guns - 1) / 2) * 0.1 * k; return rod(V(gx, y + 0.15 * k, z + d * 0.2 * k), V(gx, y + 0.2 * k, z + d * 0.82 * k), 0.022 * k, 0.018 * k, 4, GUNMETAL); })];
}
// A pole mast at `z` from `y`, `h` tall: a yard across it, a top, a flag of the owner's at its head.
const poleMast = (z: number, y: number, h: number) => [rod(V(0, y, z), V(0, y + h, z), 0.022, 0.012, 4, STEEL_DARK), rod(V(-0.22, y + h * 0.72, z), V(0.22, y + h * 0.72, z), 0.008, 0.008, 3, STEEL_DARK),
  shape(new THREE.CylinderGeometry(0.06, 0.045, 0.07, 6), STEEL_DARK, { y: y + h * 0.55, z }), lp(plate([[0, 0], [0.26, -0.02], [0.26, -0.12], [0, -0.14]], PAINT), { y: y + h, z, ry: Math.PI / 2 }, { team: true })];
// A steel hull: grey topsides over a red bottom, a dark line at the water.
const steelHull = (L: Lines, color = STEEL, deck = STEEL_DECK) => [...hullOf(L, color, BOOT, deck), strake(L, 0, 0.1, 0x1c1e22)];

// An ironclad: a low dark hull almost awash, an armoured casemate with sloped sides and guns at its ports, a
// pilot house, one tall funnel, the owner's colour along the casemate's top.
function ironcladShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 3.7, beam: 1.0, draught: 0.26, free: 0.2, bow: 0.04, stern: 0.02, transom: 0.4 }, f = linesOf(L), y = f.floor(0);
  return [...hullOf(L, DARK_HULL, 0x3a2c2a, 0x44464a),
    lp(hull([R([0, 0, -1.05], 0.001, 0.44), R([0, 0.17, -0.85], 0.17, 0.4), R([0, 0.17, 0.85], 0.17, 0.4), R([0, 0, 1.05], 0.001, 0.44)], 4, 0x3a3c40, { side: [1, 0, 0], caps: [false, false] }), { y }),
    box(0.62, 0.035, 1.72, PAINT, { y: y + 0.35 }, { team: true }),
    ...[1, -1].flatMap((s) => [-0.5, 0, 0.5].map((z) => gun(s * 0.44, y + 0.17, z, 0.22, s * Math.PI / 2))), gun(0, y + 0.15, 1.08, 0.3), gun(0, y + 0.15, -1.08, 0.3),
    box(0.26, 0.14, 0.26, 0x3a3c40, { y: y + 0.43, z: 0.55 }), ...funnel(-0.15, y + 0.36, 0.62, 0.12, 0x2a2a2c),
    rod(V(0, y + 0.36, -0.75), V(0, y + 1.0, -0.82), 0.012, 0.01, 3, STEEL_DARK), ensign(V(0, y + 0.98, -0.84), 0.3, 0.18),
    // (The ram under the bow.)
    lp(hull([R([0, -0.12, 1.6], 0.08, 0.1), R([0, -0.14, 2.0], 0, 0)], 4, 0x3a3c40, { side: [1, 0, 0] }))];
}
// A cruiser of the first steel navies: a ram bow, a gun in a turret fore and aft and more along her sides,
// a bridge, two funnels, two masts with their tops.
function cruiserShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 4.7, beam: 0.9, draught: 0.28, free: 0.4, bow: 0.1, stern: 0.04, transom: 0.35 }, f = linesOf(L), y = f.floor(0);
  return [...steelHull(L), strake(L, 0.8, 0.94, PAINT, { team: true }, 0.1, 0.9),
    box(0.56, 0.2, 2.0, STEEL, { y: y + 0.1, z: -0.1 }), box(0.4, 0.2, 0.42, STEEL, { y: y + 0.3, z: 0.7 }), box(0.5, 0.03, 0.5, STEEL_DARK, { y: y + 0.41, z: 0.72 }),
    ...funnel(0.2, y + 0.2, 0.62, 0.12), ...funnel(-0.4, y + 0.2, 0.62, 0.12), ...gunTurret(1.5, f.floor(1.5), 0.9, 1), ...gunTurret(-1.65, f.floor(-1.65), 0.9, 1, true),
    ...[1, -1].flatMap((s) => [-0.8, -0.2, 0.4].map((z) => gun(s * (f.wide(z) + 0.02), y + 0.1, z, 0.24, s * Math.PI / 2))),
    ...poleMast(1.0, y + 0.4, 1.3), ...poleMast(-1.0, y + 0.2, 1.3), ...[1, -1].map((s) => lp(hull([R([0, 0, -0.2], 0.04, 0.07), R([0, 0, 0.2], 0.03, 0.05)], 4, 0xd8d0bc, { side: [1, 0, 0] }), { x: s * 0.2, y: y + 0.26, z: -0.95 }))];
}
// A destroyer: long, lean and fast. A raised forecastle, a gun behind its shield forward and two aft, a
// bridge, two raked funnels, torpedo tubes between them, depth charges on the stern.
function destroyerShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 4.5, beam: 0.62, draught: 0.2, free: 0.3, bow: 0.2, stern: 0, transom: 0.4 }, f = linesOf(L), y = f.floor(0);
  const mount = (z: number, aft = false) => { const d = aft ? -1 : 1, yy = f.floor(z); return [box(0.2, 0.14, 0.06, STEEL, { y: yy + 0.11, z: z + d * 0.05 }), rod(V(0, yy + 0.1, z), V(0, yy + 0.15, z + d * 0.45), 0.02, 0.016, 4, GUNMETAL), shape(new THREE.CylinderGeometry(0.08, 0.09, 0.05, 6), STEEL_DARK, { y: yy + 0.025, z })]; };
  return [...steelHull(L), strake(L, 0.78, 0.94, PAINT, { team: true }, 0.55, 0.92),
    box(0.4, 0.14, 1.9, STEEL, { y: y + 0.07, z: -0.15 }), box(0.34, 0.26, 0.4, STEEL, { y: y + 0.27, z: 0.72 }), box(0.42, 0.03, 0.46, STEEL_DARK, { y: y + 0.41, z: 0.74 }),
    ...funnel(0.2, y + 0.14, 0.5, 0.09), ...funnel(-0.35, y + 0.14, 0.5, 0.09), ...mount(1.45), ...mount(-1.2, true), ...mount(-1.75, true),
    ...[-0.75, -0.95].map((z) => shape(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 5), STEEL_DARK, { y: y + 0.19, z, rz: Math.PI / 2, ry: 0.25 })),
    ...[1, -1].flatMap((s) => [-2.0, -2.1].map((z) => shape(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 5), 0x3a3c40, { x: s * 0.12, y: f.floor(z) + 0.04, z }))),
    ...poleMast(0.55, y + 0.42, 1.0)];
}
// A battleship: a broad armoured hull, three great turrets of three guns (two forward, one over the other,
// and one aft), a tall tower of a bridge, two funnels, lesser turrets along each side, a mast with its radar.
function battleshipShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 5.6, beam: 1.3, draught: 0.34, free: 0.44, bow: 0.16, stern: 0.02, transom: 0.4 }, f = linesOf(L), y = f.floor(0);
  return [...steelHull(L), strake(L, 0.8, 0.94, PAINT, { team: true }, 0.12, 0.9),
    box(0.8, 0.2, 2.5, STEEL, { y: y + 0.1, z: -0.2 }), box(0.56, 0.2, 1.5, STEEL, { y: y + 0.3, z: -0.15 }),
    // (The tower: decks stepped up to the director at its head.)
    box(0.46, 0.34, 0.5, STEEL, { y: y + 0.57, z: 0.42 }), box(0.56, 0.03, 0.6, STEEL_DARK, { y: y + 0.62, z: 0.46 }), box(0.3, 0.3, 0.32, STEEL, { y: y + 0.89, z: 0.4 }), box(0.4, 0.03, 0.4, STEEL_DARK, { y: y + 0.9, z: 0.42 }),
    shape(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8), STEEL_DARK, { y: y + 1.08, z: 0.4 }), box(0.46, 0.04, 0.06, STEEL_DARK, { y: y + 1.1, z: 0.4 }),
    ...funnel(-0.2, y + 0.4, 0.6, 0.14), ...funnel(-0.75, y + 0.4, 0.55, 0.13),
    ...gunTurret(1.95, f.floor(1.95), 1.35, 3), ...gunTurret(1.25, y + 0.2, 1.35, 3), ...gunTurret(-1.95, f.floor(-1.95), 1.35, 3, true),
    ...[1, -1].flatMap((s) => [...gunTurret(0.1, y + 0.2, 0.55, 2, false, s * 0.44), ...gunTurret(-0.95, y + 0.2, 0.55, 2, true, s * 0.44)]),
    ...poleMast(-1.15, y + 0.4, 1.25), box(0.34, 0.14, 0.03, 0x3a3c40, { y: y + 1.5, z: -1.15 }),
    rod(V(0, f.floor(-2.6), -2.6), V(0, f.floor(-2.6) + 0.5, -2.7), 0.01, 0.01, 3, STEEL_DARK), ensign(V(0, f.floor(-2.6) + 0.48, -2.72), 0.3, 0.18)];
}
// A carrier's flight deck over the water (this file's units, as drawn: unitView.ts stands her aircraft on it).
export const CARRIER_DECK = 1.02 * SHIP_SCALE;
// A carrier: a long flat flight deck over a hangar, its centre line and the owner's stripe painted on it, lifts
// let into it, the island with its funnel, mast and radar to starboard, aircraft parked aft.
function carrierShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 5.8, beam: 1.2, draught: 0.34, free: 0.5, bow: 0.1, stern: 0.02, transom: 0.5 }, f = linesOf(L), y = f.floor(0), D = 1.0;
  const plane = (x: number, z: number, turn: number) => [box(0.05, 0.04, 0.3, 0x4f6272, { x, y: D + 0.07, z, ry: turn }), box(0.36, 0.012, 0.09, 0x4f6272, { x, y: D + 0.075, z, ry: turn }), box(0.14, 0.012, 0.05, 0x4f6272, { x: x - Math.sin(turn) * 0.13, y: D + 0.092, z: z - Math.cos(turn) * 0.13, ry: turn })];
  return [...steelHull(L),
    box(1.0, D - y - 0.04, 4.9, STEEL, { y: (D + y) / 2 - 0.02, z: -0.1 }), box(1.5, 0.04, 5.9, 0x4a4e52, { y: D, z: 0 }),
    // (What is painted on the deck: each kind at a height of its own, clear of the deck and of the others, or they flicker.)
    box(0.03, 0.006, 5.4, 0xe8e6e0, { x: -0.36, y: D + 0.042, z: 0 }), box(1.46, 0.006, 0.14, PAINT, { y: D + 0.034, z: 2.4 }, { team: true }), box(1.46, 0.006, 0.14, PAINT, { y: D + 0.034, z: -2.6 }, { team: true }),
    box(0.4, 0.006, 0.5, 0x33363a, { x: 0.05, y: D + 0.026, z: 1.2 }), box(0.4, 0.006, 0.5, 0x33363a, { x: 0.05, y: D + 0.026, z: -1.4 }),
    // (The island.)
    box(0.24, 0.3, 1.0, STEEL, { x: 0.58, y: D + 0.17, z: 0.1 }), box(0.22, 0.16, 0.42, STEEL, { x: 0.58, y: D + 0.4, z: 0.32 }), box(0.3, 0.03, 0.5, STEEL_DARK, { x: 0.58, y: D + 0.49, z: 0.34 }),
    ...funnel(-0.2, D + 0.3, 0.36, 0.1, STEEL_DARK, 0.58), rod(V(0.58, D + 0.5, 0.3), V(0.58, D + 1.05, 0.3), 0.016, 0.01, 4, STEEL_DARK), box(0.26, 0.12, 0.03, 0x3a3c40, { x: 0.58, y: D + 0.92, z: 0.3 }),
    lp(plate([[0, 0], [0.24, -0.02], [0.24, -0.11], [0, -0.13]], PAINT), { x: 0.58, y: D + 1.05, z: 0.3, ry: Math.PI / 2 }, { team: true }),
    ...plane(-0.55, -1.75, 0.5), ...plane(0.3, -2.0, 0.35), ...plane(-0.5, -2.25, 0.6)];
}
// A submarine, running on the surface: a long round hull mostly under, a flat casing along its back, the
// conning tower with its periscopes and the owner's band, a deck gun, the bow planes.
function submarineShip(k = 1, nuclear = false): THREE.BufferGeometry[] {
  const pressure = nuclear
    ? lp(hull([R([0, -0.06, -2.0], 0, 0), R([0, -0.06, -1.4], 0.2, 0.2), R([0, -0.06, 0.9], 0.3, 0.3), R([0, -0.06, 1.7], 0.26, 0.26), R([0, -0.06, 2.05], 0.1, 0.1), R([0, -0.06, 2.12], 0, 0)], 8, 0x26282c, { side: [1, 0, 0] }))
    : lp(hull([R([0, -0.07, -1.8], 0, 0), R([0, -0.07, -1.2], 0.15, 0.17), R([0, -0.07, 0.6], 0.2, 0.23), R([0, -0.07, 1.45], 0.14, 0.15), R([0, -0.05, 1.85], 0, 0)], 8, DARK_HULL, { side: [1, 0, 0] }));
  const parts = nuclear ? [pressure,
    // (The sail forward, its planes; the rudder standing out of the water aft.)
    lp(hull([R([0, 0, -0.34], 0.2, 0.05), R([0, 0, 0.1], 0.2, 0.1), R([0, 0, 0.36], 0.2, 0.04)], 4, 0x26282c, { side: [1, 0, 0] }), { y: 0.4, z: 0.85 }), box(0.14, 0.05, 0.6, PAINT, { y: 0.56, z: 0.85 }, { team: true }),
    box(0.7, 0.02, 0.16, 0x26282c, { y: 0.42, z: 0.9 }), rod(V(0, 0.6, 0.95), V(0, 0.92, 0.95), 0.012, 0.01, 3, GUNMETAL), rod(V(0, 0.6, 0.78), V(0, 0.8, 0.78), 0.01, 0.01, 3, GUNMETAL),
    lp(plate([[0, 0], [0.34, 0], [0.2, 0.36], [0.04, 0.36]], 0x26282c, 0.03), { y: 0.02, z: -1.5, ry: Math.PI / 2 }),
    ...[-0.7, -0.4, -0.1, 0.2].flatMap((z) => [1, -1].map((s) => shape(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 6), 0x3a3c40, { x: s * 0.09, y: 0.235, z })))]
    : [pressure, box(0.2, 0.03, 2.5, 0x3a3c40, { y: 0.13, z: -0.05 }),
      lp(hull([R([0, 0, -0.26], 0.15, 0.05), R([0, 0, 0.05], 0.15, 0.09), R([0, 0, 0.26], 0.15, 0.04)], 4, DARK_HULL, { side: [1, 0, 0] }), { y: 0.3, z: 0.2 }), box(0.13, 0.05, 0.44, PAINT, { y: 0.42, z: 0.2 }, { team: true }),
      rod(V(0, 0.44, 0.26), V(0, 0.74, 0.26), 0.011, 0.009, 3, GUNMETAL), rod(V(0, 0.44, 0.12), V(0, 0.62, 0.12), 0.009, 0.009, 3, GUNMETAL),
      shape(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 6), 0x3a3c40, { y: 0.17, z: 0.85 }), rod(V(0, 0.2, 0.85), V(0, 0.25, 1.2), 0.016, 0.013, 4, GUNMETAL),
      box(0.5, 0.015, 0.12, DARK_HULL, { y: 0.02, z: 1.35 }), line(V(0, 0.74, 0.26), V(0, 0.15, 1.75)), line(V(0, 0.74, 0.26), V(0, 0.15, -1.6))];
  return k === 1 ? parts : parts.map((g) => g.applyMatrix4(new THREE.Matrix4().makeScale(k, k, k)));
}
// A missile cruiser: a clean modern hull, a gun forward, blocks of missile cells let into the deck fore and aft,
// a faceted bridge with its flat radar faces, a lattice mast, two funnels, a helicopter's deck on the stern.
function missileCruiserShip(): THREE.BufferGeometry[] {
  const L: Lines = { len: 5.2, beam: 0.98, draught: 0.28, free: 0.44, bow: 0.2, stern: 0, transom: 0.55 }, f = linesOf(L), y = f.floor(0), LIGHT = 0x9aa1a8;
  const cells = (z: number) => [box(0.46, 0.03, 0.62, 0x3a3e44, { y: f.floor(z) + 0.015, z }), ...[-0.2, 0, 0.2].flatMap((dz) => [-0.11, 0.11].map((x) => box(0.16, 0.012, 0.15, 0x26292e, { x, y: f.floor(z) + 0.036, z: z + dz })))];
  return [...steelHull(L, LIGHT), strake(L, 0.8, 0.94, PAINT, { team: true }, 0.5, 0.9),
    ...gunTurret(1.95, f.floor(1.95), 0.8, 1), ...cells(1.25), ...cells(-1.07),
    // (The bridge: faceted, a radar face to each quarter.)
    lp(hull([R([0, 0, -0.6], 0.3, 0.36), R([0, 0, 0.3], 0.3, 0.36), R([0, 0.05, 0.62], 0.2, 0.26)], 4, LIGHT, { side: [1, 0, 0] }), { y: y + 0.3, z: 0.45 }),
    lp(hull([R([0, 0, -0.3], 0.14, 0.26), R([0, 0, 0.26], 0.14, 0.22)], 4, LIGHT, { side: [1, 0, 0] }), { y: y + 0.74, z: 0.5 }),
    ...[1, -1].flatMap((s) => [0.25, 0.7].map((z) => lp(plate([[-0.09, -0.09], [0.09, -0.09], [0.13, 0], [0.09, 0.09], [-0.09, 0.09], [-0.13, 0]], 0x4a4f56), { x: s * 0.37, y: y + 0.38, z, ry: Math.PI / 2 }))),
    // (The lattice mast and its arrays; the funnels; the hangar and the pad.)
    rod(V(-0.08, y + 0.88, 0.35), V(0, y + 1.6, 0.4), 0.012, 0.008, 3, STEEL_DARK), rod(V(0.08, y + 0.88, 0.35), V(0, y + 1.6, 0.4), 0.012, 0.008, 3, STEEL_DARK), rod(V(0, y + 0.88, 0.55), V(0, y + 1.6, 0.4), 0.012, 0.008, 3, STEEL_DARK),
    box(0.36, 0.03, 0.03, STEEL_DARK, { y: y + 1.3, z: 0.4 }), box(0.22, 0.1, 0.03, 0x3a3c40, { y: y + 1.45, z: 0.42 }),
    lp(plate([[0, 0], [0.24, -0.02], [0.24, -0.11], [0, -0.13]], PAINT), { y: y + 1.62, z: 0.4, ry: Math.PI / 2 }, { team: true }),
    ...funnel(-0.35, y + 0.2, 0.5, 0.12, LIGHT, 0), box(0.6, 0.2, 0.72, LIGHT, { y: y + 0.1, z: -0.36 }), box(0.56, 0.3, 0.6, LIGHT, { y: f.floor(-1.75) + 0.15, z: -1.72 }),
    box(0.7, 0.01, 0.62, 0x3a3e44, { y: f.floor(-2.3) + 0.006, z: -2.25 }), shape(new THREE.CylinderGeometry(0.16, 0.16, 0.008, 8), 0xe8e6e0, { y: f.floor(-2.3) + 0.016, z: -2.25 }), shape(new THREE.CylinderGeometry(0.12, 0.12, 0.009, 8), 0x3a3e44, { y: f.floor(-2.3) + 0.026, z: -2.25 })];
}
function ship(type: UnitKey): THREE.BufferGeometry[] {
  const parts = ((): THREE.BufferGeometry[] => {
    switch (type) {
      case 'galley': return galleyShip();
      case 'trireme': return triremeShip();
      case 'cog': return cogShip();
      case 'caravel': return caravelShip();
      case 'galleass': return galleassShip();
      case 'frigate': return frigateShip();
      case 'privateer': return privateerShip();
      case 'shipOfTheLine': return lineShip();
      case 'ironclad': return ironcladShip();
      case 'cruiser': return cruiserShip();
      case 'destroyer': return destroyerShip();
      case 'battleship': return battleshipShip();
      case 'carrier': return carrierShip();
      case 'submarine': return submarineShip();
      case 'nuclearSubmarine': return submarineShip(1.15, true);
      case 'missileCruiser': return missileCruiserShip();
      default: return [];
    }
  })();
  const m = new THREE.Matrix4().makeScale(SHIP_SCALE, SHIP_SCALE, SHIP_SCALE);
  return parts.map((g) => g.applyMatrix4(m));
}

// The boat a land unit crosses the water in (embarked): a broad, round-hulled boat under a square sail in
// the owner's colour and a few oars, its people's goods stowed amidships under canvas.
function transport(): THREE.BufferGeometry[] {
  const L: Lines = { len: 2.7, beam: 1.0, draught: 0.2, free: 0.3, bow: 0.32, stern: 0.3, transom: 0.22 }, f = linesOf(L), m = new THREE.Matrix4().makeScale(SHIP_SCALE, SHIP_SCALE, SHIP_SCALE);
  return [
    ...hullOf(L, HULL_WOOD, 0x4a3524, DECK), strake(L, 0.7, 0.92, PAINT, { team: true }),
    rod(V(0, 0.45, 1.3), V(0, 0.98, 1.42), 0.03, 0.02, 4, HULL_WOOD), rod(V(0, 0.42, -1.3), V(0, 0.9, -1.4), 0.03, 0.02, 4, HULL_WOOD),
    ...rigged(0.2, f.floor(0.2), 1.75, [[0.3, 0.55, 1.45, true]]), line(V(0, f.floor(0.2) + 1.75, 0.2), V(0, 0.95, 1.4)), line(V(0, f.floor(0.2) + 1.75, 0.2), V(0, 0.88, -1.38)),
    // (Goods: crates, barrels, a bundle under canvas; thwarts across.)
    box(0.3, 0.2, 0.3, 0x8a6a42, { x: -0.16, y: f.floor(-0.45) + 0.1, z: -0.45, ry: 0.2 }), box(0.24, 0.18, 0.24, 0x9a7a4e, { x: 0.18, y: f.floor(-0.5) + 0.09, z: -0.52 }), box(0.22, 0.16, 0.22, 0x8a6a42, { x: 0.02, y: f.floor(-0.45) + 0.28, z: -0.47, ry: 0.5 }),
    ...[[-0.2, -0.85], [0.14, -0.9]].map(([x, z]) => shape(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 6), 0x6a4a30, { x: x!, y: f.floor(z!) + 0.11, z: z! })),
    lp(hull([R([0, 0, -0.3], 0.001, 0.2), R([0, 0.16, -0.12], 0.08, 0.24), R([0, 0.16, 0.14], 0.08, 0.24), R([0, 0, 0.32], 0.001, 0.2)], 4, 0xcfc4a4, { side: [1, 0, 0], caps: [false, false] }), { y: f.floor(0.75) + 0.02, z: 0.75 }),
    ...[-0.1, 0.45].map((z) => box(f.wide(z) * 1.8, 0.03, 0.1, WOOD, { y: f.floor(z) + 0.12, z })),
    ...oarBank(f, [-0.25, 0.1, 0.45], 0.26, 0.55), rod(V(0.12, 0.4, -1.2), V(0.2, -0.18, -1.5), 0.014, 0.03, 3, WOOD),
  ].map((g) => g.applyMatrix4(m));
}
export function transportModel(): THREE.BufferGeometry {
  const g = mergeGeometries(transport().map((p) => (p.getAttribute('aLimb') && !p.getAttribute('leafMask') ? p : tag(p))), false);
  if (!g) throw new Error('transportModel: parts don\'t merge');
  return g;
}

// ---- aircraft ----
// Parked on their city's ground (they fly when they strike: unitView.ts),
// nose to +z: a fuselage, wings (the upper one in the owner's colour), the
// tail, a propeller's disc.
const AIR_Y = 0.3;
// A missile or a bomb once it is on its way (variant IN_FLIGHT): the weapon
// alone, its launcher, cradle or pad left behind, lying along +z, its nose
// first, so it can be turned to the way it flies (unitView.ts).
export const IN_FLIGHT = 100;
function munition(type: UnitKey): THREE.BufferGeometry[] {
  const Y = 0.14;
  if (type === 'guidedMissile') return [lp(hull([R([0, Y, -0.5], 0.05), R([0, Y, 0.35], 0.05), R([0, Y, 0.55], 0, 0)], 4, 0xe8e6e0, { side: [1, 0, 0] })),
    box(0.105, 0.105, 0.1, PAINT, { y: Y, z: 0.1 }, { team: true }),
    ...[0, Math.PI / 2].map((r) => box(0.26, 0.012, 0.14, 0xc04030, { y: Y, z: -0.43, rz: r }))];
  if (type === 'atomicBomb') return [lp(hull([R([0, 0.24, -0.55], 0.06), R([0, 0.24, -0.3], 0.2), R([0, 0.24, 0.25], 0.22), R([0, 0.24, 0.45], 0, 0)], 6, 0x6a7066, { side: [1, 0, 0] })),
    box(0.46, 0.46, 0.06, PAINT, { y: 0.24, z: 0.05 }, { team: true }), ...[0, Math.PI / 2].map((r) => box(0.36, 0.02, 0.14, 0x4a4e48, { y: 0.24, z: -0.55, rz: r }))];
  // (The nuclear missile: the tall white rocket laid along its flight, its band, its fins at the tail.)
  return [lp(hull([R([0, Y, -0.85], 0.11), R([0, Y, 0.53], 0.11), R([0, Y, 0.88], 0, 0)], 6, 0xecebe6, { side: [1, 0, 0] })),
    box(0.235, 0.235, 0.14, PAINT, { y: Y, z: 0.1 }, { team: true }),
    ...[0, Math.PI / 2].map((r) => box(0.36, 0.02, 0.2, 0xc04030, { y: Y, z: -0.73, rz: r }))];
}
function aircraft(type: UnitKey): THREE.BufferGeometry[] {
  const body = (len: number, r: number, color: number) => lp(hull([R([0, AIR_Y, -len / 2], 0.02, 0.02), R([0, AIR_Y, -len * 0.1], r, r), R([0, AIR_Y, len * 0.35], r, r), R([0, AIR_Y, len / 2], r * 0.7, r * 0.7)], 4, color, { side: [1, 0, 0] }));
  const wing = (span: number, chord: number, y: number, z: number, color: number, team: boolean) => lp(plate([[-span / 2, -chord / 2], [span / 2, -chord / 2], [span / 2 * 0.95, chord / 2], [-span / 2 * 0.95, chord / 2]], color), { y, z, rx: -Math.PI / 2 }, team ? { team: true } : undefined);
  const tail = (len: number, color: number) => [wing(0.5, 0.18, AIR_Y, -len / 2 + 0.08, color, false), lp(plate([[0, 0], [0.2, 0], [0.05, 0.22]], color), { y: AIR_Y, z: -len / 2 + 0.02, ry: -Math.PI / 2 })];
  const prop = (x: number, z: number) => lp(plate([[-0.02, -0.18], [0.02, -0.18], [0.02, 0.18], [-0.02, 0.18]], 0x2a2420), { x, y: AIR_Y, z }, { spin: { axis: 'z', at: [x, AIR_Y] } });
  const gear = [1, -1].map((s) => rod(V(s * 0.1, AIR_Y - 0.05, 0.15), V(s * 0.14, 0.04, 0.18), 0.012, 0.012, 3, GUNMETAL));
  // (An airship: three quarters the size it was first drawn, one to a unit: two of them hid the city they were based in.)
  if (type === 'airship') return [lp(hull([R([0, AIR_Y + 0.75, -1.5], 0, 0), R([0, AIR_Y + 0.75, -1.0], 0.34, 0.34), R([0, AIR_Y + 0.75, 0.5], 0.42, 0.42), R([0, AIR_Y + 0.75, 1.25], 0.26, 0.26), R([0, AIR_Y + 0.75, 1.55], 0, 0)], 6, 0xd2cab8, { side: [1, 0, 0] })),
    // (Its envelope of doped canvas; a band of its civ's colour round it, and its fin.)
    lp(hull([R([0, AIR_Y + 0.75, -0.05], 0.428, 0.428), R([0, AIR_Y + 0.75, 0.4], 0.432, 0.432)], 6, PAINT, { side: [1, 0, 0], caps: [false, false] }), {}, { team: true }), box(0.2, 0.14, 0.5, 0x5a4a38, { y: AIR_Y + 0.2, z: 0.1 }),
    ...[1, -1].map((s) => rod(V(s * 0.08, AIR_Y + 0.27, 0.1), V(s * 0.2, AIR_Y + 0.45, 0.1), 0.008, 0.008, 3, GUNMETAL)), lp(plate([[0, 0], [0.5, 0], [0.15, 0.4]], PAINT), { y: AIR_Y + 0.75, z: -1.3, ry: -Math.PI / 2 }, { team: true })].map((g) => g.scale(0.75, 0.75, 0.75));
  if (type === 'jetFighter') return [body(1.3, 0.08, 0x8a9096), lp(plate([[-0.75, -0.25], [0.75, -0.25], [0.08, 0.35], [-0.08, 0.35]], PAINT), { y: AIR_Y, z: -0.1, rx: Math.PI / 2 }, { team: true }),
    ...tail(1.3, 0x8a9096), ...gear];
  if (type === 'heavyBomber') return [body(2.3, 0.15, 0x7a7e76), wing(3.4, 0.5, AIR_Y + 0.03, 0.15, PAINT, true), ...[0.55, 1.1, -0.55, -1.1].flatMap((x) => [lp(hull([R([x, AIR_Y - 0.02, -0.15], 0.055, 0.055), R([x, AIR_Y - 0.02, 0.42], 0.065, 0.065)], 4, 0x4a4e48, { side: [1, 0, 0] })), prop(x, 0.44)]),
    ...tail(2.3, 0x7a7e76), ...gear];
  if (type === 'helicopter') return [lp(hull([R([0, 0.32, -0.25], 0.16, 0.14), R([0, 0.32, 0.25], 0.17, 0.15), R([0, 0.28, 0.45], 0, 0)], 4, OLIVE, { side: [1, 0, 0] })), rod(V(0, 0.36, -0.25), V(0, 0.4, -1.0), 0.04, 0.025, 4, OLIVE),
    box(0.34, 0.03, 0.06, PAINT, { y: 0.16, z: 0 }, { team: true }), ...[1, -1].map((s) => rod(V(s * 0.16, 0.16, -0.2), V(s * 0.16, 0.16, 0.3), 0.012, 0.012, 3, GUNMETAL)),
    rod(V(0, 0.5, 0), V(0, 0.58, 0), 0.02, 0.02, 3, GUNMETAL), ...[0.5, -1.07].map((a) => lp(plate([[-0.9, -0.04], [0.9, -0.04], [0.9, 0.04], [-0.9, 0.04]], 0x1a1a1a).rotateX(-Math.PI / 2).rotateY(a), { y: 0.59 }, { spin: { axis: 'y', at: [0, 0] } })),
    lp(plate([[0, 0], [0.18, 0], [0.04, 0.2]], OLIVE), { y: 0.4, z: -1.0, ry: -Math.PI / 2 })];
  if (type === 'stealthFighter') return [body(1.3, 0.08, 0x3a3e44), lp(plate([[-0.7, -0.3], [0.7, -0.3], [0.1, 0.4], [-0.1, 0.4]], 0x3a3e44), { y: AIR_Y, z: -0.1, rx: Math.PI / 2 }),
    box(0.3, 0.012, 0.06, PAINT, { y: AIR_Y + 0.01, z: 0.1 }, { team: true }), ...[1, -1].map((s) => lp(plate([[0, 0], [0.25, 0], [0.05, 0.22]], 0x3a3e44), { x: s * 0.12, y: AIR_Y, z: -0.6, ry: -Math.PI / 2, rz: s * 0.4 })), ...gear];
  if (type === 'stealthBomber') return [lp(plate([[0, 0.8], [1.6, -0.3], [1.1, -0.45], [0.55, -0.2], [0, -0.45], [-0.55, -0.2], [-1.1, -0.45], [-1.6, -0.3]], 0x2e3036), { y: AIR_Y, rx: Math.PI / 2 }),
    lp(hull([R([0, AIR_Y, -0.4], 0.02, 0.12), R([0, AIR_Y + 0.05, 0.2], 0.08, 0.2), R([0, AIR_Y, 0.75], 0, 0)], 4, 0x2e3036, { side: [1, 0, 0] })), box(0.5, 0.012, 0.05, PAINT, { y: AIR_Y + 0.02, z: 0.3 }, { team: true }), ...gear];
  if (type === 'drone') return [body(0.8, 0.05, 0xb8bcc0), wing(1.6, 0.14, AIR_Y + 0.02, 0.05, 0xb8bcc0, false), ...[1, -1].map((s) => box(0.08, 0.01, 0.15, PAINT, { x: s * 0.76, y: AIR_Y + 0.03, z: 0.05 }, { team: true })),
    ...[1, -1].map((s) => lp(plate([[0, 0], [0.18, 0], [0.04, 0.14]], 0xb8bcc0), { x: s * 0.05, y: AIR_Y, z: -0.38, ry: -Math.PI / 2, rz: s * 0.7 })), prop(0, -0.42), ...gear];
  if (type === 'guidedMissile') return [box(0.3, 0.12, 0.8, OLIVE, { y: 0.06 }), box(0.25, 0.04, 0.9, PAINT, { y: 0.14 }, { team: true }), lp(hull([R([0, 0, -0.5], 0.05), R([0, 0, 0.35], 0.05), R([0, 0, 0.55], 0, 0)], 4, 0xe8e6e0, { side: [1, 0, 0] }), { y: 0.35, rx: -0.35 }),
    ...[1, -1].map((s) => lp(plate([[0, 0], [0.12, 0], [0, 0.12]], 0xc04030), { x: s * 0.04, y: 0.2, z: -0.42, rx: -0.35, ry: s > 0 ? 0 : Math.PI }))];
  // (The bomb on its cradle, fat, finned, a band of the owner's colour; the missile upright on its pad.)
  if (type === 'atomicBomb') return [box(0.5, 0.1, 0.9, OLIVE, { y: 0.05 }), ...[1, -1].map((s) => box(0.04, 0.2, 0.7, OLIVE, { x: s * 0.18, y: 0.18 })),
    lp(hull([R([0, 0, -0.55], 0.06), R([0, 0, -0.3], 0.2), R([0, 0, 0.25], 0.22), R([0, 0, 0.45], 0, 0)], 6, 0x6a7066, { side: [1, 0, 0] }), { y: 0.36 }),
    box(0.46, 0.04, 0.06, PAINT, { y: 0.36, z: 0.05 }, { team: true }), ...[0, Math.PI / 2].map((r) => box(0.36, 0.02, 0.14, 0x4a4e48, { y: 0.36, z: -0.55, rz: r }))];
  if (type === 'nuclearMissile') return [box(0.7, 0.08, 0.7, 0x7a7c78, { y: 0.04 }), ...[0, 1, 2, 3].map((i) => rod(V(Math.cos(i * Math.PI / 2) * 0.28, 0.08, Math.sin(i * Math.PI / 2) * 0.28), V(Math.cos(i * Math.PI / 2) * 0.1, 0.9, Math.sin(i * Math.PI / 2) * 0.1), 0.015, 0.012, 3, GUNMETAL)),
    lp(hull([R([0, 0.12, 0], 0.11), R([0, 1.5, 0], 0.11), R([0, 1.85, 0], 0, 0)], 6, 0xecebe6, { side: [0, 0, 1] })), lp(hull([R([0, 1.0, 0], 0.115), R([0, 1.14, 0], 0.115)], 6, PAINT, { side: [0, 0, 1], caps: [false, false] }), {}, { team: true }),
    ...[0, Math.PI / 2].map((r) => box(0.36, 0.2, 0.02, 0xc04030, { y: 0.24, ry: r }))];
  if (type === 'attackHelicopter') return [...aircraft('helicopter'), ...[1, -1].flatMap((s) => [box(0.3, 0.02, 0.1, OLIVE, { x: s * 0.25, y: 0.3, z: 0.05 }), shape(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 5), GUNMETAL, { x: s * 0.36, y: 0.27, z: 0.08, rx: Math.PI / 2 })])];
  if (type === 'fighter') return [body(1.0, 0.09, OLIVE), wing(1.4, 0.3, AIR_Y + 0.22, 0.12, PAINT, true), wing(1.3, 0.28, AIR_Y - 0.06, 0.12, OLIVE, false),
    ...[1, -1].map((s) => rod(V(s * 0.5, AIR_Y - 0.06, 0.12), V(s * 0.5, AIR_Y + 0.22, 0.12), 0.01, 0.01, 3, WOOD)), ...tail(1.0, OLIVE), prop(0, 0.51), ...gear];
  return [body(1.8, 0.13, 0x6a6e66), wing(2.6, 0.45, AIR_Y + 0.02, 0.15, PAINT, true), ...[1, -1].flatMap((s) => [lp(hull([R([s * 0.55, AIR_Y - 0.02, -0.2], 0.06, 0.06), R([s * 0.55, AIR_Y - 0.02, 0.4], 0.07, 0.07)], 4, 0x4a4e48, { side: [1, 0, 0] })), prop(s * 0.55, 0.42)]),
    ...tail(1.8, 0x6a6e66), ...gear];
}

// An anti-aircraft gun: four outriggers on their pads, a turntable, the mount between two side plates (a band
// of the owner's colour over them), twin long barrels with flared muzzles raised to the sky, a shield either side.
function antiAircraft(): THREE.BufferGeometry[] {
  return [
    ...[0, Math.PI / 2].map((r) => box(1.04, 0.05, 0.09, OLIVE, { y: 0.07, ry: r + Math.PI / 4 })),
    ...(FINE ? [0, 1, 2, 3].map((k) => { const a = Math.PI / 4 + (k * Math.PI) / 2; return shape(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 6), GUNMETAL, { x: 0.5 * Math.cos(a), y: 0.02, z: 0.5 * Math.sin(a) }); }) : []),
    shape(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 8), OLIVE_DARK, { y: 0.15 }),
    ...[1, -1].map((s) => slab([[-0.16, 0.2], [0.16, 0.2], [0.1, 0.5], [-0.12, 0.5]], 0.03, OLIVE, s * 0.15)),
    box(0.36, 0.035, 0.26, PAINT, { y: 0.515, z: -0.01 }, { team: true }),
    box(0.2, 0.16, 0.34, OLIVE_DARK, { y: 0.42, z: 0.02, rx: -0.75 }),
    ...[1, -1].flatMap((s) => barrel(V(s * 0.055, 0.44, 0.04), 0.86, 0.75, 0.026, 0.02, GUNMETAL, [[0.2, 0.034, 0.12], [0.97, 0.034, 0.06]], 6)),
    ...[1, -1].map((s) => box(0.24, 0.3, 0.02, OLIVE, { x: s * 0.29, y: 0.46, z: 0.16, rx: -0.35, ry: s * -0.25 })),
    ...(FINE ? [box(0.12, 0.1, 0.16, OLIVE_DARK, { x: 0.2, y: 0.26, z: -0.2 }), rod(V(-0.2, 0.5, 0), V(-0.2, 0.68, 0.06), 0.008, 0.008, 3, GUNMETAL), box(0.06, 0.06, 0.01, GUNMETAL, { x: -0.2, y: 0.7, z: 0.07, rx: -0.75 })] : []),
  ];
}

const MACHINES: ReadonlySet<UnitKey> = new Set<UnitKey>(['catapult', 'trebuchet', 'cannon', 'gatlingGun', 'artillery', 'antiTank', 'landship', 'tank', 'antiAircraft',
  'fieldCannon', 'modernArmor', 'mechanizedInfantry', 'rocketArtillery', 'mobileSAM', 'privateer', 'shipOfTheLine', 'missileCruiser', 'nuclearSubmarine',
  'stealthFighter', 'stealthBomber', 'attackHelicopter', 'drone', 'guidedMissile', 'atomicBomb', 'nuclearMissile',
  'galley', 'trireme', 'galleass', 'cog', 'caravel', 'frigate', 'ironclad', 'cruiser', 'destroyer', 'battleship', 'submarine', 'carrier',
  'airship', 'fighter', 'jetFighter', 'bomber', 'heavyBomber', 'helicopter']);
export const isMachine = (type: UnitKey): boolean => MACHINES.has(type);
// Where a land machine's shot leaves it (its muzzle, or the head of what it throws: model units, [up, forward]
// of where it stands; the field cannon's as its smaller model has it). Others shoot from a figure's hands (null).
const MUZZLES: Partial<Record<UnitKey, readonly [number, number]>> = {
  cannon: [0.57, 0.7], fieldCannon: [0.45, 0.55], artillery: [0.72, 0.92], gatlingGun: [0.5, 0.6], antiTank: [0.38, 1.05],
  landship: [0.31, 0.54], tank: [0.66, 1.2], modernArmor: [0.53, 1.52], mechanizedInfantry: [0.65, 0.58],
  antiAircraft: [1.03, 0.67], rocketArtillery: [0.93, 0.16], mobileSAM: [1.0, 0.18], catapult: [0.85, 0.2], trebuchet: [1.9, 0.2],
};
export const muzzleOf = (type: UnitKey): readonly [number, number] | null => MUZZLES[type] ?? null;

// ---- hair ----
// Hair, drawn apart from the figures (an instanced mesh per style, shared by
// every unit and civ), each figure with its own style and colour (the
// instance colour: hair is all team-tagged white). Modelled on a head on
// foot (a rider's sits RIDER_HEAD higher).
export const RIDER_HEAD = SEAT - HIP;
export const HAIR_STYLES = HAIR_STYLE_KEYS;
export type HairStyle = HairStyleKey;
// The styles each wears, drawn from (repeated: more often), bareheaded and
// under a helmet (only what shows below it: 'bald' there shows none).
export const HAIR_BY: Record<'man' | 'woman', { bare: readonly HairStyle[]; helmet: readonly HairStyle[] }> = {
  man: { bare: ['short', 'short', 'short', 'beard', 'beard', 'bald', 'long', 'tail'], helmet: ['bald', 'bald', 'helmBeard', 'helmLong'] },
  woman: { bare: ['long', 'long', 'bun', 'bun', 'tail', 'tail', 'short'], helmet: ['helmLong', 'helmLong', 'bald'] },
};
export function hairModel(style: HairStyle): THREE.BufferGeometry {
  const g = mergeGeometries(hairShapes(style).map((p) => tag(p, { team: true })), false);
  if (!g) throw new Error(`hairModel: ${style} parts don't merge`);
  return heroicHead(g); // (as large as the head it grows on)
}
// Whether a type's figures wear helmets (their hair then mostly hidden).
// (Always: knights, lancers and modern soldiers; others as their civ goes.)
const HELMETED: ReadonlySet<UnitKey> = new Set<UnitKey>(['horseArcher', 'spearman', 'horseman', 'commander', 'swordsman', 'compositeBowman', 'longswordsman', 'pikeman', 'crossbowman', 'musketman', 'rifleman', 'cavalry']);
export const wearsHelmet = (type: UnitKey, civ: ArchCiv): boolean =>
  type === 'knight' || type === 'lancer' || type === 'infantry' || type === 'machineGun' || type === 'manAtArms' || type === 'explorer' || type === 'greatWarInfantry' || type === 'marine' || type === 'specialForces' || type === 'paratrooper' || (HELMETED.has(type) && GEAR[civ].helmet !== 'none');

// ---- who serves ----
// The share of women among a unit's figures: about half of the civilians
// (settlers, scouts), one soldier in ten; half of everyone once their
// civ has women's suffrage (a civic).
export const WOMEN = { civilian: 0.5, soldier: 0.1, suffrage: 0.5 } as const;
export const womenShare = (type: UnitKey, suffrage: boolean): number =>
  suffrage ? WOMEN.suffrage : UNIT_LOOK[type].party === 'group' ? WOMEN.civilian : WOMEN.soldier;

// What a unit shows, and how many: a formation of up to FORMATION figures
// for fighting units (fewer as it is hurt), a small party for the others.
export const FORMATION = { cols: 4, rows: 3 } as const;
export const FULL_FORMATION = FORMATION.cols * FORMATION.rows;
// Fighting units' figures shown at `hp` (of 100), of `full` at full
// strength: soldiers one per 8 HP or part of it (at most a dozen), machines
// one per a share of it.
export const figuresFor = (hp: number, full = FULL_FORMATION): number =>
  Math.max(1, Math.min(full, full === FULL_FORMATION ? Math.ceil(hp / 8) : Math.ceil((hp * full) / 100)));

// Horsed units show fewer figures (a horse and rider are twice a figure on foot).
export const HORSE_COUNT = 6;
export interface UnitLook {
  readonly party: 'formation' | 'group'; // a fighting formation, or a small party
  readonly count: number;                // figures at full strength
  readonly spacing: readonly [number, number]; // between figures, across and front to back (model units)
  readonly cols?: number;                // a formation's ranks are this wide (default FORMATION.cols)
}
export const UNIT_LOOK: Record<UnitKey, UnitLook> = {
  warrior:  { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  spearman: { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  archer:   { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  horseman: { party: 'formation', count: HORSE_COUNT, cols: 3, spacing: [0.6, 1.05] },
  scout:    { party: 'group', count: 2, spacing: [0.5, 0.5] },
  commander: { party: 'group', count: 2, spacing: [0.75, 0.5] },
  swordsman:   { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  pikeman:     { party: 'formation', count: FULL_FORMATION, spacing: [0.5, 0.55] },
  crossbowman: { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  knight: { party: 'formation', count: HORSE_COUNT, cols: 3, spacing: [0.62, 1.1] },
  settler:  { party: 'group', count: 4, spacing: [0.55, 0.55] },
  worker:   { party: 'group', count: 2, spacing: [0.55, 0.5] },
  missionary: { party: 'group', count: 2, spacing: [0.55, 0.5] },
  musketman: { party: 'formation', count: FULL_FORMATION, spacing: [0.52, 0.58] },
  rifleman:  { party: 'formation', count: FULL_FORMATION, spacing: [0.52, 0.58] },
  infantry:  { party: 'formation', count: FULL_FORMATION, spacing: [0.6, 0.62] },
  cavalry: { party: 'formation', count: HORSE_COUNT, cols: 3, spacing: [0.6, 1.05] },
  cannon:    { party: 'formation', count: 4, cols: 2, spacing: [0.95, 1.3] },
  artillery: { party: 'formation', count: 4, cols: 2, spacing: [1.0, 1.5] },
  tank:      { party: 'formation', count: 4, cols: 2, spacing: [1.1, 1.9] },
  chariotArcher:   { party: 'formation', count: 6, cols: 3, spacing: [0.8, 2.0] },
  compositeBowman: { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  catapult:        { party: 'formation', count: 4, cols: 2, spacing: [1.05, 1.5] },
  longswordsman:   { party: 'formation', count: FULL_FORMATION, spacing: [0.58, 0.62] },
  trebuchet:       { party: 'formation', count: 2, cols: 2, spacing: [1.5, 1.6] },
  lancer:          { party: 'formation', count: HORSE_COUNT, cols: 3, spacing: [0.6, 1.05] },
  gatlingGun:      { party: 'formation', count: 4, cols: 2, spacing: [0.9, 1.2] },
  machineGun:      { party: 'formation', count: FULL_FORMATION, spacing: [0.6, 0.62] },
  antiTank:        { party: 'formation', count: 4, cols: 2, spacing: [1.0, 1.4] },
  landship:        { party: 'formation', count: 4, cols: 2, spacing: [1.2, 2.0] },
  galley:     { party: 'formation', count: 3, cols: 3, spacing: [0.99, 1.81] },
  trireme:    { party: 'formation', count: 3, cols: 3, spacing: [1.07, 2.06] },
  galleass:   { party: 'formation', count: 2, cols: 2, spacing: [1.29, 2.15] },
  caravel:    { party: 'formation', count: 2, cols: 2, spacing: [0.95, 1.81] },
  frigate:    { party: 'formation', count: 2, cols: 2, spacing: [1.07, 2.32] },
  ironclad:   { party: 'formation', count: 2, cols: 2, spacing: [0.95, 1.98] },
  destroyer:  { party: 'formation', count: 3, cols: 3, spacing: [0.73, 2.32] },
  battleship: { party: 'formation', count: 2, cols: 2, spacing: [1.16, 2.75] },
  fighter:    { party: 'formation', count: 3, cols: 3, spacing: [2.0, 1.4] },
  bomber:     { party: 'formation', count: 2, cols: 2, spacing: [3.3, 2.2] },
  cog:        { party: 'formation', count: 2, cols: 2, spacing: [1.03, 1.72] },
  cruiser:    { party: 'formation', count: 2, cols: 2, spacing: [0.9, 2.41] },
  submarine:  { party: 'formation', count: 3, cols: 3, spacing: [0.77, 1.98] },
  carrier:    { party: 'formation', count: 1, cols: 1, spacing: [1.29, 2.92] },
  airship:    { party: 'formation', count: 1, cols: 1, spacing: [1.5, 3.6] },
  heavyBomber: { party: 'formation', count: 2, cols: 2, spacing: [4.1, 2.8] },
  jetFighter: { party: 'formation', count: 3, cols: 3, spacing: [2.0, 1.8] },
  helicopter: { party: 'formation', count: 3, cols: 3, spacing: [2.4, 2.4] },
  antiAircraft: { party: 'formation', count: 4, cols: 2, spacing: [1.1, 1.2] },
  slinger:          { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  horseArcher:      { party: 'formation', count: HORSE_COUNT, cols: 3, spacing: [0.6, 1.05] },
  manAtArms:        { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  explorer:         { party: 'group', count: 2, spacing: [0.5, 0.5] },
  fieldCannon:      { party: 'formation', count: 4, cols: 2, spacing: [0.85, 1.2] },
  greatWarInfantry: { party: 'formation', count: FULL_FORMATION, spacing: [0.55, 0.6] },
  marine:           { party: 'formation', count: FULL_FORMATION, spacing: [0.6, 0.62] },
  mechanizedInfantry: { party: 'formation', count: 4, cols: 2, spacing: [1.0, 1.7] },
  specialForces:    { party: 'formation', count: 8, cols: 4, spacing: [0.6, 0.62] },
  paratrooper:      { party: 'formation', count: FULL_FORMATION, spacing: [0.6, 0.62] },
  modernArmor:      { party: 'formation', count: 4, cols: 2, spacing: [1.1, 1.9] },
  rocketArtillery:  { party: 'formation', count: 4, cols: 2, spacing: [1.0, 1.6] },
  mobileSAM:        { party: 'formation', count: 4, cols: 2, spacing: [1.0, 1.6] },
  privateer:        { party: 'formation', count: 2, cols: 2, spacing: [0.95, 1.98] },
  shipOfTheLine:    { party: 'formation', count: 2, cols: 2, spacing: [1.25, 2.58] },
  missileCruiser:   { party: 'formation', count: 2, cols: 2, spacing: [0.99, 2.58] },
  nuclearSubmarine: { party: 'formation', count: 2, cols: 2, spacing: [0.86, 2.41] },
  stealthFighter:   { party: 'formation', count: 3, cols: 3, spacing: [2.0, 1.8] },
  stealthBomber:    { party: 'formation', count: 2, cols: 2, spacing: [3.9, 2.0] },
  attackHelicopter: { party: 'formation', count: 3, cols: 3, spacing: [2.4, 2.4] },
  drone:            { party: 'formation', count: 3, cols: 3, spacing: [2.1, 1.3] },
  guidedMissile:    { party: 'formation', count: 2, cols: 2, spacing: [0.8, 1.4] },
  atomicBomb:       { party: 'formation', count: 1, cols: 1, spacing: [1, 1] },
  nuclearMissile:   { party: 'formation', count: 1, cols: 1, spacing: [1, 1] },
};
// A unit's figures at full strength, and its formation's width.
export const fullCount = (type: UnitKey): number => UNIT_LOOK[type].count;
export const colsOf = (type: UnitKey, n: number): number => {
  const look = UNIT_LOOK[type];
  return look.party === 'formation' ? look.cols ?? FORMATION.cols : Math.ceil(Math.sqrt(n));
};

// Where a unit's figures stand (model units: x across, z forward, around
// its middle), so many as it shows at `hp`: in ranks, the front one full
// first (a hurt formation loses men from the back); a party loosely.
// `rand` jitters them (none: exact ranks).
export function formationSlots(type: UnitKey, hp: number, rand?: () => number): [number, number][] {
  const look = UNIT_LOOK[type];
  const n = look.party === 'formation' ? figuresFor(hp, look.count) : look.count;
  const cols = colsOf(type, look.count);
  const rows = Math.ceil(look.count / cols);
  const jitter = look.party === 'group' ? 0.35 : 0.08, j = () => (rand ? (rand() - 0.5) * jitter : 0);
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = r === Math.floor((n - 1) / cols) ? n - r * cols : cols;
    return [(c - (inRow - 1) / 2 + j()) * look.spacing[0], ((rows - 1) / 2 - r + j()) * look.spacing[1]];
  });
}

// One figure of a unit type, dressed for a civ (each instance draws its own
// horse coat from a few: the variant).
// (`fine`: its people in the finer body (people.ts finePerson), for when it
// is seen close; else the plain one, for far off.)
export function unitModel(type: UnitKey, civ: ArchCiv, variant = 0, female = false, fine = true): THREE.BufferGeometry {
  FINE = fine; CIV = civ;
  const gear = GEAR[civ];
  const parts = (() => {
    switch (type) {
      case 'warrior': return figure(gear, 'club', true, { helmet: false, female });
      case 'spearman': return figure(gear, 'spear', true, { helmet: true, female });
      case 'archer': return figure(gear, 'bow', false, { helmet: false, quiver: true, female });
      case 'horseman': return rider(gear, HORSE[variant % HORSE.length]!, female, 'horseman');
      case 'chariotArcher': return chariot(gear, HORSE[variant % HORSE.length]!, female);
      case 'compositeBowman': return figure(gear, 'recurve', false, { helmet: true, quiver: true, female });
      case 'catapult': return catapult();
      case 'longswordsman': return figure(gear, 'longsword', false, { armor: 'plate', helmet: true, female });
      case 'trebuchet': return trebuchet();
      case 'lancer': return rider(gear, HORSE[variant % HORSE.length]!, female, 'lancer');
      case 'gatlingGun': return gatling();
      case 'machineGun': return figure(gear, 'mg', false, { helmet: true, female, modern: true });
      case 'antiTank': return antiTank();
      case 'landship': return landship();
      case 'galley': case 'trireme': case 'galleass': case 'cog': case 'caravel': case 'frigate': case 'ironclad': case 'cruiser': case 'destroyer': case 'battleship':
      case 'submarine': case 'carrier': return ship(type);
      case 'fighter': case 'jetFighter': case 'bomber': case 'heavyBomber': case 'airship': case 'helicopter': return aircraft(type);
      case 'antiAircraft': return antiAircraft();
      case 'slinger': return figure(gear, 'sling', false, { helmet: false, female });
      case 'horseArcher': return horseArcher(gear, HORSE[variant % HORSE.length]!, female);
      case 'manAtArms': return figure(gear, 'sword', true, { armor: 'mail', helmet: true, helmetAs: HEAVY_HELMET(gear.helmet), shieldAs: 'kite', female });
      case 'explorer': return figure(gear, 'staff', false, { helmet: true, helmetAs: 'hat', pack: true, female, civilian: true });
      case 'fieldCannon': return fieldCannon();
      case 'greatWarInfantry': return figure(gear, 'boltRifle', false, { helmet: true, female, modern: true });
      case 'marine': return figure(gear, 'smg', false, { helmet: true, helmetAs: 'cap', female, modern: true, pack: true });
      case 'mechanizedInfantry': return apc();
      case 'specialForces': return figure(gear, 'carbine', false, { helmet: true, helmetAs: 'beret', female, modern: true });
      case 'paratrooper': return figure(gear, 'assaultRifle', false, { helmet: true, helmetAs: 'kettle', female, modern: true, pack: true, quiver: false });
      case 'modernArmor': return modernArmor();
      case 'rocketArtillery': return rocketArtillery();
      case 'mobileSAM': return mobileSAM();
      case 'privateer': case 'shipOfTheLine': case 'missileCruiser': case 'nuclearSubmarine': return ship(type);
      case 'stealthFighter': case 'stealthBomber': case 'attackHelicopter': case 'drone': return aircraft(type);
      case 'guidedMissile': case 'atomicBomb': case 'nuclearMissile': return variant >= IN_FLIGHT ? munition(type) : aircraft(type);
      case 'scout': return figure(gear, 'staff', false, { helmet: false, pack: true, female, civilian: true });
      case 'settler': return figure(gear, variant % 2 ? 'staff' : 'none', false, { pack: variant % 2 === 0, female, civilian: true });
      case 'worker': return figure(gear, 'hoe', false, { female, civilian: true });
      // (A missionary: robed to the ankles, bare-headed, a pilgrim's staff with its bell in hand; one of the two carries the books on its back.)
      case 'missionary': return figure(gear, 'pilgrim', false, { helmet: false, pack: variant % 2 === 0, female, civilian: true, robe: true });
      // (Its two figures: the commander mounted, and the standard-bearer.)
      case 'swordsman': return figure(gear, 'sword', true, { armor: 'mail', helmet: true, female });
      case 'pikeman': return figure(gear, 'pike', false, { armor: 'plate', helmet: true, female });
      case 'crossbowman': return figure(gear, 'crossbow', false, { armor: 'mail', helmet: true, quiver: true, female });
      case 'knight': return rider(gear, HORSE[variant % HORSE.length]!, female, 'knight');
      case 'musketman': return figure(gear, 'musket', false, { helmet: true, female });
      case 'rifleman': return figure(gear, 'rifle', false, { helmet: true, female });
      case 'infantry': return figure(gear, 'selfLoader', false, { helmet: true, female, modern: true, pack: true });
      case 'cavalry': return rider(gear, HORSE[variant % HORSE.length]!, female, 'cavalry');
      case 'cannon': return cannon();
      case 'artillery': return artillery();
      case 'tank': return tank();
      case 'commander': return variant === 0 ? rider(gear, HORSE[0], female, 'officer') : figure(gear, 'banner', false, { helmet: true, female });
    }
  })();
  // (Every part tagged, none with a leaf mask: their attributes must match.)
  // (A textured body: its texture coordinates; the rest (weapons, shields) none: -1, untextured.)
  const texture = parts.find((p) => typeof p.userData['texture'] === 'string')?.userData['texture'] as string | undefined;
  if (texture) for (const p of parts) if (!p.getAttribute('uv')) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.getAttribute('position').count * 2).fill(-1), 2));
  const g = mergeGeometries(parts.map((p) => (p.getAttribute('aLimb') && !p.getAttribute('leafMask') ? p : tag(p))), false);
  if (!g) throw new Error(`unitModel: ${type} parts don't merge`);
  if (texture) g.userData['texture'] = texture;
  return g;
}
// How many variants of a type's model there are (instances pick among them).
const HORSED: ReadonlySet<UnitKey> = new Set<UnitKey>(['horseman', 'chariotArcher', 'horseArcher', 'knight', 'lancer', 'cavalry']);
export const unitVariants = (type: UnitKey): number => (HORSED.has(type) ? HORSE.length : type === 'settler' || type === 'commander' ? 2 : 1);
// The model variant of a unit's i-th figure (a commander's are set: first
// the commander, then the standard-bearer; others drawn).
export const variantOf = (type: UnitKey, i: number, rand: () => number): number =>
  type === 'commander' ? i % 2 : Math.floor(rand() * unitVariants(type));
// Whether a figure is horsed (its shadow longer), and where its head is
// (hair: over a figure on foot's, up and forward or back in model units):
// a rider's up in the saddle, a chariot archer's back in the car.
export const rides = (type: UnitKey, variant: number): boolean => HORSED.has(type) || (type === 'commander' && variant === 0);
export const headOffset = (type: UnitKey, variant: number): readonly [number, number] =>
  type === 'chariotArcher' ? [CAR_FLOOR, CAR_Z] : rides(type, variant) ? [RIDER_HEAD, 0] : [0, 0];
