import * as THREE from 'three';
import { angleDiff, clamp } from '../core/util';
import { CELL, LANE_OFFSET, N, nearestNode, nodeValid, onRoad } from '../world/CityLayout';
import type { Game } from '../core/Game';
import { Vehicle } from './Vehicle';

export type Crime = 'hitPed' | 'assault' | 'murder' | 'shootCop' | 'killCop' | 'stealPolice' | 'gunfire' | 'hitCop' | 'mission';

const HEAT: Record<Crime, number> = { hitPed: 1, assault: 1, murder: 3, shootCop: 3, killCop: 7, stealPolice: 4.5, gunfire: 0.6, hitCop: 1.5, mission: 0 };
const MIN_LEVEL: Record<Crime, number> = { hitPed: 1, assault: 1, murder: 2, shootCop: 2, killCop: 3, stealPolice: 2, gunfire: 1, hitCop: 1, mission: 0 };
const THRESH = [0, 1, 4, 10, 20, 36];
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/**
 * Five-star wanted system: crimes add heat when witnessed, police units are dispatched (capped), they chase
 * using grid routing + direct pursuit, cops deploy on foot, roadblocks appear from 3 stars, and the player
 * escapes by staying out of sight long enough.
 */
export class Police {
  wanted = 0;
  heat = 0;
  lastSeen = new THREE.Vector3();
  unseen = 0;
  seenThisFrame = false;
  maxUnits = 4;
  bustTimer = 0;
  private dispatchTimer = 0;
  private roadblockTimer = 0;
  roadblock: Vehicle[] = [];
  private losTick = 0;
  flashStars = false;

  constructor(private game: Game) {}

  get escapeTime() { return 7 + this.wanted * 3.5; }
  get searchRadius() { return 60 + this.wanted * 25; }

  units() { return this.game.vehicles.filter((v) => v.driver === 'police' && !v.destroyed); }

  /** Called when the player commits a crime. Witnessed if police are around or the crime is serious. */
  reportCrime(c: Crime, pos: THREE.Vector3) {
    if (this.game.player.dead) return;
    let witnessed = c === 'murder' || c === 'killCop' || c === 'shootCop' || c === 'stealPolice' || c === 'mission' || this.wanted > 0;
    if (!witnessed) {
      for (const v of this.game.vehicles) if ((v.kind === 'police') && !v.destroyed && v.curPos.distanceTo(pos) < 70) { witnessed = true; break; }
      if (!witnessed) for (const p of this.game.peds.pool) if (p.active && p.kind === 'cop' && p.state !== 'dead' && p.pos.distanceTo(pos) < 60) { witnessed = true; break; }
      if (!witnessed && (c === 'hitPed' || c === 'assault') && Math.random() < 0.35) witnessed = true; // a bystander calls it in
    }
    if (!witnessed) return;
    this.heat += HEAT[c];
    let lvl = 0;
    for (let i = 1; i < THRESH.length; i++) if (this.heat >= THRESH[i]) lvl = i;
    this.setWanted(Math.max(this.wanted, lvl, MIN_LEVEL[c]));
    this.spotted(this.game.player.pos);
  }

  setWanted(level: number) {
    level = clamp(Math.round(level), 0, 5);
    if (level > this.wanted) { this.heat = Math.max(this.heat, THRESH[level]); this.game.audio.wantedUp(); }
    if (level > 0 && this.wanted === 0) this.lastSeen.copy(this.game.player.pos);
    this.wanted = level;
    if (level === 0) { this.heat = 0; this.unseen = 0; this.calmDown(); }
  }

  spotted(_pos: THREE.Vector3) {
    this.seenThisFrame = true;
    this.lastSeen.copy(this.game.player.pos);
  }

  private calmDown() {
    for (const v of this.game.vehicles) if (v.driver === 'police') { v.sirenOn = false; v.aiState.leaving = 1; }
    for (const p of this.game.peds.pool) if (p.active && p.kind === 'cop' && p.state === 'combat') { p.aim = 0; }
  }

  clear() { this.setWanted(0); this.roadblock = []; this.bustTimer = 0; }

  update(dt: number, frustum: THREE.Frustum) {
    const g = this.game, pl = g.player;
    this.maxUnits = { low: 3, medium: 4, high: 5 }[g.settings.gfx.traffic];
    if (this.wanted === 0) { this.flashStars = false; this.cleanup(); return; }

    // visibility checks (staggered raycasts)
    this.losTick++;
    const units = this.units();
    if (this.losTick % 6 === 0) {
      const sight = 55 + this.wanted * 12;
      _w.copy(pl.pos); _w.y += 1.2;
      for (const v of units) {
        const d = v.curPos.distanceTo(pl.pos);
        if (d < 18) { this.spotted(pl.pos); break; }
        if (d < sight) {
          _v.copy(v.curPos); _v.y += 1.2;
          if (g.physics.lineOfSight(_v, _w)) { this.spotted(pl.pos); break; }
        }
      }
    }
    if (this.seenThisFrame) this.unseen = 0;
    else this.unseen += dt;
    this.seenThisFrame = false;
    this.flashStars = this.unseen > 1.5;
    if (this.unseen > this.escapeTime) {
      g.hud.notify('You lost the cops.');
      g.missions.onWantedCleared();
      this.setWanted(0);
      return;
    }

    // dispatch police cars
    this.dispatchTimer -= dt;
    const want = Math.min(this.maxUnits, [0, 1, 2, 3, 4, 5][this.wanted]);
    if (this.dispatchTimer <= 0 && units.length < want) {
      this.dispatchTimer = 2.5;
      // first try to convert a nearby patrol car from traffic
      const patrol = g.vehicles.find((v) => v.kind === 'police' && v.driver === 'traffic' && v.curPos.distanceTo(pl.pos) < 140);
      if (patrol) { patrol.makeDynamic(); patrol.driver = 'police'; patrol.sirenOn = true; patrol.aiState = {}; }
      else {
        // new units are sent to the last known position, not the player's true location
        const from = this.unseen > 2 ? this.lastSeen : pl.pos;
        const v = g.traffic.trySpawn(g.vehicles, from, frustum, 90, 170, 'police', pl.pos);
        if (v) { v.makeDynamic(); v.driver = 'police'; v.sirenOn = true; v.aiState = {}; }
      }
    }

    // roadblocks at 3+ stars
    this.roadblockTimer -= dt;
    if (this.wanted >= 3 && this.roadblockTimer <= 0 && pl.inVehicle) { this.roadblockTimer = 30; this.spawnRoadblock(); }

    // cops leave cars when the player is on foot nearby
    let copsOnFoot = 0;
    for (const p of g.peds.pool) if (p.active && p.kind === 'cop' && p.state === 'combat') copsOnFoot++;
    for (const v of units) {
      if (!pl.inVehicle && !v.aiState.deployed && v.curPos.distanceTo(pl.pos) < 22 && Math.abs(v.speedMs) < 3 && copsOnFoot < 8) {
        v.aiState.deployed = 1;
        for (const side of [-1, 1]) {
          const f = v.forward(_v);
          const p = v.curPos.clone().add(new THREE.Vector3(f.z * side, 0, -f.x * side).multiplyScalar(v.spec.width / 2 + 0.9));
          p.y = Math.max(0.2, p.y - 0.4);
          g.peds.spawnCombat('cop', p);
          copsOnFoot++;
        }
        v.driver = 'none';
        v.sirenOn = true;
      }
    }

    // busted: a cop right next to a slow player on foot
    let near = false;
    if (!pl.inVehicle && !pl.dead) {
      for (const p of g.peds.pool) if (p.active && p.kind === 'cop' && p.state === 'combat' && p.pos.distanceTo(pl.pos) < 1.8) { near = true; break; }
    }
    if (near && pl.speed < 2.5 && this.wanted <= 2) this.bustTimer += dt; else this.bustTimer = Math.max(0, this.bustTimer - dt);
    if (this.bustTimer > 1.6) { this.bustTimer = 0; g.onBusted(); }
  }

  private spawnRoadblock() {
    const g = this.game, pl = g.player, v = pl.vehicle;
    if (!v) return;
    const f = v.forward(_v);
    // find the node ~2 blocks ahead along the dominant heading
    const n = nearestNode(pl.pos.x, pl.pos.z);
    const dx = Math.abs(f.x) > Math.abs(f.z) ? Math.sign(f.x) : 0, dz = dx === 0 ? Math.sign(f.z) : 0;
    const ti = n.i + dx * 2, tj = n.j + dz * 2;
    if (!nodeValid(ti, tj)) return;
    const cx = ti * CELL, cz = tj * CELL;
    // place two cruisers across the approach road, just before the intersection
    const bx = cx - dx * 14, bz = cz - dz * 14;
    const yaw = Math.atan2(dz, -dx) ; // perpendicular to the road
    for (const s of [-1, 1]) {
      const p = new THREE.Vector3(bx + (dz !== 0 ? s * 2.8 : 0), Vehicle.rideHeight('police') + 0.1, bz + (dx !== 0 ? s * 2.8 : 0));
      const car = new Vehicle(g.physics, 'police', p, yaw + (s > 0 ? Math.PI : 0), 'physics');
      car.driver = 'none'; car.sirenOn = true; car.aiState = { roadblock: 1 };
      g.vehicles.push(car);
      this.roadblock.push(car);
      const cp = new THREE.Vector3(bx - dx * 4 + (dz !== 0 ? s * 3 : 0), 0.2, bz - dz * 4 + (dx !== 0 ? s * 3 : 0));
      g.peds.spawnCombat('cop', cp);
    }
    g.hud.notify('Roadblock ahead!');
  }

  private cleanup() {
    // police leave once the heat is off: despawn units that are out of view / far
    const pl = this.game.player;
    for (const v of this.game.vehicles) {
      if (v.aiState.leaving && v.driver === 'police' && v.curPos.distanceTo(pl.pos) > 60) v.aiState.despawn = 1;
    }
  }

  /** Police driving AI — called each fixed step for police-driven physics vehicles. */
  drive(v: Vehicle, dt: number) {
    const g = this.game, pl = g.player;
    const s = v.aiState;
    const pos = v.curPos;
    const yaw = v.yaw;
    const speed = v.speedMs;
    const target = this.wanted > 0 ? (this.unseen < 2 ? pl.pos : this.lastSeen) : null;
    if (!target || s.leaving) { v.throttle = 0; v.brakeIn = 1; v.steer = 0; return; }
    const dist = Math.hypot(target.x - pos.x, target.z - pos.z);

    let wx: number, wz: number;
    const direct = dist < 48 && this.unseen < 1;
    if (direct || !onRoad(pos.x, pos.z) && dist < 80) {
      const pv = pl.inVehicle && pl.vehicle ? pl.vehicle.velocity : _v.set(0, 0, 0);
      wx = target.x + pv.x * 0.5; wz = target.z + pv.z * 0.5;
    } else {
      // grid routing: head for the next intersection toward the target
      if (s.ni === undefined || Math.hypot(s.ni * CELL - pos.x, s.nj * CELL - pos.z) < 11) {
        let ci: number, cj: number;
        if (s.ni === undefined) {
          const n = nearestNode(pos.x + Math.sin(yaw) * 30, pos.z + Math.cos(yaw) * 30);
          ci = n.i; cj = n.j;
          s.ni = ci; s.nj = cj;
        } else { ci = s.ni; cj = s.nj; }
        if (s.ni === ci && s.nj === cj && Math.hypot(ci * CELL - pos.x, cj * CELL - pos.z) < 11) {
          const tn = nearestNode(target.x, target.z);
          const di = tn.i - ci, dj = tn.j - cj;
          let ni = ci, nj = cj;
          if (Math.abs(di) >= Math.abs(dj) && di !== 0) ni += Math.sign(di); else if (dj !== 0) nj += Math.sign(dj); else ni += di === 0 ? 0 : Math.sign(di);
          if (!nodeValid(ni, nj)) { ni = ci; nj = cj; }
          s.pi = ci; s.pj = cj; s.ni = ni; s.nj = nj;
        }
      }
      // aim for the right-hand lane of the current road
      const ddx = Math.sign(s.ni - (s.pi ?? s.ni)), ddz = Math.sign(s.nj - (s.pj ?? s.nj));
      wx = s.ni * CELL - ddz * LANE_OFFSET; wz = s.nj * CELL + ddx * LANE_OFFSET;
    }
    const want = Math.atan2(wx - pos.x, wz - pos.z);
    const ang = angleDiff(yaw, want);

    // stuck recovery
    s.reverse = (s.reverse ?? 0) - dt;
    if (s.reverse > 0) { v.throttle = 0; v.brakeIn = 1; v.steer = -Math.sign(ang); v.handbrake = false; return; }
    if (Math.abs(speed) < 1.2 && v.throttle > 0.5) s.stuck = (s.stuck ?? 0) + dt; else s.stuck = 0;
    if (s.stuck > 1.4) { s.stuck = 0; s.reverse = 1.3; }
    if (v.upright < 0.3) { s.flip = (s.flip ?? 0) + dt; if (s.flip > 2.5) { v.unflip(); s.flip = 0; } } else s.flip = 0;

    const aggressive = 0.75 + this.wanted * 0.06;
    let tSpeed = v.spec.maxSpeed * aggressive;
    if (Math.abs(ang) > 0.5) tSpeed = Math.min(tSpeed, 14);
    if (Math.abs(ang) > 1.2) tSpeed = 8;
    const playerSlow = pl.speed < 3;
    if (dist < 12 && playerSlow) tSpeed = 0; // pull up next to a stopped player
    v.steer = clamp(ang * 2.2, -1, 1);
    v.handbrake = Math.abs(ang) > 1.3 && speed > 12;
    if (speed < tSpeed - 1) { v.throttle = 1; v.brakeIn = 0; }
    else if (speed > tSpeed + 4) { v.throttle = 0; v.brakeIn = 1; }
    else { v.throttle = 0.3; v.brakeIn = 0; }
    if (Math.abs(ang) > 2.2 && dist > 10) {
      // target behind: K-turn (reversing inverts steering)
      v.throttle = 0; v.brakeIn = 1; v.handbrake = false;
      if (speed < 2) v.steer = -Math.sign(ang);
    }
  }

  get unitCount() { return this.units().length; }
  get N() { return N; }
}
