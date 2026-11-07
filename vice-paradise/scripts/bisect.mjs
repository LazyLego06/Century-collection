import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.click('#btn-play');
await page.evaluate(() => { const g = window.game; g.setState('playing'); g.input.enabled = true; g.env.hours = 12; g.settings.gfx.autoAdjust = false; g.settings.setGfx('msaa', 0); });
const tests = JSON.parse(process.argv[2]);
const fs = await import('fs');
for (const [name, code] of tests) {
  await page.evaluate(code);
  await page.evaluate(() => { const g = window.game; g.camYaw = Math.PI*0.75; g.camPitch=0.15; });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `/tmp/shots/bs-${name}.png`, clip: { x: 470, y: 150, width: 170, height: 110 } });
}
await browser.close();
