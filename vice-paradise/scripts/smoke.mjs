// Headless smoke test: loads the built game, plays through basic interactions, captures screenshots + errors.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/tmp/shots';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/01-menu.png` });
const st = () => page.evaluate(() => window.game.debugState());
console.log('menu', JSON.stringify(await st()));
await page.click('#btn-play');
// headless has no pointer lock; force playing state
await page.evaluate(() => { window.game.setState('playing'); window.game.input.enabled = true; });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/02-onfoot.png` });
console.log('playing', JSON.stringify(await st()));
// walk forward
await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
console.log('walked', JSON.stringify(await st()));
// enter nearest car (teleport next to starter car first)
await page.evaluate(() => { const g = window.game; const v = g.vehicles[0]; const p = v.curPos.clone(); p.z -= 3; p.y = 0.25; g.player.teleport(p); });
await page.waitForTimeout(300);
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
console.log('in car', JSON.stringify(await st()));
await page.keyboard.down('KeyW'); await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/03-driving.png` });
console.log('driving', JSON.stringify(await st()));
await page.keyboard.down('KeyA'); await page.waitForTimeout(1200); await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyS'); await page.waitForTimeout(2000); await page.keyboard.up('KeyS');
console.log('after turn/brake', JSON.stringify(await st()));
// wanted level + police
await page.evaluate(() => window.game.police.setWanted(3));
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/04-wanted.png` });
console.log('wanted', JSON.stringify(await st()));
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
// shoot
await page.evaluate(() => { window.game.input.rmb = true; });
await page.mouse.move(640, 360);
await page.evaluate(() => { const i = window.game.input; i.lmb = true; i.lmbPressed = true; });
await page.waitForTimeout(400);
await page.evaluate(() => { const i = window.game.input; i.lmb = false; i.rmb = false; });
await page.screenshot({ path: `${out}/05-onfoot-wanted.png` });
console.log('shot', JSON.stringify(await st()));
// night + map + perf overlay
await page.evaluate(() => { const g = window.game; g.police.clear(); g.env.hours = 22; g.settings.setGame('showPerf', true); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/06-night-perf.png` });
await page.evaluate(() => { const g = window.game; g.hud.openBigMap(); g.setState('map'); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/07-map.png` });
console.log('final', JSON.stringify(await st()));
console.log('ERRORS:\n' + (errors.slice(0, 30).join('\n') || 'none'));
await browser.close();
