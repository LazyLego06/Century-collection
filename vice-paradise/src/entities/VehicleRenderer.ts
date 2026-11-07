import * as THREE from 'three';
import { KINDS, SPECS, VehicleKind, buildVehicleGeometry, buildWheelGeometry } from './VehicleModels';
import { Vehicle } from './Vehicle';

const CAP = 72;
const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _sphere = new THREE.Sphere();

interface KindMeshes { body: THREE.InstancedMesh; detail: THREE.InstancedMesh; lights: THREE.InstancedMesh; }

/**
 * All vehicles are drawn with GPU instancing: 3 instanced meshes per vehicle kind + one for every wheel +
 * two for police light bars, i.e. ~18 draw calls regardless of how many cars exist. Per-instance frustum and
 * distance culling is done on the CPU while packing instance buffers; wheels are skipped beyond 110 m (LOD).
 */
export class VehicleRenderer {
  group = new THREE.Group();
  meshes = new Map<VehicleKind, KindMeshes>();
  wheels: THREE.InstancedMesh;
  sirenR: THREE.InstancedMesh;
  sirenB: THREE.InstancedMesh;
  paint: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  drawn = 0;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene = new THREE.Scene();
  private envSphere: THREE.Mesh;

  constructor() {
    this.paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.35, envMapIntensity: 1 });
    this.glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.3, envMapIntensity: 1.2 });
    for (const k of KINDS) {
      const g = buildVehicleGeometry(SPECS[k]);
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
        const m = new THREE.InstancedMesh(geo, mat, CAP);
        m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
        return m;
      };
      const body = mk(g.body, this.paint, true);
      body.setColorAt(0, _c.set(1, 1, 1));
      body.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(k, { body, detail: mk(g.detail, this.glass, true), lights: mk(g.lights, this.lightMat, false) });
    }
    this.wheels = new THREE.InstancedMesh(buildWheelGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), CAP * 4 * 2);
    this.wheels.frustumCulled = false; this.wheels.count = 0; this.wheels.castShadow = false;
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.wheels);
    const sb = new THREE.BoxGeometry(0.55, 0.14, 0.22);
    this.sirenR = new THREE.InstancedMesh(sb, new THREE.MeshBasicMaterial({ color: 0xffffff }), 40);
    this.sirenB = new THREE.InstancedMesh(sb, new THREE.MeshBasicMaterial({ color: 0xffffff }), 40);
    for (const s of [this.sirenR, this.sirenB]) { s.frustumCulled = false; s.count = 0; s.setColorAt(0, _c.set(1, 1, 1)); this.group.add(s); }

    const sg = new THREE.SphereGeometry(10, 16, 8);
    const cols = new Float32Array(sg.attributes.position.count * 3);
    sg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.envSphere = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    this.envScene.add(this.envSphere);
  }

  /** Regenerates the small reflection environment from current sky colours (called every few seconds). */
  updateEnvMap(renderer: THREE.WebGLRenderer, zenith: THREE.Color, horizon: THREE.Color, ground: THREE.Color, sun: THREE.Vector3, sunColor: THREE.Color, enabled: boolean) {
    if (!enabled) {
      this.paint.envMapIntensity = 0; this.glass.envMapIntensity = 0.2;
      if (!this.paint.envMap) return;
    } else { this.paint.envMapIntensity = 1; this.glass.envMapIntensity = 1.2; }
    const pos = this.envSphere.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.envSphere.geometry.attributes.color as THREE.BufferAttribute;
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      if (d.y >= 0) _c.copy(horizon).lerp(zenith, Math.pow(d.y, 0.6)); else _c.copy(ground);
      const sd = Math.max(0, d.dot(sun));
      _c.r += sunColor.r * Math.pow(sd, 12) * 3; _c.g += sunColor.g * Math.pow(sd, 12) * 3; _c.b += sunColor.b * Math.pow(sd, 12) * 3;
      col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    col.needsUpdate = true;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
    const rt = this.pmrem.fromScene(this.envScene as unknown as THREE.Scene, 0, 0.1, 50);
    this.envRT?.dispose();
    this.envRT = rt;
    this.paint.envMap = rt.texture; this.glass.envMap = rt.texture;
    this.paint.needsUpdate = true; this.glass.needsUpdate = true;
  }

  update(vehicles: Vehicle[], frustum: THREE.Frustum, cam: THREE.Vector3, maxDist: number, time: number, night: number) {
    const counts = new Map<VehicleKind, number>();
    for (const k of KINDS) counts.set(k, 0);
    let wc = 0, sr = 0, sbn = 0;
    this.drawn = 0;
    this.lightMat.color.setScalar(0.9 + night * 2.5);
    const md2 = maxDist * maxDist;
    for (const v of vehicles) {
      if (!v.visible) continue;
      const d2 = v.pos.distanceToSquared(cam);
      if (d2 > md2) continue;
      _sphere.center.copy(v.pos); _sphere.radius = v.spec.length * 0.6 + 0.5;
      if (!frustum.intersectsSphere(_sphere)) continue;
      const k = counts.get(v.kind)!;
      if (k >= CAP) continue;
      counts.set(v.kind, k + 1);
      this.drawn++;
      const ms = this.meshes.get(v.kind)!;
      _m.compose(v.pos, v.quat, _s.set(1, 1, 1));
      ms.body.setMatrixAt(k, _m); ms.detail.setMatrixAt(k, _m); ms.lights.setMatrixAt(k, _m);
      const hf = v.health / v.spec.maxHealth;
      const dmg = v.destroyed ? 0.08 : 0.35 + 0.65 * Math.min(1, hf * 1.4);
      _c.copy(v.color).multiplyScalar(dmg);
      ms.body.setColorAt(k, _c);

      // wheels (LOD: only near vehicles)
      if (d2 < 110 * 110 && wc < this.wheels.instanceMatrix.count - 4) {
        const s = v.spec;
        const cy = Vehicle.connY(s);
        for (let i = 0; i < 4; i++) {
          const front = i < 2;
          const x = i % 2 === 0 ? s.trackX : -s.trackX;
          const z = front ? s.axleZ : -s.axleZ;
          const susp = v.mode === 'physics' ? v.suspension[i] : s.suspRest - 0.06;
          _p.set(x, cy - susp, z);
          _e.set(v.wheelSpin, front ? v.steerCur : 0, 0, 'YXZ');
          _q.setFromEuler(_e);
          _t.compose(_p, _q, _s.set(1, s.wheelR, s.wheelR));
          _w.multiplyMatrices(_m, _t);
          this.wheels.setMatrixAt(wc++, _w);
        }
      }
      if (v.kind === 'police' && v.sirenOn && !v.destroyed) {
        const s = v.spec;
        const flash = Math.sin(time * 14 + v.id) > 0;
        const hy = s.bodyH / 2 + 0.7;
        _t.makeTranslation(-0.32, hy, -0.15); _w.multiplyMatrices(_m, _t);
        this.sirenR.setMatrixAt(sr, _w); this.sirenR.setColorAt(sr, _c.setRGB(flash ? 6 : 0.4, 0.05, 0.05)); sr++;
        _t.makeTranslation(0.32, hy, -0.15); _w.multiplyMatrices(_m, _t);
        this.sirenB.setMatrixAt(sbn, _w); this.sirenB.setColorAt(sbn, _c.setRGB(0.05, 0.2, flash ? 0.4 : 7)); sbn++;
      }
    }
    for (const k of KINDS) {
      const ms = this.meshes.get(k)!, c = counts.get(k)!;
      for (const m of [ms.body, ms.detail, ms.lights]) { m.count = c; m.instanceMatrix.needsUpdate = true; }
      if (ms.body.instanceColor) ms.body.instanceColor.needsUpdate = true;
    }
    this.wheels.count = wc; this.wheels.instanceMatrix.needsUpdate = true;
    this.sirenR.count = sr; this.sirenB.count = sbn;
    for (const s of [this.sirenR, this.sirenB]) { s.instanceMatrix.needsUpdate = true; if (s.instanceColor) s.instanceColor.needsUpdate = true; }
  }

  setShadows(on: boolean) {
    for (const ms of this.meshes.values()) { ms.body.castShadow = on; ms.detail.castShadow = on; }
  }
}
