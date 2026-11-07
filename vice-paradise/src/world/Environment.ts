import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util';
import { WorldUniforms } from './Materials';
import { WATER_Y } from './CityLayout';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night; uniform float time;
varying vec3 vDir;
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(y, 0.55));
  // glow around the sun, stronger near the horizon (sunset bands)
  float sd = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(sd, 8.0) * 0.35 + pow(sd, 900.0) * 18.0) * (1.0 - night);
  // horizon haze below 0
  col = mix(col, horizon * 0.8, smoothstep(0.0, -0.15, d.y));
  // stars
  if (night > 0.01 && d.y > 0.0) {
    vec3 q = floor(d * 380.0);
    float s = h3(q);
    float tw = 0.6 + 0.4 * sin(time * 3.0 + s * 50.0);
    col += vec3(step(0.9975, s) * night * tw * 1.4);
    // moon
    float md = max(dot(d, -sunDir), 0.0);
    col += vec3(0.8, 0.85, 1.0) * (pow(md, 2000.0) * 6.0 + pow(md, 30.0) * 0.08) * night;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const WATER_VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night; uniform float time; uniform float reflectQ;
uniform vec3 camPos;
#include <fog_pars_fragment>
varying vec3 vWorld;
float wave(vec2 p, vec2 dir, float freq, float speed) { return sin(dot(p, dir) * freq + time * speed); }
void main() {
  vec2 p = vWorld.xz;
  // analytic normal from a few directional waves (cheap, no textures)
  float e = 0.0;
  vec2 g = vec2(0.0);
  g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.35 + time * 1.1) * 0.35 * 0.10;
  g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 0.9 + time * 1.7) * 0.9 * 0.04;
  g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 2.1 + time * 2.3) * 2.1 * 0.015;
  g += vec2(-0.9, -0.3) * cos(dot(p, vec2(-0.9, -0.3)) * 4.3 + time * 3.1) * 4.3 * 0.006;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(camPos - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  // turquoise shallows near the beach and canals, deep blue offshore
  float shallow = clamp(1.0 - (vWorld.x - 990.0) / 140.0, 0.0, 1.0) * step(950.0, vWorld.x);
  vec3 deep = mix(vec3(0.01, 0.12, 0.2), vec3(0.04, 0.42, 0.45), shallow);
  deep *= mix(1.0, 0.18, night);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(horizon, zenith, pow(max(r.y, 0.0), 0.5));
  vec3 col = mix(deep, sky, fres * mix(0.35, 1.0, reflectQ));
  float spec = pow(max(dot(r, sunDir), 0.0), 220.0) * (1.0 - night) * reflectQ;
  col += sunColor * spec * 6.0;
  // moon glitter
  col += vec3(0.6, 0.7, 1.0) * pow(max(dot(r, -sunDir), 0.0), 300.0) * night * 2.0 * reflectQ;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

interface SkyKey { el: number; zenith: number; horizon: number; sun: number; sunI: number; hemiSky: number; hemiGround: number; hemiI: number; }
const KEYS: SkyKey[] = [
  { el: -0.35, zenith: 0x03061a, horizon: 0x1a1238, sun: 0x8899ff, sunI: 0.5, hemiSky: 0x4a5a9a, hemiGround: 0x2a2030, hemiI: 1.0 },
  { el: -0.08, zenith: 0x10123a, horizon: 0x5a2a6a, sun: 0x9a88ff, sunI: 0.4, hemiSky: 0x5a5a9a, hemiGround: 0x2a2030, hemiI: 0.95 },
  { el: 0.02, zenith: 0x2a2a6e, horizon: 0xff6a4a, sun: 0xff7a40, sunI: 1.0, hemiSky: 0x8a6aa0, hemiGround: 0x3a2a2a, hemiI: 0.75 },
  { el: 0.15, zenith: 0x3a5aa8, horizon: 0xffb07a, sun: 0xffb070, sunI: 2.0, hemiSky: 0x9ab0d8, hemiGround: 0x4a4038, hemiI: 0.9 },
  { el: 0.45, zenith: 0x2f6fd0, horizon: 0xb9dcff, sun: 0xfff2dc, sunI: 2.3, hemiSky: 0xb0d0ff, hemiGround: 0x5a5048, hemiI: 0.9 },
  { el: 1.0, zenith: 0x2a66cc, horizon: 0xaad4ff, sun: 0xffffff, sunI: 2.4, hemiSky: 0xb8d8ff, hemiGround: 0x5a5048, hemiI: 0.95 },
];

const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function lerpHex(a: number, b: number, t: number, out: THREE.Color) {
  tmpA.setHex(a); tmpB.setHex(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

export class Environment {
  hours = 17.5;
  night = 0;
  sunDir = new THREE.Vector3(0, 1, 0);
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  water: THREE.Mesh;
  fog: THREE.Fog;
  skyUniforms: Record<string, THREE.IUniform>;
  waterMat: THREE.ShaderMaterial;
  private shadowRadius = 40;
  private shadowSize = 0;

  constructor(private scene: THREE.Scene) {
    this.fog = new THREE.Fog(0x9fc3e8, 150, 520);
    scene.fog = this.fog;
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xb0d0ff, 0x5a5048, 1.0);
    scene.add(this.hemi);

    this.skyUniforms = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      sunDir: { value: this.sunDir }, sunColor: { value: new THREE.Color() }, night: { value: 0 }, time: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMat);
    this.sky.frustumCulled = false;
    // drawn after opaque geometry so the depth test rejects every hidden sky pixel (saves fill-rate)
    this.sky.renderOrder = 100;
    scene.add(this.sky);

    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { camPos: { value: new THREE.Vector3() }, reflectQ: { value: 1 } }]),
    });
    // share sky colour uniforms with water
    const wu = this.waterMat.uniforms;
    wu.zenith = this.skyUniforms.zenith; wu.horizon = this.skyUniforms.horizon; wu.sunDir = this.skyUniforms.sunDir;
    wu.sunColor = this.skyUniforms.sunColor; wu.night = this.skyUniforms.night; wu.time = this.skyUniforms.time;
    const wg = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.water.position.set(450, WATER_Y, 450);
    this.water.frustumCulled = false;
    this.water.renderOrder = 90;
    scene.add(this.water);
  }

  setShadows(size: number, radius: number) {
    this.shadowRadius = radius;
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  setReflections(on: boolean) {
    this.waterMat.uniforms.reflectQ.value = on ? 1 : 0;
    WorldUniforms.uReflect.value = on ? 1 : 0.35;
  }

  setDrawDistance(far: number) {
    this.fog.near = far * 0.35;
    this.fog.far = far;
  }

  update(dt: number, timeScale: number, time: number, camera: THREE.Camera, focus: THREE.Vector3) {
    this.hours = (this.hours + (dt * timeScale) / 60) % 24;
    // sun travels east (+x, over the ocean) -> west
    const t = ((this.hours - 6) / 24) * Math.PI * 2; // 6:00 sunrise
    const el = Math.sin(t);
    const az = Math.cos(t);
    this.sunDir.set(az * 0.92, el, 0.38).normalize();
    const elev = this.sunDir.y;
    this.night = smoothstep(0.06, -0.14, elev);

    // interpolate keyframes
    let k = 0;
    while (k < KEYS.length - 2 && elev > KEYS[k + 1].el) k++;
    const a = KEYS[k], b = KEYS[k + 1];
    const f = clamp((elev - a.el) / (b.el - a.el), 0, 1);
    const u = this.skyUniforms;
    lerpHex(a.zenith, b.zenith, f, u.zenith.value);
    lerpHex(a.horizon, b.horizon, f, u.horizon.value);
    lerpHex(a.sun, b.sun, f, u.sunColor.value);
    u.night.value = this.night;
    u.time.value = time;
    this.fog.color.copy(u.horizon.value).multiplyScalar(0.85);
    lerpHex(a.hemiSky, b.hemiSky, f, this.hemi.color);
    lerpHex(a.hemiGround, b.hemiGround, f, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, f);

    // the directional light is the sun by day and the moon by night
    const lightDir = elev > -0.05 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z);
    this.sun.color.copy(u.sunColor.value);
    this.sun.intensity = lerp(a.sunI, b.sunI, f) * (elev > -0.05 ? smoothstep(-0.05, 0.05, elev) : 1);
    if (elev <= -0.05) { this.sun.color.setHex(0x9aaaff); this.sun.intensity = 0.6; }

    // shadow camera follows the focus, snapped to texels to avoid shimmering
    const R = this.shadowRadius;
    const cam = this.sun.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 600;
    cam.updateProjectionMatrix();
    const texel = Math.max(0.01, (2 * R) / Math.max(1, this.shadowSize));
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + lightDir.x * 250, Math.max(20, lightDir.y * 250), fz + lightDir.z * 250);
    this.sun.target.updateMatrixWorld();

    WorldUniforms.uNight.value = this.night;
    WorldUniforms.uTime.value = time;
    WorldUniforms.uSkyColor.value.copy(u.horizon.value).lerp(u.zenith.value, 0.4);

    this.sky.position.copy(camera.position);
    this.waterMat.uniforms.camPos.value.copy(camera.position);
  }

  get clock() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
