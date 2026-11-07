// Captures README screenshots (software-rendered in headless Chromium).
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'docs/screenshots';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.evaluate(() => { const g = window.game; g.settings.applyPreset('high'); g.settings.gfx.autoAdjust = false; g.settings.setGame('showFps', false); });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/menu.png` });
await page.evaluate(() => {
  const g = window.game;
  window.simT = performance.now() + 1e6;
  window.sim = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { window.simT += 1000 / 60; g.frame(window.simT); } };
  g.settings.game.timeScale = 0;
  g.start(); g.input.onLockChange = null; g.setState('playing');
  window.requestAnimationFrame = () => 0;
});
const shot = async (name, code) => {
  await page.evaluate(code);
  await page.evaluate(() => document.getElementById('hud-help').classList.add('hidden'));
  await page.screenshot({ path: `${out}/${name}.png` });
};
await shot('driving', `(() => { const g = window.game, V = g.player.pos.constructor; g.env.hours = 16.5;
  const v = new (g.vehicles[0].constructor)(g.physics, 'sports', new V(160, 0.6, 363), Math.PI / 2, 'physics', 0xff2fa0); g.vehicles.push(v);
  g.player.teleport(new V(160, 0.3, 360)); g.city.forceColliders(160, 360, 220); g.player.enterVehicle(v);
  g.skipRender = true; v.throttle = 1; for (let i = 0; i < 200; i++) { v.throttle = 1; sim(1/60); } g.skipRender = false; g.camYaw = v.yaw + 0.35; g.camPitch = 0.12; v.throttle = 1; sim(0.4); })()`);
await shot('pursuit', `(() => { const g = window.game, V = g.player.pos.constructor; g.env.hours = 19.2; g.skipRender = true; g.police.setWanted(3); sim(12);
  const pv = g.vehicles.filter(v => v.driver === 'police').sort((a, b) => a.curPos.distanceTo(g.player.pos) - b.curPos.distanceTo(g.player.pos))[0];
  g.skipRender = false; if (pv) { const c = pv.curPos; g.camYaw = Math.atan2(c.x - g.player.pos.x, c.z - g.player.pos.z); } g.camPitch = 0.12; g.camIdle = 0; sim(0.4); })()`);
await shot('night', `(() => { const g = window.game, V = g.player.pos.constructor; g.police.clear(); if (g.player.inVehicle) g.player.exitVehicle(); g.env.hours = 23; g.settings.setGfx('post', 'light');
  g.player.teleport(new V(720, 0.3, 432)); g.city.forceColliders(720, 432, 200); g.skipRender = true; sim(2); g.skipRender = false; g.camYaw = Math.PI * 1.15; g.camPitch = -0.05; sim(0.5); })()`);
await shot('beach', `(() => { const g = window.game, V = g.player.pos.constructor; g.env.hours = 10; g.settings.setGfx('post', 'light');
  g.player.teleport(new V(925, 0.3, 520)); g.city.forceColliders(925, 520, 200); g.skipRender = true; sim(2); g.skipRender = false; g.camYaw = -1.9; g.camPitch = 0.08; sim(0.5); })()`);
await shot('map', `(() => { const g = window.game; g.hud.openBigMap(); g.hud.bigMap.zoom = 1.0; g.hud.bigMap.cx = 470; g.hud.bigMap.cz = 430; g.setState('map'); sim(0.2); })()`);
await browser.close();
