import * as THREE from 'three';
import { Audio } from './Audio';
import { Input } from './Input';
import { PerfMonitor, detectOS } from './Perf';
import { Physics, GROUPS } from './Physics';
import { RenderPipeline } from './RenderPipeline';
import { DRAW_DISTANCE, PED_COUNT, SHADOW_CFG, Settings, TRAFFIC_COUNT, ShadowQuality } from './Settings';
import { angleDiff, clamp, damp, formatMoney, lerp } from './util';
import { CityLayout, zoneName } from '../world/CityLayout';
import { CityRenderer } from '../world/CityRenderer';
import { Environment } from '../world/Environment';
import { TrafficLights } from '../world/TrafficLights';
import { WorldUniforms } from '../world/Materials';
import { Vehicle } from '../entities/Vehicle';
import { VehicleRenderer } from '../entities/VehicleRenderer';
import { CharacterRenderer, CharacterVisual } from '../entities/CharacterRenderer';
import { Peds } from '../entities/Peds';
import { Player } from '../entities/Player';
import { Police } from '../entities/Police';
import { Traffic, Obstacle } from '../entities/Traffic';
import { Effects } from '../entities/Effects';
import { Weapons } from '../entities/Weapons';
import { Pickups } from '../entities/Pickups';
import { Missions } from '../gameplay/Missions';
import { MarkerRenderer } from '../gameplay/Markers';
import { HUD } from '../ui/HUD';
import { SpatialGrid } from './util';

export type GameState = 'menu' | 'playing' | 'paused' | 'map' | 'dead';

const SPAWN = new THREE.Vector3(9 * 72 + 40, 0.25, 5 * 72 - 8);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Game {
  // core
  settings = new Settings();
  pipeline: RenderPipeline;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  input: Input;
  audio = new Audio();
  physics = new Physics();
  perf = new PerfMonitor();
  os = detectOS();
  // world
  layout = new CityLayout();
  lights = new TrafficLights();
  city: CityRenderer;
  env: Environment;
  // entities
  vehicles: Vehicle[] = [];
  vehicleRenderer = new VehicleRenderer();
  characters = new CharacterRenderer(110);
  effects = new Effects();
  player: Player;
  peds: Peds;
  police: Police;
  traffic: Traffic;
  weapons: Weapons;
  pickups: Pickups;
  missions: Missions;
  markers: MarkerRenderer;
  hud: HUD;
  // state
  state: GameState = 'menu';
  time = 0;
  money = 500;
  displayMoney = 500;
  camYaw = 0;
  camPitch = 0.25;
  private camDist = 5;
  private camIdle = 0;
  private camPos = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private accumulator = 0;
  private lastT = 0;
  private deathTimer = 0;
  private deathKind: 'wasted' | 'busted' = 'wasted';
  private obstacles = new SpatialGrid<Obstacle>(16);
  private obstaclePool: Obstacle[] = [];
  private envTimer = 0;
  private memTimer = 0;
  private memEstimate = 0;
  private visuals: CharacterVisual[] = [];
  private menuAngle = 0;
  private timeBoost = false;
  zoneName = '';
  /** Skip GPU rendering (used by automated simulation tests). */
  skipRender = false;
  onStateChange: ((s: GameState) => void) | null = null;
  private appliedShadow: ShadowQuality | '' = '';

  constructor(canvas: HTMLCanvasElement) {
    this.pipeline = new RenderPipeline(canvas);
    this.renderer = this.pipeline.renderer;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.3, 1600);
    this.input = new Input(canvas);
    this.env = new Environment(this.scene);
    this.city = new CityRenderer(this.layout, this.physics, this.lights);
    this.scene.add(this.city.root, this.vehicleRenderer.group, this.characters.group, this.effects.group);

    this.city.forceColliders(SPAWN.x, SPAWN.z, 200);
    this.player = new Player(this, SPAWN);
    this.peds = new Peds(this, 90);
    this.police = new Police(this);
    this.traffic = new Traffic(this.physics, this.lights);
    this.weapons = new Weapons(this);
    this.pickups = new Pickups(this);
    this.scene.add(this.pickups.mesh);
    this.hud = new HUD(this);
    this.missions = new Missions(this);
    this.markers = new MarkerRenderer(this);
    this.scene.add(this.markers.group);
    this.displayMoney = this.money;

    // a starter car parked by the spawn point
    const car = new Vehicle(this.physics, 'sports', new THREE.Vector3(SPAWN.x - 14, Vehicle.rideHeight('sports') + 0.1, 5 * 72 + 3), Math.PI / 2, 'physics', 0xffd23f);
    this.vehicles.push(car);
    this.camYaw = Math.PI; // look north toward downtown

    window.addEventListener('resize', () => this.onResize());
    this.settings.onChange(() => this.applySettings());
    this.applySettings();
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.setState('paused');
    };
    this.env.hours = 18.2;
  }

  setState(s: GameState) {
    this.state = s;
    this.input.enabled = s === 'playing';
    if (s === 'playing') this.input.requestLock(); else this.input.exitLock();
    if (s !== 'playing') this.audio.silence();
    this.onStateChange?.(s);
  }

  onResize() {
    this.pipeline.resize();
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  applySettings() {
    const g = this.settings.gfx, gm = this.settings.game;
    this.pipeline.post = g.post;
    this.pipeline.setSamples(g.msaa);
    let sh = g.shadows;
    if (this.perf.shadowDowngrade) sh = ({ off: 'off', low: 'off', medium: 'low', high: 'medium' } as const)[sh];
    if (sh !== this.appliedShadow) {
      this.appliedShadow = sh;
      const cfg = SHADOW_CFG[sh];
      this.renderer.shadowMap.enabled = cfg.size > 0;
      this.env.setShadows(cfg.size, cfg.radius);
      this.city.setShadows(cfg.size > 0);
      this.vehicleRenderer.setShadows(cfg.size > 0);
      this.characters.setShadows(cfg.size > 0);
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true)); });
    }
    this.env.setReflections(g.reflections === 'basic');
    this.env.setDrawDistance(DRAW_DISTANCE[g.drawDistance]);
    this.camera.fov = gm.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setVolume(gm.volume);
    this.traffic.despawn = Math.min(320, DRAW_DISTANCE[g.drawDistance] * 0.75);
    document.getElementById('fps')!.classList.toggle('hidden', !gm.showFps);
    document.getElementById('perf')!.classList.toggle('hidden', !gm.showPerf);
    this.envTimer = 0;
  }

  get drawDistance() { return DRAW_DISTANCE[this.settings.gfx.drawDistance]; }

  addMoney(n: number) { this.money += n; this.audio.money(); this.missions.save(); }

  start() {
    this.audio.unlock();
    this.setState('playing');
    if (!this.missions.completed.size) {
      this.hud.help('Welcome to <b>Vice Paradise</b>!<br>Yellow <b>S</b> blips on the map are missions — walk into the marker and press <b>E</b>.<br>Your ride is parked right behind you. Press <b>F</b> to get in.', 9);
    }
  }

  /** Nearest vehicle the player can enter. */
  nearestEnterable(): Vehicle | null {
    let best: Vehicle | null = null, bd = 1e9;
    for (const v of this.vehicles) {
      if (v.destroyed || v.burnTimer >= 0 || v.sunk) continue;
      const d = v.curPos.distanceTo(this.player.pos);
      if (d < v.spec.length / 2 + 2.0 && d < bd) { bd = d; best = v; }
    }
    return best;
  }

  onPlayerDeath() {
    this.deathKind = 'wasted';
    this.deathTimer = 4.5;
    this.state = 'dead';
    this.hud.bigText('Wasted', '', 'wasted', 4.5);
    this.audio.wasted();
    this.missions.onPlayerWasted();
  }
  onBusted() {
    this.deathKind = 'busted';
    this.deathTimer = 4;
    this.state = 'dead';
    this.player.dead = true;
    this.hud.bigText('Busted', '', 'busted', 4);
    this.audio.wantedUp();
    this.missions.onPlayerBusted();
  }

  private respawnAfterDeath() {
    const busted = this.deathKind === 'busted';
    const at = busted ? this.layout.policeStation : this.layout.hospital;
    const fee = Math.min(this.money, busted ? 800 : 500);
    this.money -= fee;
    if (this.player.inVehicle) this.player.exitVehicle();
    this.player.respawn(new THREE.Vector3(at.x, 0.3, at.z));
    this.city.forceColliders(at.x, at.z, 200);
    this.police.clear();
    if (busted) for (const s of this.weapons.slots) if (s.def.id !== 'pistol') s.reserve = Math.floor(s.reserve / 2);
    for (const p of this.peds.pool) if (p.active && p.kind === 'cop' && p.state === 'combat') this.peds.release(p);
    for (const v of this.vehicles) if (v.driver === 'police') v.aiState.despawn = 1;
    this.camYaw = 0;
    this.state = 'playing';
    this.hud.notify(`${busted ? 'Bail' : 'Hospital bill'}: ${formatMoney(fee)}`);
    this.missions.save();
  }

  /* --------------------------------------------------------------------------------------- input */
  private handleInput(dt: number) {
    const inp = this.input, pl = this.player, gm = this.settings.game;
    if (inp.hit('F2')) this.settings.setGame('showFps', !gm.showFps);
    if (inp.hit('F3')) this.settings.setGame('showPerf', !gm.showPerf);
    if (this.state !== 'playing') return;

    const sens = 0.0022 * gm.mouseSensitivity * (pl.aiming ? 0.6 : 1);
    if (inp.mouseDX || inp.mouseDY) this.camIdle = 0; else this.camIdle += dt;
    this.camYaw -= inp.mouseDX * sens;
    this.camPitch = clamp(this.camPitch + inp.mouseDY * sens * (gm.invertY ? -1 : 1), -0.9, 1.2);

    if (inp.hit('KeyM')) { this.hud.openBigMap(); this.setState('map'); return; }
    if (inp.hit('KeyP')) { this.setState('paused'); return; }
    this.timeBoost = inp.down('KeyT');
    if (inp.hit('Backspace')) this.missions.abandon();
    if (pl.dead) return;

    if (inp.hit('KeyF')) {
      if (pl.inVehicle) pl.exitVehicle();
      else { const v = this.nearestEnterable(); if (v) { pl.enterVehicle(v); this.camYaw = v.yaw; this.camPitch = 0.16; } }
    }
    if (inp.hit('KeyE')) { const m = this.missions.giverNear(); if (m) this.missions.start(m); }

    if (pl.inVehicle && pl.vehicle) {
      const v = pl.vehicle;
      v.throttle = inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0;
      v.brakeIn = inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0;
      v.steer = (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0) - (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0);
      v.handbrake = inp.down('Space');
      v.horn = inp.down('KeyH') ? 0.1 : v.horn;
      if (v.upright < 0.3 && Math.abs(v.speedMs) < 2) { v.aiState.flip = (v.aiState.flip ?? 0) + dt; if (v.aiState.flip > 2) { v.unflip(); v.aiState.flip = 0; } }
    } else {
      pl.moveX = inp.axis('KeyA', 'KeyD');
      pl.moveZ = inp.axis('KeyS', 'KeyW');
      pl.wantSprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
      if (inp.hit('Space')) pl.wantJump = true;
      pl.aiming = inp.rmb;
      pl.camYaw = this.camYaw;
      for (let i = 0; i < 5; i++) if (inp.hit(`Digit${i + 1}`)) this.weapons.select(i);
      if (inp.wheel) this.weapons.cycle(inp.wheel > 0 ? 1 : -1);
      if (inp.hit('KeyR')) this.weapons.reload();
      // shooting turns the character toward the aim direction
      if (inp.lmb) { pl.aiming = pl.aiming || this.weapons.slot.def.id !== 'fist'; }
      this.weapons.update(dt, inp.lmb, inp.lmbPressed, this.camera);
    }
    pl.armed = !pl.inVehicle && this.weapons.slot.def.id !== 'fist';
  }

  /* --------------------------------------------------------------------------------------- simulation */
  private fixedStep(dt: number) {
    const pl = this.player;
    pl.fixedUpdate(dt);
    // obstacles for traffic look-ahead
    this.obstacles.clear();
    let oi = 0;
    const ob = (x: number, z: number, isPlayer: boolean, isTraffic: boolean, id: number) => {
      const o = this.obstaclePool[oi] ?? (this.obstaclePool[oi] = { x: 0, z: 0, isPlayer: false, isTraffic: false, id: 0 });
      oi++;
      o.x = x; o.z = z; o.isPlayer = isPlayer; o.isTraffic = isTraffic; o.id = id;
      this.obstacles.insert(x, z, o);
    };
    for (const v of this.vehicles) ob(v.curPos.x, v.curPos.z, v.driver === 'player', v.mode === 'traffic', v.id);
    if (!pl.inVehicle) ob(pl.pos.x, pl.pos.z, true, false, -1);
    for (const p of this.peds.pool) if (p.active && p.state !== 'dead' && (p.state === 'combat' || p.state === 'flee' || p.state === 'knocked')) ob(p.pos.x, p.pos.z, false, false, -2);
    this.traffic.fixedUpdate(dt, this.vehicles, pl.pos, this.obstacles);
    for (const v of this.vehicles) {
      if (v.mode !== 'physics') continue;
      if (v.driver === 'police') this.police.drive(v, dt);
      else if (v.driver === 'none' || v.driver === 'npc') { v.throttle = 0; v.brakeIn = 0; v.steer = 0; }
      // simplified physics far away: let distant idle vehicles sleep
      if (v.driver !== 'player' && v.driver !== 'police' && v.curPos.distanceToSquared(pl.pos) > 150 * 150) { if (!v.body.isSleeping()) v.body.sleep(); continue; }
      v.fixedUpdate(dt);
    }
    this.physics.step();
    this.physics.events.drainContactForceEvents((e) => {
      const a = this.physics.owners.get(e.collider1()), b = this.physics.owners.get(e.collider2());
      const f = e.totalForceMagnitude();
      for (const [x, y] of [[a, b], [b, a]] as const) {
        if (!(x instanceof Vehicle)) continue;
        const dmg = Math.max(0, (f - x.spec.mass * 40) / (x.spec.mass * 6));
        if (dmg < 2) continue;
        if (this.time - x.lastImpact > 0.25) {
          this.audio.crash(x.curPos, dmg / 60);
          this.effects.sparks(_v.copy(x.curPos).setY(x.curPos.y + 0.3), _w.set(0, 1, 0), 4);
          if (x.driver === 'player') this.effects.addShake(Math.min(0.8, dmg / 120));
        }
        x.lastImpact = this.time;
        x.damage(dmg);
        if (y instanceof Vehicle) {
          if (x.driver === 'player') {
            y.lastHitByPlayer = this.time;
            if (y.mode === 'traffic') { y.speed *= 0.5; y.makeDynamic(); y.driver = 'npc'; }
            // only the player's fault if they were the faster car
            if (y.kind === 'police' && (y.driver === 'police' || y.sirenOn) && dmg > 15 && Math.abs(x.speedMs) > Math.abs(y.speedMs) + 3) this.police.reportCrime('hitCop', y.curPos);
          }
        }
      }
    });
    for (const v of this.vehicles) v.syncFromBody();
    pl.syncFromBody();
  }

  private updateVehicles(dt: number) {
    const pl = this.player;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      // fire & explosion
      if (v.burnTimer >= 0 && !v.destroyed) {
        v.burnTimer -= dt;
        _v.copy(v.curPos); _v.y += 0.8;
        this.effects.fire(_v);
        if (Math.random() < 0.5) this.effects.vehicleSmoke(_v, true);
        if (v.burnTimer <= 0) this.explode(v);
      } else if (!v.destroyed && v.health < v.spec.maxHealth * 0.35 && Math.random() < dt * 8) {
        _v.set(0, 0.4, v.spec.length * 0.35).applyQuaternion(v.curQuat).add(v.curPos);
        this.effects.vehicleSmoke(_v, v.health < v.spec.maxHealth * 0.15);
      }
      if (v.destroyed) v.wreckAge += dt;
      if (v.sunk && pl.vehicle === v) { pl.exitVehicle(); }
      if (v.horn > 0) v.horn -= dt;
      // safety net: a body that went non-finite is reset to the nearest road instead of corrupting the sim
      if (!Number.isFinite(v.curPos.x + v.curPos.y + v.curPos.z)) {
        v.teleport(new THREE.Vector3(Math.round(pl.pos.x / 72) * 72 + 3, 1.2, Math.round(pl.pos.z / 72) * 72 + 30), 0);
        v.aiState = {}; v.aiState.despawn = v.driver !== 'player' ? 1 : 0;
      }
      // despawn
      const d = v.curPos.distanceTo(pl.pos);
      const isPlayers = pl.vehicle === v;
      const missionV = this.missions.vehicles.size > 0 && [...this.missions.vehicles.values()].includes(v);
      let remove = false;
      if (!isPlayers && !missionV) {
        if (v.aiState.despawn && d > 40) remove = true;
        else if (v.mode === 'traffic' && d > this.traffic.despawn) remove = true;
        else if (v.mode === 'physics' && !v.persistent && d > (v.driver === 'police' ? 320 : 230)) remove = true;
        else if ((v.destroyed && v.wreckAge > 45 && d > 50) || (v.sunk && d > 30)) remove = true;
        else if (this.police.roadblock.includes(v) && d > 260) remove = true;
      }
      if (remove) {
        v.dispose();
        this.vehicles.splice(i, 1);
        const rb = this.police.roadblock.indexOf(v);
        if (rb >= 0) this.police.roadblock.splice(rb, 1);
      }
    }
  }

  private explode(v: Vehicle) {
    v.destroyed = true; v.burnTimer = -1; v.sirenOn = false;
    _v.copy(v.curPos);
    this.effects.explosion(_v);
    this.audio.explosion(_v);
    this.peds.panic(_v, 50);
    const byPlayer = this.time - v.lastHitByPlayer < 10 || v.driver === 'player';
    if (v.mode === 'physics') v.body.applyImpulse({ x: (Math.random() - 0.5) * 2000, y: v.spec.mass * 6, z: (Math.random() - 0.5) * 2000 }, true);
    for (const p of this.peds.pool) if (p.active && p.state !== 'dead' && p.pos.distanceTo(_v) < 8) this.peds.damage(p, 200, byPlayer);
    for (const o of this.vehicles) {
      if (o === v) continue;
      const d = o.curPos.distanceTo(_v);
      if (d < 9) {
        o.damage(400 * (1 - d / 9));
        if (o.mode === 'traffic') { o.makeDynamic(); o.driver = 'npc'; }
        if (o.mode === 'physics') { _w.subVectors(o.curPos, _v).normalize().multiplyScalar(o.spec.mass * 8 * (1 - d / 9)); o.body.applyImpulse({ x: _w.x, y: o.spec.mass * 4, z: _w.z }, true); }
      }
    }
    const pd = this.player.pos.distanceTo(_v);
    if (this.player.vehicle === v) this.player.damage(500, null);
    else if (pd < 9) this.player.damage(90 * (1 - pd / 9), _v);
    if (v.kind === 'police' && byPlayer) this.police.reportCrime('killCop', _v);
  }

  /* --------------------------------------------------------------------------------------- camera */
  private updateCamera(dt: number) {
    const pl = this.player, cam = this.camera;
    const shake = this.effects.takeShake(dt);
    let target: THREE.Vector3, dist: number, height: number, side = 0;
    if (this.state === 'menu') {
      this.menuAngle += dt * 0.04;
      const cx = 520, cz = 330;
      cam.position.set(cx + Math.cos(this.menuAngle) * 260, 95 + Math.sin(this.menuAngle * 0.7) * 20, cz + Math.sin(this.menuAngle) * 260);
      cam.lookAt(cx, 40, cz);
      return;
    }
    if (pl.inVehicle && pl.vehicle) {
      const v = pl.vehicle;
      target = _v.copy(v.pos); target.y += 1.4;
      dist = 5.5 + v.spec.length * 0.6;
      height = 0.18;
      // auto-recentre behind the car when the mouse is idle
      const sp = v.speedMs;
      if (this.camIdle > 1.2 && Math.abs(sp) > 3) {
        const behind = v.yaw + (sp < -1 ? Math.PI : 0); // chase view looks along the direction of travel
        this.camYaw += angleDiff(this.camYaw, behind) * damp(2.5, dt);
        this.camPitch += (0.16 - this.camPitch) * damp(2, dt);
      }
      if (this.input.down('KeyC')) { this.camYaw = v.yaw + Math.PI; } // look behind
      cam.fov = lerp(cam.fov, this.settings.game.fov + clamp(Math.abs(sp) / 45, 0, 1) * 12, damp(3, dt));
    } else {
      target = _v.copy(pl.pos); target.y += pl.dead ? 0.6 : 1.55;
      const aim = pl.aim;
      dist = lerp(4.4, 2.1, aim);
      side = lerp(0.35, 0.75, aim);
      height = 0;
      cam.fov = lerp(cam.fov, this.settings.game.fov - aim * 15, damp(8, dt));
    }
    cam.updateProjectionMatrix();
    this.camDist = lerp(this.camDist, dist, damp(4, dt));
    const yaw = this.camYaw, pitch = this.camPitch + height;
    // camera sits behind the look direction: forward = (sin yaw, cos yaw)
    const back = _w.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const pivot = target.clone().addScaledVector(right, side);
    // collision: pull the camera in front of walls
    let d = this.camDist;
    const hit = this.physics.raycast(pivot, back, d + 0.3, GROUPS.qStatic);
    if (hit) d = Math.max(0.6, hit.dist - 0.3);
    const desired = pivot.clone().addScaledVector(back, d);
    desired.y = Math.max(desired.y, -0.2);
    this.camPos.copy(desired);
    cam.position.copy(this.camPos);
    if (shake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3));
    cam.lookAt(pivot.x + Math.sin(yaw) * 10 * Math.cos(this.camPitch), pivot.y - Math.sin(this.camPitch) * 10 + 0.6, pivot.z + Math.cos(yaw) * 10 * Math.cos(this.camPitch));
  }

  /* --------------------------------------------------------------------------------------- main loop */
  frame(tMs: number) {
    const t = tMs / 1000;
    let dt = this.lastT ? t - this.lastT : 1 / 60;
    this.lastT = t;
    this.perf.push(dt * 1000);
    dt = Math.max(0, Math.min(dt, 0.1));
    this.renderer.info.reset();

    this.handleInput(dt);
    const running = this.state === 'playing' || this.state === 'dead' || this.state === 'menu';
    if (running) {
      this.time += dt;
      const pl = this.player;
      if (this.state === 'dead') {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.respawnAfterDeath();
      }
      // fixed timestep physics
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= this.physics.dt && steps < 4) {
        this.fixedStep(this.physics.dt);
        this.accumulator -= this.physics.dt;
        steps++;
      }
      if (steps === 4) this.accumulator = 0;
      const alpha = this.accumulator / this.physics.dt;
      for (const v of this.vehicles) v.interpolate(alpha);
      pl.interpolate(alpha, dt);

      this.lights.update(dt);
      this.updateVehicles(dt);
      const gfx = this.settings.gfx;
      this.traffic.target = Math.round(TRAFFIC_COUNT[gfx.traffic] * this.perf.density);
      let trafficCount = 0;
      for (const v of this.vehicles) if (v.mode === 'traffic') trafficCount++;
      if (trafficCount < this.traffic.target) this.traffic.trySpawn(this.vehicles, pl.pos, this.state === 'menu' ? null : this.frustum, trafficCount < this.traffic.target * 0.5 ? 40 : this.traffic.spawnMin, this.traffic.despawn - 20);
      this.peds.update(dt, this.frustum, Math.round(PED_COUNT[gfx.pedestrians] * this.perf.density));
      this.police.update(dt, this.frustum);
      this.missions.update(dt);
      this.pickups.update(dt, this.time);
      this.displayMoney += (this.money - this.displayMoney) * damp(6, dt);
      if (Math.abs(this.money - this.displayMoney) < 1) this.displayMoney = this.money;
      this.zoneName = zoneName(pl.pos.x, pl.pos.z);
    }

    this.updateCamera(dt);
    this.camera.updateMatrixWorld();
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);

    // world rendering systems
    const timeScale = this.state === 'menu' ? 0.3 : this.settings.game.timeScale * (this.timeBoost ? 30 : 1);
    if (this.state !== 'paused' && this.state !== 'map') this.env.update(dt, timeScale, this.time, this.camera, this.state === 'menu' ? this.camera.position : this.player.pos);
    const focus = this.state === 'menu' ? new THREE.Vector3(520, 0, 330) : this.player.pos;
    this.city.update(this.camera.position, focus, this.drawDistance, this.env.night, this.state === 'menu' ? 2 : 1);
    this.vehicleRenderer.update(this.vehicles, this.frustum, this.camera.position, this.drawDistance, this.time, this.env.night);
    this.visuals.length = 0;
    this.visuals.push(this.player);
    for (const p of this.peds.pool) if (p.active) this.visuals.push(p);
    this.characters.update(this.visuals, this.frustum, this.camera.position, 160);
    this.markers.update(this.time);
    if (running) this.effects.update(dt, this.pipeline.pixelSize.h);

    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 6;
      const su = this.env.skyUniforms;
      this.vehicleRenderer.updateEnvMap(this.renderer, su.zenith.value, su.horizon.value, this.env.hemi.groundColor, this.env.sunDir, su.sunColor.value, this.settings.gfx.reflections === 'basic');
    }

    // audio
    const pl = this.player;
    this.audio.setListener(this.camera.position);
    let sirenD = 1e9;
    for (const v of this.vehicles) if (v.sirenOn) sirenD = Math.min(sirenD, v.curPos.distanceTo(pl.pos));
    let horn = false;
    for (const v of this.vehicles) if (v.horn > 0 && v.curPos.distanceTo(pl.pos) < 40) horn = true;
    if (this.state === 'playing' || this.state === 'dead') {
      const v = pl.vehicle;
      this.audio.update(!!v && !v.destroyed, v ? clamp(Math.abs(v.speedMs) / v.spec.maxSpeed, 0, 1) : 0, v ? v.throttle : 0, sirenD, horn, this.time);
      this.hud.update(dt, this.time);
    }
    if (this.state === 'map') this.hud.drawBigMap(this.time);

    // dynamic resolution / auto-adjust
    if (this.perf.autoAdjust(dt, this.settings.gfx.targetFps, this.settings.gfx.resolutionScale, this.settings.gfx.autoAdjust && this.state === 'playing')) this.applySettings();
    this.pipeline.scale = this.settings.gfx.autoAdjust ? this.perf.dynScale : this.settings.gfx.resolutionScale;
    if (!this.settings.gfx.autoAdjust) this.perf.dynScale = this.settings.gfx.resolutionScale;

    if (!this.skipRender) this.pipeline.render(this.scene, this.camera, this.time);
    this.updatePerfOverlay(dt);
    this.input.endFrame();
  }

  private updatePerfOverlay(dt: number) {
    const gm = this.settings.game;
    if (!gm.showFps && !gm.showPerf) return;
    this.perf.stats();
    const fpsEl = document.getElementById('fps')!;
    if (gm.showFps) fpsEl.textContent = `${Math.round(this.perf.fps)} FPS`;
    if (!gm.showPerf) return;
    this.memTimer -= dt;
    if (this.memTimer <= 0) { this.memTimer = 2; this.memEstimate = this.estimateGpuMemory(); }
    const info = this.renderer.info;
    const npcs = this.peds.activeCount;
    const ps = this.pipeline.pixelSize;
    const gl = this.renderer.getContext();
    const compressed = ['WEBGL_compressed_texture_s3tc', 'EXT_texture_compression_bptc', 'WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc'].filter((e) => gl.getSupportedExtensions()?.includes(e)).map((e) => e.split('_').pop()).join(', ') || 'none';
    const gfx = this.settings.gfx;
    document.getElementById('perf')!.textContent =
      `VICE PARADISE — PERFORMANCE (F3)\n` +
      `FPS            ${this.perf.fps.toFixed(0)}   avg ${this.perf.avgFps.toFixed(0)}   1% low ${this.perf.low1.toFixed(0)}\n` +
      `Frame time     ${this.perf.frameMs.toFixed(2)} ms\n` +
      `Draw calls     ${info.render.calls}\n` +
      `Triangles      ${(info.render.triangles / 1000).toFixed(1)}k\n` +
      `Active NPCs    ${npcs} (combat ${this.peds.combatCount}, drawn ${this.characters.drawn - 1})\n` +
      `Vehicles       ${this.vehicles.length} (drawn ${this.vehicleRenderer.drawn}, police ${this.police.unitCount})\n` +
      `World chunks   ${this.city.loadedCount} loaded / ${this.city.physicsChunks} with physics\n` +
      `Static colliders ${this.physics.staticCount}  Particles ${this.effects.particleCount}\n` +
      `Render res     ${ps.w}x${ps.h} (${Math.round(this.pipeline.scale * 100)}%)  MSAA ${gfx.msaa}x\n` +
      `Preset         ${gfx.preset}  shadows ${this.appliedShadow}  post ${gfx.post}\n` +
      `Auto-adjust    ${gfx.autoAdjust ? 'on' : 'off'}  density ${Math.round(this.perf.density * 100)}%  last: ${this.perf.lastAdjust}\n` +
      `GPU memory     ~${(this.memEstimate / 1048576).toFixed(0)} MB (ESTIMATE, not measured)\n` +
      `GPU            ${this.pipeline.gpuName.slice(0, 48)}\n` +
      `WebGL2 ${this.pipeline.isWebGL2 ? 'yes' : 'no'}  compressed tex: ${compressed}\n` +
      `OS             ${this.os}`;
  }

  /** Rough GPU memory estimate: geometry buffers + textures + render targets + shadow map. */
  private estimateGpuMemory() {
    let bytes = 0;
    const seen = new Set<THREE.BufferGeometry>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry || seen.has(m.geometry)) return;
      seen.add(m.geometry);
      for (const a of Object.values(m.geometry.attributes)) bytes += (a as THREE.BufferAttribute).array?.byteLength ?? 0;
      if (m.geometry.index) bytes += m.geometry.index.array.byteLength;
      if (o instanceof THREE.InstancedMesh) { bytes += o.instanceMatrix.array.byteLength; if (o.instanceColor) bytes += o.instanceColor.array.byteLength; }
    });
    bytes += this.city.estimateBytes();
    bytes += this.pipeline.estimateTargetBytes();
    const sm = this.env.sun.shadow.mapSize.x;
    if (this.renderer.shadowMap.enabled) bytes += sm * sm * 4;
    bytes += 6 * 256 * 256 * 8; // reflection PMREM
    return bytes;
  }

  /** Debug hook for automated tests. */
  debugState() {
    const pl = this.player;
    return {
      state: this.state, pos: pl.pos.toArray().map((n) => +n.toFixed(2)), inVehicle: pl.inVehicle,
      speed: +pl.speed.toFixed(2), health: pl.health, wanted: this.police.wanted, vehicles: this.vehicles.length,
      traffic: this.vehicles.filter((v) => v.mode === 'traffic').length, peds: this.peds.activeCount,
      chunks: this.city.loadedCount, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles,
      fps: +this.perf.fps.toFixed(1), mission: this.missions.active?.id ?? null, objective: this.missions.objective, money: this.money,
      police: this.police.unitCount, hours: +this.env.hours.toFixed(2), scale: this.pipeline.scale,
    };
  }
}

void WorldUniforms; void _q;
