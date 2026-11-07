import * as THREE from 'three';

const P_VERT = /* glsl */ `
attribute float size; attribute float alpha; attribute vec3 pcolor;
varying float vA; varying vec3 vC;
uniform float scale;
void main() {
  vA = alpha; vC = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const P_FRAG = /* glsl */ `
varying float vA; varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC, a);
}`;

/** Fixed-size pooled particle system (one draw call). */
class ParticlePool {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private life: Float32Array; private maxLife: Float32Array; private grow: Float32Array; private drag: Float32Array; private grav: Float32Array;
  private baseCol: Float32Array;
  private cursor = 0;
  alive = 0;

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.baseCol = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, gr: number, b: number, size: number, life: number, grow = 0, drag = 0.5, grav = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.baseCol[i * 3] = r; this.baseCol[i * 3 + 1] = gr; this.baseCol[i * 3 + 2] = b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt: number, viewportH: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = viewportH * 0.9;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = k;
      this.col[i * 3] = this.baseCol[i * 3]; this.col[i * 3 + 1] = this.baseCol[i * 3 + 1]; this.col[i * 3 + 2] = this.baseCol[i * 3 + 2];
    }
    this.alive = alive;
    const g = this.points.geometry;
    for (const a of ['position', 'pcolor', 'size', 'alpha']) (g.attributes[a] as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Pooled tracer lines. */
class TracerPool {
  lines: THREE.LineSegments;
  private pos: Float32Array; private col: Float32Array; private life: Float32Array;
  private cursor = 0;
  constructor(private n: number) {
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 6); this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
  }
  add(a: THREE.Vector3, b: THREE.Vector3) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
    this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    this.life[i] = 0.07;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] = Math.max(0, this.life[i] - dt);
      const k = this.life[i] / 0.07;
      this.col.set([3 * k, 2.4 * k, 1.2 * k, 0.6 * k, 0.4 * k, 0.2 * k], i * 6);
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.lines.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Effects {
  group = new THREE.Group();
  glow = new ParticlePool(700, true);
  smoke = new ParticlePool(500, false);
  tracers = new TracerPool(48);
  private shake = 0;

  constructor() {
    this.group.add(this.smoke.points, this.glow.points, this.tracers.lines);
  }

  get particleCount() { return this.glow.alive + this.smoke.alive; }

  muzzle(p: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 4; i++) this.glow.emit(p.x + dir.x * 0.1 * i, p.y + dir.y * 0.1 * i, p.z + dir.z * 0.1 * i, dir.x * 2, dir.y * 2, dir.z * 2, 4, 2.6, 1.0, 0.5 - i * 0.08, 0.05);
  }
  tracer(a: THREE.Vector3, b: THREE.Vector3) { this.tracers.add(a, b); }
  sparks(p: THREE.Vector3, n: THREE.Vector3, count = 6) {
    for (let i = 0; i < count; i++)
      this.glow.emit(p.x, p.y, p.z, n.x * 3 + (Math.random() - 0.5) * 5, n.y * 3 + Math.random() * 3, n.z * 3 + (Math.random() - 0.5) * 5, 3, 1.8, 0.6, 0.12, 0.25 + Math.random() * 0.2, 0, 1, 9);
    this.smoke.emit(p.x, p.y, p.z, n.x * 0.5, 0.4, n.z * 0.5, 0.45, 0.43, 0.4, 0.35, 0.6, 1.2, 1);
  }
  blood(p: THREE.Vector3) {
    for (let i = 0; i < 7; i++) this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.55, 0.02, 0.03, 0.18, 0.5, 0.2, 1, 9);
  }
  dust(p: THREE.Vector3, amount = 1) {
    if (Math.random() > amount) return;
    this.smoke.emit(p.x + (Math.random() - 0.5) * 0.5, p.y, p.z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 0.55, 0.52, 0.48, 0.5, 0.9, 1.5, 1.2);
  }
  vehicleSmoke(p: THREE.Vector3, heavy: boolean) {
    const c = heavy ? 0.12 : 0.5;
    this.smoke.emit(p.x + (Math.random() - 0.5) * 0.6, p.y, p.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6, c, c, c, 0.6, 1.6, 2.2, 0.6);
  }
  fire(p: THREE.Vector3) {
    this.glow.emit(p.x + (Math.random() - 0.5) * 1.2, p.y, p.z + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 0.5, 4, 1.6, 0.3, 0.9, 0.4 + Math.random() * 0.3, -1, 1);
  }
  explosion(p: THREE.Vector3) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, s = 4 + Math.random() * 10;
      this.glow.emit(p.x, p.y + 0.5, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, 6, 2.6 + Math.random(), 0.6, 1.4 + Math.random() * 1.6, 0.5 + Math.random() * 0.5, 2, 2.5, 2);
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 4;
      this.smoke.emit(p.x, p.y + 1, p.z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.1, 0.09, 0.09, 2.5, 2.5 + Math.random() * 2, 2.5, 0.8);
    }
    this.shake = Math.max(this.shake, 1);
  }
  addShake(v: number) { this.shake = Math.max(this.shake, v); }
  takeShake(dt: number) { const s = this.shake; this.shake = Math.max(0, this.shake - dt * 2.5); return s; }

  update(dt: number, viewportH: number) {
    this.glow.update(dt, viewportH);
    this.smoke.update(dt, viewportH);
    this.tracers.update(dt);
  }
}
