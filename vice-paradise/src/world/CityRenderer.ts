import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics, RAPIER as R } from '../core/Physics';
import {
  BEACH_END, BEACH_FLAT_END, Box, CityLayout, Chunk, CHUNK, LAND_MAX, LAND_MIN, CANAL_Z0, CANAL_Z1, CITY, CELL, N, ROAD_HALF,
} from './CityLayout';
import {
  createBuildingMaterial, createFacadeAtlas, createSlabMaterial, createGroundMaterial, createSandMaterial, lampHeadGeometry, lampPoleGeometry,
  palmGeometry, palmMaterial, tlightHeadGeometry, tlightPoleGeometry, unitBoxBase,
} from './Materials';
import { TrafficLights } from './TrafficLights';

interface ChunkState {
  chunk: Chunk;
  group: THREE.Group | null;
  nearGroup: THREE.Group | null;
  buildings: THREE.InstancedMesh | null;
  tallCount: number;
  colliders: RAPIER.Collider[] | null;
  tier: number;
  dist: number;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const YAXIS = new THREE.Vector3(0, 1, 0);

/**
 * Streams the city in 144 m chunks. Each loaded chunk is a handful of InstancedMeshes (one draw call per kind),
 * with three LOD tiers:
 *   0 (near): buildings + props + street furniture, shadow casting
 *   1 (mid):  buildings + palms + neon
 *   2 (far):  tall buildings only (skyline)
 * Static colliders are streamed separately within a smaller physics radius.
 */
export class CityRenderer {
  root = new THREE.Group();
  states: ChunkState[];
  atlas: THREE.DataTexture;
  buildingMat: THREE.MeshLambertMaterial;
  boxMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  slabMat = createSlabMaterial();
  neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  poleMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  palmMat = palmMaterial();
  boxGeo = unitBoxBase();
  palmGeo = palmGeometry();
  lampGeo = lampPoleGeometry();
  lampHeadGeo = lampHeadGeometry();
  tlGeo = tlightPoleGeometry();
  tlHeadGeo = tlightHeadGeometry();
  loadedCount = 0;
  physicsChunks = 0;
  shadows = false;
  private buildQueue: ChunkState[] = [];

  constructor(public layout: CityLayout, private physics: Physics, public lights: TrafficLights) {
    this.atlas = createFacadeAtlas();
    this.buildingMat = createBuildingMaterial(this.atlas);
    this.states = layout.chunks.map((chunk) => ({ chunk, group: null, nearGroup: null, buildings: null, tallCount: 0, colliders: null, tier: -1, dist: 1e9 }));
    this.buildStatic();
  }

  /** Always-present geometry: ground plane (procedural roads), beach, canal walls, railings + their colliders. */
  private buildStatic() {
    const size = LAND_MAX - LAND_MIN;
    const gg = new THREE.PlaneGeometry(size, size, 1, 1);
    gg.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(gg, createGroundMaterial());
    ground.position.set((LAND_MAX + LAND_MIN) / 2, 0, (LAND_MAX + LAND_MIN) / 2);
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false; ground.updateMatrix();
    this.root.add(ground);

    // beach: a strip that slopes into the sea
    const bw = BEACH_END + 60 - LAND_MAX;
    const sg = new THREE.PlaneGeometry(bw, LAND_MAX - LAND_MIN, 24, 1);
    sg.rotateX(-Math.PI / 2);
    const pos = sg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + LAND_MAX + bw / 2;
      let y = 0;
      if (x > BEACH_FLAT_END) y = -((x - BEACH_FLAT_END) / (BEACH_END - BEACH_FLAT_END)) * 3;
      pos.setY(i, Math.max(y, -4));
    }
    sg.computeVertexNormals();
    const sand = new THREE.Mesh(sg, createSandMaterial());
    sand.position.set(LAND_MAX + bw / 2, 0, (LAND_MAX + LAND_MIN) / 2);
    sand.receiveShadow = true;
    this.root.add(sand);

    const all = [...this.layout.canalWalls, ...this.layout.rails];
    this.root.add(this.makeBoxes(all, this.boxMat, false));

    // ---- static colliders
    const P = this.physics;
    const slab = (x0: number, x1: number, z0: number, z1: number) =>
      P.addStaticDesc(R.ColliderDesc.cuboid((x1 - x0) / 2, 1, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, -1, (z0 + z1) / 2).setFriction(1));
    slab(LAND_MIN, LAND_MAX, LAND_MIN, CANAL_Z0);
    slab(LAND_MIN, LAND_MAX, CANAL_Z1, LAND_MAX);
    for (let i = 0; i <= N; i++) slab(i * CELL - ROAD_HALF, i * CELL + ROAD_HALF, CANAL_Z0, CANAL_Z1);
    slab(LAND_MAX, BEACH_FLAT_END, LAND_MIN, LAND_MAX);
    // beach slope
    const ang = -Math.atan2(3, BEACH_END - BEACH_FLAT_END);
    const len = Math.hypot(BEACH_END - BEACH_FLAT_END, 3);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    P.addStaticDesc(R.ColliderDesc.cuboid(len / 2 + 0.5, 0.5, (LAND_MAX - LAND_MIN) / 2)
      .setTranslation((BEACH_FLAT_END + BEACH_END) / 2 - nx * 0.5, -1.5 - ny * 0.5, (LAND_MAX + LAND_MIN) / 2)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.9));
    // sea bed
    P.addStaticDesc(R.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(450, -5, 450));
    for (const b of all) if (b.collide) P.addStaticBox(b);
  }

  /** Generic instanced box batch (unit box with base at y=0). */
  private makeBoxes(list: Box[], mat: THREE.Material, castShadow: boolean) {
    const mesh = new THREE.InstancedMesh(this.boxGeo, mat, Math.max(1, list.length));
    list.forEach((b, i) => {
      _q.setFromAxisAngle(YAXIS, b.ry);
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(b.w, b.h, b.d));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setHex(b.color));
    });
    mesh.count = list.length;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  private buildChunk(st: ChunkState) {
    const ch = st.chunk;
    const g = new THREE.Group();
    const near = new THREE.Group();

    // buildings sorted tallest first so the far tier can simply lower .count
    const bl = [...ch.buildings].sort((a, b) => b.h - a.h);
    if (bl.length) {
      const bm = new THREE.InstancedMesh(this.boxGeo, this.buildingMat, bl.length);
      const style = new Float32Array(bl.length * 2);
      bl.forEach((b, i) => {
        _m.compose(_p.set(b.x, 0, b.z), _q.identity(), _s.set(b.w, b.h, b.d));
        bm.setMatrixAt(i, _m);
        bm.setColorAt(i, _c.setHex(b.color));
        style[i * 2] = b.style; style[i * 2 + 1] = b.seed;
      });
      bm.geometry = this.boxGeo.clone(); // per-chunk attribute requires its own geometry wrapper
      bm.geometry.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 2));
      bm.receiveShadow = true;
      bm.computeBoundingSphere();
      st.tallCount = bl.filter((b) => b.h >= 28).length;
      st.buildings = bm;
      g.add(bm);
    }
    if (ch.slabs.length) g.add(this.makeBoxes(ch.slabs, this.slabMat, false));
    if (ch.neon.length) g.add(this.makeBoxes(ch.neon, this.neonMat, false));
    if (ch.palms.length) {
      const pm = new THREE.InstancedMesh(this.palmGeo, this.palmMat, ch.palms.length);
      ch.palms.forEach((p, i) => {
        _q.setFromAxisAngle(YAXIS, p.r);
        _m.compose(_p.set(p.x, 0.2, p.z), _q, _s.setScalar(p.s));
        pm.setMatrixAt(i, _m);
      });
      pm.castShadow = true;
      pm.computeBoundingSphere();
      g.add(pm);
    }
    if (ch.boxes.length) near.add(this.makeBoxes(ch.boxes, this.boxMat, true));
    if (ch.lamps.length) {
      const lp = new THREE.InstancedMesh(this.lampGeo, this.poleMat, ch.lamps.length);
      const lh = new THREE.InstancedMesh(this.lampHeadGeo, this.lampHeadMat, ch.lamps.length);
      ch.lamps.forEach((l, i) => {
        _q.setFromAxisAngle(YAXIS, l.ry);
        _m.compose(_p.set(l.x, 0.2, l.z), _q, _s.setScalar(1));
        lp.setMatrixAt(i, _m); lh.setMatrixAt(i, _m);
      });
      lp.computeBoundingSphere(); lh.computeBoundingSphere();
      near.add(lp, lh);
    }
    if (ch.tlights.length) {
      const tp = new THREE.InstancedMesh(this.tlGeo, this.poleMat, ch.tlights.length);
      const ns = ch.tlights.filter((t) => t.axis === 0), ew = ch.tlights.filter((t) => t.axis === 1);
      const hns = new THREE.InstancedMesh(this.tlHeadGeo, this.lights.matNS, Math.max(1, ns.length));
      const hew = new THREE.InstancedMesh(this.tlHeadGeo, this.lights.matEW, Math.max(1, ew.length));
      let a = 0, b = 0;
      ch.tlights.forEach((t, i) => {
        _q.setFromAxisAngle(YAXIS, t.ry);
        _m.compose(_p.set(t.x, 0.2, t.z), _q, _s.setScalar(1));
        tp.setMatrixAt(i, _m);
        if (t.axis === 0) hns.setMatrixAt(a++, _m); else hew.setMatrixAt(b++, _m);
      });
      hns.count = a; hew.count = b;
      tp.computeBoundingSphere(); hns.computeBoundingSphere(); hew.computeBoundingSphere();
      near.add(tp, hns, hew);
    }
    g.add(near);
    st.group = g;
    st.nearGroup = near;
    this.root.add(g);
    this.loadedCount++;
  }

  private unloadChunk(st: ChunkState) {
    if (!st.group) return;
    st.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.dispose();
        if (o === st.buildings) o.geometry.dispose();
      }
    });
    this.root.remove(st.group);
    st.group = null; st.nearGroup = null; st.buildings = null; st.tier = -1;
    this.loadedCount--;
  }

  private buildColliders(st: ChunkState) {
    const ch = st.chunk, P = this.physics;
    const list: RAPIER.Collider[] = [];
    for (const s of ch.slabs) if (s.collide) list.push(P.addStaticBox(s));
    for (const b of ch.buildings) list.push(P.addStaticBox({ x: b.x, y: 0, z: b.z, w: b.w, h: b.h, d: b.d, ry: 0 }));
    for (const b of ch.boxes) if (b.collide) list.push(P.addStaticBox(b));
    for (const p of ch.palms) list.push(P.addStaticBox({ x: p.x, y: 0, z: p.z, w: 0.5, h: 4, d: 0.5, ry: 0 }));
    for (const l of ch.lamps) list.push(P.addStaticBox({ x: l.x, y: 0, z: l.z, w: 0.25, h: 6, d: 0.25, ry: 0 }));
    for (const t of ch.tlights) list.push(P.addStaticBox({ x: t.x, y: 0, z: t.z, w: 0.25, h: 4.5, d: 0.25, ry: 0 }));
    st.colliders = list;
    this.physicsChunks++;
  }
  private removeColliders(st: ChunkState) {
    if (!st.colliders) return;
    for (const c of st.colliders) this.physics.removeCollider(c);
    st.colliders = null;
    this.physicsChunks--;
  }

  /** Ensure all chunks around a point have colliders (used before spawning the player). */
  forceColliders(x: number, z: number, r: number) {
    for (const st of this.states) {
      const d = this.rectDist(st.chunk, x, z);
      if (d < r && !st.colliders) this.buildColliders(st);
    }
  }

  private rectDist(ch: Chunk, x: number, z: number) {
    const dx = Math.max(ch.x0 - x, 0, x - ch.x1), dz = Math.max(ch.z0 - z, 0, z - ch.z1);
    return Math.hypot(dx, dz);
  }

  update(cam: THREE.Vector3, focus: THREE.Vector3, drawDist: number, night: number, maxBuildsPerFrame = 1) {
    const nearDist = Math.min(190, drawDist * 0.42), midDist = drawDist * 0.72;
    this.buildQueue.length = 0;
    for (const st of this.states) {
      st.dist = this.rectDist(st.chunk, cam.x, cam.z);
      if (st.dist < drawDist) {
        if (!st.group) this.buildQueue.push(st);
      } else if (st.dist > drawDist + 80 && st.group) this.unloadChunk(st);

      // colliders follow the player (focus), not the camera
      const pd = this.rectDist(st.chunk, focus.x, focus.z);
      if (pd < 170 && !st.colliders) this.buildColliders(st);
      else if (pd > 240 && st.colliders) this.removeColliders(st);
    }
    this.buildQueue.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < Math.min(maxBuildsPerFrame, this.buildQueue.length); i++) this.buildChunk(this.buildQueue[i]);

    for (const st of this.states) {
      if (!st.group) continue;
      const tier = st.dist < nearDist ? 0 : st.dist < midDist ? 1 : 2;
      if (tier !== st.tier) {
        st.tier = tier;
        st.nearGroup!.visible = tier === 0;
        for (const c of st.group.children) if (c !== st.nearGroup && c !== st.buildings) c.visible = tier <= 1;
        if (st.buildings) {
          st.buildings.count = tier === 2 ? st.tallCount : st.chunk.buildings.length;
          st.buildings.castShadow = tier === 0 && this.shadows;
        }
      }
    }

    // emissive intensities follow the time of day
    this.neonMat.color.setScalar(1.0 + night * 2.2);
    this.lampHeadMat.color.setRGB(0.7 + night * 2.6, 0.65 + night * 1.9, 0.55 + night * 1.0);
  }

  setShadows(on: boolean) {
    this.shadows = on;
    for (const st of this.states) st.tier = -1; // force refresh
  }

  /** Approximate GPU bytes held by city geometry + textures (estimate). */
  estimateBytes() {
    let instances = 0;
    for (const st of this.states) if (st.group) st.group.traverse((o) => { if (o instanceof THREE.InstancedMesh) instances += o.instanceMatrix.count; });
    const instBytes = instances * (64 + 12 + 8);
    const atlas = 1024 * 1024 * 4 * 1.33;
    return instBytes + atlas;
  }
}

export { CHUNK, CITY };
