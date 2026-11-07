import type { Settings, PresetName, GraphicsSettings, GameSettings } from '../core/Settings';

const $ = (id: string) => document.getElementById(id)!;

type Opt<T> = { label: string; value: T };

/** Builds the graphics/game settings panel from the Settings model. */
export class SettingsMenu {
  constructor(private settings: Settings) {
    this.build();
    settings.onChange(() => this.refresh());
  }

  private build() {
    const presets = $('presets');
    const names: [PresetName, string][] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']];
    presets.innerHTML = '';
    for (const [p, label] of names) {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.preset = p;
      b.onclick = () => this.settings.applyPreset(p);
      presets.appendChild(b);
    }
    this.refresh();
  }

  refresh() {
    const s = this.settings, g = s.gfx, gm = s.game;
    document.querySelectorAll<HTMLButtonElement>('#presets button').forEach((b) => b.classList.toggle('active', b.dataset.preset === g.preset));
    const grid = $('settings-grid');
    grid.innerHTML = '';
    const sel = <K extends keyof GraphicsSettings>(label: string, key: K, opts: Opt<GraphicsSettings[K]>[]) => {
      const row = document.createElement('div'); row.className = 'setting';
      row.innerHTML = `<span>${label}</span>`;
      const el = document.createElement('select');
      for (const o of opts) { const op = document.createElement('option'); op.value = String(o.value); op.textContent = o.label; if (o.value === g[key]) op.selected = true; el.appendChild(op); }
      el.onchange = () => { const o = opts[el.selectedIndex]; s.setGfx(key, o.value); };
      const v = document.createElement('span'); v.className = 'val'; v.appendChild(el); row.appendChild(v);
      grid.appendChild(row);
    };
    const range = (label: string, val: number, min: number, max: number, step: number, fmt: (v: number) => string, on: (v: number) => void) => {
      const row = document.createElement('div'); row.className = 'setting';
      row.innerHTML = `<span>${label}</span>`;
      const v = document.createElement('span'); v.className = 'val';
      const el = document.createElement('input'); el.type = 'range'; el.min = String(min); el.max = String(max); el.step = String(step); el.value = String(val);
      const num = document.createElement('span'); num.className = 'num'; num.textContent = fmt(val);
      el.oninput = () => { num.textContent = fmt(+el.value); };
      el.onchange = () => on(+el.value);
      v.append(el, num); row.appendChild(v); grid.appendChild(row);
    };
    const toggle = (label: string, val: boolean, on: (v: boolean) => void) => {
      const row = document.createElement('div'); row.className = 'setting';
      row.innerHTML = `<span>${label}</span>`;
      const el = document.createElement('select');
      el.innerHTML = `<option value="1"${val ? ' selected' : ''}>On</option><option value="0"${!val ? ' selected' : ''}>Off</option>`;
      el.onchange = () => on(el.value === '1');
      const v = document.createElement('span'); v.className = 'val'; v.appendChild(el); row.appendChild(v); grid.appendChild(row);
    };
    const lvl = [{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }] as const;

    range('Resolution scale', g.resolutionScale, 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => s.setGfx('resolutionScale', v));
    sel('Shadow quality', 'shadows', [{ label: 'Off', value: 'off' }, { label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }]);
    sel('Draw distance', 'drawDistance', [...lvl]);
    sel('Traffic density', 'traffic', [...lvl]);
    sel('Pedestrian density', 'pedestrians', [...lvl]);
    sel('Reflections', 'reflections', [{ label: 'Off', value: 'off' }, { label: 'Basic', value: 'basic' }]);
    sel('Post-processing', 'post', [{ label: 'Off', value: 'off' }, { label: 'Minimal', value: 'minimal' }, { label: 'Light (bloom)', value: 'light' }]);
    sel('Anti-aliasing (MSAA)', 'msaa', [{ label: 'Off', value: 0 }, { label: '2x', value: 2 }, { label: '4x', value: 4 }]);
    toggle('Auto performance adjust', g.autoAdjust, (v) => s.setGfx('autoAdjust', v));
    range('Target FPS', g.targetFps, 30, 144, 1, (v) => `${v}`, (v) => s.setGfx('targetFps', v));
    const gameToggle = (label: string, key: keyof GameSettings) => toggle(label, gm[key] as boolean, (v) => s.setGame(key, v as never));
    gameToggle('FPS counter (F2)', 'showFps');
    gameToggle('Performance overlay (F3)', 'showPerf');
    range('Mouse sensitivity', gm.mouseSensitivity, 0.2, 3, 0.1, (v) => v.toFixed(1), (v) => s.setGame('mouseSensitivity', v));
    gameToggle('Invert mouse Y', 'invertY');
    range('Field of view', gm.fov, 55, 95, 1, (v) => `${v}°`, (v) => s.setGame('fov', v));
    range('Volume', gm.volume, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => s.setGame('volume', v));
    range('Day length (min/real sec)', gm.timeScale, 0, 10, 0.5, (v) => (v === 0 ? 'paused' : `${v}`), (v) => s.setGame('timeScale', v));

    const note = document.createElement('div');
    note.className = 'setting-note';
    note.innerHTML = 'Medium is tuned as the default for a GTX 1050 Ti at 1080p. Ultra is intended for stronger GPUs. With auto-adjust on, resolution scale and world density are lowered automatically when the frame rate drops below the target and restored when there is headroom.';
    grid.appendChild(note);
  }
}
