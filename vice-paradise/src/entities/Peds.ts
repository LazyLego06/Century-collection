import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { GROUPS, RAPIER } from '../core/Physics';
import { angleDiff, clamp, randPick, randRange, rayVsVerticalCapsule } from '../core/util';
import { Block, SLAB_H } from '../world/CityLayout';
import type { CharacterVisual } from './CharacterRenderer';
import type { Game } from '../core/Game';
import type { Vehicle } from './Vehicle';

export type PedKind = 'civilian' | 'gang' | 'cop';
export type PedState = 'walk' | 'idle' | 'flee' | 'knocked' | 'dead' | 'combat';

const SKINS = [0xf1c8a5, 0xe0ac85, 0xc68c5f, 0x9a6440, 0x6e4329, 0xffdcc0];
const SHIRTS = [0xff2fa0, 0x00c8ff, 0xffd23f, 0xffffff, 0x2bd97c, 0xff7b39, 0x7d3cff, 0xe8e8e8, 0x1f6fbf, 0xff4d6d];
const PANTS = [0x1f2a44, 0x2a2a2a, 0xd9cfb0, 0x4a4a5a, 0x3a5a7a, 0xf0f0f0];
const HAIRS = [0x1a120c, 0x3a2414, 0x6b4a2a, 0xd8b060, 0x0d0d0d, 0x8a8a8a];
const RING = 28, SIDE = 56, PERIM = SIDE * 4;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

export class Ped implements CharacterVisual {
  pos = new THREE.Vector3();
  yaw = 0; phase = Math.random() * 6; stride = 0; aim = 0; lying = 0; spin = 0; armed = false; visible = true;
  skin = new THREE.Color(); shirt = new THREE.Color(); pants = new THREE.Color(); hair = new THREE.Color();
  active = false;
  id = 0;
  kind: PedKind = 'civilian';
  state: PedState = 'walk';
  health = 100;
  block: Block | null = null;
  t = 0; dir = 1; laneOff = 0; speed = 1.3;
  timer = 0;
  vel = new THREE.Vector3();
  body: RAPIER_T.RigidBody | null = null;
  collider: RAPIER_T.Collider | null = null;
  fireCd = 0; losTimer = 0; hasLOS = false; seenPlayer = false;
  damageOut = 8; accuracy = 0.4;
  tag = ''; // mission tag
  fleeFrom = new THREE.Vector3();
  strafe = 1;
  killedByPlayer = false;
}

/**
 * Pedestrians use a fixed object pool. Civilians follow sidewalk rings around blocks (no physics cost);
 * combat peds (gang members / police on foot) get a kinematic capsule + character controller for movement.
 * Distant peds update at a reduced rate.
 */
export class Peds {
  pool: Ped[] = [];
  target = 32;
  private controller: RAPIER_T.KinematicCharacterController;
  private nextId = 1;
  private tick = 0;
  activeCount = 0;
  combatCount = 0;

  constructor(private game: Game, cap = 80) {
    for (let i = 0; i < cap; i++) this.pool.push(new Ped());
    this.controller = game.physics.world.createCharacterController(0.05);
    this.controller.enableAutostep(0.45, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle(0.8);
  }

  private alloc(): Ped | null {
    for (const p of this.pool) if (!p.active) { p.active = true; p.id = this.nextId++; return p; }
    // recycle the farthest dead/civilian ped
    let best: Ped | null = null, bd = -1;
    const pp = this.game.player.pos;
    for (const p of this.pool) {
      if (p.kind !== 'civilian' && p.state !== 'dead') continue;
      if (p.tag) continue;
      const d = p.pos.distanceToSquared(pp);
      if (d > bd) { bd = d; best = p; }
    }
    if (best) { this.release(best); best.active = true; best.id = this.nextId++; }
    return best;
  }

  release(p: Ped) {
    if (p.collider) { this.game.physics.owners.delete(p.collider.handle); }
    if (p.body) this.game.physics.world.removeRigidBody(p.body);
    p.body = null; p.collider = null;
    p.active = false; p.tag = ''; p.lying = 0; p.spin = 0; p.aim = 0; p.armed = false; p.killedByPlayer = false;
  }

  private dress(p: Ped, kind: PedKind) {
    p.kind = kind;
    p.skin.setHex(randPick(SKINS));
    p.hair.setHex(randPick(HAIRS));
    if (kind === 'cop') { p.shirt.setHex(0x1d2f6b); p.pants.setHex(0x141c38); p.hair.setHex(0x101010); }
    else if (kind === 'gang') { p.shirt.setHex(randPick([0x5b2a86, 0x1e7a3c, 0x111111])); p.pants.setHex(0x1a1a1a); }
    else { p.shirt.setHex(randPick(SHIRTS)); p.pants.setHex(randPick(PANTS)); }
  }

  ringPoint(b: Block, t: number, off: number, out: THREE.Vector3) {
    const tt = ((t % PERIM) + PERIM) % PERIM;
    const side = Math.floor(tt / SIDE), u = tt - side * SIDE - RING;
    const r = RING + off;
    if (side === 0) out.set(b.cx + u, SLAB_H, b.cz - r);
    else if (side === 1) out.set(b.cx + r, SLAB_H, b.cz + u);
    else if (side === 2) out.set(b.cx - u, SLAB_H, b.cz + r);
    else out.set(b.cx - r, SLAB_H, b.cz - u);
    return side;
  }

  spawnCivilian(minD: number, maxD: number, frustum: THREE.Frustum | null) {
    const pp = this.game.player.pos;
    const b = this.game.layout.randomBlockNear(pp.x, pp.z, minD, maxD);
    if (!b) return null;
    const t = Math.random() * PERIM;
    this.ringPoint(b, t, 0, _v);
    if (frustum && _v.distanceTo(pp) < 90 && frustum.containsPoint(_w.copy(_v).setY(1))) return null;
    const p = this.alloc();
    if (!p) return null;
    this.dress(p, 'civilian');
    p.block = b; p.t = t; p.dir = Math.random() < 0.5 ? 1 : -1; p.laneOff = randRange(-1.2, 1.2);
    p.speed = randRange(1.1, 1.6); p.state = Math.random() < 0.15 ? 'idle' : 'walk'; p.timer = randRange(3, 10);
    p.health = 60; p.pos.copy(_v); p.visible = true;
    return p;
  }

  /** Spawns a combat-capable ped (gang member or police officer on foot). */
  spawnCombat(kind: 'gang' | 'cop', pos: THREE.Vector3, tag = '') {
    const p = this.alloc();
    if (!p) return null;
    this.dress(p, kind);
    p.state = 'combat'; p.block = null; p.tag = tag;
    p.health = kind === 'cop' ? 110 : 90;
    p.armed = true; p.aim = 0;
    p.damageOut = kind === 'cop' ? 7 : 6;
    p.accuracy = kind === 'cop' ? 0.42 : 0.34;
    p.fireCd = randRange(0.8, 2.0);
    p.seenPlayer = kind === 'cop';
    p.strafe = Math.random() < 0.5 ? 1 : -1;
    p.pos.copy(pos);
    p.visible = true;
    const W = this.game.physics.world;
    p.body = W.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.9, pos.z));
    p.collider = W.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.32).setCollisionGroups(GROUPS.npc), p.body);
    this.game.physics.owners.set(p.collider.handle, p);
    return p;
  }

  /** Driver pulled out during a carjacking: civilians flee, cops fight back. */
  spawnEjectedDriver(v: Vehicle, kind: 'civilian' | 'cop') {
    const f = v.forward(_d);
    const pos = v.curPos.clone().add(_o.set(f.z, 0, -f.x).multiplyScalar(v.spec.width / 2 + 1.0));
    pos.y = Math.max(0.2, pos.y - 0.4);
    if (kind === 'cop') { this.spawnCombat('cop', pos); return; }
    const b = this.game.layout.randomBlockNear(pos.x, pos.z, 0, 60);
    const p = this.alloc();
    if (!p || !b) return;
    this.dress(p, 'civilian');
    p.block = b; p.t = this.closestT(b, pos); p.dir = 1; p.laneOff = 0; p.speed = 1.3;
    p.health = 60; p.pos.copy(pos); p.visible = true;
    p.state = 'flee'; p.timer = 12; p.fleeFrom.copy(v.curPos);
  }

  get visuals(): CharacterVisual[] { return this.pool; }

  /** Scare civilians around a point (gunshots, crashes, explosions). */
  panic(pos: THREE.Vector3, radius: number) {
    for (const p of this.pool) {
      if (!p.active || p.kind !== 'civilian') continue;
      if (p.state === 'dead' || p.state === 'knocked') continue;
      if (p.pos.distanceTo(pos) < radius) { p.state = 'flee'; p.timer = randRange(7, 12); p.fleeFrom.copy(pos); }
    }
  }

  /** Ray vs. all peds. Returns closest ped hit within maxT. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number) {
    let best: { ped: Ped; t: number; head: boolean } | null = null;
    for (const p of this.pool) {
      if (!p.active || p.state === 'dead') continue;
      const h = p.state === 'knocked' ? 0.5 : 1.8;
      const r = rayVsVerticalCapsule(o, d, p.pos.x, p.pos.y, p.pos.z, h, p.state === 'knocked' ? 0.7 : 0.38, maxT);
      if (h && r && (!best || r.t < best.t)) best = { ped: p, t: r.t, head: r.y > 1.5 };
    }
    return best;
  }

  damage(p: Ped, amount: number, fromPlayer: boolean, dir?: THREE.Vector3) {
    if (p.state === 'dead') return;
    p.health -= amount;
    _v.copy(p.pos); _v.y += 1.2;
    this.game.effects.blood(_v);
    if (fromPlayer) {
      if (p.kind === 'civilian') this.game.police.reportCrime('assault', p.pos);
      if (p.kind === 'cop') this.game.police.reportCrime('shootCop', p.pos);
      if (p.kind === 'gang') p.seenPlayer = true;
    }
    if (p.health <= 0) this.kill(p, fromPlayer, dir);
    else if (p.kind === 'civilian') { p.state = 'flee'; p.timer = 10; p.fleeFrom.copy(this.game.player.pos); }
  }

  kill(p: Ped, byPlayer: boolean, dir?: THREE.Vector3) {
    if (p.state === 'dead') return;
    p.state = 'dead';
    p.timer = 25;
    p.killedByPlayer = byPlayer;
    p.armed = false; p.aim = 0;
    if (dir) p.yaw = Math.atan2(-dir.x, -dir.z);
    if (p.body) { this.game.physics.owners.delete(p.collider!.handle); this.game.physics.world.removeRigidBody(p.body); p.body = null; p.collider = null; }
    if (byPlayer) {
      if (p.kind === 'civilian') this.game.police.reportCrime('murder', p.pos);
      if (p.kind === 'cop') this.game.police.reportCrime('killCop', p.pos);
      this.game.pickups.dropFrom(p);
    }
    this.game.missions.onPedKilled(p);
    this.panic(p.pos, 25);
  }

  /** Vehicle vs ped collisions (peds have no physics bodies, so this is analytic). */
  private vehicleHits(vehicles: Vehicle[]) {
    const pp = this.game.player;
    for (const v of vehicles) {
      const sp = Math.abs(v.speedMs);
      if (sp < 2.2 || !v.visible) continue;
      if (v.curPos.distanceToSquared(pp.pos) > 150 * 150) continue;
      const fwd = v.forward(_d);
      const hw = v.spec.width / 2 + 0.35, hl = v.spec.length / 2 + 0.35;
      for (const p of this.pool) {
        if (!p.active || p.state === 'dead' || p.state === 'knocked') continue;
        const rx = p.pos.x - v.curPos.x, rz = p.pos.z - v.curPos.z;
        if (rx * rx + rz * rz > 16) continue;
        const along = rx * fwd.x + rz * fwd.z, lat = -rx * fwd.z + rz * fwd.x;
        if (Math.abs(along) > hl || Math.abs(lat) > hw || Math.abs(p.pos.y - v.curPos.y) > 2) continue;
        const vel = v.velocity;
        p.state = 'knocked';
        p.timer = 1.6;
        p.vel.set(vel.x * 1.05, 3 + sp * 0.18, vel.z * 1.05);
        if (p.body) { this.game.physics.owners.delete(p.collider!.handle); this.game.physics.world.removeRigidBody(p.body); p.body = null; p.collider = null; }
        const byPlayer = v.driver === 'player';
        p.health -= sp * 9;
        this.game.audio.thud();
        if (byPlayer) { this.game.police.reportCrime(p.kind === 'cop' ? 'shootCop' : 'hitPed', p.pos); if (p.kind === 'gang') p.seenPlayer = true; }
        if (p.health <= 0) p.killedByPlayer = byPlayer;
        this.panic(p.pos, 20);
      }
    }
  }

  update(dt: number, frustum: THREE.Frustum, density: number) {
    this.tick++;
    const g = this.game;
    const pp = g.player.pos;
    this.target = density;

    // maintain population
    let civ = 0;
    this.activeCount = 0; this.combatCount = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      this.activeCount++;
      if (p.state === 'combat') this.combatCount++;
      if (p.kind === 'civilian' && p.state !== 'dead') civ++;
      const d = p.pos.distanceTo(pp);
      const far = p.tag ? 400 : p.state === 'combat' ? 260 : 170;
      if (d > far || (p.state === 'dead' && (p.timer <= 0 || d > 90))) this.release(p);
    }
    for (let k = 0; k < 2 && civ < this.target; k++) if (this.spawnCivilian(50, 150, frustum)) civ++;

    this.vehicleHits(g.vehicles);

    for (const p of this.pool) {
      if (!p.active) continue;
      const d2 = p.pos.distanceToSquared(pp);
      // reduced update rate for distant civilians
      const every = p.state === 'combat' || p.state === 'knocked' ? 1 : d2 > 90 * 90 ? 3 : 1;
      if ((this.tick + p.id) % every !== 0) continue;
      this.updatePed(p, dt * every, d2);
    }
  }

  private updatePed(p: Ped, dt: number, d2: number) {
    const g = this.game;
    switch (p.state) {
      case 'walk':
      case 'idle':
      case 'flee': {
        if (!p.block) { p.state = 'dead'; p.timer = 0; return; }
        if (p.state === 'idle') {
          p.stride = Math.max(0, p.stride - dt * 4);
          p.timer -= dt;
          if (p.timer <= 0) { p.state = 'walk'; p.timer = randRange(8, 20); }
        } else {
          let speed = p.speed;
          if (p.state === 'flee') {
            speed = 5.2;
            p.timer -= dt;
            // run along the ring away from the threat
            const ahead = this.ringPoint(p.block, p.t + p.dir * 2, p.laneOff, _w);
            void ahead;
            if (_w.distanceToSquared(p.fleeFrom) < p.pos.distanceToSquared(p.fleeFrom)) p.dir = -p.dir;
            if (p.timer <= 0) { p.state = 'walk'; }
          } else {
            p.timer -= dt;
            if (p.timer <= 0) { if (Math.random() < 0.25) { p.state = 'idle'; p.timer = randRange(2, 6); } else p.timer = randRange(6, 18); }
          }
          // keep clear of the player
          const pr = _o.copy(p.pos).sub(g.player.pos);
          if (!g.player.inVehicle && pr.lengthSq() < 0.5 && p.state === 'walk') p.dir = -p.dir;
          p.t += p.dir * speed * dt;
          this.ringPoint(p.block, p.t, p.laneOff, _v);
          const dx = _v.x - p.pos.x, dz = _v.z - p.pos.z;
          if (dx * dx + dz * dz > 1e-6) p.yaw = Math.atan2(dx, dz);
          p.pos.copy(_v);
          p.stride = Math.min(1, speed / 1.4) * (p.state === 'flee' ? 1.2 : 0.8);
          p.phase += dt * speed * 2.6;
        }
        break;
      }
      case 'knocked': {
        p.vel.y -= 18 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.spin += dt * 9;
        const ground = SLAB_H * 0.5;
        if (p.pos.y <= ground) {
          p.pos.y = ground;
          p.vel.multiplyScalar(0.6);
          p.vel.y = Math.abs(p.vel.y) > 2 ? Math.abs(p.vel.y) * 0.3 : 0;
        }
        p.timer -= dt;
        if (p.timer <= 0) {
          p.spin = 0;
          if (p.health <= 0) { p.lying = 1; this.kill(p, p.killedByPlayer); }
          else { p.lying = 0; p.state = p.kind === 'civilian' ? 'flee' : 'dead'; p.timer = 8; p.fleeFrom.copy(g.player.pos); if (p.kind !== 'civilian') this.kill(p, false); }
          if (p.kind === 'civilian' && p.block) {
            // snap back to the nearest ring position
            p.pos.y = SLAB_H;
            p.t = this.closestT(p.block, p.pos);
          }
        }
        break;
      }
      case 'dead': {
        p.lying = Math.min(1, p.lying + dt * 3);
        p.stride = 0;
        p.timer -= dt;
        break;
      }
      case 'combat':
        this.combatAI(p, dt, d2);
        break;
    }
  }

  private closestT(b: Block, pos: THREE.Vector3) {
    let best = 0, bd = 1e9;
    for (let t = 0; t < PERIM; t += 4) {
      this.ringPoint(b, t, 0, _w);
      const d = _w.distanceToSquared(pos);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  private combatAI(p: Ped, dt: number, d2: number) {
    const g = this.game;
    const player = g.player;
    const target = player.pos;
    const dist = Math.sqrt(d2);
    const wanted = g.police.wanted;
    const hostile = p.kind === 'gang' ? p.seenPlayer || dist < 22 : wanted > 0;
    if (p.kind === 'gang' && dist < 22) p.seenPlayer = true;

    // line of sight check at ~4 Hz
    p.losTimer -= dt;
    if (p.losTimer <= 0) {
      p.losTimer = 0.25 + Math.random() * 0.1;
      _v.copy(p.pos); _v.y += 1.55;
      _w.copy(target); _w.y += player.inVehicle ? 0.8 : 1.4;
      p.hasLOS = dist < 70 && g.physics.lineOfSight(_v, _w);
      if (p.hasLOS && p.kind === 'cop' && wanted > 0) g.police.spotted(p.pos);
    }

    let mx = 0, mz = 0, speed = 0;
    if (hostile) {
      const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
      const want = Math.atan2(dx, dz);
      p.yaw += angleDiff(p.yaw, want) * Math.min(1, dt * 8);
      const arrest = p.kind === 'cop' && wanted <= 1;
      const pref = arrest ? 1.2 : p.kind === 'cop' ? 11 : 9;
      if (dist > pref + 2 || !p.hasLOS) { mx = dx / dist; mz = dz / dist; speed = dist > 25 ? 5 : 3.6; }
      else if (!arrest) {
        // strafe while shooting
        mx = -dz / dist * p.strafe; mz = dx / dist * p.strafe; speed = 1.6;
        if (Math.random() < dt * 0.4) p.strafe = -p.strafe;
      }
      p.aim = Math.min(1, p.aim + dt * 4) * (arrest ? 0 : 1);
      // shooting
      p.fireCd -= dt;
      if (!arrest && p.hasLOS && dist < 55 && p.fireCd <= 0 && !player.dead) {
        p.fireCd = randRange(0.55, 1.2);
        this.enemyShoot(p, dist);
      }
    } else {
      p.aim = Math.max(0, p.aim - dt * 2);
    }

    // movement through the character controller
    if (p.body && p.collider) {
      const desired = { x: mx * speed * dt, y: -9.8 * dt * 0.5, z: mz * speed * dt };
      this.controller.computeColliderMovement(p.collider, desired, undefined, GROUPS.qWorld);
      const m = this.controller.computedMovement();
      const t = p.body.translation();
      const nt = { x: t.x + m.x, y: Math.max(t.y + m.y, 0.9), z: t.z + m.z };
      p.body.setNextKinematicTranslation(nt);
      p.pos.set(nt.x, nt.y - 0.9, nt.z);
      const moved = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
      p.stride = Math.min(1.2, moved / 3);
      p.phase += dt * moved * 2.4;
    }
  }

  private enemyShoot(p: Ped, dist: number) {
    const g = this.game, pl = g.player;
    _v.copy(p.pos); _v.y += 1.4;
    _d.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    _v.addScaledVector(_d, 0.5);
    const spd = pl.speed;
    const chance = clamp(p.accuracy - dist * 0.006 - spd * 0.012 + (pl.inVehicle ? 0.05 : 0), 0.05, 0.75) * (g.police.wanted >= 4 ? 1.25 : 1);
    const hit = Math.random() < chance;
    _w.copy(pl.pos); _w.y += pl.inVehicle ? 0.8 : 1.3;
    if (!hit) _w.add(_o.set(randRange(-1.5, 1.5), randRange(-0.5, 1), randRange(-1.5, 1.5)));
    g.effects.muzzle(_v, _d);
    g.effects.tracer(_v, _w);
    g.audio.gunshot(p.pos, 0.6);
    if (hit) {
      if (pl.inVehicle && pl.vehicle) pl.vehicle.damage(p.damageOut * 2.5);
      else pl.damage(p.damageOut, p.pos);
    }
  }
}
