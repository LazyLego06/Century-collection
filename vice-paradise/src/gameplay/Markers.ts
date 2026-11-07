import * as THREE from 'three';
import type { Game } from '../core/Game';

const VERT = /* glsl */ `
attribute vec3 mcolor;
varying float vH; varying vec3 vC;
void main() {
  vH = uv.y; vC = mcolor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform float time;
varying float vH; varying vec3 vC;
void main() {
  float a = pow(1.0 - vH, 1.6) * (0.55 + 0.15 * sin(time * 4.0 + vH * 12.0));
  gl_FragColor = vec4(vC * a, a);
}`;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** Glowing mission marker beams — a single additive instanced draw call (the only big transparent surface). */
export class MarkerRenderer {
  group = new THREE.Group();
  private beams: THREE.InstancedMesh;
  private arrows: THREE.InstancedMesh;
  private colors: Float32Array;
  private mat: THREE.ShaderMaterial;

  constructor(private game: Game) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    g.translate(0, 0.5, 0);
    this.colors = new Float32Array(32 * 3);
    g.setAttribute('mcolor', new THREE.InstancedBufferAttribute(this.colors, 3));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { time: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beams = new THREE.InstancedMesh(g, this.mat, 32);
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    const ag = new THREE.ConeGeometry(0.45, 0.9, 4);
    ag.rotateX(Math.PI);
    this.arrows = new THREE.InstancedMesh(ag, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.4) }), 4);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    this.group.add(this.beams, this.arrows);
  }

  update(time: number) {
    const g = this.game, m = g.missions;
    this.mat.uniforms.time.value = time;
    let n = 0, a = 0;
    const beam = (x: number, z: number, r: number, h: number, c: [number, number, number]) => {
      if (n >= 32) return;
      _m.compose(_p.set(x, 0.05, z), _q.identity(), _s.set(r, h, r));
      this.beams.setMatrixAt(n, _m);
      this.colors.set(c, n * 3);
      n++;
    };
    if (g.state !== 'menu') {
      if (!m.active) {
        for (const d of m.available()) if (Math.hypot(d.giver[0] - g.player.pos.x, d.giver[1] - g.player.pos.z) < 250) beam(d.giver[0], d.giver[1], 1.2, 3.5, [1.6, 1.2, 0.15]);
      } else if (m.target) {
        if (m.markerRadius > 0) beam(m.target.x, m.target.z, m.markerRadius, 6, [1.6, 1.2, 0.15]);
        else {
          _m.compose(_p.set(m.target.x, 2.6 + Math.sin(time * 4) * 0.2, m.target.z), _q.setFromAxisAngle(_s.set(0, 1, 0), time * 2), _s.set(1, 1, 1));
          this.arrows.setMatrixAt(a++, _m);
        }
        if (m.nextTarget) beam(m.nextTarget.x, m.nextTarget.z, m.markerRadius * 0.7, 4, [0.3, 0.9, 1.4]);
      }
      if (g.hud.waypoint && !m.target) beam(g.hud.waypoint.x, g.hud.waypoint.z, 2, 30, [1.4, 0.2, 0.8]);
    }
    this.beams.count = n;
    this.beams.instanceMatrix.needsUpdate = true;
    (this.beams.geometry.attributes.mcolor as THREE.BufferAttribute).needsUpdate = true;
    this.arrows.count = a;
    this.arrows.instanceMatrix.needsUpdate = true;
  }
}
