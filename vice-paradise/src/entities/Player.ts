import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { GROUPS, RAPIER } from '../core/Physics';
import { angleDiff, clamp, damp } from '../core/util';
import { WATER_Y } from '../world/CityLayout';
import type { CharacterVisual } from './CharacterRenderer';
import type { Game } from '../core/Game';
import type { Vehicle } from './Vehicle';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const CAP_HALF = 0.55, CAP_R = 0.35, CENTER_Y = CAP_HALF + CAP_R; // capsule centre above feet

export class Player implements CharacterVisual {
  pos = new THREE.Vector3();
  yaw = 0; phase = 0; stride = 0; aim = 0; lying = 0; spin = 0; armed = true; visible = true;
  skin = new THREE.Color(0xd9a77e); shirt = new THREE.Color(0x19c6c0); pants = new THREE.Color(0xf2efe6); hair = new THREE.Color(0x2a1a10);
  health = 100; armor = 0;
  dead = false;
  inVehicle = false;
  vehicle: Vehicle | null = null;
  swimming = false;
  sprinting = false;
  // input (sampled per frame, applied per fixed step)
  moveX = 0; moveZ = 0; wantJump = false; wantSprint = false; camYaw = 0; aiming = false;
  body: RAPIER_T.RigidBody;
  collider: RAPIER_T.Collider;
  private controller: RAPIER_T.KinematicCharacterController;
  private vy = 0;
  private grounded = true;
  private curPos = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private airTime = 0;
  private hVel = new THREE.Vector3();
  lastDamageTime = -10;
  damageDir = 0;

  constructor(private game: Game, spawn: THREE.Vector3) {
    const W = game.physics.world;
    this.body = W.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CENTER_Y, spawn.z));
    this.collider = W.createCollider(RAPIER.ColliderDesc.capsule(CAP_HALF, CAP_R).setCollisionGroups(GROUPS.player), this.body);
    game.physics.owners.set(this.collider.handle, this);
    this.controller = W.createCharacterController(0.04);
    this.controller.enableAutostep(0.45, 0.25, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle(0.9);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
    this.curPos.copy(spawn); this.prevPos.copy(spawn); this.pos.copy(spawn);
  }

  get speed() {
    if (this.inVehicle && this.vehicle) return Math.abs(this.vehicle.speedMs);
    return this.hVel.length();
  }
  get headPos() { return _v.set(this.pos.x, this.pos.y + 1.6, this.pos.z); }

  fixedUpdate(dt: number) {
    if (this.inVehicle || this.dead) return;
    const g = this.game;
    // desired horizontal velocity relative to camera
    const len = Math.hypot(this.moveX, this.moveZ);
    let mx = 0, mz = 0;
    if (len > 0.01) {
      const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
      // camera forward = (sin, cos); right = (-cos, sin) (right-handed, y up)
      const ix = this.moveX / len, iz = this.moveZ / len;
      mx = sy * iz - cy * ix;
      mz = cy * iz + sy * ix;
    }
    this.sprinting = this.wantSprint && !this.aiming && len > 0.01;
    let speed = this.aiming ? 2.6 : this.sprinting ? 7.2 : 3.6;
    if (this.swimming) speed = this.sprinting ? 3.2 : 2.2;
    const tx = mx * speed, tz = mz * speed;
    const accel = this.grounded || this.swimming ? 14 : 3;
    this.hVel.x += (tx - this.hVel.x) * damp(accel, dt);
    this.hVel.z += (tz - this.hVel.z) * damp(accel, dt);

    // facing: follow movement, or the camera while aiming
    if (this.aiming) this.yaw += angleDiff(this.yaw, this.camYaw) * damp(20, dt);
    else if (len > 0.01) this.yaw += angleDiff(this.yaw, Math.atan2(mx, mz)) * damp(12, dt);

    // vertical
    const feetY = this.body.translation().y - CENTER_Y;
    this.swimming = feetY < WATER_Y - 1.1;
    if (this.swimming) {
      const targetY = WATER_Y - 1.25;
      this.vy += (targetY - feetY) * 6 * dt - this.vy * 3 * dt;
      if (this.wantJump) { this.vy = 6.5; }
    } else {
      this.vy -= 22 * dt;
      if (this.grounded && this.wantJump) { this.vy = 7.2; this.grounded = false; g.audio.jump(); }
    }
    this.wantJump = false;

    const desired = { x: this.hVel.x * dt, y: this.vy * dt, z: this.hVel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, undefined, GROUPS.qAll);
    const m = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded) {
      if (!wasGrounded && this.airTime > 0.5 && this.vy < -16) this.damage((-this.vy - 16) * 6, null);
      if (this.vy < 0) this.vy = 0;
      this.airTime = 0;
    } else this.airTime += dt;
    if (m.y > desired.y + 1e-4 && this.vy > 0 && !this.grounded) this.vy *= 0.5; // head bump
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: Math.max(t.y + m.y, -4 + CENTER_Y), z: t.z + m.z });
    this.hVel.set(m.x / dt, 0, m.z / dt).clampLength(0, 12);
  }

  /** After physics step. */
  syncFromBody() {
    this.prevPos.copy(this.curPos);
    const t = this.body.translation();
    this.curPos.set(t.x, t.y - CENTER_Y, t.z);
  }

  interpolate(alpha: number, dt: number) {
    if (this.inVehicle && this.vehicle) {
      this.pos.copy(this.vehicle.pos);
      this.visible = false;
      return;
    }
    this.visible = !this.dead || true;
    this.pos.lerpVectors(this.prevPos, this.curPos, alpha);
    const sp = this.hVel.length();
    this.stride = this.swimming ? 0.5 : clamp(sp / 3.6, 0, 1.25);
    this.phase += dt * (this.swimming ? 4 : sp * 2.5);
    this.aim += ((this.aiming ? 1 : 0) - this.aim) * damp(14, dt);
    this.lying += ((this.dead ? 1 : 0) - this.lying) * damp(5, dt);
  }

  teleport(p: THREE.Vector3) {
    this.body.setTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z });
    this.curPos.copy(p); this.prevPos.copy(p); this.pos.copy(p);
    this.vy = 0; this.hVel.set(0, 0, 0);
  }

  damage(amount: number, from: THREE.Vector3 | null) {
    if (this.dead || amount <= 0) return;
    const g = this.game;
    if (this.armor > 0) {
      const a = Math.min(this.armor, amount * 0.7);
      this.armor -= a; amount -= a;
    }
    this.health -= amount;
    this.lastDamageTime = g.time;
    if (from) this.damageDir = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
    g.hud.damageFlash();
    if (this.health <= 0) { this.health = 0; this.dead = true; g.onPlayerDeath(); }
  }

  enterVehicle(v: Vehicle) {
    const g = this.game;
    if (v.driver === 'traffic' || v.driver === 'npc') {
      g.peds.spawnEjectedDriver(v, 'civilian');
    } else if (v.driver === 'police') {
      g.peds.spawnEjectedDriver(v, 'cop');
      g.police.reportCrime('stealPolice', v.curPos);
    }
    if (v.kind === 'police') g.police.reportCrime('stealPolice', v.curPos);
    v.makeDynamic();
    v.driver = 'player';
    v.sirenOn = false;
    v.persistent = false;
    this.inVehicle = true;
    this.vehicle = v;
    this.collider.setEnabled(false);
    this.hVel.set(0, 0, 0);
    this.aiming = false;
    g.audio.door();
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    const g = this.game;
    v.forward(_f);
    _r.set(-_f.z, 0, _f.x); // right side of the car
    const W = v.spec.width / 2 + 0.9;
    const candidates = [
      _v.copy(v.curPos).addScaledVector(_r, -W).clone(), // driver side (left)
      v.curPos.clone().addScaledVector(_r, W),
      v.curPos.clone().addScaledVector(_f, -(v.spec.length / 2 + 1.2)),
    ];
    let out = v.curPos.clone().setY(v.curPos.y + 2.2);
    for (const c of candidates) {
      const dir = c.clone().sub(v.curPos); dir.y = 0;
      const d = dir.length(); dir.normalize();
      const o = v.curPos.clone(); o.y = Math.max(o.y, 0.6);
      const hit = g.physics.raycast(o, dir, d + 0.4, GROUPS.qWorld, v.body);
      if (!hit) { out = c; out.y = Math.max(0.25, c.y - 0.2); break; }
    }
    const spd = Math.abs(v.speedMs);
    v.driver = 'none';
    v.throttle = 0; v.brakeIn = 0; v.steer = 0; v.handbrake = false;
    this.inVehicle = false;
    this.vehicle = null;
    this.collider.setEnabled(true);
    this.teleport(out);
    this.yaw = Math.atan2(_f.x, _f.z);
    if (spd > 12) this.damage((spd - 12) * 3, null);
    g.audio.door();
  }

  respawn(p: THREE.Vector3) {
    this.dead = false; this.health = 100; this.armor = 0; this.lying = 0;
    if (this.inVehicle) { this.inVehicle = false; this.vehicle = null; this.collider.setEnabled(true); }
    this.teleport(p);
  }
}
