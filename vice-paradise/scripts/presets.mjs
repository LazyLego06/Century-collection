// Applies each graphics preset and reports draw calls / triangles / render resolution at fixed viewpoints.
// NOTE: headless Chromium renders with SwiftShader (CPU), so FPS here says nothing about a GTX 1050 Ti.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.click('[data-act=settings]');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/shots/settings.png' });
await page.click('[data-act=settings-back]');
await page.evaluate(() => {
  const g = window.game;
  window.simT = performance.now() + 1e6;
  window.sim = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { window.simT += 1000 / 60; g.frame(window.simT); } };
  g.settings.gfx.autoAdjust = false; g.settings.game.timeScale = 0;
  g.start(); g.input.onLockChange = null; g.setState('playing');
  window.requestAnimationFrame = () => 0;
});
const views = [['downtown street', 432, 300, 0.3, 0.1], ['spawn / Pulse', 688, 352, 3.1, 0.2], ['beach', 900, 300, -1.57, 0.15]];
for (const p of ['low', 'medium', 'high', 'ultra']) {
  for (const [name, x, z, yaw, pitch] of views) {
    const r = await page.evaluate(({ p, x, z, yaw, pitch }) => {
      const g = window.game, V = g.player.pos.constructor;
      g.settings.applyPreset(p);
      g.player.teleport(new V(x, 0.3, z)); g.city.forceColliders(x, z, 200); g.env.hours = 14;
      g.skipRender = true; sim(2); g.skipRender = false; g.camYaw = yaw; g.camPitch = pitch; sim(0.3);
      const i = g.renderer.info;
      return { calls: i.render.calls, tris: i.render.triangles, res: g.pipeline.pixelSize, chunks: g.city.loadedCount, veh: g.vehicles.length, peds: g.peds.activeCount, draw: g.drawDistance };
    }, { p, x, z, yaw, pitch });
    console.log(`${p.padEnd(7)} ${name.padEnd(16)} calls=${String(r.calls).padStart(4)} tris=${(r.tris / 1000).toFixed(0).padStart(4)}k res=${r.res.w}x${r.res.h} chunks=${r.chunks} vehicles=${r.veh} peds=${r.peds} draw=${r.draw}m`);
  }
}
console.log('ERRORS: ' + (errors.length ? errors.join('\n') : 'none'));
await browser.close();
