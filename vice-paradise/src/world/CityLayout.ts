import { rng } from '../core/util';

/** World constants (metres). Roads run along grid lines x = i*CELL and z = j*CELL. */
export const CELL = 72;
export const ROAD_HALF = 6;
export const BLOCK_HALF = 30; // block (incl. sidewalk) spans centre ± 30
export const LOT_HALF = 26; // buildable lot inside the sidewalk
export const N = 12; // blocks per axis
export const CITY = N * CELL; // 864
export const CANAL_ROW = 8;
export const CANAL_Z0 = CANAL_ROW * CELL + ROAD_HALF; // 582
export const CANAL_Z1 = (CANAL_ROW + 1) * CELL - ROAD_HALF; // 642
export const LAND_MIN = -14;
export const LAND_MAX = CITY + 14; // 878
export const BEACH_FLAT_END = 950;
export const BEACH_END = 1010;
export const WATER_Y = -0.45;
export const SLAB_H = 0.2;
export const CHUNK = CELL * 2; // 144 m
export const CHUNKS_X = 7; // last column holds the beach
export const CHUNKS_Z = 6;
export const LANE_OFFSET = 3;
export const INTERSECTION_CLEAR = 8;

export enum District { Downtown, Commercial, Residential, Beach, Nightlife, Park, Canal, Police, Hospital, Gas }

export interface Building { x: number; z: number; w: number; d: number; h: number; color: number; style: number; seed: number; }
export interface Box { x: number; y: number; z: number; w: number; h: number; d: number; color: number; ry: number; collide: boolean; }
export interface Palm { x: number; z: number; s: number; r: number; }
export interface Lamp { x: number; z: number; ry: number; }
export interface TLight { x: number; z: number; axis: 0 | 1; ry: number; } // axis 0 = traffic along z (NS), 1 = along x (EW)
export interface Block { i: number; j: number; cx: number; cz: number; district: District; lawn: boolean; name: string; }

export interface Chunk {
  ci: number; cj: number; x0: number; z0: number; x1: number; z1: number;
  blocks: Block[];
  buildings: Building[];
  boxes: Box[];
  neon: Box[];
  palms: Palm[];
  lamps: Lamp[];
  tlights: TLight[];
  slabs: Box[];
}

export interface Landmark { kind: 'police' | 'hospital' | 'gas' | 'club' | 'safehouse'; name: string; x: number; z: number; }

const PASTELS = [0xffc7d9, 0xbff3ea, 0xfff1b8, 0xd8c8ff, 0xffd6b0, 0xc8f0ff, 0xffffff, 0xf7e1ff];
const DOWNTOWN_TINT = [0xffffff, 0xe6f0ff, 0xdfe8f0, 0xf0f0ff, 0xd8e6ee];
const NEON = [0xff2fa0, 0x00f0ff, 0xb44dff, 0xff9a3c, 0x3dff8b, 0xff3b3b];

export function districtOf(i: number, j: number): District {
  if (j === CANAL_ROW) return District.Canal;
  const key = `${i},${j}`;
  const special: Record<string, District> = {
    '3,3': District.Police, '8,2': District.Hospital,
    '1,6': District.Gas, '9,0': District.Gas, '6,10': District.Gas, '3,9': District.Gas,
    '1,2': District.Park, '5,9': District.Park, '8,7': District.Park,
  };
  if (special[key] !== undefined) return special[key];
  if (i === 11) return District.Beach;
  if (i >= 4 && i <= 7 && j >= 2 && j <= 6) return District.Downtown;
  if ((i === 9 || i === 10) && j >= 4 && j <= 7) return District.Nightlife;
  if (i <= 2 || j >= 9) return District.Residential;
  return District.Commercial;
}

export function zoneName(x: number, z: number): string {
  if (x > LAND_MAX) return 'Paradise Beach';
  if (x < LAND_MIN || z < LAND_MIN || z > LAND_MAX) return 'Biscay Bay';
  if (z > CANAL_Z0 - 6 && z < CANAL_Z1 + 6) return 'Grand Canal';
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  const d = districtOf(Math.max(0, Math.min(N - 1, i)), Math.max(0, Math.min(N - 1, j)));
  switch (d) {
    case District.Downtown: return 'Neon Heights';
    case District.Beach: return 'Ocean Drive';
    case District.Nightlife: return 'Pulse District';
    case District.Residential: return j >= 9 ? 'Sunset Isles' : 'Palmetto Hills';
    case District.Park: return 'Bayfront Park';
    case District.Police: return 'Midtown';
    case District.Hospital: return 'Midtown';
    default: return j < 2 ? 'Port Vice' : 'Midtown';
  }
}

export class CityLayout {
  chunks: Chunk[] = [];
  blocks: Block[] = [];
  landmarks: Landmark[] = [];
  /** Lots used by gameplay (spawn points etc). */
  policeStation = { x: 0, z: 0 };
  hospital = { x: 0, z: 0 };
  canalWalls: Box[] = [];
  rails: Box[] = [];
  beachBoxes: Box[] = [];

  constructor(seed = 1337) {
    const R = rng(seed);
    for (let cj = 0; cj < CHUNKS_Z; cj++)
      for (let ci = 0; ci < CHUNKS_X; ci++)
        this.chunks.push({
          ci, cj, x0: ci * CHUNK, z0: cj * CHUNK, x1: (ci + 1) * CHUNK, z1: (cj + 1) * CHUNK,
          blocks: [], buildings: [], boxes: [], neon: [], palms: [], lamps: [], tlights: [], slabs: [],
        });

    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const d = districtOf(i, j);
        if (d === District.Canal) continue;
        const b: Block = { i, j, cx: i * CELL + CELL / 2, cz: j * CELL + CELL / 2, district: d, lawn: d === District.Residential || d === District.Park, name: zoneName(i * CELL + 36, j * CELL + 36) };
        this.blocks.push(b);
        const ch = this.chunkAt(b.cx, b.cz)!;
        ch.blocks.push(b);
        this.genBlock(b, ch, R);
      }

    // street lamps + traffic lights
    for (const b of this.blocks) {
      const ch = this.chunkAt(b.cx, b.cz)!;
      for (const off of [-18, 18]) {
        ch.lamps.push({ x: b.cx + off, z: b.cz - 28.8, ry: Math.PI });
        ch.lamps.push({ x: b.cx + off, z: b.cz + 28.8, ry: 0 });
        ch.lamps.push({ x: b.cx - 28.8, z: b.cz + off, ry: -Math.PI / 2 });
        ch.lamps.push({ x: b.cx + 28.8, z: b.cz + off, ry: Math.PI / 2 });
      }
    }
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        const x = i * CELL, z = j * CELL;
        const ch = this.chunkAt(Math.min(x, CITY - 1), Math.min(z, CITY - 1))!;
        ch.tlights.push({ x: x - 7.2, z: z - 7.2, axis: 0, ry: 0 });
        ch.tlights.push({ x: x + 7.2, z: z + 7.2, axis: 0, ry: Math.PI });
        ch.tlights.push({ x: x + 7.2, z: z - 7.2, axis: 1, ry: -Math.PI / 2 });
        ch.tlights.push({ x: x - 7.2, z: z + 7.2, axis: 1, ry: Math.PI / 2 });
      }

    // Paradise Expressway: the perimeter ring road, marked with overhead gantries
    for (let k = 1; k < N; k += 3) {
      const t = k * CELL + CELL / 2;
      for (const [x, z, alongX] of [[t, 0, true], [t, CITY, true], [0, t, false], [CITY, t, false]] as [number, number, boolean][]) {
        const ch = this.chunkAt(Math.min(x, CITY - 1), Math.min(z, CITY - 1))!;
        const px = alongX ? 0 : 7.2, pz = alongX ? 7.2 : 0;
        ch.boxes.push({ x: x - px, y: 0, z: z - pz, w: 0.35, h: 6.4, d: 0.35, color: 0x9a9ea6, ry: 0, collide: true });
        ch.boxes.push({ x: x + px, y: 0, z: z + pz, w: 0.35, h: 6.4, d: 0.35, color: 0x9a9ea6, ry: 0, collide: true });
        ch.boxes.push({ x, y: 6.2, z, w: alongX ? 0.4 : 14.8, h: 0.35, d: alongX ? 14.8 : 0.4, color: 0x9a9ea6, ry: 0, collide: false });
        ch.boxes.push({ x, y: 5.0, z, w: alongX ? 0.15 : 6, h: 1.4, d: alongX ? 6 : 0.15, color: 0x0f6b3a, ry: 0, collide: false });
        ch.neon.push({ x, y: 5.6, z, w: alongX ? 0.17 : 4.4, h: 0.12, d: alongX ? 4.4 : 0.17, color: 0xe8fff0, ry: 0, collide: false });
      }
    }
    this.genCanal();
    this.genBeach(R);
  }

  chunkAt(x: number, z: number): Chunk | undefined {
    const ci = Math.floor(x / CHUNK), cj = Math.floor(z / CHUNK);
    if (ci < 0 || cj < 0 || ci >= CHUNKS_X || cj >= CHUNKS_Z) return undefined;
    return this.chunks[cj * CHUNKS_X + ci];
  }

  private genBlock(b: Block, ch: Chunk, R: ReturnType<typeof rng>) {
    const { cx, cz } = b;
    const slabColor = b.district === District.Beach ? 0xc9b9a0 : 0x8f8c87;
    ch.slabs.push({ x: cx, y: 0, z: cz, w: BLOCK_HALF * 2, h: SLAB_H, d: BLOCK_HALF * 2, color: slabColor, ry: 0, collide: true });
    if (b.lawn) ch.slabs.push({ x: cx, y: 0, z: cz, w: LOT_HALF * 2, h: SLAB_H + 0.03, d: LOT_HALF * 2, color: 0x4f8f3a, ry: 0, collide: false });

    const B = (x: number, z: number, w: number, d: number, h: number, color: number, style: number) => {
      ch.buildings.push({ x: cx + x, z: cz + z, w, d, h, color, style, seed: R.next() * 100 });
    };
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, collide = true, ry = 0) =>
      ch.boxes.push({ x: cx + x, y, z: cz + z, w, h, d, color, ry, collide });
    const neon = (x: number, y: number, z: number, w: number, h: number, d: number, color: number) =>
      ch.neon.push({ x: cx + x, y, z: cz + z, w, h, d, color, ry: 0, collide: false });
    const palm = (x: number, z: number) => ch.palms.push({ x: cx + x, z: cz + z, s: R.range(0.8, 1.25), r: R.range(0, Math.PI * 2) });
    const roofStuff = (bx: number, bz: number, w: number, d: number, h: number) => {
      const n = R.int(1, 3);
      for (let k = 0; k < n; k++) {
        const sw = R.range(2, 5), sd = R.range(2, 5);
        box(bx + R.range(-w / 2 + sw, w / 2 - sw) * 0.8, h, bz + R.range(-d / 2 + sd, d / 2 - sd) * 0.8, sw, R.range(1.2, 3), sd, 0x8a8f96, false);
      }
    };

    switch (b.district) {
      case District.Downtown: {
        const centrality = Math.max(0, 1 - Math.hypot(b.i - 5.5, b.j - 4) / 4.2);
        const pattern = R.int(0, 2);
        const tower = (x: number, z: number, w: number, d: number) => {
          const h = Math.round(45 + centrality * 120 * R.range(0.55, 1.1) + R.range(0, 25));
          const style = R.pick([0, 1, 2, 3, 0, 1]);
          B(x, z, w, d, h, R.pick(DOWNTOWN_TINT), style);
          roofStuff(x, z, w, d, h);
          if (h > 120) box(x, h, z, 0.5, R.range(10, 25), 0.5, 0xbbbbbb, false); // antenna
          if (h > 90 && R.chance(0.5)) neon(x, h - 3, z + d / 2 + 0.15, w * 0.7, 1.2, 0.2, R.pick(NEON));
        };
        if (pattern === 0) { tower(0, 0, 40, 40); }
        else if (pattern === 1) { B(0, 0, 52, 52, R.range(8, 12), 0xd0d4da, 3); tower(-12, 0, 22, 40); tower(13, 0, 20, 36); }
        else { tower(-13, -13, 22, 22); tower(13, -13, 22, 22); tower(-13, 13, 22, 22); tower(13, 13, 22, 22); }
        if (R.chance(0.5)) palm(-28, -28);
        break;
      }
      case District.Commercial: {
        // shops around the perimeter
        const sides = [0, 1, 2, 3];
        for (const s of sides) {
          let t = -24;
          while (t < 20) {
            const w = R.range(10, 16);
            if (t + w > 26) break;
            const depth = R.range(11, 16), h = R.range(5, 15);
            const along = t + w / 2;
            const inward = LOT_HALF - depth / 2;
            let x = 0, z = 0, bw = w, bd = depth;
            if (s === 0) { x = along; z = -inward; }
            else if (s === 1) { x = along; z = inward; }
            else if (s === 2) { x = -inward; z = along; bw = depth; bd = w; }
            else { x = inward; z = along; bw = depth; bd = w; }
            // skip overlapping corners for side 2/3
            if ((s >= 2) && Math.abs(along) > 26 - 16) { t += w + R.range(0.5, 3); continue; }
            B(x, z, bw, bd, h, R.pick(PASTELS), R.pick([6, 6, 7, 5, 4]));
            if (R.chance(0.35)) neon(x + (s === 2 ? -bw / 2 - 0.1 : s === 3 ? bw / 2 + 0.1 : 0), h * 0.75, z + (s === 0 ? -bd / 2 - 0.1 : s === 1 ? bd / 2 + 0.1 : 0), s >= 2 ? 0.2 : bw * 0.6, 0.6, s >= 2 ? bd * 0.6 : 0.2, R.pick(NEON));
            t += w + R.range(0.5, 3);
          }
        }
        if (R.chance(0.6)) B(0, 0, 18, 18, R.range(18, 34), R.pick(DOWNTOWN_TINT), 3);
        break;
      }
      case District.Residential: {
        const spots = [-17, 0, 17];
        for (const sx of spots) for (const sz of spots) {
          if (sx === 0 && sz === 0) { palm(0, 0); continue; }
          if (R.chance(0.15)) { palm(sx, sz); continue; }
          const w = R.range(9, 13), d = R.range(9, 13), h = R.range(4.5, 8.5);
          B(sx, sz, w, d, h, R.pick(PASTELS), R.pick([5, 5, 4, 7]));
          box(sx, h, sz, w + 0.6, 0.35, d + 0.6, R.pick([0xb5583c, 0x9a4a32, 0xcfcfcf]), false); // roof cap
          if (R.chance(0.6)) palm(sx + (R.chance(0.5) ? -1 : 1) * (w / 2 + 2.2), sz + R.range(-3, 3));
        }
        // pool in some yards
        if (R.chance(0.3)) box(R.pick([-8, 8]), SLAB_H, R.pick([-8, 8]), 6, 0.06, 4, 0x2ec5ff, false);
        break;
      }
      case District.Beach: {
        // art-deco hotels facing the beach
        const n = R.int(2, 3);
        const span = 52 / n;
        for (let k = 0; k < n; k++) {
          const z = -26 + span * (k + 0.5);
          const w = R.range(18, 26), d = span - 3, h = R.range(14, 42);
          const x = -26 + w / 2 + R.range(0, 4);
          B(x, z, w, d, h, R.pick(PASTELS), 4);
          neon(x + w / 2 + 0.12, h * 0.2, z, 0.25, h * 0.7, 1.2, R.pick(NEON));
          neon(x + w / 2 + 0.12, 3.6, z, 0.2, 0.3, d * 0.9, R.pick(NEON));
          box(x + w / 2 + 2.5, 3.2, z, 5, 0.3, d * 0.6, R.pick(PASTELS), false); // awning
        }
        for (let k = -2; k <= 2; k++) palm(24, k * 11);
        break;
      }
      case District.Nightlife: {
        const xs = [-14, 14];
        for (const x of xs) for (const z of [-13, 13]) {
          const w = R.range(16, 22), d = R.range(16, 22), h = R.range(8, 22);
          B(x, z, w, d, h, R.pick([0x5a4a7a, 0x3a3550, 0x704c7e, 0x2d2a3e]), 8);
          const c = R.pick(NEON);
          // neon outline bands
          neon(x, h - 0.6, z - d / 2 - 0.12, w, 0.35, 0.2, c);
          neon(x, h - 0.6, z + d / 2 + 0.12, w, 0.35, 0.2, c);
          neon(x - w / 2 - 0.12, h - 0.6, z, 0.2, 0.35, d, c);
          neon(x + w / 2 + 0.12, h - 0.6, z, 0.2, 0.35, d, c);
          neon(x, 4.2, z + Math.sign(z) * (d / 2 + 0.15), w * 0.5, 1.4, 0.2, R.pick(NEON));
        }
        this.landmarks.push({ kind: 'club', name: R.pick(['Club Pulse', 'Malibu Nights', 'Velvet Wave', 'Laser Lagoon']), x: cx, z: cz });
        palm(0, -28); palm(0, 28);
        break;
      }
      case District.Park: {
        for (let k = 0; k < 14; k++) palm(R.range(-24, 24), R.range(-24, 24));
        box(0, SLAB_H, 0, 8, 0.6, 8, 0xd9d4c5, true); // fountain base
        box(0, SLAB_H + 0.6, 0, 6, 0.05, 6, 0x2ec5ff, false);
        for (const s of [-1, 1]) { box(s * 10, SLAB_H, 0, 2.4, 0.5, 0.7, 0x7a5233, true); box(0, SLAB_H, s * 10, 0.7, 0.5, 2.4, 0x7a5233, true); }
        break;
      }
      case District.Police: {
        B(-8, -6, 36, 26, 14, 0xf2f4ff, 9);
        neon(-8, 11.5, 7.15, 18, 1.6, 0.2, 0x3a8fff);
        box(-8, 14, -6, 4, 6, 4, 0xdedede, false);
        box(14, SLAB_H, 12, 18, 0.02, 20, 0x3b3b40, false); // parking lot
        this.policeStation = { x: cx + 12, z: cz + 22 };
        this.landmarks.push({ kind: 'police', name: 'VPPD Midtown Precinct', x: cx, z: cz });
        break;
      }
      case District.Hospital: {
        B(0, -4, 40, 34, 24, 0xffffff, 9);
        neon(0, 18, 13.15, 6, 6, 0.2, 0xff2a3a);
        box(0, 24, -4, 12, 0.3, 12, 0x404040, false); // helipad
        this.hospital = { x: cx, z: cz + 22 };
        this.landmarks.push({ kind: 'hospital', name: 'Mercy Bay Hospital', x: cx, z: cz });
        break;
      }
      case District.Gas: {
        // canopy + pumps + store
        box(-6, 5, 4, 20, 0.6, 12, 0xffffff, false);
        neon(-6, 5.2, 10.1, 20, 0.4, 0.15, 0x2bd97c);
        for (const px of [-14, 2]) for (const pz of [-1, 9]) box(px, SLAB_H, pz, 0.4, 4.8, 0.4, 0xdddddd, true);
        for (const px of [-11, -6, -1]) box(px, SLAB_H, 4, 1.0, 1.6, 0.7, 0xd02a2a, true);
        B(12, -12, 18, 14, 5, 0xfff1b8, 6);
        box(-6, SLAB_H, 4, 30, 0.02, 22, 0x3b3b40, false);
        palm(22, 20); palm(-22, -20);
        this.landmarks.push({ kind: 'gas', name: 'Gas & Go', x: cx, z: cz });
        break;
      }
    }
  }

  private genCanal() {
    const wallC = 0x8f8a80, railC = 0xe8e8e8;
    for (let i = 0; i < N; i++) {
      const x0 = i * CELL + ROAD_HALF, x1 = (i + 1) * CELL - ROAD_HALF;
      const xm = (x0 + x1) / 2, w = x1 - x0;
      // canal walls (visible below road level)
      this.canalWalls.push({ x: xm, y: -3, z: CANAL_Z0 + 0.5, w, h: 3, d: 1, color: wallC, ry: 0, collide: true });
      this.canalWalls.push({ x: xm, y: -3, z: CANAL_Z1 - 0.5, w, h: 3, d: 1, color: wallC, ry: 0, collide: true });
      this.rails.push({ x: xm, y: 0, z: CANAL_Z0 - 0.2, w, h: 1.0, d: 0.3, color: railC, ry: 0, collide: true });
      this.rails.push({ x: xm, y: 0, z: CANAL_Z1 + 0.2, w, h: 1.0, d: 0.3, color: railC, ry: 0, collide: true });
    }
    for (let i = 0; i <= N; i++) {
      const x = i * CELL;
      for (const s of [-1, 1]) {
        this.rails.push({ x: x + s * (ROAD_HALF + 0.2), y: 0, z: (CANAL_Z0 + CANAL_Z1) / 2, w: 0.4, h: 1.1, d: CANAL_Z1 - CANAL_Z0, color: railC, ry: 0, collide: true });
        this.canalWalls.push({ x: x + s * (ROAD_HALF + 0.5), y: -3, z: (CANAL_Z0 + CANAL_Z1) / 2, w: 1, h: 3, d: CANAL_Z1 - CANAL_Z0, color: wallC, ry: 0, collide: true });
      }
      // bridge underside
      this.canalWalls.push({ x, y: -1.2, z: (CANAL_Z0 + CANAL_Z1) / 2, w: ROAD_HALF * 2, h: 1.2, d: CANAL_Z1 - CANAL_Z0, color: 0x6f6a62, ry: 0, collide: false });
    }
    // island perimeter seawall railings (north, west, south). East side is open beach.
    const L = LAND_MAX - LAND_MIN, mid = (LAND_MAX + LAND_MIN) / 2;
    this.rails.push({ x: mid, y: 0, z: LAND_MIN + 0.2, w: L, h: 1.0, d: 0.4, color: railC, ry: 0, collide: true });
    this.rails.push({ x: mid, y: 0, z: LAND_MAX - 0.2, w: L, h: 1.0, d: 0.4, color: railC, ry: 0, collide: true });
    this.rails.push({ x: LAND_MIN + 0.2, y: 0, z: mid, w: 0.4, h: 1.0, d: L, color: railC, ry: 0, collide: true });
    for (const z of [LAND_MIN - 1, LAND_MAX + 1]) this.canalWalls.push({ x: mid + 66, y: -4, z, w: L + 132, h: 4, d: 2, color: wallC, ry: 0, collide: true });
    this.canalWalls.push({ x: LAND_MIN - 1, y: -4, z: mid, w: 2, h: 4, d: L, color: wallC, ry: 0, collide: true });
  }

  private genBeach(R: ReturnType<typeof rng>) {
    for (let z = 10; z < CITY; z += R.range(14, 26)) {
      const ch = this.chunkAt(CITY + 10, z)!;
      ch.palms.push({ x: R.range(884, 900), z, s: R.range(0.9, 1.3), r: R.range(0, 6.28) });
      if (R.chance(0.6)) {
        // beach umbrella + towel
        const ux = R.range(905, 940), uz = z + R.range(-6, 6);
        const c = R.pick([0xff2fa0, 0x00c8ff, 0xffd23f, 0xff7b39]);
        ch.boxes.push({ x: ux, y: 0, z: uz, w: 0.12, h: 2.4, d: 0.12, color: 0xeeeeee, ry: 0, collide: false });
        ch.boxes.push({ x: ux, y: 2.3, z: uz, w: 2.8, h: 0.18, d: 2.8, color: c, ry: R.range(0, 1.5), collide: false });
        ch.boxes.push({ x: ux + 1.5, y: 0.02, z: uz, w: 1, h: 0.03, d: 2, color: R.pick([0xffffff, 0xffd23f, 0x00f0ff]), ry: 0, collide: false });
      }
    }
    // lifeguard towers
    for (const z of [120, 400, 700]) {
      const ch = this.chunkAt(CITY + 10, z)!;
      const x = 935, c = R.pick([0xff9ad5, 0x8ff7e8, 0xfff07a]);
      for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) ch.boxes.push({ x: x + dx, y: 0, z: z + dz, w: 0.2, h: 2.5, d: 0.2, color: 0xffffff, ry: 0, collide: true });
      ch.boxes.push({ x, y: 2.5, z, w: 3.4, h: 2.4, d: 3.4, color: c, ry: 0, collide: true });
      ch.boxes.push({ x, y: 4.9, z, w: 4.2, h: 0.3, d: 4.2, color: 0xff2fa0, ry: 0, collide: false });
    }
  }

  /** Random sidewalk point (on the pedestrian ring of a random block near a position). */
  randomBlockNear(x: number, z: number, minD: number, maxD: number, rnd = Math.random): Block | null {
    for (let tries = 0; tries < 20; tries++) {
      const b = this.blocks[Math.floor(rnd() * this.blocks.length)];
      const d = Math.hypot(b.cx - x, b.cz - z);
      if (d >= minD && d <= maxD) return b;
    }
    let best: Block | null = null, bestD = 1e9;
    for (const b of this.blocks) {
      const d = Math.abs(Math.hypot(b.cx - x, b.cz - z) - (minD + maxD) / 2);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }
}

/** Road graph helpers on the regular grid. Nodes are (i,j) with 0..N inclusive. */
export const nodePos = (i: number, j: number) => ({ x: i * CELL, z: j * CELL });
export const nodeValid = (i: number, j: number) => i >= 0 && j >= 0 && i <= N && j <= N;
export function nearestNode(x: number, z: number) {
  return { i: Math.max(0, Math.min(N, Math.round(x / CELL))), j: Math.max(0, Math.min(N, Math.round(z / CELL))) };
}
/** True if a world point lies on asphalt. */
export function onRoad(x: number, z: number) {
  if (x < -ROAD_HALF || z < -ROAD_HALF || x > CITY + ROAD_HALF || z > CITY + ROAD_HALF) return false;
  const lx = ((x + ROAD_HALF) % CELL + CELL) % CELL, lz = ((z + ROAD_HALF) % CELL + CELL) % CELL;
  return lx < ROAD_HALF * 2 || lz < ROAD_HALF * 2;
}
/** True if the point is over open water (canal/sea). */
export function isWater(x: number, z: number) {
  if (x > BEACH_END - 20) return true;
  if (x < LAND_MIN || z < LAND_MIN || z > LAND_MAX) return x < BEACH_FLAT_END || z < LAND_MIN || z > LAND_MAX;
  if (z > CANAL_Z0 && z < CANAL_Z1) {
    const lx = ((x + ROAD_HALF) % CELL + CELL) % CELL;
    return lx >= ROAD_HALF * 2 && x < CITY;
  }
  return false;
}
/** Perimeter ring road ("Paradise Expressway") has a higher speed limit. */
export const isExpressway = (ai: number, aj: number, bi: number, bj: number) =>
  (ai === bi && (ai === 0 || ai === N)) || (aj === bj && (aj === 0 || aj === N));
