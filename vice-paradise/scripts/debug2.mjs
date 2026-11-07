import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.click('#btn-play');
await page.evaluate(() => { const g = window.game; g.setState('playing'); g.input.enabled = true; g.input.locked=false; g.env.hours = 12; g.settings.gfx.autoAdjust = false; g.camYaw = Math.PI*0.75; g.camPitch=0.15; });
const variants = [
  ['a-default', () => {}],
  ['b-nomsaa', () => { window.game.settings.setGfx('msaa', 0); }],
  ['c-scale1', () => { window.game.settings.setGfx('resolutionScale', 1); }],
];
for (const [name, fn] of variants) {
  await page.evaluate(`(${fn.toString()})()`);
  await page.evaluate(() => { const g = window.game; g.camYaw = Math.PI*0.75; g.camPitch=0.15; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/shots/${name}.png` });
}
await browser.close();
