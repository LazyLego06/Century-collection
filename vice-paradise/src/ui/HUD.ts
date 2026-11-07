import * as THREE from 'three';
import type { Game } from '../core/Game';
import { formatMoney } from '../core/util';
import {
  BEACH_END, BEACH_FLAT_END, CANAL_Z0, CANAL_Z1, CELL, CITY, District, LAND_MAX, LAND_MIN, N, ROAD_HALF, nearestNode, nodeValid,
} from '../world/CityLayout';

const MX0 = -100, MZ0 = -100, MW = 1180, MH = 1080; // map image covers this world rect at 1 px per metre

const $ = (id: string) => document.getElementById(id)!;

/** Grid BFS between road nodes for the GPS route. */
export function gpsRoute(from: THREE.Vector3, to: THREE.Vector3): [number, number][] {
  const a = nearestNode(from.x, from.z), b = nearestNode(to.x, to.z);
  const key = (i: number, j: number) => i * 100 + j;
  const prev = new Map<number, number>();
  const q: [number, number][] = [[a.i, a.j]];
  prev.set(key(a.i, a.j), -1);
  while (q.length) {
    const [i, j] = q.shift()!;
    if (i === b.i && j === b.j) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (!nodeValid(ni, nj) || prev.has(key(ni, nj))) continue;
      prev.set(key(ni, nj), key(i, j));
      q.push([ni, nj]);
    }
  }
  const path: [number, number][] = [];
  let k = key(b.i, b.j);
  while (k !== -1 && prev.has(k)) { path.push([Math.floor(k / 100) * CELL, (k % 100) * CELL]); k = prev.get(k)!; }
  return path.reverse();
}

export class HUD {
  root = $('hud');
  private mm = $('minimap') as HTMLCanvasElement;
  private mctx = this.mm.getContext('2d')!;
  mapImage: HTMLCanvasElement;
  private helpTimer = 0;
  private bigTimer = 0;
  private notifQueue: string[] = [];
  private zoneTimer = 0;
  private lastZone = '';
  private cache: Record<string, string> = {};
  private flash = 0;
  private bigMapCanvas = $('bigmap-canvas') as HTMLCanvasElement;
  bigMap = { zoom: 1, cx: 450, cz: 450, dragging: false, lx: 0, ly: 0 };
  waypoint: THREE.Vector3 | null = null;
  private route: [number, number][] = [];
  private routeTimer = 0;

  constructor(private game: Game) {
    this.mapImage = this.renderMapImage();
    this.setupBigMap();
  }

  private set(id: string, html: string) {
    if (this.cache[id] === html) return;
    this.cache[id] = html;
    $(id).innerHTML = html;
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  help(html: string, seconds = 4) {
    const el = $('hud-help');
    el.innerHTML = html; el.classList.remove('hidden');
    this.helpTimer = seconds;
  }
  notify(text: string) { this.notifQueue.push(text); if (this.helpTimer <= 0) this.nextNotif(); }
  private nextNotif() { const t = this.notifQueue.shift(); if (t) this.help(t, 2.5); }

  bigText(title: string, sub: string, cls: 'wasted' | 'busted' | 'passed' | 'failed', seconds: number) {
    const el = $('hud-big');
    el.className = cls;
    el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.bigTimer = seconds;
  }

  damageFlash() { this.flash = 1; }

  /** Pre-renders a stylised map of the city (used by both the minimap and full map). */
  private renderMapImage() {
    const c = document.createElement('canvas');
    c.width = MW; c.height = MH;
    const x = c.getContext('2d')!;
    const X = (wx: number) => wx - MX0, Z = (wz: number) => wz - MZ0;
    x.fillStyle = '#123a5a'; x.fillRect(0, 0, MW, MH);
    x.fillStyle = '#d8c48f'; x.fillRect(X(LAND_MAX), Z(LAND_MIN), BEACH_FLAT_END - LAND_MAX + 30, LAND_MAX - LAND_MIN);
    x.fillStyle = '#c0a978'; x.fillRect(X(BEACH_FLAT_END + 30), Z(LAND_MIN), BEACH_END - BEACH_FLAT_END - 30, LAND_MAX - LAND_MIN);
    x.fillStyle = '#5b5f68'; x.fillRect(X(LAND_MIN), Z(LAND_MIN), LAND_MAX - LAND_MIN, LAND_MAX - LAND_MIN);
    x.fillStyle = '#1d5f86'; x.fillRect(X(LAND_MIN), Z(CANAL_Z0), LAND_MAX - LAND_MIN, CANAL_Z1 - CANAL_Z0);
    x.fillStyle = '#5b5f68';
    for (let i = 0; i <= N; i++) x.fillRect(X(i * CELL - ROAD_HALF), Z(CANAL_Z0), ROAD_HALF * 2, CANAL_Z1 - CANAL_Z0);
    const dcol: Record<number, string> = {
      [District.Downtown]: '#3d4256', [District.Commercial]: '#4a4550', [District.Residential]: '#3c5236', [District.Beach]: '#5a4b5c',
      [District.Nightlife]: '#4a2f5a', [District.Park]: '#2e6a33', [District.Police]: '#2c4670', [District.Hospital]: '#6a3a44', [District.Gas]: '#2f5a48', [District.Canal]: '#1d5f86',
    };
    for (const b of this.game.layout.blocks) {
      x.fillStyle = dcol[b.district];
      x.fillRect(X(b.cx - 30), Z(b.cz - 30), 60, 60);
    }
    x.fillStyle = 'rgba(0,0,0,0.28)';
    for (const ch of this.game.layout.chunks) for (const b of ch.buildings) x.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w, b.d);
    // road centre lines
    x.strokeStyle = 'rgba(255,220,120,0.25)'; x.lineWidth = 1;
    for (let i = 0; i <= N; i++) {
      x.beginPath(); x.moveTo(X(i * CELL), Z(0)); x.lineTo(X(i * CELL), Z(CITY)); x.stroke();
      x.beginPath(); x.moveTo(X(0), Z(i * CELL)); x.lineTo(X(CITY), Z(i * CELL)); x.stroke();
    }
    return c;
  }

  private blipColor(kind: string) {
    return { police: '#3fa0ff', hospital: '#ff4d6d', club: '#c13bff', gas: '#2bd97c', safehouse: '#ffffff' }[kind] ?? '#fff';
  }

  /** Draw all world blips with a world->canvas transform already set on ctx. */
  private drawBlips(x: CanvasRenderingContext2D, scale: number, time: number, forMinimap: boolean) {
    const g = this.game;
    const r = (forMinimap ? 4.5 : 6) / scale;
    // GPS route
    if (this.route.length && (g.missions.target || this.waypoint)) {
      x.strokeStyle = g.missions.target ? 'rgba(255,210,63,0.85)' : 'rgba(255,47,160,0.9)';
      x.lineWidth = (forMinimap ? 5 : 4) / scale;
      x.lineJoin = 'round';
      x.beginPath();
      x.moveTo(g.player.pos.x, g.player.pos.z);
      for (const [px, pz] of this.route) x.lineTo(px, pz);
      const t = g.missions.target ?? this.waypoint!;
      x.lineTo(t.x, t.z);
      x.stroke();
    }
    for (const l of g.layout.landmarks) {
      x.fillStyle = this.blipColor(l.kind);
      x.beginPath(); x.arc(l.x, l.z, r * 1.1, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#000'; x.lineWidth = 1 / scale; x.stroke();
    }
    if (!g.missions.active) for (const m of g.missions.available()) {
      x.fillStyle = '#ffd23f';
      x.beginPath(); x.arc(m.giver[0], m.giver[1], r * 1.4, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#000'; x.font = `bold ${r * 1.9}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(m.category[0], m.giver[0], m.giver[1] + r * 0.1);
    }
    // police search area
    if (g.police.wanted > 0 && g.police.flashStars) {
      x.strokeStyle = 'rgba(255,60,60,0.6)'; x.fillStyle = 'rgba(255,60,60,0.08)'; x.lineWidth = 2 / scale;
      x.beginPath(); x.arc(g.police.lastSeen.x, g.police.lastSeen.z, g.police.searchRadius, 0, Math.PI * 2); x.fill(); x.stroke();
    }
    const flash = Math.sin(time * 10) > 0;
    for (const v of g.vehicles) {
      if (v.kind === 'police' && (v.driver === 'police' || v.sirenOn)) {
        x.fillStyle = flash ? '#ff3040' : '#3060ff';
        x.beginPath(); x.arc(v.curPos.x, v.curPos.z, r, 0, Math.PI * 2); x.fill();
      }
    }
    for (const p of g.peds.pool) {
      if (!p.active || p.state !== 'combat') continue;
      x.fillStyle = p.kind === 'cop' ? (flash ? '#ff3040' : '#3060ff') : '#ff3040';
      x.beginPath(); x.arc(p.pos.x, p.pos.z, r * 0.7, 0, Math.PI * 2); x.fill();
    }
    for (const [, v] of g.missions.vehicles) {
      if (g.player.vehicle === v) continue;
      x.fillStyle = '#4dc3ff';
      x.beginPath(); x.arc(v.curPos.x, v.curPos.z, r * 1.1, 0, Math.PI * 2); x.fill();
    }
    if (this.waypoint) { x.fillStyle = '#ff2fa0'; x.beginPath(); x.arc(this.waypoint.x, this.waypoint.z, r * 1.3, 0, Math.PI * 2); x.fill(); }
    const tgt = g.missions.target;
    if (tgt) {
      x.fillStyle = '#ffd23f'; x.strokeStyle = '#000'; x.lineWidth = 1.5 / scale;
      x.beginPath(); x.arc(tgt.x, tgt.z, r * 1.5, 0, Math.PI * 2); x.fill(); x.stroke();
      const nt = g.missions.nextTarget;
      if (nt) { x.fillStyle = 'rgba(255,210,63,0.5)'; x.beginPath(); x.arc(nt.x, nt.z, r, 0, Math.PI * 2); x.fill(); }
    }
  }

  private drawMinimap(time: number) {
    const g = this.game, x = this.mctx, S = this.mm.width;
    const pl = g.player.pos;
    const sp = g.player.speed;
    const scale = (2.4 - Math.min(1.1, sp / 30)) * (S / 440); // px per metre
    x.save();
    x.clearRect(0, 0, S, S);
    x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.clip();
    x.fillStyle = '#123a5a'; x.fillRect(0, 0, S, S);
    x.translate(S / 2, S / 2 + S * 0.12);
    const cy = g.camYaw;
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(cy), Math.sin(cy));
    x.rotate(rot);
    x.scale(scale, scale);
    x.translate(-pl.x, -pl.z);
    x.drawImage(this.mapImage, MX0, MZ0);
    this.drawBlips(x, scale, time, true);
    x.restore();
    // player arrow (heading relative to camera)
    x.save();
    x.translate(S / 2, S / 2 + S * 0.12);
    const heading = g.player.inVehicle && g.player.vehicle ? g.player.vehicle.yaw : g.player.yaw;
    x.rotate(-(heading - cy));
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -14); x.lineTo(10, 12); x.lineTo(0, 6); x.lineTo(-10, 12); x.closePath(); x.fill(); x.stroke();
    x.restore();
    // north indicator
    x.save();
    x.translate(S / 2, S / 2);
    x.fillStyle = '#fff'; x.font = 'bold 26px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('N', Math.sin(rot) * (S / 2 - 22), -Math.cos(rot) * (S / 2 - 22));
    x.restore();
  }

  private setupBigMap() {
    const c = this.bigMapCanvas;
    c.width = 1100; c.height = 1100;
    const toWorld = (ev: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * c.width, py = ((ev.clientY - r.top) / r.height) * c.height;
      const s = (c.width / 1150) * this.bigMap.zoom;
      return new THREE.Vector3((px - c.width / 2) / s + this.bigMap.cx, 0, (py - c.height / 2) / s + this.bigMap.cz);
    };
    let moved = false;
    c.addEventListener('mousedown', (e) => { this.bigMap.dragging = true; this.bigMap.lx = e.clientX; this.bigMap.ly = e.clientY; moved = false; });
    window.addEventListener('mouseup', (e) => {
      if (!this.bigMap.dragging) return;
      this.bigMap.dragging = false;
      if (!moved && e.target === c) {
        if (e.button === 2) this.waypoint = null;
        else { this.waypoint = toWorld(e); this.notify('Waypoint set'); }
        this.routeTimer = 0;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.bigMap.dragging) return;
      const r = c.getBoundingClientRect();
      const s = (c.width / 1150) * this.bigMap.zoom * (r.width / c.width);
      const dx = e.clientX - this.bigMap.lx, dy = e.clientY - this.bigMap.ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      this.bigMap.cx -= dx / s; this.bigMap.cz -= dy / s;
      this.bigMap.lx = e.clientX; this.bigMap.ly = e.clientY;
    });
    c.addEventListener('wheel', (e) => { this.bigMap.zoom = Math.min(5, Math.max(0.8, this.bigMap.zoom * (e.deltaY > 0 ? 0.85 : 1.18))); e.preventDefault(); }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  openBigMap() { this.bigMap.cx = this.game.player.pos.x; this.bigMap.cz = this.game.player.pos.z; this.bigMap.zoom = 1.6; }

  drawBigMap(time: number) {
    const c = this.bigMapCanvas, x = c.getContext('2d')!;
    const s = (c.width / 1150) * this.bigMap.zoom;
    x.save();
    x.fillStyle = '#0e2c45'; x.fillRect(0, 0, c.width, c.height);
    x.translate(c.width / 2, c.height / 2);
    x.scale(s, s);
    x.translate(-this.bigMap.cx, -this.bigMap.cz);
    x.drawImage(this.mapImage, MX0, MZ0);
    // district labels
    x.fillStyle = 'rgba(255,255,255,0.75)'; x.font = `bold ${14 / s * 1.4}px Arial`; x.textAlign = 'center';
    const labels: [string, number, number][] = [['NEON HEIGHTS', 432, 300], ['OCEAN DRIVE', 830, 200], ['PULSE DISTRICT', 720, 430], ['PALMETTO HILLS', 110, 300], ['SUNSET ISLES', 400, 760], ['GRAND CANAL', 300, 612], ['PORT VICE', 450, 40], ['MIDTOWN', 230, 120], ['PARADISE BEACH', 940, 470]];
    for (const [t, lx, lz] of labels) x.fillText(t, lx, lz);
    this.drawBlips(x, s, time, false);
    const p = this.game.player.pos;
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 2 / s;
    x.beginPath(); x.arc(p.x, p.z, 7 / s, 0, Math.PI * 2); x.fill(); x.stroke();
    x.restore();
  }

  update(dt: number, time: number) {
    const g = this.game, pl = g.player;
    if (this.helpTimer > 0) { this.helpTimer -= dt; if (this.helpTimer <= 0) { $('hud-help').classList.add('hidden'); this.nextNotif(); } }
    if (this.bigTimer > 0) { this.bigTimer -= dt; $('hud-big').classList.toggle('hidden', this.bigTimer <= 0); }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    ($('damage-flash') as HTMLElement).style.boxShadow = `inset 0 0 160px rgba(255,0,0,${(this.flash * 0.6 + (pl.health < 25 ? 0.25 + Math.sin(time * 6) * 0.1 : 0)).toFixed(2)})`;

    this.set('hud-money', formatMoney(g.displayMoney));
    this.set('hud-time', g.env.clock);
    const w = g.weapons.slot;
    this.set('hud-weapon-name', w.def.name);
    this.set('hud-ammo', w.def.mag ? `${w.clip}<span style="opacity:.6"> / ${w.reserve}</span>${g.weapons.reloading > 0 ? ' <span style="color:#ffd23f">R</span>' : ''}` : '');
    let stars = '';
    for (let i = 5; i >= 1; i--) stars += `<span class="s${g.police.wanted >= i ? ' on' : ''}">★</span>`;
    this.set('hud-stars', stars);
    $('hud-stars').classList.toggle('flash', g.police.flashStars);
    ($('bar-health') as HTMLElement).style.width = `${Math.max(0, pl.health)}%`;
    ($('bar-armor') as HTMLElement).style.width = `${pl.armor}%`;

    const v = pl.inVehicle ? pl.vehicle : null;
    $('hud-speedo').classList.toggle('hidden', !v);
    if (v) {
      this.set('speedo-val', Math.round(Math.abs(v.speedMs) * 3.6).toString());
      this.set('speedo-name', v.spec.name);
      ($('bar-vhealth') as HTMLElement).style.width = `${(v.health / v.spec.maxHealth) * 100}%`;
    }
    const ch = $('crosshair');
    ch.classList.toggle('on', !pl.inVehicle && !pl.dead && (pl.aiming || g.input.lmb));
    $('hitmarker').classList.toggle('on', g.weapons.hitMarker > 0);

    // mission objective / timer / prompts
    const m = g.missions;
    let obj = m.objective;
    const giver = m.giverNear();
    if (giver) obj = `<b>${giver.name}</b> (${giver.category}) — ${giver.blurb}<br>Press <b>E</b> to start`;
    else if (!pl.inVehicle && !m.active) {
      const nv = g.nearestEnterable();
      if (nv) obj = `Press <b>F</b> to ${nv.driver === 'none' ? 'enter' : 'steal'} the ${nv.spec.name}`;
    }
    this.set('hud-objective', obj);
    const tEl = $('hud-timer');
    if (m.timer >= 0) {
      tEl.classList.remove('hidden');
      const t = Math.max(0, m.timer);
      this.set('hud-timer', `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`);
      tEl.classList.toggle('low', t < 10);
    } else tEl.classList.add('hidden');

    // zone name
    const zone = g.zoneName;
    if (zone !== this.lastZone) { this.lastZone = zone; this.set('hud-zone', zone); $('hud-zone').classList.add('on'); this.zoneTimer = 4; }
    if (this.zoneTimer > 0) { this.zoneTimer -= dt; if (this.zoneTimer <= 0) $('hud-zone').classList.remove('on'); }

    // GPS route recompute
    this.routeTimer -= dt;
    const tgt = m.target ?? this.waypoint;
    if (this.waypoint && !m.target && pl.pos.distanceTo(this.waypoint) < 15) { this.waypoint = null; this.notify('Arrived at waypoint'); }
    if (this.routeTimer <= 0) { this.routeTimer = 0.5; this.route = tgt ? gpsRoute(pl.pos, tgt) : []; }

    this.drawMinimap(time);
  }
}
