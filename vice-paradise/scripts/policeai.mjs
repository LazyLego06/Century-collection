import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.evaluate(() => {
  const g = window.game;
  window.simT = performance.now() + 1e6;
  window.sim = (sec, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (fn) fn(i); window.simT += 1000 / 60; g.frame(window.simT); } };
  g.settings.gfx.autoAdjust = false; g.skipRender = true;
  g.start(); g.input.onLockChange = null; g.setState('playing');
  window.requestAnimationFrame = () => 0;
});
const trials = +(process.argv[2] || 6);
let reached = 0; const times = [];
for (let t = 0; t < trials; t++) {
  const r = await page.evaluate((t) => {
    const g = window.game, V = g.player.pos.constructor;
    g.police.clear();
    for (const v of [...g.vehicles]) if (v.driver === 'police' || v.kind === 'police') { v.aiState.despawn = 1; }
    sim(1);
    const spots = [[216, 300], [500, 150], [650, 750], [300, 700], [790, 430], [100, 100]];
    const [x, z] = spots[t % spots.length];
    g.player.teleport(new V(x, 0.3, z)); g.city.forceColliders(x, z, 200); sim(0.5);
    g.police.setWanted(2);
    const log = []; let first = -1;
    sim(30, (i) => {
      const units = g.vehicles.filter(v => v.driver === 'police');
      const cops = g.peds.pool.filter(p => p.active && p.kind === 'cop' && p.state === 'combat');
      const d = Math.min(...units.map(v => v.curPos.distanceTo(g.player.pos)), ...cops.map(p => p.pos.distanceTo(g.player.pos)));
      if (first < 0 && d < 15) first = i / 60;
      if (i % 120 === 0) log.push(`w${g.police.wanted}s${g.state}:` + units.map(v => `${v.curPos.distanceTo(g.player.pos).toFixed(0)}m/${v.speedMs.toFixed(0)}${(v.aiState.reverse ?? 0) > 0 ? 'R' : ''}${v.upright < 0.5 ? 'F' : ''}`).join(','));
    });
    return { spot: [x, z], first, log: log.join(' | ') };
  }, t);
  if (r.first >= 0) { reached++; times.push(r.first); }
  console.log(`trial ${t} at ${r.spot}: ${r.first >= 0 ? 'reached in ' + r.first.toFixed(1) + 's' : 'NOT reached'}  ${r.log}`);
}
console.log(`reached ${reached}/${trials}, mean ${(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)).toFixed(1)} s`);
await browser.close();
