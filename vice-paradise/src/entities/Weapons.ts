import * as THREE from 'three';
import { GROUPS } from '../core/Physics';
import type { Game } from '../core/Game';
import { Ped } from './Peds';
import { Vehicle } from './Vehicle';

export interface WeaponDef {
  id: string; name: string; damage: number; rate: number; mag: number; reload: number; spread: number;
  range: number; pellets: number; auto: boolean; startReserve: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'fist', name: 'Fists', damage: 18, rate: 2.5, mag: 0, reload: 0, spread: 0, range: 1.9, pellets: 1, auto: false, startReserve: 0 },
  { id: 'pistol', name: 'Pistol', damage: 30, rate: 4.5, mag: 12, reload: 1.2, spread: 0.012, range: 140, pellets: 1, auto: false, startReserve: 72 },
  { id: 'smg', name: 'Micro SMG', damage: 17, rate: 12, mag: 30, reload: 1.7, spread: 0.035, range: 110, pellets: 1, auto: true, startReserve: 150 },
  { id: 'shotgun', name: 'Pump Shotgun', damage: 13, rate: 1.15, mag: 6, reload: 2.3, spread: 0.075, range: 45, pellets: 9, auto: false, startReserve: 30 },
  { id: 'rifle', name: 'Carbine Rifle', damage: 32, rate: 8, mag: 30, reload: 1.9, spread: 0.016, range: 200, pellets: 1, auto: true, startReserve: 120 },
];

export interface WeaponSlot { def: WeaponDef; owned: boolean; clip: number; reserve: number; }

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _hit = new THREE.Vector3();

/** Hitscan weapons: aim along the camera ray, resolve hits against peds (analytic) and the physics world. */
export class Weapons {
  slots: WeaponSlot[] = WEAPONS.map((def) => ({ def, owned: def.id === 'fist' || def.id === 'pistol', clip: def.mag, reserve: def.startReserve }));
  current = 1;
  private cooldown = 0;
  reloading = 0;
  hitMarker = 0;

  constructor(private game: Game) {}

  get slot() { return this.slots[this.current]; }

  give(id: string, ammo: number) {
    const s = this.slots.find((x) => x.def.id === id);
    if (!s) return;
    if (!s.owned) { s.owned = true; s.clip = s.def.mag; }
    s.reserve += ammo;
  }

  select(i: number) {
    if (i < 0 || i >= this.slots.length || !this.slots[i].owned || i === this.current) return;
    this.current = i; this.reloading = 0; this.cooldown = 0.2;
    this.game.audio.click();
  }
  cycle(dir: number) {
    let i = this.current;
    for (let k = 0; k < this.slots.length; k++) {
      i = (i + dir + this.slots.length) % this.slots.length;
      if (this.slots[i].owned) { this.select(i); return; }
    }
  }

  reload() {
    const s = this.slot;
    if (s.def.mag === 0 || this.reloading > 0 || s.clip >= s.def.mag || s.reserve <= 0) return;
    this.reloading = s.def.reload;
    this.game.audio.reload();
  }

  update(dt: number, trigger: boolean, triggerPressed: boolean, camera: THREE.Camera) {
    this.cooldown -= dt;
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    const s = this.slot;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = s.def.mag - s.clip;
        const take = Math.min(need, s.reserve);
        s.clip += take; s.reserve -= take;
      }
      return;
    }
    const wantFire = s.def.auto ? trigger : triggerPressed;
    if (!wantFire || this.cooldown > 0) return;
    if (s.def.mag > 0 && s.clip <= 0) { if (s.reserve > 0) this.reload(); else if (triggerPressed) this.game.audio.click(); return; }
    this.cooldown = 1 / s.def.rate;
    if (s.def.id === 'fist') { this.punch(); return; }
    s.clip--;
    this.fire(s.def, camera);
    if (s.clip === 0 && s.reserve > 0) this.reload();
  }

  private punch() {
    const g = this.game, pl = g.player;
    g.audio.whoosh();
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    for (const p of g.peds.pool) {
      if (!p.active || p.state === 'dead') continue;
      const rx = p.pos.x - pl.pos.x, rz = p.pos.z - pl.pos.z;
      const d = Math.hypot(rx, rz);
      if (d < 1.9 && (rx * fx + rz * fz) / Math.max(d, 0.01) > 0.4) {
        g.peds.damage(p, this.slot.def.damage, true, _d.set(fx, 0, fz));
        g.audio.thud();
        this.hitMarker = 0.15;
        break;
      }
    }
  }

  private fire(def: WeaponDef, camera: THREE.Camera) {
    const g = this.game, pl = g.player;
    camera.getWorldPosition(_o);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    // muzzle at the player's right hand
    _m.set(pl.pos.x + Math.sin(pl.yaw) * 0.6 + Math.cos(pl.yaw) * -0.25, pl.pos.y + 1.4, pl.pos.z + Math.cos(pl.yaw) * 0.6 - Math.sin(pl.yaw) * -0.25);
    g.effects.muzzle(_m, camDir);
    g.audio.gunshot(pl.pos, 1, def.id);
    g.effects.addShake(def.id === 'shotgun' ? 0.35 : 0.12);
    // skip the part of the camera ray between the camera and the player
    const skip = Math.max(0, _o.distanceTo(pl.pos) - 0.2);
    let anyHit = false;
    for (let k = 0; k < def.pellets; k++) {
      _d.copy(camDir);
      _d.x += (Math.random() - 0.5) * def.spread * 2; _d.y += (Math.random() - 0.5) * def.spread * 2; _d.z += (Math.random() - 0.5) * def.spread * 2;
      _d.normalize();
      const start = _o.clone().addScaledVector(_d, skip);
      const range = def.range;
      const wh = g.physics.raycast(start, _d, range, GROUPS.qAll, pl.inVehicle && pl.vehicle ? pl.vehicle.body : pl.body);
      const ph = g.peds.raycast(start, _d, wh ? wh.dist : range);
      let end: THREE.Vector3;
      if (ph && (!wh || ph.t < wh.dist)) {
        end = start.clone().addScaledVector(_d, ph.t);
        g.peds.damage(ph.ped, def.damage * (ph.head ? 2.5 : 1), true, _d);
        anyHit = true;
      } else if (wh) {
        end = wh.point;
        if (wh.owner instanceof Vehicle) {
          const v = wh.owner;
          v.damage(def.damage * 1.2);
          if (v.kind === 'police' && !v.destroyed) g.police.reportCrime('shootCop', v.curPos);
          if (v.driver === 'traffic' && v.mode === 'traffic') { v.makeDynamic(); v.driver = 'npc'; }
          anyHit = true;
        } else if (wh.owner instanceof Ped) {
          g.peds.damage(wh.owner, def.damage, true, _d);
          anyHit = true;
        }
        g.effects.sparks(wh.point, wh.normal, def.pellets > 1 ? 2 : 6);
      } else end = start.clone().addScaledVector(_d, range);
      if (k < 3) g.effects.tracer(_m, end);
      _hit.copy(end);
    }
    if (anyHit) this.hitMarker = 0.12;
    g.peds.panic(pl.pos, 40);
    g.police.reportCrime('gunfire', pl.pos);
  }
}
