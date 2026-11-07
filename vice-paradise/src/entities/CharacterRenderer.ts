import * as THREE from 'three';

/** Everything the renderer needs to pose a humanoid. */
export interface CharacterVisual {
  pos: THREE.Vector3;
  yaw: number;
  phase: number; // walk cycle phase
  stride: number; // 0..1 how much the limbs swing
  aim: number; // 0..1 arms raised forward
  lying: number; // 0..1 fallen over
  spin: number; // tumble angle while knocked
  armed: boolean;
  skin: THREE.Color; shirt: THREE.Color; pants: THREE.Color; hair: THREE.Color;
  visible: boolean;
}

const _base = new THREE.Matrix4(), _part = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _sph = new THREE.Sphere();

function limb(w: number, h: number, d: number) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, -h / 2, 0); return g; }

/**
 * Low-poly humanoids drawn with 7 instanced meshes total (torso, head, hair, legs, arms, hands, gun).
 * Every pedestrian, enemy, cop and the player share these draw calls.
 */
export class CharacterRenderer {
  group = new THREE.Group();
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private hair: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private gun: THREE.InstancedMesh;
  drawn = 0;

  constructor(private cap = 96) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mk = (g: THREE.BufferGeometry, n: number, m: THREE.Material = mat) => {
      const im = new THREE.InstancedMesh(g, m, n);
      im.frustumCulled = false; im.count = 0; im.castShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(im);
      return im;
    };
    const torso = new THREE.BoxGeometry(0.46, 0.62, 0.26); torso.translate(0, 0.31, 0);
    const head = new THREE.BoxGeometry(0.24, 0.27, 0.25); head.translate(0, 0.135, 0);
    const hair = new THREE.BoxGeometry(0.26, 0.09, 0.27); hair.translate(0, 0.3, -0.01);
    this.torso = mk(torso, cap);
    this.head = mk(head, cap);
    this.hair = mk(hair, cap);
    this.legs = mk(limb(0.19, 0.9, 0.21), cap * 2);
    this.arms = mk(limb(0.13, 0.68, 0.14), cap * 2);
    const gun = new THREE.BoxGeometry(0.08, 0.14, 0.42); gun.translate(0, -0.6, 0.12);
    this.gun = mk(gun, cap, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  }

  update(list: CharacterVisual[], frustum: THREE.Frustum, cam: THREE.Vector3, maxDist: number) {
    let n = 0, g = 0;
    const md2 = maxDist * maxDist;
    for (const c of list) {
      if (!c.visible || n >= this.cap) continue;
      if (c.pos.distanceToSquared(cam) > md2) continue;
      _sph.center.copy(c.pos); _sph.center.y += 0.9; _sph.radius = 1.2;
      if (!frustum.intersectsSphere(_sph)) continue;

      // base transform: position, heading, then fall-over / tumble
      _q.setFromAxisAngle(_p.set(0, 1, 0), c.yaw);
      _base.compose(c.pos, _q, _s.set(1, 1, 1));
      if (c.lying > 0 || c.spin !== 0) {
        _e.set(-c.lying * Math.PI / 2 + c.spin, 0, 0);
        _t.makeRotationFromEuler(_e);
        // pivot around a point just above the ground so the body lies flat
        _part.makeTranslation(0, 0.15 * c.lying, 0);
        _base.multiply(_part).multiply(_t);
      }
      const swing = Math.sin(c.phase) * 0.75 * c.stride;
      const lean = c.stride * 0.12;

      // legs
      for (let s = -1; s <= 1; s += 2) {
        _e.set(s * swing, 0, 0);
        _q.setFromEuler(_e);
        _t.compose(_p.set(s * 0.11, 0.92, 0), _q, _s.set(1, 1, 1));
        _part.multiplyMatrices(_base, _t);
        this.legs.setMatrixAt(n * 2 + (s < 0 ? 0 : 1), _part);
        this.legs.setColorAt(n * 2 + (s < 0 ? 0 : 1), c.pants);
      }
      // torso
      _e.set(lean, 0, 0); _q.setFromEuler(_e);
      _t.compose(_p.set(0, 0.9, 0), _q, _s.set(1, 1, 1));
      _part.multiplyMatrices(_base, _t);
      this.torso.setMatrixAt(n, _part); this.torso.setColorAt(n, c.shirt);
      // head + hair
      _t.compose(_p.set(0, 1.53, lean * 0.3), _q.identity(), _s.set(1, 1, 1));
      _part.multiplyMatrices(_base, _t);
      this.head.setMatrixAt(n, _part); this.head.setColorAt(n, c.skin);
      this.hair.setMatrixAt(n, _part); this.hair.setColorAt(n, c.hair);
      // arms (raise forward when aiming)
      for (let s = -1; s <= 1; s += 2) {
        const aimA = -Math.PI / 2 * c.aim;
        const ang = aimA + (1 - c.aim) * (-s * swing * 0.8);
        _e.set(ang, s < 0 ? 0 : 0, c.aim > 0.5 ? (s < 0 ? -0.35 : 0.05) * c.aim : s * 0.06);
        _q.setFromEuler(_e);
        _t.compose(_p.set(s * 0.3, 1.48, 0), _q, _s.set(1, 1, 1));
        _part.multiplyMatrices(_base, _t);
        this.arms.setMatrixAt(n * 2 + (s < 0 ? 0 : 1), _part);
        this.arms.setColorAt(n * 2 + (s < 0 ? 0 : 1), c.aim > 0.5 || c.shirt === c.skin ? c.shirt : c.skin);
        if (s > 0 && c.armed) { this.gun.setMatrixAt(g, _part); g++; }
      }
      n++;
    }
    this.drawn = n;
    for (const m of [this.torso, this.head, this.hair]) { m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true; }
    for (const m of [this.legs, this.arms]) { m.count = n * 2; m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true; }
    this.gun.count = g; this.gun.instanceMatrix.needsUpdate = true;
  }

  setShadows(on: boolean) { for (const m of this.group.children) (m as THREE.Mesh).castShadow = on; }
}
