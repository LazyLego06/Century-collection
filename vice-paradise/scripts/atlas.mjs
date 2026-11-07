import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('http://localhost:4173/');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
const url = await page.evaluate(() => {
  const t = window.game.city.atlas; const { data, width, height } = t.image;
  const c = document.createElement('canvas'); c.width = width; c.height = height; const x = c.getContext('2d');
  const id = x.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let i = 0; i < width * 4; i += 4) { const s = (height - 1 - y) * width * 4 + i, d = y * width * 4 + i; id.data[d] = data[s]; id.data[d+1] = data[s+1]; id.data[d+2] = data[s+2]; id.data[d+3] = 255; }
  x.putImageData(id, 0, 0); return c.toDataURL();
});
const fs = await import('fs'); fs.writeFileSync('/tmp/shots/atlas.png', Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
