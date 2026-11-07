// Drives every mission to completion through its step logic (teleporting between objectives).
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.evaluate(() => {
  const g = window.game; localStorage.clear(); g.missions.reset();
  window.simT = performance.now() + 1e6;
  window.sim = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { window.simT += 1000 / 60; g.frame(window.simT); } };
  g.settings.gfx.autoAdjust = false; g.skipRender = true;
  g.start(); g.input.onLockChange = null; g.setState('playing');
  window.requestAnimationFrame = () => 0;
});
const ids = ['neon_welcome', 'hot_delivery', 'ocean_sprint', 'heat_wave', 'cab_rush', 'turf_war'];
for (const id of ids) {
  const r = await page.evaluate((id) => {
    const g = window.game, m = g.missions, V = g.player.pos.constructor;
    const def = m.available().find((d) => d.id === id);
    if (!def) return { id, error: 'not available' };
    if (g.player.inVehicle) g.player.exitVehicle();
    g.player.teleport(new V(def.giver[0], 0.3, def.giver[1])); g.city.forceColliders(def.giver[0], def.giver[1], 200); sim(0.3);
    if (m.giverNear()?.id !== id) return { id, error: 'giver marker not detected' };
    g.input.pressed.add('KeyE'); sim(0.2);
    const trace = [];
    let guard = 0;
    while (m.active && guard++ < 200) {
      const s = m.active.steps[m.stepIndex];
      trace.push(s.type);
      if (s.type === 'getIn') { const v = m.vehicles.get(s.key); g.player.teleport(v.curPos.clone().setY(0.3)); g.player.enterVehicle(v); sim(0.3); }
      else if (s.type === 'goto' || s.type === 'checkpoints') {
        const t = m.target.clone();
        g.city.forceColliders(t.x, t.z, 150);
        if (g.player.inVehicle) { g.player.vehicle.teleport(t.setY(1.0), 0); sim(0.6); }
        else { g.player.teleport(t.setY(0.3)); sim(0.3); }
      }
      else if (s.type === 'kill') { for (const p of g.peds.pool) if (p.active && p.tag === s.tag && p.state !== 'dead') g.peds.damage(p, 999, true); sim(0.3); }
      else if (s.type === 'loseWanted') { g.police.setWanted(0); g.missions.onWantedCleared(); sim(0.3); }
      else sim(0.5);
    }
    return { id, passed: m.completed.has(id), active: m.active?.id ?? null, trace: trace.filter((x, i, a) => x !== a[i - 1]).join('>'), money: g.money, state: g.state };
  }, id);
  console.log((r.passed ? 'PASS ' : 'FAIL ') + JSON.stringify(r));
  await page.evaluate(() => sim(4.5));
}
console.log('ERRORS: ' + (errors.length ? errors.slice(0, 10).join('\n') : 'none'));
await browser.close();
