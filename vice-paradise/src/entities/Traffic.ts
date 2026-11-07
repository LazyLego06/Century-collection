import * as THREE from 'three';
import { Physics } from '../core/Physics';
import { SpatialGrid, clamp } from '../core/util';
import { CELL, INTERSECTION_CLEAR, LANE_OFFSET, N, nodeValid } from '../world/CityLayout';
import { TrafficLights } from '../world/TrafficLights';
import { LaneState, Vehicle } from './Vehicle';
import type { VehicleKind } from './VehicleModels';

export interface Obstacle { x: number; z: number; isPlayer: boolean; isTraffic: boolean; id: number; }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _tmp: Obstacle[] = [];
const CRUISE = 13.5;

function dirOf(ai: number, aj: number, bi: number, bj: number) { return { dx: Math.sign(bi - ai), dz: Math.sign(bj - aj) }; }

/** Start/end points of the right-hand lane on edge a->b. */
function laneEnds(ai: number, aj: number, bi: number, bj: number, start: THREE.Vector3, end: THREE.Vector3) {
  const { dx, dz } = dirOf(ai, aj, bi, bj);
  const rx = -dz, rz = dx; // right-hand side
  start.set(ai * CELL + dx * INTERSECTION_CLEAR + rx * LANE_OFFSET, 0, aj * CELL + dz * INTERSECTION_CLEAR + rz * LANE_OFFSET);
  end.set(bi * CELL - dx * INTERSECTION_CLEAR + rx * LANE_OFFSET, 0, bj * CELL - dz * INTERSECTION_CLEAR + rz * LANE_OFFSET);
}

function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  return out.set(u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, 0, u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z);
}
function bezierTan(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, t: number, out: THREE.Vector3) {
  return out.set(2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x), 0, 2 * (1 - t) * (p1.z - p0.z) + 2 * t * (p2.z - p1.z));
}

/**
 * Kinematic lane-following traffic. Cars are cheap kinematic bodies (they still push/collide with the player)
 * and only become full physics vehicles when crashed into or carjacked. Distant cars tick at a reduced rate.
 */
export class Traffic {
  target = 24;
  spawnMin = 70;
  despawn = 300;
  private tick = 0;

  constructor(private physics: Physics, private lights: TrafficLights) {}

  pickKind(): VehicleKind {
    const r = Math.random();
    if (r < 0.42) return 'sedan';
    if (r < 0.62) return 'suv';
    if (r < 0.78) return 'taxi';
    if (r < 0.92) return 'sports';
    return 'police';
  }

  private newLane(ai: number, aj: number, bi: number, bj: number, s: number): LaneState {
    const ls: LaneState = { ai, aj, bi, bj, s, turning: false, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), len: 0, ni: -1, nj: -1, blockedTime: 0 };
    laneEnds(ai, aj, bi, bj, ls.p0, ls.p2);
    ls.len = ls.p0.distanceTo(ls.p2);
    return ls;
  }

  /** Try to spawn one traffic car on a random edge between minR and maxR from the focus, outside the view. */
  trySpawn(vehicles: Vehicle[], focus: THREE.Vector3, frustum: THREE.Frustum | null, minR: number, maxR: number, forceKind?: VehicleKind): Vehicle | null {
    for (let tries = 0; tries < 12; tries++) {
      const ai = Math.floor(Math.random() * (N + 1)), aj = Math.floor(Math.random() * (N + 1));
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [dx, dz] = dirs[Math.floor(Math.random() * 4)];
      const bi = ai + dx, bj = aj + dz;
      if (!nodeValid(bi, bj)) continue;
      const lane = this.newLane(ai, aj, bi, bj, 0);
      lane.s = Math.random() * lane.len * 0.8;
      const p = new THREE.Vector3().lerpVectors(lane.p0, lane.p2, lane.s / lane.len);
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d < minR || d > maxR) continue;
      if (frustum && d < 200 && frustum.containsPoint(_a.set(p.x, 1, p.z))) continue;
      let clear = true;
      for (const v of vehicles) if (v.curPos.distanceToSquared(p) < 14 * 14) { clear = false; break; }
      if (!clear) continue;
      const kind = forceKind ?? this.pickKind();
      p.y = Vehicle.rideHeight(kind);
      const v = new Vehicle(this.physics, kind, p, Math.atan2(dx, dz), 'traffic');
      v.driver = 'traffic';
      v.lane = lane;
      v.speed = CRUISE * 0.7;
      vehicles.push(v);
      return v;
    }
    return null;
  }

  /** Pick the next node after arriving at b: straight is most likely, never a U-turn unless at a dead end. */
  private chooseNext(l: LaneState) {
    const { dx, dz } = dirOf(l.ai, l.aj, l.bi, l.bj);
    const opts: [number, number, number][] = [];
    const straight: [number, number] = [l.bi + dx, l.bj + dz];
    const left: [number, number] = [l.bi + dz, l.bj - dx];
    const right: [number, number] = [l.bi - dz, l.bj + dx];
    if (nodeValid(...straight)) opts.push([...straight, 5]);
    if (nodeValid(...left)) opts.push([...left, 2]);
    if (nodeValid(...right)) opts.push([...right, 3]);
    if (!opts.length) { l.ni = l.ai; l.nj = l.aj; return; }
    let tot = 0; for (const o of opts) tot += o[2];
    let r = Math.random() * tot;
    for (const o of opts) { r -= o[2]; if (r <= 0) { l.ni = o[0]; l.nj = o[1]; return; } }
    l.ni = opts[0][0]; l.nj = opts[0][1];
  }

  private startTurn(l: LaneState) {
    this.chooseNext(l);
    const end = l.p2.clone();
    const ns = new THREE.Vector3(), ne = new THREE.Vector3();
    laneEnds(l.bi, l.bj, l.ni, l.nj, ns, ne);
    l.p0.copy(end); l.p2.copy(ns);
    const d1 = dirOf(l.ai, l.aj, l.bi, l.bj), d2 = dirOf(l.bi, l.bj, l.ni, l.nj);
    if (d1.dx === d2.dx && d1.dz === d2.dz) l.p1.lerpVectors(l.p0, l.p2, 0.5);
    else if (d1.dx === -d2.dx && d1.dz === -d2.dz) l.p1.set(l.bi * CELL + d1.dx * 8, 0, l.bj * CELL + d1.dz * 8);
    else l.p1.set(l.bi * CELL + -d1.dz * LANE_OFFSET + -d2.dz * LANE_OFFSET, 0, l.bj * CELL + d1.dx * LANE_OFFSET + d2.dx * LANE_OFFSET);
    // approximate arc length
    let len = 0; const a = new THREE.Vector3(), b = new THREE.Vector3();
    bezier(l.p0, l.p1, l.p2, 0, a);
    for (let i = 1; i <= 8; i++) { bezier(l.p0, l.p1, l.p2, i / 8, b); len += a.distanceTo(b); a.copy(b); }
    l.len = Math.max(1, len);
    l.s = 0;
    l.turning = true;
  }

  fixedUpdate(dt: number, vehicles: Vehicle[], focus: THREE.Vector3, obstacles: SpatialGrid<Obstacle>) {
    this.tick++;
    for (const v of vehicles) {
      if (v.mode !== 'traffic' || !v.lane) continue;
      const dist = Math.hypot(v.curPos.x - focus.x, v.curPos.z - focus.z);
      // reduced update frequency for distant cars (cheaper AI, same motion)
      const every = dist > 200 ? 4 : dist > 120 ? 2 : 1;
      v.trafficAccum += dt;
      if ((this.tick + v.id) % every !== 0) continue;
      const sdt = v.trafficAccum;
      v.trafficAccum = 0;
      this.drive(v, sdt, obstacles, dist < 120);
    }
  }

  private drive(v: Vehicle, dt: number, obstacles: SpatialGrid<Obstacle>, nearPlayer: boolean) {
    const l = v.lane!;
    let target = v.kind === 'sports' ? CRUISE * 1.15 : CRUISE;
    const fwd = v.forward(_b);
    // traffic lights (only on straight segments approaching the stop line)
    if (!l.turning) {
      const axis: 0 | 1 = l.ai === l.bi ? 0 : 1;
      const st = this.lights.state(axis);
      const toStop = l.len - l.s;
      if (st !== 'g' && toStop > -0.5 && toStop < 26) {
        if (!(st === 'y' && toStop < 6)) target = Math.min(target, Math.max(0, Math.sqrt(Math.max(0, 2 * 4.5 * (toStop - 0.5)))));
      }
    } else target *= 0.62;

    // look ahead for obstacles
    const look = 5 + v.speed * 1.2;
    obstacles.query(v.curPos.x + fwd.x * look * 0.5, v.curPos.z + fwd.z * look * 0.5, look * 0.5 + 3, _tmp);
    let blockedByTraffic = false, blocked = false;
    for (const o of _tmp) {
      if (o.id === v.id) continue;
      const rx = o.x - v.curPos.x, rz = o.z - v.curPos.z;
      const along = rx * fwd.x + rz * fwd.z;
      const lat = Math.abs(-rx * fwd.z + rz * fwd.x);
      if (along > 0.5 && along < look && lat < 2.3) {
        if (o.isTraffic && l.blockedTime > 7) continue; // resolve rare deadlocks
        target = Math.min(target, Math.max(0, (along - 6) * 0.9));
        blocked = true;
        if (o.isTraffic) blockedByTraffic = true;
        if (o.isPlayer && along < 9 && nearPlayer) v.horn = 0.6;
      }
    }
    l.blockedTime = blocked && blockedByTraffic && v.speed < 0.5 ? l.blockedTime + dt : Math.max(0, l.blockedTime - dt * 0.5);
    if (l.blockedTime > 9) l.blockedTime = 0;

    const acc = target > v.speed ? 3.2 : 7.5;
    v.speed += clamp(target - v.speed, -acc * dt, acc * dt);
    l.s += v.speed * dt;
    if (l.s >= l.len) {
      const over = l.s - l.len;
      if (!l.turning) this.startTurn(l);
      else {
        const ni = l.ni, nj = l.nj, bi = l.bi, bj = l.bj;
        const nl = this.newLane(bi, bj, ni, nj, 0);
        Object.assign(l, nl);
      }
      l.s = over;
    }
    // pose
    const p = _a;
    let yaw: number;
    if (l.turning) {
      const t = clamp(l.s / l.len, 0, 1);
      bezier(l.p0, l.p1, l.p2, t, p);
      const tan = bezierTan(l.p0, l.p1, l.p2, t, _b);
      yaw = Math.atan2(tan.x, tan.z);
    } else {
      p.lerpVectors(l.p0, l.p2, clamp(l.s / l.len, 0, 1));
      yaw = Math.atan2(l.p2.x - l.p0.x, l.p2.z - l.p0.z);
    }
    p.y = Vehicle.rideHeight(v.kind);
    const half = yaw / 2;
    v.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    v.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    v.wheelSpin += (v.speed / v.spec.wheelR) * dt;
  }
}
