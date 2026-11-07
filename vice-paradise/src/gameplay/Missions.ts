import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Vehicle } from '../entities/Vehicle';
import type { VehicleKind } from '../entities/VehicleModels';
import type { Ped } from '../entities/Peds';
import { CELL } from '../world/CityLayout';
import { formatMoney } from '../core/util';

type XZ = [number, number];
export type Step =
  | { type: 'dialog'; text: string; seconds?: number }
  | { type: 'spawnVehicle'; key: string; kind: VehicleKind; pos: XZ; yaw: number; color?: number }
  | { type: 'getIn'; key: string; text: string }
  | { type: 'goto'; pos: XZ; text: string; radius?: number; vehicle?: boolean; onFoot?: boolean; stop?: boolean }
  | { type: 'wait'; seconds: number; text: string }
  | { type: 'spawnEnemies'; tag: string; kind: 'gang' | 'cop'; at: XZ[] }
  | { type: 'kill'; tag: string; text: string }
  | { type: 'wanted'; level: number }
  | { type: 'loseWanted'; text: string }
  | { type: 'checkpoints'; points: XZ[]; text: string }
  | { type: 'timer'; seconds: number }
  | { type: 'stopTimer' }
  | { type: 'giveWeapon'; id: string; ammo: number }
  | { type: 'protect'; key: string; minHealth?: number };

export interface MissionDef {
  id: string; name: string; category: 'Story' | 'Delivery' | 'Race' | 'Police Escape' | 'Driving';
  giver: XZ; reward: number; requires?: string; blurb: string; steps: Step[];
}

/** Helpers to address the grid: block centres / road nodes / curbside points. */
const B = (i: number, j: number): XZ => [i * CELL + 36, j * CELL + 36];
const NODE = (i: number, j: number): XZ => [i * CELL, j * CELL];
const CURB = (i: number, j: number, side: 'n' | 's' | 'e' | 'w'): XZ => {
  const [x, z] = B(i, j);
  return side === 'n' ? [x, z - 29] : side === 's' ? [x, z + 29] : side === 'e' ? [x + 29, z] : [x - 29, z];
};

export const MISSIONS: MissionDef[] = [
  {
    id: 'neon_welcome', name: 'Neon Welcome', category: 'Story', giver: [9 * CELL + 50, 5 * CELL - 10], reward: 2500,
    blurb: 'Rico has a job for a new face in town.',
    steps: [
      { type: 'dialog', text: '<b>Rico:</b> "Welcome to Vice Paradise, amigo. My guys at the port got jumped. Take my ride and go handle it."', seconds: 5 },
      { type: 'spawnVehicle', key: 'ride', kind: 'sports', pos: [9 * CELL + 30, 5 * CELL + 3], yaw: Math.PI / 2, color: 0xff2fa0 },
      { type: 'getIn', key: 'ride', text: 'Get in Rico\'s <b>Vortex RS</b>.' },
      { type: 'giveWeapon', id: 'pistol', ammo: 48 },
      { type: 'goto', pos: [6 * CELL - 3, 20], text: 'Drive to the <b>Port Vice</b> waterfront.', vehicle: true, radius: 12 },
      { type: 'spawnEnemies', tag: 'port', kind: 'gang', at: [[420, -8], [440, -4], [458, -10], [472, 2], [490, -7], [405, 0]] },
      { type: 'kill', tag: 'port', text: 'Take out the <b>Vipers</b> at the port.' },
      { type: 'dialog', text: '<b>Rico:</b> "That\'s how we do it in Paradise. Come see me at Club Pulse for more work."', seconds: 4 },
    ],
  },
  {
    id: 'hot_delivery', name: 'Hot Delivery', category: 'Delivery', giver: CURB(1, 6, 'e'), reward: 1400,
    blurb: 'Deliver a package across town before the buyer walks.',
    steps: [
      { type: 'spawnVehicle', key: 'van', kind: 'suv', pos: [2 * CELL - 3, 6 * CELL + 46], yaw: 0, color: 0xf2f2f2 },
      { type: 'getIn', key: 'van', text: 'Get in the <b>delivery SUV</b>.' },
      { type: 'protect', key: 'van', minHealth: 1 },
      { type: 'goto', pos: [4 * CELL + 3, 1 * CELL + 36], text: 'Pick up the package at the <b>warehouse</b>.', vehicle: true, stop: true },
      { type: 'wait', seconds: 2, text: 'Loading the package…' },
      { type: 'timer', seconds: 85 },
      { type: 'goto', pos: [9 * CELL - 3, 10 * CELL + 36], text: 'Deliver the package to <b>Sunset Isles</b> before time runs out.', vehicle: true, stop: true },
      { type: 'stopTimer' },
    ],
  },
  {
    id: 'ocean_sprint', name: 'Ocean Drive Sprint', category: 'Race', giver: [12 * CELL + 10, 1 * CELL + 30], reward: 1800,
    blurb: 'A timed checkpoint race along the coast.',
    steps: [
      { type: 'spawnVehicle', key: 'racer', kind: 'sports', pos: [12 * CELL - 3, 1 * CELL + 50], yaw: 0, color: 0x00d2ff },
      { type: 'getIn', key: 'racer', text: 'Get in the <b>race car</b>.' },
      { type: 'timer', seconds: 95 },
      {
        type: 'checkpoints', text: 'Hit every <b>checkpoint</b> before time runs out!',
        points: [NODE(12, 3), NODE(12, 6), NODE(12, 9), NODE(12, 12), NODE(9, 12), NODE(6, 12), NODE(6, 9), NODE(6, 6), NODE(9, 6), NODE(9, 3), NODE(12, 3)],
      },
      { type: 'stopTimer' },
    ],
  },
  {
    id: 'heat_wave', name: 'Heat Wave', category: 'Police Escape', giver: CURB(8, 1, 's'), reward: 2200,
    blurb: 'Draw the heat away from a bank job. Survive a 3-star pursuit.',
    steps: [
      { type: 'dialog', text: '<b>Lena:</b> "The crew needs a distraction. Make some noise, then lose the cops."', seconds: 4 },
      { type: 'spawnVehicle', key: 'getaway', kind: 'police', pos: [8 * CELL + 30, 2 * CELL + 3], yaw: Math.PI / 2 },
      { type: 'getIn', key: 'getaway', text: 'Steal the <b>police cruiser</b>.' },
      { type: 'wanted', level: 3 },
      { type: 'loseWanted', text: '<b>Lose the cops.</b> Break line of sight and stay hidden.' },
    ],
  },
  {
    id: 'cab_rush', name: 'Cab Rush', category: 'Driving', giver: CURB(5, 3, 's'), reward: 1600,
    blurb: 'Pick up and drop off fares on a tight clock.',
    steps: [
      { type: 'spawnVehicle', key: 'cab', kind: 'taxi', pos: [5 * CELL + 30, 4 * CELL + 3], yaw: Math.PI / 2 },
      { type: 'getIn', key: 'cab', text: 'Get in the <b>Paradise Cab</b>.' },
      { type: 'protect', key: 'cab', minHealth: 1 },
      { type: 'timer', seconds: 45 },
      { type: 'goto', pos: [7 * CELL + 36, 2 * CELL - 3], text: 'Pick up the fare in <b>Neon Heights</b>.', vehicle: true, stop: true },
      { type: 'wait', seconds: 1.5, text: 'Passenger getting in…' },
      { type: 'timer', seconds: 50 },
      { type: 'goto', pos: [11 * CELL + 36, 7 * CELL + 3], text: 'Drop them at <b>Ocean Drive</b>.', vehicle: true, stop: true },
      { type: 'wait', seconds: 1.5, text: 'Next fare is waiting…' },
      { type: 'timer', seconds: 55 },
      { type: 'goto', pos: [3 * CELL + 3, 10 * CELL + 36], text: 'Take the next fare to <b>Sunset Isles</b>.', vehicle: true, stop: true },
      { type: 'stopTimer' },
    ],
  },
  {
    id: 'turf_war', name: 'Turf War', category: 'Story', requires: 'neon_welcome', giver: CURB(10, 6, 'n'), reward: 4000,
    blurb: 'Hit the Vipers where they live, then shake the heat.',
    steps: [
      { type: 'dialog', text: '<b>Rico:</b> "The Vipers hide out in Sunset Isles. Take this and end them."', seconds: 4 },
      { type: 'giveWeapon', id: 'smg', ammo: 150 },
      { type: 'goto', pos: [2 * CELL + 36, 10 * CELL - 3], text: 'Go to the <b>Viper hideout</b> in Sunset Isles.', radius: 25 },
      { type: 'spawnEnemies', tag: 'turf', kind: 'gang', at: [[152, 748], [208, 762], [180, 727], [170, 785], [208, 732], [146, 776], [188, 790]] },
      { type: 'kill', tag: 'turf', text: 'Wipe out the <b>Vipers</b>.' },
      { type: 'wanted', level: 2 },
      { type: 'loseWanted', text: 'The cops are coming. <b>Lose your wanted level.</b>' },
    ],
  },
];

const SAVE_KEY = 'vp_save_v1';

/** Runs data-driven missions as sequences of steps with timers and failure conditions. */
export class Missions {
  completed = new Set<string>();
  active: MissionDef | null = null;
  stepIndex = 0;
  stepTime = 0;
  timer = -1;
  target: THREE.Vector3 | null = null;
  nextTarget: THREE.Vector3 | null = null;
  vehicles = new Map<string, Vehicle>();
  protectKey: string | null = null;
  cpIndex = 0;
  objective = '';
  markerRadius = 4;
  private lostWanted = false;
  private failReason = '';

  constructor(private game: Game) {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (s) { const d = JSON.parse(s); (d.completed ?? []).forEach((c: string) => this.completed.add(c)); if (typeof d.money === 'number') game.money = d.money; }
    } catch { /* ignore */ }
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ completed: [...this.completed], money: this.game.money })); } catch { /* ignore */ }
  }
  reset() { this.completed.clear(); this.game.money = 500; this.save(); }

  available() {
    return MISSIONS.filter((m) => (!m.requires || this.completed.has(m.requires)));
  }

  /** Mission start markers near the player (shown when no mission is active). */
  giverNear(): MissionDef | null {
    if (this.active) return null;
    const p = this.game.player.pos;
    for (const m of this.available()) if (Math.hypot(m.giver[0] - p.x, m.giver[1] - p.z) < 3.5) return m;
    return null;
  }

  start(m: MissionDef) {
    this.active = m; this.stepIndex = 0; this.stepTime = 0; this.timer = -1; this.target = null; this.nextTarget = null;
    this.vehicles.clear(); this.protectKey = null; this.cpIndex = 0; this.lostWanted = false;
    this.game.hud.bigText(m.name, m.category, 'passed', 2.5);
    this.enterStep();
  }

  abandon() { if (this.active) this.fail('Mission abandoned.'); }

  fail(reason: string) {
    if (!this.active) return;
    this.failReason = reason;
    this.cleanup();
    this.game.hud.bigText('Mission Failed', reason, 'failed', 3.5);
    this.game.audio.failed();
  }

  private pass() {
    const m = this.active!;
    const firstTime = !this.completed.has(m.id);
    this.completed.add(m.id);
    const reward = firstTime ? m.reward : Math.round(m.reward * 0.5);
    this.cleanup();
    this.game.addMoney(reward);
    this.game.hud.bigText('Mission Passed', formatMoney(reward), 'passed', 4);
    this.game.audio.passed();
    this.save();
  }

  private cleanup() {
    for (const v of this.vehicles.values()) v.persistent = false;
    for (const p of this.game.peds.pool) if (p.active && p.tag) p.tag = '';
    this.active = null; this.target = null; this.nextTarget = null; this.timer = -1; this.objective = ''; this.protectKey = null;
    this.vehicles.clear();
  }

  private get step(): Step | null { return this.active ? this.active.steps[this.stepIndex] ?? null : null; }

  private enterStep() {
    const s = this.step;
    const g = this.game;
    this.stepTime = 0;
    this.target = null; this.nextTarget = null;
    if (!s) { this.pass(); return; }
    switch (s.type) {
      case 'dialog': g.hud.help(s.text, s.seconds ?? 4); this.objective = ''; break;
      case 'spawnVehicle': {
        const pos = new THREE.Vector3(s.pos[0], Vehicle.rideHeight(s.kind) + 0.15, s.pos[1]);
        // clear the spot of any traffic
        for (const v of g.vehicles) if (v.curPos.distanceTo(pos) < 6 && v.driver !== 'player') v.aiState.despawn = 1;
        g.city.forceColliders(pos.x, pos.z, 60);
        const v = new Vehicle(g.physics, s.kind, pos, s.yaw, 'physics', s.color);
        v.persistent = true;
        g.vehicles.push(v);
        this.vehicles.set(s.key, v);
        this.advance(); return;
      }
      case 'getIn': this.objective = s.text; break;
      case 'goto':
        this.objective = s.text;
        this.target = new THREE.Vector3(s.pos[0], 0, s.pos[1]);
        this.markerRadius = s.radius ?? 5;
        break;
      case 'wait': this.objective = s.text; break;
      case 'spawnEnemies':
        for (const [x, z] of s.at) {
          g.city.forceColliders(x, z, 40);
          g.peds.spawnCombat(s.kind, new THREE.Vector3(x, 0.25, z), s.tag);
        }
        this.advance(); return;
      case 'kill': this.objective = s.text; break;
      case 'wanted': g.police.setWanted(s.level); this.advance(); return;
      case 'loseWanted': this.objective = s.text; this.lostWanted = g.police.wanted === 0; break;
      case 'checkpoints': this.objective = s.text; this.cpIndex = 0; this.setCheckpoint(); break;
      case 'timer': this.timer = s.seconds; this.advance(); return;
      case 'stopTimer': this.timer = -1; this.advance(); return;
      case 'giveWeapon': g.weapons.give(s.id, s.ammo); g.hud.notify(`Received ${g.weapons.slots.find((w) => w.def.id === s.id)?.def.name}`); this.advance(); return;
      case 'protect': this.protectKey = s.key; this.advance(); return;
    }
  }

  private setCheckpoint() {
    const s = this.step;
    if (!s || s.type !== 'checkpoints') return;
    const p = s.points[this.cpIndex];
    this.target = new THREE.Vector3(p[0], 0, p[1]);
    const n = s.points[this.cpIndex + 1];
    this.nextTarget = n ? new THREE.Vector3(n[0], 0, n[1]) : null;
    this.markerRadius = 9;
  }

  private advance() { this.stepIndex++; this.enterStep(); }

  onPedKilled(_p: Ped) { /* kill steps poll tags each frame */ }
  onWantedCleared() { this.lostWanted = true; }
  onPlayerWasted() { if (this.active) this.fail('You were wasted.'); }
  onPlayerBusted() { if (this.active) this.fail('You were busted.'); }

  update(dt: number) {
    const g = this.game;
    if (!this.active) return;
    const s = this.step;
    if (!s) return;
    this.stepTime += dt;
    if (this.timer >= 0) {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('You ran out of time.'); return; }
    }
    if (this.protectKey) {
      const v = this.vehicles.get(this.protectKey);
      if (v && (v.destroyed || v.sunk || v.burnTimer >= 0)) { this.fail('The vehicle was wrecked.'); return; }
    }
    const pl = g.player;
    const inside = (r: number) => this.target && Math.hypot(this.target.x - pl.pos.x, this.target.z - pl.pos.z) < r;
    switch (s.type) {
      case 'dialog': if (this.stepTime > (s.seconds ?? 4)) this.advance(); break;
      case 'getIn': {
        const v = this.vehicles.get(s.key);
        if (!v || v.destroyed) { this.fail('The vehicle was destroyed.'); return; }
        this.target = v.curPos.clone().setY(0);
        this.markerRadius = 0;
        if (pl.inVehicle && pl.vehicle === v) this.advance();
        break;
      }
      case 'goto': {
        if (s.vehicle && !pl.inVehicle) { this.objective = 'Get back in a vehicle.'; break; }
        this.objective = s.text;
        if (inside(this.markerRadius + (pl.inVehicle ? 2 : 0))) {
          if (s.stop && pl.speed > 3) { this.objective = 'Stop in the marker.'; break; }
          g.audio.checkpoint();
          this.advance();
        }
        break;
      }
      case 'wait': if (this.stepTime > s.seconds) this.advance(); break;
      case 'kill': {
        let left = 0;
        for (const p of g.peds.pool) if (p.active && p.tag === s.tag && p.state !== 'dead') left++;
        this.objective = `${s.text} (${left} left)`;
        if (left === 0) this.advance();
        break;
      }
      case 'loseWanted': if (this.lostWanted || g.police.wanted === 0) this.advance(); break;
      case 'checkpoints': {
        if (!pl.inVehicle) { this.objective = 'Get back in a vehicle.'; break; }
        this.objective = `${s.text} (${this.cpIndex}/${s.points.length})`;
        if (inside(this.markerRadius + 2)) {
          g.audio.checkpoint();
          this.cpIndex++;
          if (this.cpIndex >= s.points.length) this.advance();
          else this.setCheckpoint();
        }
        break;
      }
    }
  }
}
