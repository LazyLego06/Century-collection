import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export const G_STATIC = 1 << 0;
export const G_VEHICLE = 1 << 1;
export const G_PLAYER = 1 << 2;
export const G_NPC = 1 << 3;
export const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS = {
  static: groups(G_STATIC, 0xffff),
  vehicle: groups(G_VEHICLE, G_STATIC | G_VEHICLE | G_PLAYER | G_NPC),
  player: groups(G_PLAYER, G_STATIC | G_VEHICLE | G_NPC),
  npc: groups(G_NPC, G_STATIC | G_VEHICLE | G_PLAYER | G_NPC),
  /** Query filters (membership bits are ignored by queries; the filter half selects what is hit). */
  qStatic: groups(0xffff, G_STATIC),
  qWorld: groups(0xffff, G_STATIC | G_VEHICLE),
  qWheels: groups(0xffff, G_STATIC | G_VEHICLE),
  qAll: groups(0xffff, G_STATIC | G_VEHICLE | G_NPC | G_PLAYER),
};

export interface StaticBox { x: number; y: number; z: number; w: number; h: number; d: number; ry: number; }

export interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider; owner: unknown; }

export class Physics {
  world!: RAPIER.World;
  events!: RAPIER.EventQueue;
  owners = new Map<number, unknown>();
  readonly dt = 1 / 60;
  staticCount = 0;
  private ray!: RAPIER.Ray;

  static async init() {
    await RAPIER.init();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    this.events = new RAPIER.EventQueue(true);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  }

  /** Box with base at y (matches the instanced "unit box with base at 0" convention). */
  addStaticBox(b: StaticBox) {
    const desc = RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
      .setTranslation(b.x, b.y + b.h / 2, b.z)
      .setCollisionGroups(GROUPS.static)
      .setFriction(0.8);
    if (b.ry) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ry);
      desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    this.staticCount++;
    return this.world.createCollider(desc);
  }

  addStaticDesc(desc: RAPIER.ColliderDesc) {
    desc.setCollisionGroups(GROUPS.static);
    this.staticCount++;
    return this.world.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider) {
    this.owners.delete(c.handle);
    this.world.removeCollider(c, false);
    this.staticCount--;
  }

  step() {
    this.world.step(this.events);
  }

  /** Ray cast; returns the closest hit and its owner object (vehicle/ped) if registered. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter = GROUPS.qWorld, excludeBody?: RAPIER.RigidBody, excludeCollider?: RAPIER.Collider): RayHit | null {
    this.ray.origin.x = origin.x; this.ray.origin.y = origin.y; this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x; this.ray.dir.y = dir.y; this.ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filter, excludeCollider, excludeBody);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      dist: t,
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      owner: this.owners.get(hit.collider.handle),
    };
  }

  /** Cheap line-of-sight test against static geometry only. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return true;
    d.divideScalar(len);
    const h = this.raycast(a, d, len, GROUPS.qStatic);
    return !h;
  }
}
