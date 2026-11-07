export type PresetName = 'low' | 'medium' | 'high' | 'ultra';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type Level3 = 'low' | 'medium' | 'high';
export type ReflectionQ = 'off' | 'basic';
export type PostQ = 'off' | 'minimal' | 'light';

export interface GraphicsSettings {
  preset: PresetName | 'custom';
  resolutionScale: number; // 0.5 – 1.0
  shadows: ShadowQuality;
  drawDistance: Level3;
  traffic: Level3;
  pedestrians: Level3;
  reflections: ReflectionQ;
  post: PostQ;
  msaa: 0 | 2 | 4;
  autoAdjust: boolean;
  targetFps: number;
}

export interface GameSettings {
  showFps: boolean;
  showPerf: boolean;
  mouseSensitivity: number;
  invertY: boolean;
  fov: number;
  volume: number;
  timeScale: number; // game minutes per real second
}

export const PRESETS: Record<PresetName, Omit<GraphicsSettings, 'preset' | 'autoAdjust' | 'targetFps'>> = {
  low: { resolutionScale: 0.7, shadows: 'off', drawDistance: 'low', traffic: 'low', pedestrians: 'low', reflections: 'off', post: 'off', msaa: 0 },
  medium: { resolutionScale: 0.85, shadows: 'low', drawDistance: 'medium', traffic: 'medium', pedestrians: 'medium', reflections: 'basic', post: 'minimal', msaa: 2 },
  high: { resolutionScale: 1.0, shadows: 'medium', drawDistance: 'high', traffic: 'medium', pedestrians: 'medium', reflections: 'basic', post: 'light', msaa: 4 },
  // Ultra is offered for stronger GPUs; on a GTX 1050 Ti it is not expected to hold 60 FPS everywhere.
  ultra: { resolutionScale: 1.0, shadows: 'high', drawDistance: 'high', traffic: 'high', pedestrians: 'high', reflections: 'basic', post: 'light', msaa: 4 },
};

/** Concrete numbers derived from the abstract levels. */
export const DRAW_DISTANCE = { low: 320, medium: 470, high: 650 } as const;
export const TRAFFIC_COUNT = { low: 14, medium: 24, high: 34 } as const;
export const PED_COUNT = { low: 18, medium: 32, high: 46 } as const;
export const SHADOW_CFG = {
  off: { size: 0, radius: 0 },
  low: { size: 1024, radius: 34 },
  medium: { size: 2048, radius: 50 },
  high: { size: 2048, radius: 75 },
} as const;

const GFX_KEY = 'vp_gfx_v1';
const GAME_KEY = 'vp_game_v1';

export class Settings {
  gfx: GraphicsSettings;
  game: GameSettings;
  private listeners: (() => void)[] = [];

  constructor() {
    this.gfx = { preset: 'medium', ...PRESETS.medium, autoAdjust: true, targetFps: 60 };
    this.game = { showFps: true, showPerf: false, mouseSensitivity: 1, invertY: false, fov: 70, volume: 0.6, timeScale: 1 };
    try {
      const g = localStorage.getItem(GFX_KEY);
      if (g) Object.assign(this.gfx, JSON.parse(g));
      const s = localStorage.getItem(GAME_KEY);
      if (s) Object.assign(this.game, JSON.parse(s));
    } catch { /* storage unavailable */ }
  }

  applyPreset(p: PresetName) {
    Object.assign(this.gfx, PRESETS[p]);
    this.gfx.preset = p;
    this.changed();
  }

  setGfx<K extends keyof GraphicsSettings>(k: K, v: GraphicsSettings[K]) {
    this.gfx[k] = v;
    if (k !== 'autoAdjust' && k !== 'targetFps' && k !== 'preset') this.gfx.preset = 'custom';
    this.changed();
  }
  setGame<K extends keyof GameSettings>(k: K, v: GameSettings[K]) {
    this.game[k] = v;
    this.changed();
  }

  onChange(fn: () => void) { this.listeners.push(fn); }
  changed() {
    try {
      localStorage.setItem(GFX_KEY, JSON.stringify(this.gfx));
      localStorage.setItem(GAME_KEY, JSON.stringify(this.game));
    } catch { /* ignore */ }
    for (const l of this.listeners) l();
  }
}
