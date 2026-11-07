import './styles.css';
import { Physics } from './core/Physics';
import { Game, GameState } from './core/Game';
import { SettingsMenu } from './ui/Menus';

const $ = (id: string) => document.getElementById(id)!;
const setLoad = (pct: number, text: string) => { ($('loadfill') as HTMLElement).style.width = `${pct}%`; $('loadtext').textContent = text; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function boot() {
  const canvas = $('game') as HTMLCanvasElement;
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    setLoad(0, 'WebGL2 is required. Please use an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.');
    return;
  }
  setLoad(10, 'Initialising physics');
  await Physics.init();
  await nextFrame();
  setLoad(35, 'Generating Vice Paradise');
  await nextFrame();
  const game = new Game(canvas);
  (window as unknown as { game: Game }).game = game;
  setLoad(70, 'Compiling shaders');
  await nextFrame();
  // warm up: render a few frames behind the loading screen so chunks stream in and shaders compile
  for (let i = 0; i < 12; i++) { game.frame(performance.now()); await nextFrame(); }
  setLoad(100, 'Ready');

  new SettingsMenu(game.settings);
  const screens = ['menu', 'pause', 'settings', 'controls', 'bigmap'];
  let returnTo: 'menu' | 'pause' = 'menu';
  const show = (id: string | null) => { for (const s of screens) $(s).classList.toggle('hidden', s !== id); };
  const hw = $('hwinfo');
  const gpu = game.pipeline.gpuName;
  const is1050 = /1050/i.test(gpu);
  hw.innerHTML = `Detected: <b>${game.os}</b> · ${gpu}<br>${is1050 ? 'GTX 1050 Ti profile: Medium preset with auto performance adjust (default).' : 'Default preset: Medium with automatic performance adjustment.'}<br>Press F3 in-game for the performance overlay.`;

  game.onStateChange = (s: GameState) => {
    $('hud').classList.toggle('hidden', s === 'menu');
    if (s === 'paused') {
      show('pause');
      const m = game.missions;
      $('pause-stats').innerHTML = `Money: $${game.money.toLocaleString()}<br>Missions completed: ${m.completed.size} / 6<br>Time: ${game.env.clock} · Zone: ${game.zoneName}`;
    } else if (s === 'map') show('bigmap');
    else if (s === 'playing' || s === 'dead') show(null);
    else if (s === 'menu') show('menu');
  };

  $('loading').classList.add('hidden');
  show('menu');

  document.body.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (!act) return;
    switch (act) {
      case 'play': game.start(); break;
      case 'resume': game.setState('playing'); break;
      case 'settings': returnTo = game.state === 'menu' ? 'menu' : 'pause'; show('settings'); break;
      case 'settings-back': show(returnTo); break;
      case 'controls': returnTo = game.state === 'menu' ? 'menu' : 'pause'; show('controls'); break;
      case 'controls-back': show(returnTo); break;
      case 'map': game.hud.openBigMap(); game.setState('map'); break;
      case 'quit': game.missions.abandon(); game.setState('menu'); break;
      case 'reset':
        if (confirm('Reset all mission progress and money?')) { game.missions.reset(); alert('Save reset.'); }
        break;
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyM') {
      if (game.state === 'map') { game.setState('playing'); game.input.pressed.clear(); e.preventDefault(); }
      else if (game.state === 'paused' && e.code === 'Escape') game.setState('playing');
    }
  });
  // clicking the canvas while paused resumes (pointer lock needs a user gesture)
  canvas.addEventListener('click', () => { if (game.state === 'paused') game.setState('playing'); });

  const loop = (t: number) => { game.frame(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  setLoad(0, `Failed to start: ${err?.message ?? err}`);
});
