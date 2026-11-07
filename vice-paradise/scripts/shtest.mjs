import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
p.on('console', m => console.log(m.text()));
await p.goto('http://localhost:5199/shtest.html'); await p.waitForFunction(() => window.done, null, { timeout: 60000 });
await p.screenshot({ path: '/tmp/shots/shtest.png' }); await b.close();
