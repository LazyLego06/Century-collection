import * as THREE from 'three';
import type { PostQ } from './Settings';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uvScale;      // portion of the scene target that holds the frame (dynamic resolution)
uniform vec2 uvMax;        // clamp to avoid bleeding past the valid region
uniform float bloomStrength;
uniform float grade;       // 0 = off, 1 = colour grade + vignette
uniform float exposure;
uniform float time;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 suv = min(vUv * uvScale, uvMax);
  vec3 col = texture2D(tScene, suv).rgb;
  if (bloomStrength > 0.0) col += texture2D(tBloom, suv).rgb * bloomStrength;
  col *= exposure;
  col = aces(col);
  if (grade > 0.5) {
    // warm "Miami" grade: lift shadows slightly toward purple, push highlights warm
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, 1.12);
    col += vec3(0.012, 0.0, 0.022) * (1.0 - l);
    col *= vec3(1.03, 1.0, 0.97);
    vec2 d = vUv - 0.5;
    col *= 1.0 - dot(d, d) * 0.75;
  }
  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene; uniform vec2 uvScale; uniform vec2 uvMax; uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, min(vUv * uvScale, uvMax)).rgb;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.6, l), 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc; uniform vec2 dir; uniform vec2 uvScale; uniform vec2 uvMax;
varying vec2 vUv;
void main() {
  vec2 uv = vUv * uvScale;
  vec3 c = texture2D(tSrc, min(uv, uvMax)).rgb * 0.2270270;
  c += texture2D(tSrc, min(uv + dir * 1.3846153, uvMax)).rgb * 0.3162162;
  c += texture2D(tSrc, max(uv - dir * 1.3846153, vec2(0.0))).rgb * 0.3162162;
  c += texture2D(tSrc, min(uv + dir * 3.2307692, uvMax)).rgb * 0.0702702;
  c += texture2D(tSrc, max(uv - dir * 3.2307692, vec2(0.0))).rgb * 0.0702702;
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * Renders the scene into an off-screen target with a dynamic viewport (dynamic resolution without
 * re-allocating), then upsamples to the canvas with tone mapping + optional grade and quarter-res bloom.
 */
export class RenderPipeline {
  renderer: THREE.WebGLRenderer;
  scale = 0.85;
  post: PostQ = 'minimal';
  exposure = 1.0;
  private sceneRT!: THREE.WebGLRenderTarget;
  private bloomA!: THREE.WebGLRenderTarget;
  private bloomB!: THREE.WebGLRenderTarget;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private finalMat: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  private samples = 0;
  isWebGL2 = true;
  gpuName = 'Unknown GPU';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const gl = this.renderer.getContext();
    this.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) this.gpuName = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch { /* ignore */ }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uvScale: { value: new THREE.Vector2(1, 1) }, uvMax: { value: new THREE.Vector2(1, 1) }, bloomStrength: { value: 0 }, grade: { value: 1 }, exposure: { value: 1 }, time: { value: 0 } },
    });
    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, uvScale: { value: new THREE.Vector2(1, 1) }, uvMax: { value: new THREE.Vector2(1, 1) }, threshold: { value: 0.85 } },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, dir: { value: new THREE.Vector2() }, uvScale: { value: new THREE.Vector2(1, 1) }, uvMax: { value: new THREE.Vector2(1, 1) } },
    });
    this.quad = new THREE.Mesh(geo, this.finalMat);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
    this.resize();
  }

  setSamples(n: number) {
    if (n === this.samples) return;
    this.samples = n;
    this.allocate();
  }

  resize() {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.renderer.setSize(this.width, this.height, true);
    this.allocate();
  }

  private allocate() {
    this.sceneRT?.dispose(); this.bloomA?.dispose(); this.bloomB?.dispose();
    this.sceneRT = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const bw = Math.max(1, Math.floor(this.width / 4)), bh = Math.max(1, Math.floor(this.height / 4));
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
    this.bloomA = new THREE.WebGLRenderTarget(bw, bh, opts);
    this.bloomB = new THREE.WebGLRenderTarget(bw, bh, opts);
  }

  /** Estimated bytes used by render targets (estimate only). */
  estimateTargetBytes() {
    const px = this.width * this.height;
    const colour = px * 8 * Math.max(1, this.samples) + (this.samples > 0 ? px * 8 : 0);
    const depth = px * 4 * Math.max(1, this.samples);
    const bloom = 2 * (px / 16) * 8;
    const canvas = px * 4 * 2;
    return colour + depth + bloom + canvas;
  }

  get pixelSize() { return { w: Math.floor(this.width * this.scale), h: Math.floor(this.height * this.scale) }; }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    const r = this.renderer;
    const W = this.width, H = this.height;
    const w = Math.max(1, Math.floor(W * this.scale)), h = Math.max(1, Math.floor(H * this.scale));
    const rt = this.sceneRT;
    rt.viewport.set(0, 0, w, h);
    rt.scissor.set(0, 0, w, h);
    rt.scissorTest = true;
    r.setRenderTarget(rt);
    r.render(scene, camera);

    const sx = w / W, sy = h / H;
    const maxX = (w - 0.5) / W, maxY = (h - 0.5) / H;

    let bloomStrength = 0;
    if (this.post === 'light') {
      bloomStrength = 0.55;
      const bw = this.bloomA.width, bh = this.bloomA.height;
      const vw = Math.max(1, Math.floor(bw * this.scale)), vh = Math.max(1, Math.floor(bh * this.scale));
      for (const t of [this.bloomA, this.bloomB]) { t.viewport.set(0, 0, vw, vh); t.scissor.set(0, 0, vw, vh); t.scissorTest = true; }
      const bsx = vw / bw, bsy = vh / bh, bmx = (vw - 0.5) / bw, bmy = (vh - 0.5) / bh;
      // bright pass
      this.quad.material = this.brightMat;
      this.brightMat.uniforms.tScene.value = rt.texture;
      this.brightMat.uniforms.uvScale.value.set(sx, sy);
      this.brightMat.uniforms.uvMax.value.set(maxX, maxY);
      r.setRenderTarget(this.bloomA); r.render(this.fsScene, this.fsCam);
      // separable blur x2
      this.quad.material = this.blurMat;
      const u = this.blurMat.uniforms;
      u.uvScale.value.set(bsx, bsy); u.uvMax.value.set(bmx, bmy);
      for (let i = 0; i < 2; i++) {
        u.tSrc.value = this.bloomA.texture; u.dir.value.set((1 + i) / bw, 0);
        r.setRenderTarget(this.bloomB); r.render(this.fsScene, this.fsCam);
        u.tSrc.value = this.bloomB.texture; u.dir.value.set(0, (1 + i) / bh);
        r.setRenderTarget(this.bloomA); r.render(this.fsScene, this.fsCam);
      }
      // the final pass samples bloom with the scene's uv mapping; compensate for different viewport fraction
    }

    this.quad.material = this.finalMat;
    const fu = this.finalMat.uniforms;
    fu.tScene.value = rt.texture;
    fu.tBloom.value = this.bloomA.texture;
    fu.uvScale.value.set(sx, sy);
    fu.uvMax.value.set(maxX, maxY);
    fu.bloomStrength.value = bloomStrength;
    fu.grade.value = this.post === 'off' ? 0 : 1;
    fu.exposure.value = this.exposure;
    fu.time.value = time;
    r.setRenderTarget(null);
    r.render(this.fsScene, this.fsCam);
  }
}
