#!/usr/bin/env node
// Cross-platform launcher: detects Windows / Linux (Ubuntu) / macOS, builds the game if needed,
// serves the optimised production build and opens it in the default browser.
import { existsSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const platform = process.platform;
let osName = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
if (platform === 'linux') {
  try { const rel = execSync('cat /etc/os-release', { encoding: 'utf8' }); const m = rel.match(/^PRETTY_NAME="?([^"\n]+)/m); if (m) osName = m[1]; } catch { /* ignore */ }
}
console.log(`\n  VICE PARADISE launcher — detected ${osName} (${os.arch()}), Node ${process.version}`);
const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: platform === 'win32' });
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited with ${c}`))));
});

if (!existsSync('node_modules')) { console.log('  Installing dependencies (first run)…'); await run(npm, ['install']); }
if (!existsSync('dist/index.html') || process.argv.includes('--rebuild')) { console.log('  Building optimised production bundle…'); await run(npm, ['run', 'build']); }

const port = 4173;
const url = `http://localhost:${port}/`;
const { preview } = await import('vite');
const server = await preview({ preview: { port, strictPort: false, host: true } });
const addr = server.resolvedUrls?.local?.[0] ?? url;
console.log(`\n  Serving at ${addr}`);
const tips = {
  Windows: 'Use Chrome or Edge. If the GPU shown in the F3 overlay is not your GTX 1050 Ti, set the browser to "High performance" in Windows Settings > System > Display > Graphics.',
  Linux: 'Use Chrome/Chromium with the proprietary NVIDIA driver. Check chrome://gpu shows "WebGL2: Hardware accelerated"; if not, start Chrome with --ignore-gpu-blocklist.',
  macOS: 'Use Chrome or Safari.',
};
console.log(`  Tip: ${tips[platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux']}`);
console.log('  Press Ctrl+C to stop.\n');
if (!process.argv.includes('--no-open')) {
  try {
    if (platform === 'win32') spawn('cmd', ['/c', 'start', '""', addr], { detached: true, stdio: 'ignore' }).unref();
    else if (platform === 'darwin') spawn('open', [addr], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [addr], { detached: true, stdio: 'ignore' }).unref();
  } catch { console.log(`  Open ${addr} in your browser.`); }
}
