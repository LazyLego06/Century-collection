// Gameplay system test (headless): missions, police pursuit, combat, vehicle damage.
// Uses game time stepping (frame() calls with synthetic timestamps) so results don't depend on headless FPS.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else console.log('  [page]', m.text()); });
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
// take manual control of the loop: we'll advance simulated time deterministically
await page.evaluate(() => {
  const g = window.game;
  window.simT = performance.now() + 1e6;
  window.sim = (sec, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (fn) fn(i); window.simT += 1000 / 60; g.frame(window.simT); } };
  g.settings.gfx.autoAdjust = false; g.skipRender = true;
  g.start(); g.input.onLockChange = null; g.setState('playing');
  window.requestAnimationFrame = () => 0; // freeze the real loop
});
const S = (label) => page.evaluate((l) => { const d = window.game.debugState(); return l + ' ' + JSON.stringify(d); }, label).then(console.log);
const ok = (cond, msg) => console.log((cond ? 'PASS ' : 'FAIL ') + msg);

// 1) drive the starter car
let r = await page.evaluate(() => {
  const g = window.game; const v = g.vehicles[0];
  const p = v.curPos.clone(); p.z -= 3; p.y = 0.3; g.player.teleport(p); sim(0.2);
  g.input.pressed.add('KeyF'); sim(0.1);
  const inCar = g.player.inVehicle;
  g.input.keys.add('KeyW'); sim(4); g.input.keys.delete('KeyW');
  const sp = g.player.speed * 3.6;
  let minS = 1e9; g.input.keys.add('KeyS'); sim(3, () => { minS = Math.min(minS, g.player.vehicle.speedMs * 3.6); }); g.input.keys.delete('KeyS');
  return { inCar, sp, after: minS, pos: g.player.pos.toArray(), st: g.state, t: g.time };
});
console.log(JSON.stringify(r)); ok(r.inCar, 'enter vehicle'); ok(r.sp > 60, `accelerate (4s → ${r.sp.toFixed(0)} km/h)`); ok(r.after < 15, `brake (→ ${r.after.toFixed(0)} km/h)`);

// 2) traffic is moving
r = await page.evaluate(() => { const g = window.game; const t = g.vehicles.filter(v => v.mode === 'traffic'); const p0 = t.map(v => v.curPos.clone()); sim(3); let moved = 0; t.forEach((v, i) => { if (v.curPos.distanceTo(p0[i]) > 3) moved++; }); return { n: t.length, moved }; });
ok(r.moved > r.n * 0.4, `traffic moving (${r.moved}/${r.n})`);

// 3) wanted level + police pursuit + escape
r = await page.evaluate(() => {
  const g = window.game; g.police.setWanted(2); sim(12);
  const units = g.police.unitCount; const near = Math.min(...g.vehicles.filter(v => v.driver === 'police').map(v => v.curPos.distanceTo(g.player.pos)));
  return { units, near, wanted: g.police.wanted };
});
ok(r.units >= 1, `police dispatched (${r.units} units, nearest ${r.near?.toFixed?.(0)} m)`);
r = await page.evaluate(() => { const g = window.game; const pv = g.vehicles.filter(v => v.driver === 'police'); const p0 = Math.min(...pv.map(v => v.curPos.distanceTo(g.player.pos))); const log = []; sim(8, (i) => { if (i % 60 === 0) log.push(pv.map(v => `${v.driver}/${v.mode}/${v.curPos.distanceTo(g.player.pos).toFixed(0)}/${v.speedMs.toFixed(1)}/${g.vehicles.includes(v)}/${v.destroyed}`).join(' ')); }); console.log(log.join(' | ')); const p1 = Math.min(...g.vehicles.filter(v => v.driver === 'police').map(v => v.curPos.distanceTo(g.player.pos))); return { p0, p1 }; });
ok(r.p1 < r.p0 || r.p1 < 25, `police closing in (${r.p0.toFixed(0)} → ${r.p1.toFixed(0)} m)`);
r = await page.evaluate(() => {
  const g = window.game; g.player.exitVehicle(); sim(0.2);
  // teleport far away and hide: escape
  g.player.teleport(new g.player.pos.constructor(60, 0.3, 800)); g.city.forceColliders(60, 800, 200); sim(30);
  return { wanted: g.police.wanted };
});
ok(r.wanted === 0, `escape clears wanted level (now ${r.wanted})`);

// 4) combat: spawn a gang member, shoot him
r = await page.evaluate(() => {
  const g = window.game; g.player.teleport(new g.player.pos.constructor(72, 0.3, 780)); sim(0.3); const P = g.player.pos.clone();
  const e = g.peds.spawnCombat('gang', P.clone().add(new P.constructor(0, 0, 9)), 'test');
  sim(0.5);
  // aim camera at him
  g.camYaw = 0; g.camPitch = 0.05; sim(0.1);
  let shots = 0;
  for (let i = 0; i < 40 && e.state !== 'dead'; i++) { g.camYaw = Math.atan2(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z); g.input.rmb = true; g.input.lmb = true; g.input.lmbPressed = true; sim(0.25); shots++; }
  g.input.lmb = false; g.input.rmb = false; sim(0.5);
  return { dead: e.state === 'dead', shots, hp: g.player.health, wanted: g.police.wanted };
});
ok(r.dead, `enemy killed by gunfire (${r.shots} trigger pulls, player hp ${r.hp.toFixed(0)})`);

// 5) vehicle damage + explosion
r = await page.evaluate(() => {
  const g = window.game; const v = g.vehicles.find(v => v.mode === 'traffic');
  v.damage(5000); sim(6);
  return { destroyed: v.destroyed };
});
ok(r.destroyed, 'vehicle burns then explodes at 0 health');

// 6) mission: Ocean Drive Sprint start and first checkpoint
r = await page.evaluate(() => {
  const g = window.game; g.police.clear();
  const m = g.missions; const def = m.available().find(d => d.id === 'ocean_sprint');
  g.player.teleport(new g.player.pos.constructor(def.giver[0], 0.3, def.giver[1])); g.city.forceColliders(def.giver[0], def.giver[1], 200); sim(0.3);
  const near = m.giverNear()?.id; g.input.pressed.add('KeyE'); sim(0.2);
  const started = m.active?.id;
  sim(0.2);
  const car = m.vehicles.get('racer');
  const cp = car.curPos.clone(); cp.x += 3; g.player.teleport(cp.setY(0.3)); sim(0.1);
  g.input.pressed.add('KeyF'); sim(0.2);
  const step = m.stepIndex; const obj = m.objective; const timer = m.timer;
  // teleport car to first checkpoint
  const t = m.target; g.player.vehicle.teleport(t.clone().setY(1), 0); sim(0.5);
  return { near, started, inCar: g.player.vehicle === car, step, obj, timer, cp: m.cpIndex };
});
ok(r.near === 'ocean_sprint' && r.started === 'ocean_sprint', 'mission marker + start');
ok(r.inCar, 'mission vehicle entered'); ok(r.timer > 0, `mission timer running (${r.timer.toFixed(0)} s)`); ok(r.cp === 1, `checkpoint reached (cp ${r.cp})`);
r = await page.evaluate(() => {
  const g = window.game; const m = g.missions; let guard = 0;
  while (m.active && guard++ < 20) { const t = m.target; if (!t) { sim(0.2); continue; } g.player.vehicle.teleport(t.clone().setY(1), 0); sim(0.4); }
  return { active: m.active?.id ?? null, done: [...m.completed], money: g.money };
});
ok(r.done.includes('ocean_sprint'), `race mission passed (money ${r.money})`);

// 7) death & respawn
r = await page.evaluate(() => { const g = window.game; if (g.player.inVehicle) g.player.exitVehicle(); g.player.damage(500, null); const st = g.state; sim(6); return { st, after: g.state, hp: g.player.health }; });
ok(r.st === 'dead' && r.after === 'playing' && r.hp === 100, 'wasted → hospital respawn');

// 8) heat wave mission: 3-star escape setup
r = await page.evaluate(() => {
  const g = window.game; const m = g.missions; const def = m.available().find(d => d.id === 'heat_wave');
  g.player.teleport(new g.player.pos.constructor(def.giver[0], 0.3, def.giver[1])); g.city.forceColliders(def.giver[0], def.giver[1], 200); sim(0.3);
  m.start(def); sim(5);
  const car = m.vehicles.get('getaway'); g.player.teleport(car.curPos.clone().add(new car.curPos.constructor(0, 0, 3)).setY(0.3)); sim(0.1);
  g.player.enterVehicle(car); sim(0.5);
  return { wanted: g.police.wanted, step: m.active?.steps[m.stepIndex]?.type };
});
ok(r.wanted >= 3 && r.step === 'loseWanted', `police escape mission: ${r.wanted} stars, step ${r.step}`);
r = await page.evaluate(() => { const g = window.game; sim(3); return { rb: g.police.roadblock.length, units: g.police.unitCount }; });
ok(r.rb >= 2, `roadblock deployed at 3 stars (${r.rb} cruisers, ${r.units} pursuing units)`);
await S('final');
console.log('ERRORS: ' + (errors.length ? errors.slice(0, 10).join('\n') : 'none'));
await browser.close();
