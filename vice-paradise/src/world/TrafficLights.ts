import * as THREE from 'three';

export type LightState = 'g' | 'y' | 'r';
const CYCLE = 22;

/** Global, synchronised traffic light phases. axis 0 = traffic moving along z, 1 = along x. */
export class TrafficLights {
  t = 0;
  matNS = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
  matEW = new THREE.MeshBasicMaterial({ color: 0xff2020 });

  update(dt: number) {
    this.t = (this.t + dt) % CYCLE;
    this.setColor(this.matNS, this.state(0));
    this.setColor(this.matEW, this.state(1));
  }
  state(axis: 0 | 1): LightState {
    const t = axis === 0 ? this.t : (this.t + CYCLE / 2) % CYCLE;
    if (t < 8.5) return 'g';
    if (t < 10.5) return 'y';
    return 'r';
  }
  private setColor(m: THREE.MeshBasicMaterial, s: LightState) {
    if (s === 'g') m.color.setRGB(0.1, 2.2, 0.6);
    else if (s === 'y') m.color.setRGB(2.4, 1.4, 0.1);
    else m.color.setRGB(2.6, 0.12, 0.08);
  }
}
