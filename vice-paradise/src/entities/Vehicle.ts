import * as THREE from 'three';
import { Physics, RAPIER, GROUPS } from '../core/Physics';
import { clamp, damp } from '../core/util';
import { SPECS, VehicleKind, VehicleSpec } from './VehicleModels';
import { WATER_Y } from '../world/CityLayout';

export type VehicleMode = 'traffic' | 'physics';
export type Driver = 'none' | 'player' | 'traffic' | 'police' | 'npc';

let NEXT_ID = 1;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

/** Traffic path state (kinematic, lane following). */
export interface LaneState {
  ai: number; aj: number; bi: number; bj: number; // current edge from node a to node b
  s: number; // distance along the current segment
  turning: boolean;
  p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; // bezier (or line when not turning: p0->p2)
  len: number;
  ni: number; nj: number; // next node after b (chosen on arrival)
  blockedTime: number;
}

export class Vehicle {
  id = NEXT_ID++;
  spec: VehicleSpec;
  kind: VehicleKind;
  color: THREE.Color;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mode: VehicleMode;
  controller: RAPIER.DynamicRayCastVehicleController | null = null;
  driver: Driver = 'none';
  health: number;
  destroyed = false;
  burnTimer = -1;
  sunk = false;
  submergedTime = 0;
  wreckAge = 0;
  // pose for interpolation
  prevPos = new THREE.Vector3();
  curPos = new THREE.Vector3();
  prevQuat = new THREE.Quaternion();
  curQuat = new THREE.Quaternion();
  pos = new THREE.Vector3(); // interpolated render pose
  quat = new THREE.Quaternion();
  // controls
  throttle = 0; brakeIn = 0; steer = 0; handbrake = false;
  steerCur = 0;
  wheelSpin = 0;
  suspension = [0, 0, 0, 0];
  // traffic
  lane: LaneState | null = null;
  speed = 0; // traffic speed (m/s, along path)
  trafficAccum = 0;
  // police/AI
  sirenOn = false;
  aiState: Record<string, number> = {};
  persistent = false; // mission vehicles are never despawned
  lastImpact = 0;
  lastHitByPlayer = -100;
  visible = true;
  lightsOn = false;
  horn = 0;

  constructor(private physics: Physics, kind: VehicleKind, pos: THREE.Vector3, yaw: number, mode: VehicleMode, color?: number) {
    this.spec = SPECS[kind];
    this.kind = kind;
    this.mode = mode;
    this.color = new THREE.Color(color ?? this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)]);
    this.health = this.spec.maxHealth;
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const bd = (mode === 'traffic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setLinearDamping(0.05)
      .setAngularDamping(0.8)
      .setCanSleep(true);
    this.body = physics.world.createRigidBody(bd);
    const s = this.spec;
    const hh = s.bodyH / 2 + 0.25;
    const cd = RAPIER.ColliderDesc.cuboid(s.width / 2, hh, s.length / 2)
      .setTranslation(0, 0.2, 0)
      .setCollisionGroups(GROUPS.vehicle)
      .setFriction(0.5)
      .setRestitution(0.1)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(s.mass * 40);
    const m = s.mass;
    const ix = (m / 12) * (hh * hh * 4 + s.length * s.length), iy = (m / 12) * (s.width * s.width + s.length * s.length) * 1.1, iz = (m / 12) * (s.width * s.width + hh * hh * 4);
    cd.setMassProperties(m, { x: 0, y: -0.35, z: 0.05 }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 });
    this.collider = physics.world.createCollider(cd, this.body);
    physics.owners.set(this.collider.handle, this);
    this.curPos.copy(pos); this.prevPos.copy(pos); this.pos.copy(pos);
    this.curQuat.copy(_q); this.prevQuat.copy(_q); this.quat.copy(_q);
    if (mode === 'physics') this.ensureController();
  }

  /** Height of the chassis centre above the ground when resting on its wheels. */
  static rideHeight(kind: VehicleKind) {
    const s = SPECS[kind];
    return s.wheelR + s.suspRest - 0.06 - Vehicle.connY(s);
  }
  static connY(s: VehicleSpec) { return s.kind === 'sports' ? 0.06 : 0.0; }

  private ensureController() {
    if (this.controller) return;
    const s = this.spec;
    const c = this.physics.world.createVehicleController(this.body);
    c.indexUpAxis = 1;
    c.setIndexForwardAxis = 2; // (rapier names this setter oddly)
    const cy = Vehicle.connY(s);
    const pts = [
      { x: s.trackX, y: cy, z: s.axleZ }, { x: -s.trackX, y: cy, z: s.axleZ },
      { x: s.trackX, y: cy, z: -s.axleZ }, { x: -s.trackX, y: cy, z: -s.axleZ },
    ];
    for (let i = 0; i < 4; i++) {
      c.addWheel(pts[i], { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, s.suspRest, s.wheelR);
      c.setWheelSuspensionStiffness(i, s.suspStiff);
      c.setWheelSuspensionCompression(i, 2.4);
      c.setWheelSuspensionRelaxation(i, 3.2);
      c.setWheelMaxSuspensionTravel(i, 0.25);
      c.setWheelMaxSuspensionForce(i, 1e6);
      c.setWheelFrictionSlip(i, s.grip);
      c.setWheelSideFrictionStiffness(i, 1.0);
    }
    this.controller = c;
  }

  /** Switch from kinematic lane-following to a full physics body (crash, carjack, police). */
  makeDynamic() {
    if (this.mode === 'physics') return;
    const yaw = this.yaw;
    this.mode = 'physics';
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: Math.sin(yaw) * this.speed, y: 0, z: Math.cos(yaw) * this.speed }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lane = null;
    this.ensureController();
  }

  get yaw() {
    _f.set(0, 0, 1).applyQuaternion(this.curQuat);
    return Math.atan2(_f.x, _f.z);
  }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.curQuat); }
  get velocity() {
    if (this.mode === 'traffic') { const y = this.yaw; return _v.set(Math.sin(y) * this.speed, 0, Math.cos(y) * this.speed); }
    const lv = this.body.linvel();
    return _v.set(lv.x, lv.y, lv.z);
  }
  get speedMs() {
    if (this.mode === 'traffic') return this.speed;
    return this.controller ? this.controller.currentVehicleSpeed() : 0;
  }
  get upright() { return _u.set(0, 1, 0).applyQuaternion(this.curQuat).y; }

  /** Apply driving inputs; called every fixed step for physics vehicles. */
  fixedUpdate(dt: number) {
    if (this.mode !== 'physics' || !this.controller) return;
    const c = this.controller, s = this.spec;
    // never feed NaN into the solver (it would poison the body)
    if (!Number.isFinite(this.steer)) this.steer = 0;
    if (!Number.isFinite(this.throttle)) this.throttle = 0;
    if (!Number.isFinite(this.brakeIn)) this.brakeIn = 0;
    const dead = this.destroyed || this.sunk || this.submergedTime > 0.3;
    const speed = c.currentVehicleSpeed();
    const throttle = dead ? 0 : this.throttle;
    const brakeIn = dead ? 0 : this.brakeIn;

    // steering: smoothed and reduced at speed
    const steerLim = s.steerMax * (1 - clamp(Math.abs(speed) / 55, 0, 0.62));
    this.steerCur += (this.steer * steerLim - this.steerCur) * damp(8, dt);
    c.setWheelSteering(0, this.steerCur);
    c.setWheelSteering(1, this.steerCur);

    let engine = 0, brake = 0;
    if (throttle > 0) {
      if (speed < -1) brake = s.brake;
      else {
        const f = 1 - clamp(speed / s.maxSpeed, 0, 1) ** 2;
        engine = throttle * s.engine * Math.max(0, f);
      }
    }
    if (brakeIn > 0) {
      if (speed > 1) brake = s.brake * brakeIn;
      else if (speed > -14) engine = -s.engine * 0.55 * brakeIn;
    }
    if (throttle === 0 && brakeIn === 0) brake = this.driver === 'none' || dead ? s.brake * 0.6 : 2.5;

    const driven = (s.frontDrive ? 2 : 0) + (s.rearDrive ? 2 : 0);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const isDriven = front ? s.frontDrive : s.rearDrive;
      c.setWheelEngineForce(i, isDriven ? engine / driven : 0);
      let b = brake;
      let grip = s.grip;
      if (this.handbrake && !front) { b = s.brake * 1.6; grip = s.grip * 0.42; }
      c.setWheelBrake(i, b);
      c.setWheelFrictionSlip(i, grip);
    }

    c.updateVehicle(dt, undefined, GROUPS.qWheels);

    // --- arcade helpers ---------------------------------------------------
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) contacts++;
    const lv = this.body.linvel();
    const rot = this.body.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _f.set(0, 0, 1).applyQuaternion(_q);
    _r.set(1, 0, 0).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    const m = s.mass;
    if (contacts >= 3) {
      // downforce keeps cars planted at speed
      const v2 = lv.x * lv.x + lv.z * lv.z;
      this.body.applyImpulse({ x: -_u.x * v2 * 1.6 * dt, y: -_u.y * v2 * 1.6 * dt, z: -_u.z * v2 * 1.6 * dt }, true);
      // lateral grip assist (reduced while hand-braking to allow drifts)
      const side = lv.x * _r.x + lv.y * _r.y + lv.z * _r.z;
      const k = this.handbrake ? 0.6 : 3.2;
      const imp = -side * m * Math.min(1, k * dt);
      this.body.applyImpulse({ x: _r.x * imp, y: _r.y * imp, z: _r.z * imp }, true);
      // yaw assist so the car turns crisply even at low speed
      const av = this.body.angvel();
      const fwdSpeed = lv.x * _f.x + lv.z * _f.z;
      const wantYaw = this.steerCur * clamp(fwdSpeed / 6, -1.4, 1.4) * 1.3;
      const yawErr = wantYaw - av.y;
      if (!dead) this.body.applyTorqueImpulse({ x: 0, y: yawErr * m * 0.9 * dt * (this.handbrake ? 1.6 : 1), z: 0 }, true);
    } else if (contacts === 0) {
      // air: stabilise roll/pitch a bit
      const av = this.body.angvel();
      this.body.setAngvel({ x: av.x * 0.985, y: av.y, z: av.z * 0.985 }, true);
    }
    // anti-roll: push the car back toward upright when tilted
    const tilt = 1 - _u.y;
    if (tilt > 0.02 && contacts > 0) {
      const ax = _u.z, az = -_u.x; // axis = up x worldUp
      this.body.applyTorqueImpulse({ x: ax * m * 6 * dt, y: 0, z: az * m * 6 * dt }, true);
    }
    // water
    const p = this.body.translation();
    if (p.y < WATER_Y - 0.3) {
      this.submergedTime += dt;
      this.body.setLinearDamping(2.5);
      if (this.submergedTime > 4) this.sunk = true;
    } else if (this.submergedTime > 0 && !this.sunk) { this.submergedTime = 0; this.body.setLinearDamping(0.05); }

    for (let i = 0; i < 4; i++) this.suspension[i] = c.wheelSuspensionLength(i) ?? s.suspRest;
    this.wheelSpin += (speed / s.wheelR) * dt;
  }

  /** Reset to upright at the current position (unflip). */
  unflip() {
    const p = this.body.translation();
    const y = this.yaw;
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), y);
    this.body.setTranslation({ x: p.x, y: Math.max(p.y, 0) + 1.2, z: p.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  teleport(pos: THREE.Vector3, yaw: number) {
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.curPos.copy(pos); this.prevPos.copy(pos);
    this.curQuat.copy(_q); this.prevQuat.copy(_q);
  }

  /** Called after every physics step. */
  syncFromBody() {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    const t = this.body.translation(), r = this.body.rotation();
    this.curPos.set(t.x, t.y, t.z);
    this.curQuat.set(r.x, r.y, r.z, r.w);
  }
  interpolate(alpha: number) {
    this.pos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.quat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
  }

  damage(amount: number) {
    if (this.destroyed) return;
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; if (this.burnTimer < 0) this.burnTimer = 5; }
  }

  dispose() {
    if (this.controller) this.physics.world.removeVehicleController(this.controller);
    this.physics.owners.delete(this.collider.handle);
    this.physics.world.removeRigidBody(this.body);
    this.controller = null;
  }
}
