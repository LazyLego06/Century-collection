import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type VehicleKind = 'sports' | 'sedan' | 'suv' | 'police' | 'taxi';

export interface VehicleSpec {
  kind: VehicleKind;
  name: string;
  width: number; length: number; bodyH: number;
  wheelR: number; axleZ: number; trackX: number;
  mass: number; engine: number; maxSpeed: number; brake: number; steerMax: number;
  grip: number; suspStiff: number; suspRest: number; rearDrive: boolean; frontDrive: boolean;
  colors: number[];
  maxHealth: number;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  sports: {
    kind: 'sports', name: 'Vortex RS', width: 1.95, length: 4.4, bodyH: 0.5, wheelR: 0.34, axleZ: 1.38, trackX: 0.84,
    mass: 1250, engine: 9500, maxSpeed: 64, brake: 70, steerMax: 0.5, grip: 3.2, suspStiff: 42, suspRest: 0.26, rearDrive: true, frontDrive: false,
    colors: [0xff2fa0, 0x00d2ff, 0xffd23f, 0xff5a1f, 0xffffff, 0x18181c, 0x7d3cff], maxHealth: 900,
  },
  sedan: {
    kind: 'sedan', name: 'Monarch Sedan', width: 1.9, length: 4.6, bodyH: 0.6, wheelR: 0.35, axleZ: 1.42, trackX: 0.82,
    mass: 1400, engine: 7800, maxSpeed: 46, brake: 60, steerMax: 0.55, grip: 2.6, suspStiff: 34, suspRest: 0.3, rearDrive: false, frontDrive: true,
    colors: [0xd9d9d9, 0x2a3f6e, 0x7a1a1a, 0x1e1e22, 0x5d6b52, 0xc9b28a, 0x8aa6c1], maxHealth: 1000,
  },
  suv: {
    kind: 'suv', name: 'Bayline XL', width: 2.05, length: 4.9, bodyH: 0.8, wheelR: 0.42, axleZ: 1.55, trackX: 0.9,
    mass: 2100, engine: 8800, maxSpeed: 42, brake: 80, steerMax: 0.5, grip: 2.4, suspStiff: 32, suspRest: 0.36, rearDrive: true, frontDrive: true,
    colors: [0x111114, 0xf2f2f2, 0x3b4a3b, 0x6b2b2b, 0x2b3b5b], maxHealth: 1400,
  },
  police: {
    kind: 'police', name: 'VPPD Interceptor', width: 1.95, length: 4.8, bodyH: 0.6, wheelR: 0.36, axleZ: 1.48, trackX: 0.84,
    mass: 1600, engine: 9000, maxSpeed: 56, brake: 75, steerMax: 0.52, grip: 2.9, suspStiff: 38, suspRest: 0.3, rearDrive: true, frontDrive: false,
    colors: [0xf5f5f5], maxHealth: 1300,
  },
  taxi: {
    kind: 'taxi', name: 'Paradise Cab', width: 1.9, length: 4.6, bodyH: 0.6, wheelR: 0.35, axleZ: 1.42, trackX: 0.82,
    mass: 1400, engine: 7600, maxSpeed: 44, brake: 60, steerMax: 0.55, grip: 2.6, suspStiff: 34, suspRest: 0.3, rearDrive: false, frontDrive: true,
    colors: [0xffc21a], maxHealth: 1000,
  },
};

export const KINDS: VehicleKind[] = ['sports', 'sedan', 'suv', 'police', 'taxi'];

function cbox(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Tapered box (narrower top) for cabins — gives a less boxy silhouette at the same cost. */
function cabin(w: number, h: number, d: number, x: number, y: number, z: number, color: number, taperX = 0.85, taperZ = 0.7, shiftZ = 0) {
  const g = cbox(w, h, d, x, y, z, color);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > y) {
      p.setX(i, x + (p.getX(i) - x) * taperX);
      p.setZ(i, z + (p.getZ(i) - z) * taperZ + shiftZ);
    }
  }
  g.computeVertexNormals();
  return g;
}

export interface VehicleGeometries { body: THREE.BufferGeometry; detail: THREE.BufferGeometry; lights: THREE.BufferGeometry; }

/** Body geometry is local to the chassis centre (collider centre). +z is forward. */
export function buildVehicleGeometry(spec: VehicleSpec): VehicleGeometries {
  const W = spec.width, L = spec.length, H = spec.bodyH;
  const body: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [];
  const P = 0xffffff; // paint (tinted per instance)
  const trim = 0x1a1a1e, glass = 0x101820;
  const k = spec.kind;

  // lower body
  body.push(cbox(W, H, L, 0, 0, 0, P));
  // hood slope hint: slightly lower front block
  if (k === 'sports') {
    body.push(cabin(W * 0.98, 0.12, L * 0.3, 0, H / 2 + 0.06, L * 0.3, P, 0.92, 0.8));
    detail.push(cabin(W * 0.84, 0.42, L * 0.4, 0, H / 2 + 0.21, -0.25, glass, 0.78, 0.55, -0.1));
    body.push(cbox(W * 0.62, 0.04, L * 0.18, 0, H / 2 + 0.43, -0.35, P));
    // spoiler
    body.push(cbox(W * 0.9, 0.06, 0.32, 0, H / 2 + 0.32, -L / 2 + 0.2, P));
    detail.push(cbox(0.06, 0.28, 0.1, -W * 0.35, H / 2 + 0.16, -L / 2 + 0.2, trim), cbox(0.06, 0.28, 0.1, W * 0.35, H / 2 + 0.16, -L / 2 + 0.2, trim));
    // side intakes
    detail.push(cbox(W + 0.02, 0.16, 0.6, 0, -0.02, -0.6, trim));
  } else if (k === 'suv') {
    detail.push(cabin(W * 0.94, 0.75, L * 0.62, 0, H / 2 + 0.375, -0.25, glass, 0.94, 0.92));
    body.push(cbox(W * 0.9, 0.06, L * 0.56, 0, H / 2 + 0.77, -0.3, P));
    detail.push(cbox(W * 0.8, 0.05, L * 0.5, 0, H / 2 + 0.83, -0.3, 0x333333)); // roof rails
    detail.push(cbox(W * 1.02, 0.18, 0.2, 0, -H / 2 + 0.15, L / 2, trim), cbox(W * 1.02, 0.18, 0.2, 0, -H / 2 + 0.15, -L / 2, trim));
    detail.push(cbox(W * 1.03, 0.12, L * 0.6, 0, -H / 2 + 0.05, 0, trim));
  } else {
    // sedan / police / taxi
    detail.push(cabin(W * 0.9, 0.55, L * 0.48, 0, H / 2 + 0.275, -0.15, glass, 0.86, 0.66));
    body.push(cbox(W * 0.76, 0.05, L * 0.3, 0, H / 2 + 0.56, -0.15, P));
    detail.push(cbox(W * 1.02, 0.16, 0.18, 0, -H / 2 + 0.12, L / 2, trim), cbox(W * 1.02, 0.16, 0.18, 0, -H / 2 + 0.12, -L / 2, trim));
    if (k === 'police') {
      detail.push(cbox(W + 0.01, H * 0.5, L * 0.36, 0, -0.02, -0.1, 0x101014)); // black doors
      detail.push(cbox(W * 0.7, 0.08, 0.25, 0, H / 2 + 0.62, -0.15, 0x202020)); // lightbar base
      detail.push(cbox(W * 0.9, 0.25, 0.12, 0, -0.05, L / 2 + 0.08, 0x111111)); // push bar
    }
    if (k === 'taxi') {
      detail.push(cbox(0.7, 0.2, 0.3, 0, H / 2 + 0.68, -0.15, 0xffffff));
      detail.push(cbox(W + 0.01, 0.08, L * 0.7, 0, 0.05, 0, 0x111111)); // checker stripe
    }
  }
  // grille
  detail.push(cbox(W * 0.5, H * 0.35, 0.04, 0, -0.02, L / 2 + 0.01, trim));
  // lights
  const ly = k === 'suv' ? 0.12 : 0.05;
  lights.push(cbox(0.38, 0.13, 0.05, -W * 0.33, ly, L / 2 + 0.02, 0xfff4d6), cbox(0.38, 0.13, 0.05, W * 0.33, ly, L / 2 + 0.02, 0xfff4d6));
  lights.push(cbox(0.42, 0.12, 0.05, -W * 0.33, ly, -L / 2 - 0.02, 0xff1a1a), cbox(0.42, 0.12, 0.05, W * 0.33, ly, -L / 2 - 0.02, 0xff1a1a));
  // wheel arches (dark) to read as wheels from distance
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) detail.push(cbox(0.05, spec.wheelR * 1.1, spec.wheelR * 2.3, sx * (W / 2 + 0.005), -H / 2 + spec.wheelR * 0.35, sz * spec.axleZ, trim));

  return {
    body: mergeGeometries(body)!,
    detail: mergeGeometries(detail)!,
    lights: mergeGeometries(lights)!,
  };
}

export function buildWheelGeometry() {
  const tire = new THREE.CylinderGeometry(1, 1, 0.3, 12).toNonIndexed();
  tire.rotateZ(Math.PI / 2);
  tire.deleteAttribute('uv');
  const hub = new THREE.CylinderGeometry(0.62, 0.62, 0.32, 8).toNonIndexed();
  hub.rotateZ(Math.PI / 2);
  hub.deleteAttribute('uv');
  const col = (g: THREE.BufferGeometry, c: number) => {
    const cc = new THREE.Color(c); const n = g.attributes.position.count; const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  return mergeGeometries([col(tire, 0x151515), col(hub, 0xb8bcc4)])!;
}
