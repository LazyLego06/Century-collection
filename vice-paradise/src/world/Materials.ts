import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CANAL_Z0, CANAL_Z1, CELL, CITY, ROAD_HALF } from './CityLayout';

/** Uniforms shared by every custom world shader (updated once per frame). */
export const WorldUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
  uSkyColor: { value: new THREE.Color(0x88aaff) },
  uReflect: { value: 1 },
};

const HASH = /* glsl */ `
float vpHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vpNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vpHash(i), vpHash(i + vec2(1.0, 0.0)), f.x), mix(vpHash(i + vec2(0.0, 1.0)), vpHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/* ---------------------------------------------------------------- facade atlas */
const ATLAS = 1024, CELLPX = 256;

/**
 * Builds a 4x4 facade atlas. Each cell is a single window module (4 m x 3.6 m) that the building shader tiles.
 * RGB = albedo, A = window mask (used for lit windows at night and sky reflections).
 */
export function createFacadeAtlas(): THREE.DataTexture {
  const col = document.createElement('canvas');
  col.width = col.height = ATLAS;
  const msk = document.createElement('canvas');
  msk.width = msk.height = ATLAS;
  const c = col.getContext('2d')!, m = msk.getContext('2d')!;
  m.fillStyle = '#000'; m.fillRect(0, 0, ATLAS, ATLAS);

  const glass = (x: number, y: number, w: number, h: number, top: string, bottom: string) => {
    const g = c.createLinearGradient(x, y, x + w * 0.4, y + h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(x, y, w, h);
    // diagonal reflection streak
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.beginPath(); c.moveTo(x + w * 0.2, y); c.lineTo(x + w * 0.45, y); c.lineTo(x + w * 0.05, y + h); c.lineTo(x - w * 0.2, y + h); c.fill();
    c.restore();
    m.fillStyle = '#fff'; m.fillRect(x, y, w, h);
  };
  const cell = (idx: number, draw: (x: number, y: number, s: number) => void) => {
    const cx = (idx % 4) * CELLPX;
    // row 0 of the texture is at the bottom (we flip when packing) -> draw rows from the bottom of the canvas
    const cy = ATLAS - (Math.floor(idx / 4) + 1) * CELLPX;
    c.save(); m.save();
    draw(cx, cy, CELLPX);
    c.restore(); m.restore();
  };
  const wall = (x: number, y: number, s: number, color: string, noise = 0.06) => {
    c.fillStyle = color; c.fillRect(x, y, s, s);
    for (let k = 0; k < 220; k++) {
      c.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${noise * Math.random()})` : `rgba(255,255,255,${noise * Math.random()})`;
      c.fillRect(x + Math.random() * s, y + Math.random() * s, 3 + Math.random() * 8, 3 + Math.random() * 8);
    }
  };

  // 0 blue glass curtain wall
  cell(0, (x, y, s) => { wall(x, y, s, '#5b6b7e', 0.02); glass(x + 8, y + 6, s - 16, s - 22, '#5d8fc9', '#1b3460'); c.fillStyle = '#3a4656'; c.fillRect(x, y + s - 16, s, 16); });
  // 1 teal glass
  cell(1, (x, y, s) => { wall(x, y, s, '#4c6a6a', 0.02); glass(x + 6, y + 6, s - 12, s - 20, '#6fd6d0', '#174a55'); c.fillStyle = '#2f4848'; c.fillRect(x, y + s - 14, s, 14); });
  // 2 dark glass with spandrel band
  cell(2, (x, y, s) => { wall(x, y, s, '#2a2f38', 0.02); glass(x + 4, y + 4, s - 8, s * 0.62, '#4a5f80', '#141a28'); c.fillStyle = '#1d2129'; c.fillRect(x, y + s * 0.68, s, s * 0.32); });
  // 3 office concrete grid
  cell(3, (x, y, s) => { wall(x, y, s, '#c9c6bf', 0.08); glass(x + s * 0.18, y + s * 0.16, s * 0.64, s * 0.56, '#7d9ac0', '#22324d'); c.fillStyle = '#a8a59f'; c.fillRect(x, y + s * 0.84, s, s * 0.16); });
  // 4 art deco stucco (tintable)
  cell(4, (x, y, s) => {
    wall(x, y, s, '#f2f0ec', 0.05);
    glass(x + s * 0.25, y + s * 0.2, s * 0.5, s * 0.48, '#86c7e6', '#24506d');
    c.fillStyle = '#d6d3cc'; c.fillRect(x, y + s * 0.78, s, s * 0.06); c.fillRect(x, y + s * 0.9, s, s * 0.04);
    c.fillStyle = '#e8e6e0'; c.fillRect(x + s * 0.22, y + s * 0.69, s * 0.56, s * 0.05);
  });
  // 5 residential stucco w/ shutters
  cell(5, (x, y, s) => {
    wall(x, y, s, '#f4f1ea', 0.06);
    glass(x + s * 0.34, y + s * 0.24, s * 0.32, s * 0.42, '#9cc8e0', '#2c4a63');
    c.fillStyle = '#7fa8a0'; c.fillRect(x + s * 0.22, y + s * 0.24, s * 0.1, s * 0.42); c.fillRect(x + s * 0.68, y + s * 0.24, s * 0.1, s * 0.42);
    c.fillStyle = '#ddd8cc'; c.fillRect(x + s * 0.3, y + s * 0.67, s * 0.4, s * 0.04);
  });
  // 6 shopfront
  cell(6, (x, y, s) => {
    wall(x, y, s, '#f5f3ef', 0.05);
    glass(x + s * 0.08, y + s * 0.28, s * 0.84, s * 0.62, '#b5e0f0', '#30566f');
    c.fillStyle = '#e8e4dc'; c.fillRect(x, y + s * 0.9, s, s * 0.1);
    c.fillStyle = '#d9d4ca'; c.fillRect(x, y, s, s * 0.12);
  });
  // 7 terracotta apartments
  cell(7, (x, y, s) => {
    wall(x, y, s, '#d98c64', 0.1);
    glass(x + s * 0.28, y + s * 0.2, s * 0.44, s * 0.5, '#9fc4d8', '#2a3c52');
    c.fillStyle = '#f0e6d8'; c.fillRect(x + s * 0.24, y + s * 0.7, s * 0.52, s * 0.05); c.fillRect(x + s * 0.24, y + s * 0.16, s * 0.52, s * 0.04);
  });
  // 8 nightclub dark panels
  cell(8, (x, y, s) => {
    wall(x, y, s, '#ffffff', 0.04);
    c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(x, y, 4, s); c.fillRect(x, y, s, 4);
    glass(x + s * 0.1, y + s * 0.4, s * 0.8, s * 0.12, '#c05bff', '#4a1a6a');
  });
  // 9 institutional white w/ blue ribbon windows
  cell(9, (x, y, s) => { wall(x, y, s, '#f6f7fb', 0.04); glass(x, y + s * 0.25, s, s * 0.42, '#7fb6ff', '#1f3f7a'); c.fillStyle = '#c9ccd6'; c.fillRect(x + s - 6, y, 6, s); });
  // 10-15 variants
  cell(10, (x, y, s) => { wall(x, y, s, '#6b5d52', 0.03); glass(x + 10, y + 8, s - 20, s - 30, '#e0b07a', '#4a2f1d'); });
  cell(11, (x, y, s) => { wall(x, y, s, '#e9edf2', 0.04); glass(x + s * 0.1, y + s * 0.1, s * 0.35, s * 0.7, '#8ab4e8', '#203b66'); glass(x + s * 0.55, y + s * 0.1, s * 0.35, s * 0.7, '#8ab4e8', '#203b66'); });
  for (let k = 12; k < 16; k++) cell(k, (x, y, s) => { wall(x, y, s, '#f0eee8', 0.05); glass(x + s * 0.3, y + s * 0.25, s * 0.4, s * 0.45, '#9cc8e0', '#2c4a63'); });

  const ci = c.getImageData(0, 0, ATLAS, ATLAS).data;
  const mi = m.getImageData(0, 0, ATLAS, ATLAS).data;
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  for (let y = 0; y < ATLAS; y++) {
    const src = (ATLAS - 1 - y) * ATLAS * 4, dst = y * ATLAS * 4;
    for (let x = 0; x < ATLAS * 4; x += 4) {
      data[dst + x] = ci[src + x]; data[dst + x + 1] = ci[src + x + 1]; data[dst + x + 2] = ci[src + x + 2];
      data[dst + x + 3] = mi[src + x];
    }
  }
  const tex = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ---------------------------------------------------------------- building material */
export function createBuildingMaterial(atlas: THREE.Texture) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAtlas = { value: atlas };
    Object.assign(sh.uniforms, WorldUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aStyle;
varying vec2 vWall; varying float vRoof; flat varying vec2 vStyle; varying float vY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 iS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 lp = position;
  if (abs(normal.y) > 0.5) { vWall = vec2(lp.x * iS.x, lp.z * iS.z); vRoof = 1.0; }
  else if (abs(normal.x) > 0.5) { vWall = vec2((lp.z + 0.5) * iS.z, lp.y * iS.y); vRoof = 0.0; }
  else { vWall = vec2((lp.x + 0.5) * iS.x, lp.y * iS.y); vRoof = 0.0; }
  vStyle = aStyle; vY = lp.y * iS.y;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uAtlas; uniform float uNight; uniform vec3 uSkyColor; uniform float uReflect;
varying vec2 vWall; varying float vRoof; flat varying vec2 vStyle; varying float vY;
${HASH}`)
      .replace('#include <map_fragment>', `
float vpWin = 0.0; float vpLit = 0.0; vec3 vpLitCol = vec3(1.0, 0.78, 0.45);
// derivatives must be taken in uniform control flow
vec2 cu = vWall / vec2(4.0, 3.6);
vec2 gdx = dFdx(cu) * 0.24, gdy = dFdy(cu) * 0.24;
if (vRoof > 0.5) {
  diffuseColor.rgb = vec3(0.42, 0.41, 0.40) * (0.85 + 0.15 * vpNoise(vWall * 0.4));
} else {
  vec2 tile = fract(cu);
  float s = floor(vStyle.x + 0.5);
  vec2 off = vec2(mod(s, 4.0), floor(s / 4.0)) * 0.25;
  vec2 auv = off + (0.02 + tile * 0.96) * 0.25;
  vec4 tx = textureGrad(uAtlas, auv, gdx, gdy);
  diffuseColor.rgb *= tx.rgb;
  vpWin = tx.a;
  vec2 cid = floor(cu);
  float h = vpHash(cid + vec2(vStyle.y * 13.1, vStyle.y * 7.7));
  vpLit = step(0.7, h) * vpWin;
  float h2 = vpHash(cid * 1.7 + vStyle.y);
  vpLitCol = h2 > 0.8 ? vec3(0.55, 0.75, 1.0) : (h2 > 0.65 ? vec3(1.0, 0.55, 0.8) : vec3(1.0, 0.8, 0.5));
  // simulated ambient occlusion near the ground
  diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 5.0, vY));
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float fr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
  totalEmissiveRadiance += uSkyColor * vpWin * (0.12 + fr * 0.55) * uReflect * (1.0 - uNight * 0.85);
  totalEmissiveRadiance += vpLitCol * vpLit * uNight * 1.1 + vec3(0.02, 0.03, 0.06) * vpWin * uNight;
}`);
  };
  mat.customProgramCacheKey = () => 'vp-building';
  return mat;
}

/* ---------------------------------------------------------------- ground / roads */
export function createGroundMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WorldUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; uniform float uTime;
varying vec3 vWorld;
${HASH}`)
      .replace('#include <map_fragment>', `
float vpGlow = 0.0;
{
  vec2 p = vWorld.xz;
  const float CELL = ${CELL.toFixed(1)}; const float RH = ${ROAD_HALF.toFixed(1)}; const float CITYW = ${CITY.toFixed(1)};
  vec2 lp = mod(p + RH, CELL);
  bool inCity = p.x > -RH && p.y > -RH && p.x < CITYW + RH && p.y < CITYW + RH;
  bool rx = lp.x < RH * 2.0 && inCity;
  bool rz = lp.y < RH * 2.0 && inCity;
  if (p.y > ${CANAL_Z0.toFixed(1)} && p.y < ${CANAL_Z1.toFixed(1)} && !rx) discard;
  float n = vpNoise(p * 1.7) * 0.5 + vpNoise(p * 0.15) * 0.5;
  vec3 asphalt = vec3(0.13, 0.13, 0.145) * (0.8 + 0.4 * n);
  vec3 col = vec3(0.5, 0.49, 0.47) * (0.85 + 0.25 * n); // paving
  if (rx || rz) {
    col = asphalt;
    if (rx && !rz) {
      float d = lp.x - RH; float l = lp.y; float ad = abs(d);
      if (ad > 0.08 && ad < 0.24) col = vec3(0.85, 0.65, 0.12);
      if (ad > 5.25 && ad < 5.42) col = vec3(0.8);
      if ((l > 12.6 && l < 16.0) || (l > 68.0 && l < 71.4)) { if (fract(d * 0.45) < 0.5 && ad < 5.0) col = vec3(0.85); }
      float lz = min(abs(l - 24.0), abs(l - 60.0));
      vpGlow = (1.0 - smoothstep(0.0, 9.0, length(vec2(ad - 6.0, lz))));
    } else if (rz && !rx) {
      float d = lp.y - RH; float l = lp.x; float ad = abs(d);
      if (ad > 0.08 && ad < 0.24) col = vec3(0.85, 0.65, 0.12);
      if (ad > 5.25 && ad < 5.42) col = vec3(0.8);
      if ((l > 12.6 && l < 16.0) || (l > 68.0 && l < 71.4)) { if (fract(d * 0.45) < 0.5 && ad < 5.0) col = vec3(0.85); }
      float lz = min(abs(l - 24.0), abs(l - 60.0));
      vpGlow = (1.0 - smoothstep(0.0, 9.0, length(vec2(ad - 6.0, lz))));
    } else {
      col *= 0.92;
    }
  }
  diffuseColor.rgb *= col;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.72, 0.4) * vpGlow * vpGlow * uNight * 0.35;`);
  };
  mat.customProgramCacheKey = () => 'vp-ground';
  return mat;
}

/* ---------------------------------------------------------------- sand */
export function createSandMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorld;\n${HASH}`)
      .replace('#include <map_fragment>', `
{
  float n = vpNoise(vWorld.xz * 0.8) * 0.6 + vpNoise(vWorld.xz * 6.0) * 0.4;
  vec3 dry = vec3(0.8, 0.7, 0.5), wet = vec3(0.52, 0.43, 0.31);
  float w = smoothstep(-0.1, -0.6, vWorld.y);
  diffuseColor.rgb *= mix(dry, wet, w) * (0.9 + 0.15 * n);
}`);
  };
  mat.customProgramCacheKey = () => 'vp-sand';
  return mat;
}

/* ---------------------------------------------------------------- geometry builders */
/** Unit box with its base at y=0 (so scale.y = height). */
export function unitBoxBase() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

function colorize(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.index) return g.toNonIndexed();
  return g;
}
function prep(g: THREE.BufferGeometry, hex: number) {
  let r = g.index ? g.toNonIndexed() : g;
  r.deleteAttribute('uv');
  r = colorize(r, hex);
  return r;
}

/** Low-poly palm tree (trunk + fronds), vertex coloured, ~150 triangles. */
export function palmGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 4, H = 8.5;
  for (let k = 0; k < segs; k++) {
    const y0 = (k / segs) * H, y1 = ((k + 1) / segs) * H;
    const g = new THREE.CylinderGeometry(0.22 - k * 0.025, 0.3 - k * 0.025, y1 - y0 + 0.05, 6, 1, true);
    const bend = (k / segs) ** 2 * 1.2;
    g.translate(bend, (y0 + y1) / 2, 0);
    parts.push(prep(g, k % 2 ? 0x8a6a48 : 0x7a5c3d));
  }
  const top = new THREE.Vector3(1.2, H, 0);
  for (let f = 0; f < 7; f++) {
    const a = (f / 7) * Math.PI * 2;
    const leaf = new THREE.BufferGeometry();
    const L = 4.2, W = 0.8;
    const A = [0, 0, 0], B = [L * 0.5, 0.35, W], C = [L * 0.5, 0.35, -W], D = [L, -1.3, 0];
    // both windings so the frond is visible from above and below; normals point up so it never goes black
    const tris = [A, B, C, B, D, C, A, C, B, B, C, D];
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    leaf.setAttribute('normal', new THREE.Float32BufferAttribute(tris.flatMap(() => [0, 1, 0]), 3));
    leaf.rotateZ(-0.15);
    leaf.rotateY(a);
    leaf.translate(top.x, top.y, top.z);
    parts.push(colorize(leaf, f % 2 ? 0x3f8f3a : 0x2f7a35));
  }
  return mergeGeometries(parts)!;
}

export function palmMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WorldUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float sway = max(0.0, transformed.y - 6.0) * 0.06;
  float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
  transformed.x += sin(uTime * 1.3 + ph) * sway;
  transformed.z += cos(uTime * 1.1 + ph) * sway * 0.6;
}`);
  };
  mat.customProgramCacheKey = () => 'vp-palm';
  return mat;
}

/** Street lamp pole (lamp head is a separate emissive mesh). Local +z faces the road. */
export function lampPoleGeometry() {
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 7, 5); pole.translate(0, 3.5, 0);
  const arm = new THREE.BoxGeometry(0.1, 0.1, 2.2); arm.translate(0, 6.9, 1.0);
  return mergeGeometries([prep(pole, 0x3a3d44), prep(arm, 0x3a3d44)])!;
}
export function lampHeadGeometry() {
  const g = new THREE.BoxGeometry(0.5, 0.15, 0.9); g.translate(0, 6.8, 2.0);
  return g;
}
export function tlightPoleGeometry() {
  const pole = new THREE.CylinderGeometry(0.1, 0.12, 5.2, 5); pole.translate(0, 2.6, 0);
  const box = new THREE.BoxGeometry(0.4, 1.1, 0.35); box.translate(0, 4.6, 0.25);
  return mergeGeometries([prep(pole, 0x2b2d33), prep(box, 0x1b1c20)])!;
}
export function tlightHeadGeometry() {
  const g = new THREE.BoxGeometry(0.28, 0.28, 0.06); g.translate(0, 4.6, 0.45);
  return g;
}

/** Sidewalk slabs: plain Lambert plus fake street-lamp light pools at night (no real lights). */
export function createSlabMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = WorldUniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vWorld;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec2 l = abs(mod(vWorld.xz, ${CELL.toFixed(1)}) - ${(CELL / 2).toFixed(1)});
  float d = min(length(l - vec2(18.0, 28.8)), length(l - vec2(28.8, 18.0)));
  float gl = 1.0 - smoothstep(0.0, 8.0, d);
  totalEmissiveRadiance += vec3(1.0, 0.72, 0.4) * gl * gl * uNight * 0.3;
}`);
  };
  mat.customProgramCacheKey = () => 'vp-slab';
  return mat;
}
