/** Frame timing, automatic quality scaling, and the developer overlay. */
export function detectOS(): string {
  const uad = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const p = (uad?.platform || navigator.platform || '').toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (p.includes('win') || ua.includes('windows')) return 'Windows';
  if (ua.includes('ubuntu')) return 'Ubuntu Linux';
  if (p.includes('linux') || ua.includes('linux')) return 'Linux';
  if (p.includes('mac') || ua.includes('mac os')) return 'macOS';
  return 'Unknown OS';
}

export class PerfMonitor {
  private samples = new Float32Array(240);
  private idx = 0;
  private count = 0;
  fps = 0;
  avgFps = 0;
  frameMs = 0;
  low1 = 0;
  // auto-adjust state
  dynScale = 1;
  density = 1; // multiplies traffic/ped targets
  shadowDowngrade = false;
  private checkTimer = 0;
  private badChecks = 0;
  private goodChecks = 0;
  private upgradeBlock = 0;
  private lastAction = '';
  lastAdjust = '—';

  push(dtMs: number) {
    this.samples[this.idx] = dtMs;
    this.idx = (this.idx + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    this.frameMs = this.frameMs * 0.9 + dtMs * 0.1;
    this.fps = 1000 / Math.max(1, this.frameMs);
  }

  private avgOver(n: number) {
    n = Math.min(n, this.count);
    if (!n) return 16.7;
    let s = 0;
    for (let i = 0; i < n; i++) s += this.samples[(this.idx - 1 - i + this.samples.length) % this.samples.length];
    return s / n;
  }

  stats() {
    const n = Math.min(this.count, 120);
    const arr: number[] = [];
    for (let i = 0; i < n; i++) arr.push(this.samples[(this.idx - 1 - i + this.samples.length) % this.samples.length]);
    arr.sort((a, b) => b - a);
    const worst = arr.slice(0, Math.max(1, Math.floor(n / 100)));
    const avg = this.avgOver(120);
    this.avgFps = 1000 / avg;
    this.low1 = 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length || 16.7);
  }

  /**
   * Called every frame. Returns true when something changed.
   * Down: resolution first (cheapest visual loss on a GPU-bound card), then world density, then shadows.
   * Up: in reverse order, with hysteresis and a cooldown after a failed upgrade to avoid oscillation.
   */
  autoAdjust(dt: number, targetFps: number, presetScale: number, enabled: boolean): boolean {
    if (!enabled) {
      const changed = this.dynScale !== presetScale || this.density !== 1 || this.shadowDowngrade;
      this.dynScale = presetScale; this.density = 1; this.shadowDowngrade = false;
      return changed;
    }
    if (this.dynScale > presetScale) { this.dynScale = presetScale; return true; }
    this.checkTimer += dt;
    this.upgradeBlock = Math.max(0, this.upgradeBlock - dt);
    if (this.checkTimer < 0.5) return false;
    this.checkTimer = 0;
    const target = 1000 / targetFps;
    const avg = this.avgOver(30);
    if (avg > target * 1.12) { this.badChecks++; this.goodChecks = 0; }
    else if (avg <= target * 1.03) { this.goodChecks++; this.badChecks = 0; }
    else { this.badChecks = 0; this.goodChecks = 0; }

    if (this.badChecks >= 3) {
      this.badChecks = 0;
      if (this.lastAction === 'up') this.upgradeBlock = 30;
      this.lastAction = 'down';
      if (this.dynScale > 0.56) { this.dynScale = Math.round((this.dynScale - 0.05) * 100) / 100; this.lastAdjust = `res → ${Math.round(this.dynScale * 100)}%`; return true; }
      if (this.density > 0.55) { this.density = Math.round((this.density - 0.15) * 100) / 100; this.lastAdjust = `density → ${Math.round(this.density * 100)}%`; return true; }
      if (!this.shadowDowngrade) { this.shadowDowngrade = true; this.lastAdjust = 'shadows reduced'; return true; }
      return false;
    }
    // with v-sync the frame time cannot drop below the refresh interval, so "good" means at/near target for a while
    if (this.goodChecks >= 16 && this.upgradeBlock <= 0) {
      this.goodChecks = 0;
      this.lastAction = 'up';
      if (this.shadowDowngrade) { this.shadowDowngrade = false; this.lastAdjust = 'shadows restored'; return true; }
      if (this.density < 1) { this.density = Math.min(1, Math.round((this.density + 0.15) * 100) / 100); this.lastAdjust = `density → ${Math.round(this.density * 100)}%`; return true; }
      if (this.dynScale < presetScale) { this.dynScale = Math.min(presetScale, Math.round((this.dynScale + 0.05) * 100) / 100); this.lastAdjust = `res → ${Math.round(this.dynScale * 100)}%`; return true; }
    }
    return false;
  }
}
