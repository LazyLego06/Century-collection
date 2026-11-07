// Renders a set of screenshots around the city for visual review.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '/tmp/shots';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.evaluate(() => {
  const g = window.game;
  window.simT = performance.now() + 1e6;
  window.sim = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { window.simT += 1000 / 60; g.frame(window.simT); } };
  g.settings.gfx.autoAdjust = false; g.settings.game.timeScale = 0;
  g.start(); g.input.onLockChange = null; g.setState('playing');
  window.requestAnimationFrame = () => 0;
  document.getElementById('hud-help').classList.add('hidden');
});
const shots = JSON.parse(process.argv[3]);
for (const [name, x, z, yaw, pitch, hours, extra] of shots) {
  await page.evaluate(({ x, z, yaw, pitch, hours, extra }) => {
    const g = window.game, V = g.player.pos.constructor;
    if (g.player.inVehicle) g.player.exitVehicle();
    g.player.teleport(new V(x, 0.3, z)); g.city.forceColliders(x, z, 200);
    g.env.hours = hours;
    g.skipRender = true; sim(1.5); g.skipRender = false;
    if (extra) eval(extra);
    g.camYaw = yaw; g.camPitch = pitch; sim(0.6);
  }, { x, z, yaw, pitch, hours, extra });
  await page.screenshot({ path: `${out}/t-${name}.png` });
}
await browser.close();
