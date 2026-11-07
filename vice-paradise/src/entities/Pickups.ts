import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Ped } from './Peds';

export type PickupKind = 'health' | 'armor' | 'money' | 'weapon';
export interface Pickup { kind: PickupKind; pos: THREE.Vector3; amount: number; weapon?: string; respawn: number; timer: number; active: boolean; temp: boolean; }

const COLORS: Record<PickupKind, [number, number, number]> = { health: [0.3, 3, 0.6], armor: [0.4, 1.4, 4], money: [0.6, 3, 0.6], weapon: [3.5, 1.6, 0.3] };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _p = new THREE.Vector3();

export class Pickups {
  list: Pickup[] = [];
  mesh: THREE.InstancedMesh;

  constructor(private game: Game) {
    const geo = new THREE.OctahedronGeometry(0.35, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 96);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    const L = game.layout;
    const add = (kind: PickupKind, x: number, z: number, amount: number, weapon?: string) =>
      this.list.push({ kind, pos: new THREE.Vector3(x, 0.9, z), amount, weapon, respawn: 60, timer: 0, active: true, temp: false });
    add('health', L.hospital.x - 6, L.hospital.z - 1, 100);
    add('health', L.hospital.x + 6, L.hospital.z - 1, 100);
    add('armor', L.policeStation.x - 8, L.policeStation.z - 2, 100);
    add('weapon', 4 * 72 + 30, 1 * 72 + 64, 120, 'smg'); // Midtown back alley
    add('weapon', 9 * 72 + 64, 9 * 72 + 36, 24, 'shotgun'); // Sunset Isles
    add('weapon', 6 * 72 + 64, 6 * 72 + 64, 90, 'rifle'); // downtown plaza
    add('armor', 10 * 72 + 64, 6 * 72 + 8, 50);
    add('health', 1 * 72 + 36, 2 * 72 + 36, 50); // park
    add('money', 920, 300, 250);
    add('money', 2 * 72 + 64, 10 * 72 + 64, 200);
  }

  dropFrom(p: Ped) {
    const r = Math.random();
    const pos = p.pos.clone(); pos.y = 0.9;
    if (p.kind === 'gang') {
      if (r < 0.5) this.list.push({ kind: 'weapon', pos, amount: 30, weapon: Math.random() < 0.6 ? 'smg' : 'pistol', respawn: 0, timer: 0, active: true, temp: true });
      else this.list.push({ kind: 'money', pos, amount: 50 + Math.floor(Math.random() * 150), respawn: 0, timer: 0, active: true, temp: true });
    } else if (p.kind === 'cop') {
      this.list.push({ kind: 'weapon', pos, amount: 24, weapon: 'pistol', respawn: 0, timer: 0, active: true, temp: true });
    } else if (r < 0.4) {
      this.list.push({ kind: 'money', pos, amount: 10 + Math.floor(Math.random() * 40), respawn: 0, timer: 0, active: true, temp: true });
    }
  }

  update(dt: number, time: number) {
    const g = this.game, pl = g.player;
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) p.active = true;
        continue;
      }
      const d = p.pos.distanceTo(pl.pos.clone().setY(pl.pos.y + 0.9));
      if (p.temp && d > 200) { this.list.splice(i, 1); continue; }
      if (!pl.dead && d < (pl.inVehicle ? 2.6 : 1.4)) {
        if (this.collect(p)) {
          if (p.temp) { this.list.splice(i, 1); continue; }
          p.active = false; p.timer = p.respawn;
          continue;
        }
      }
      if (n < 96 && d < 160) {
        _q.setFromAxisAngle(_p.set(0, 1, 0), time * 2 + i);
        _m.compose(_p.set(p.pos.x, p.pos.y + Math.sin(time * 3 + i) * 0.12, p.pos.z), _q, _s.set(1, 1.4, 1));
        this.mesh.setMatrixAt(n, _m);
        const c = COLORS[p.kind];
        this.mesh.setColorAt(n, _c.setRGB(c[0], c[1], c[2]));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private collect(p: Pickup) {
    const g = this.game, pl = g.player;
    switch (p.kind) {
      case 'health': if (pl.health >= 100) return false; pl.health = Math.min(100, pl.health + p.amount); g.hud.notify('+ Health'); break;
      case 'armor': if (pl.armor >= 100) return false; pl.armor = Math.min(100, pl.armor + p.amount); g.hud.notify('+ Body Armor'); break;
      case 'money': g.addMoney(p.amount); break;
      case 'weapon': {
        const w = g.weapons.slots.find((s) => s.def.id === p.weapon)!;
        const isNew = !w.owned;
        g.weapons.give(p.weapon!, p.amount);
        g.hud.notify(isNew ? `Picked up ${w.def.name}` : `+${p.amount} ${w.def.name} ammo`);
        break;
      }
    }
    g.audio.pickup();
    return true;
  }
}
