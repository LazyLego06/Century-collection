// Headless tuning harness for vehicle physics (node + rapier, no rendering).
import * as THREE from 'three';
import { Physics, RAPIER } from '../src/core/Physics';
import { Vehicle } from '../src/entities/Vehicle';
import type { VehicleKind } from '../src/entities/VehicleModels';

await Physics.init();
const kinds: VehicleKind[] = ['sports', 'sedan', 'suv', 'police'];
for (const kind of kinds) {
  const P = new Physics();
  P.addStaticDesc(RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0));
  const v = new Vehicle(P, kind, new THREE.Vector3(0, Vehicle.rideHeight(kind) + 0.1, 0), 0, 'physics');
  v.driver = 'player';
  const log: string[] = [];
  let t = 0;
  const step = (n: number, f: () => void) => { for (let i = 0; i < n; i++) { f(); v.fixedUpdate(P.dt); P.step(); v.syncFromBody(); t += P.dt; } };
  step(60, () => { v.throttle = 0; v.brakeIn = 0; });
  log.push(`rest y=${v.curPos.y.toFixed(2)} (pred ${Vehicle.rideHeight(kind).toFixed(2)}) susp=${v.suspension.map(s=>s.toFixed(2))}`);
  let t100 = -1;
  step(60 * 12, () => { v.throttle = 1; if (t100 < 0 && v.speedMs * 3.6 >= 100) t100 = t; });
  log.push(`0-100: ${t100 > 0 ? (t100 - 1).toFixed(1) + 's' : 'n/a'} top after 12s: ${(v.speedMs * 3.6).toFixed(0)} km/h z=${v.curPos.z.toFixed(0)} x=${v.curPos.x.toFixed(1)} up=${v.upright.toFixed(2)}`);
  // turn at speed
  step(120, () => { v.throttle = 1; v.steer = 1; });
  log.push(`after 2s full steer: speed ${(v.speedMs*3.6).toFixed(0)} yaw=${v.yaw.toFixed(2)} up=${v.upright.toFixed(2)} y=${v.curPos.y.toFixed(2)}`);
  step(60, () => { v.throttle = 0; v.steer = 0; });
  let stopT = 0; const sp0 = v.speedMs;
  step(60 * 6, () => { v.brakeIn = 1; if (v.speedMs > 1) stopT += P.dt; });
  log.push(`brake from ${(sp0*3.6).toFixed(0)} km/h stop in ${stopT.toFixed(1)}s; then reverse speed ${(v.speedMs*3.6).toFixed(0)}`);
  console.log(kind.padEnd(8), '\n  ' + log.join('\n  '));
}
