import * as THREE from 'three';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next: f,
    range: (lo: number, hi: number) => lo + (hi - lo) * f(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * f()),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(f() * arr.length)],
    chance: (p: number) => f() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Shortest signed difference between two angles. */
export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
/** Frame-rate independent exponential damping factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export const randRange = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const randPick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

export const _v1 = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _v3 = new THREE.Vector3();
export const _q1 = new THREE.Quaternion();
export const _m1 = new THREE.Matrix4();
export const UP = new THREE.Vector3(0, 1, 0);

/** Distance from point p to the ray (o, d normalized) and the ray parameter t. */
export function rayPointDistance(o: THREE.Vector3, d: THREE.Vector3, p: THREE.Vector3) {
  const t = (p.x - o.x) * d.x + (p.y - o.y) * d.y + (p.z - o.z) * d.z;
  const cx = o.x + d.x * t - p.x, cy = o.y + d.y * t - p.y, cz = o.z + d.z * t - p.z;
  return { t, dist: Math.sqrt(cx * cx + cy * cy + cz * cz) };
}

/**
 * Closest approach between a ray and a vertical capsule (segment base..base+height).
 * Returns ray t and the height on the capsule where it was hit, or null.
 */
export function rayVsVerticalCapsule(o: THREE.Vector3, d: THREE.Vector3, bx: number, by: number, bz: number, height: number, radius: number, maxT: number) {
  // Solve in 2D (xz) first: closest approach between ray and vertical line
  const dx = d.x, dz = d.z;
  const ox = o.x - bx, oz = o.z - bz;
  const a = dx * dx + dz * dz;
  let t: number;
  if (a < 1e-6) t = 0; else t = -(ox * dx + oz * dz) / a;
  if (t < 0 || t > maxT) return null;
  const px = ox + dx * t, pz = oz + dz * t;
  const dist2 = px * px + pz * pz;
  if (dist2 > radius * radius) return null;
  // back off to surface
  const back = a > 1e-6 ? Math.sqrt(Math.max(0, radius * radius - dist2) / a) : 0;
  const th = Math.max(0, t - back);
  const y = o.y + d.y * th - by;
  if (y < -0.1 || y > height + 0.1) return null;
  return { t: th, y };
}

/** Simple 2D uniform-grid spatial hash for fast neighbour queries. */
export class SpatialGrid<T> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];
  constructor(public cellSize: number) {}
  private key(cx: number, cz: number) { return (cx + 2048) * 4096 + (cz + 2048); }
  clear() {
    for (const arr of this.cells.values()) { arr.length = 0; this.pool.push(arr); }
    this.cells.clear();
  }
  insert(x: number, z: number, item: T) {
    const k = this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let arr = this.cells.get(k);
    if (!arr) { arr = this.pool.pop() ?? []; this.cells.set(k, arr); }
    arr.push(item);
  }
  query(x: number, z: number, r: number, out: T[]) {
    out.length = 0;
    const c0x = Math.floor((x - r) / this.cellSize), c1x = Math.floor((x + r) / this.cellSize);
    const c0z = Math.floor((z - r) / this.cellSize), c1z = Math.floor((z + r) / this.cellSize);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    return out;
  }
}

export function formatMoney(n: number) {
  return '$' + Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
