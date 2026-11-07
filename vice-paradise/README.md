# Vice Paradise

An original, neon-soaked open-world crime game set in a fictional Miami-style island city. It runs in the browser and is built with **Three.js (WebGL2)**, **TypeScript**, **Vite** and **Rapier** physics. It is a playable game, not a mock-up: you can drive, shoot, run from the police and complete missions.

It was designed around one target machine: **GTX 1050 Ti (4 GB) + Ryzen 5 5600X + 16 GB, 1080p**. The default Medium preset is tuned for that card, and an auto-adjuster lowers resolution and density when the frame rate drops.

> **Honest performance note:** the frame rate on a GTX 1050 Ti has **not** been measured. All automated testing ran in headless Chromium with a software renderer (SwiftShader), where FPS numbers don't mean anything. What *was* measured: draw calls and triangle counts per preset (see [Measured render load](#measured-render-load)). To get real numbers on your machine, press **F3** in-game.

## Quick start

Requires **Node.js 20.19+** and a recent Chrome, Edge or Firefox with hardware acceleration enabled.

| OS | Launch |
|---|---|
| Windows | double-click `start.bat` |
| Ubuntu / Linux | `./start.sh` |
| Any OS | `npm start` |

The launcher detects your OS, installs dependencies on first run, builds an optimised production bundle and opens the game in your browser. Developer mode with hot reload: `npm install && npm run dev`.

**Tips**
* **Windows:** if the F3 overlay shows a GPU other than the GTX 1050 Ti, set your browser to "High performance" under *Settings › System › Display › Graphics*.
* **Ubuntu:** use the proprietary NVIDIA driver, and check that `chrome://gpu` reports *WebGL2: Hardware accelerated*. If it doesn't, start Chrome with `--ignore-gpu-blocklist`.

## Controls

| On foot | Driving | General |
|---|---|---|
| WASD move, Shift sprint, Space jump | W / S throttle, brake/reverse | M full-screen map (click sets a waypoint) |
| Mouse camera, RMB aim, LMB shoot | A / D steer, Space handbrake | Esc / P pause |
| R reload, 1-5 / wheel switch weapon | F exit, C look back, H horn | F2 FPS counter, F3 performance overlay |
| F enter or steal a vehicle, E start a mission | mouse looks around (camera re-centres) | T (hold) fast-forward time, Backspace abandon mission |

## What's in the game

**City (procedurally laid out, fixed seed).** 864 m × 864 m island city on a 12×12 block grid, plus a beach strip and ocean:
* *Neon Heights* downtown skyscrapers (up to ~190 m) with lit windows at night
* *Ocean Drive* art-deco hotels with neon, beach umbrellas and lifeguard towers
* *Pulse District* nightclubs with neon outlines
* *Palmetto Hills* and *Sunset Isles* residential streets, with palms and pools
* *Midtown* shops, a police precinct, a hospital, four gas stations and parks
* *Grand Canal* with 13 road bridges, the *Paradise Expressway* perimeter ring with overhead gantries, and working traffic lights at every intersection

**Gameplay**
* **Player:** third-person controller (Rapier kinematic character controller) with sprint, jump, swimming, fall damage, health and armour
* **Vehicles:** 5 types (Vortex RS sports car, Monarch sedan, Bayline SUV, VPPD Interceptor police car, Paradise Cab), each with its own mass, power, grip, suspension and drive layout. Rapier ray-cast vehicle physics adds arcade assists: downforce, lateral grip, yaw assist, anti-roll and a handbrake drift. You can carjack any car: the driver is pulled out and runs, and cops fight back. Collision damage leads to smoke, then fire, then an explosion.
* **Traffic AI:** lane following on the road graph, obeying traffic lights, braking for obstacles and the player, honking, and turning at intersections. Ram a car and it becomes a physics wreck.
* **Pedestrians:** walk the sidewalks, idle, and flee from gunfire and crashes. Cars can knock them down.
* **Police:** five-star wanted system driven by witnessed crimes. Units are dispatched up to a per-preset cap and use grid routing plus direct pursuit and ramming, with stuck and flip recovery. Officers leave their cars when you're on foot. At 1★ they arrest you (*BUSTED*); at 2★ and up they shoot. Roadblocks appear from 3★. To escape, break line of sight: the stars flash and the search area shows on the minimap.
* **Combat:** fists, pistol, SMG, pump shotgun and carbine rifle, all hitscan, with spread, headshots, reloading, tracers, muzzle flash, sparks and hit markers. Enemy AI strafes, keeps its distance and checks line of sight. Pickups for health, armour, weapons and money, plus enemy drops.
* **Missions (6):** *Neon Welcome* (story), *Hot Delivery* (delivery against the clock), *Ocean Drive Sprint* (timed checkpoint race), *Heat Wave* (3-star police escape), *Cab Rush* (driving/taxi) and *Turf War* (story 2: gang shoot-out, then an escape). Progress and money save to `localStorage`.
* **Presentation:** a cinematic title screen, rotating circular minimap with GPS route, full-screen map with waypoints, money counter, health and armour bars, wanted stars, weapon HUD, speedometer, mission objectives and timers, WASTED / BUSTED / MISSION PASSED screens, a pause menu, a day/night cycle, and synthesized WebAudio sound (engine, guns, sirens, crashes and more; no audio files).

All art is original and generated in code: facade textures, models, sky and water.

## Graphics presets

| Setting | Low | **Medium (default)** | High | Ultra* |
|---|---|---|---|---|
| Resolution scale | 70% | 85% | 100% | 100% |
| Shadow quality | Off | Low (1024², 34 m) | Medium (2048², 50 m) | High (2048², 75 m) |
| Draw distance | 320 m | 470 m | 650 m | 650 m |
| Traffic (cars) | 14 | 24 | 24 | 34 |
| Pedestrians | 18 | 32 | 32 | 46 |
| Reflections | Off | Basic | Basic | Basic |
| Post-processing | Off | Minimal (grade + vignette) | Light (+ quarter-res bloom) | Light |
| MSAA | Off | 2× | 4× | 4× |

\*Ultra is meant for stronger GPUs and is not expected to hold 60 FPS on a 1050 Ti everywhere. You can change any setting individually; the preset then shows as *custom*.

**Auto performance adjust** (on by default, target 60 FPS) watches frame time. When the average stays above target, it steps down in this order: resolution scale (5% steps, down to 55%), then world density (traffic and pedestrians), then shadow quality. It restores them in reverse when there's headroom, with hysteresis and a cooldown so it doesn't oscillate.

## Performance engineering

| Technique | Where |
|---|---|
| WebGL2 renderer, half-float HDR target, ACES tone map | `core/RenderPipeline.ts` |
| Dynamic resolution without reallocation (scaled viewport inside a full-size target, then upsampled) | `RenderPipeline.render` |
| Chunk streaming (144 m chunks): meshes built at most 1–2 per frame, unloaded with hysteresis; static colliders streamed separately around the player | `world/CityRenderer.ts` |
| Distance LOD tiers: near (props, street furniture, shadow casters) / mid (buildings, palms, neon) / far (skyline only, tallest buildings first) | `CityRenderer.update` |
| GPU instancing everywhere: one draw call per object kind per chunk; all vehicles in ~18 calls; all humanoids in 6 calls | `CityRenderer`, `VehicleRenderer`, `CharacterRenderer` |
| Per-instance CPU frustum and distance culling for dynamic instances; wheel LOD beyond 110 m | `VehicleRenderer.update`, `CharacterRenderer.update` |
| Texture atlas: one 1024² facade atlas for every building (window masks in alpha drive night lighting and sky reflections) | `world/Materials.ts` |
| Procedural roads, lane markings, crosswalks and street-light pools in one ground shader, so there are no road meshes or real lights | `createGroundMaterial`, `createSlabMaterial` |
| Simulated AO: ground-contact darkening in the facade shader | `createBuildingMaterial` |
| Lightweight water: analytic waves, fresnel, sky reflection and sun glint, with no reflection pass and no textures | `world/Environment.ts` |
| Sky and water drawn after opaque geometry, so hidden pixels are rejected by the depth test | `Environment` |
| One dynamic shadow-casting light, a snapped shadow frustum that follows the player, and a shadow size per preset | `Environment.update` |
| Limited transparency: particles (2 pooled draw calls), tracers and mission beams only | `entities/Effects.ts`, `gameplay/Markers.ts` |
| Fixed 60 Hz physics with render interpolation, which keeps motion smooth on high-refresh monitors | `Game.frame` |
| Kinematic lane-following traffic (no rigid-body cost) that becomes physics only on crash or carjack; distant traffic ticks at ½ or ¼ rate; distant idle physics cars sleep | `entities/Traffic.ts`, `Game.fixedStep` |
| Pedestrian object pool; sidewalk walkers need no physics; distant peds update at ⅓ rate; only combat NPCs get capsules | `entities/Peds.ts` |
| Spatial hash grid for traffic look-ahead; staggered line-of-sight raycasts for the police | `core/util.ts`, `entities/Police.ts` |
| Police units capped per preset (3 / 4 / 5) | `Police.update` |
| Shared geometries and materials, cuboid-only static colliders | throughout |

**Compressed textures:** the game ships no texture files. Every texture is generated at startup, and the only sizeable one is the 1024² atlas, which isn't worth transcoding at runtime. The F3 overlay reports which compressed formats your GPU supports (S3TC/BPTC on desktop NVIDIA), in case you add authored KTX2 assets later.

### Performance overlay (F3)

The overlay shows current, average and 1%-low FPS, frame time, draw calls, triangles, active and drawn NPCs, vehicles and police units, loaded chunks and physics chunks, static colliders, particles, render resolution, preset and auto-adjust state, the GPU and OS, and **estimated** GPU memory. The memory figure is computed from buffer, texture, render-target and shadow-map sizes; browsers don't expose real VRAM usage, so it is labelled as an estimate.

### Measured render load

These are draw calls and triangles per frame, including shadow and post passes, at three fixed viewpoints at 1920×1080. They were measured with `npm run bench:presets` in headless Chromium:

| Preset | Draw calls | Triangles | Internal resolution |
|---|---|---|---|
| Low | 68–80 | 14k–23k | 1344×756 |
| Medium | 118–134 | 32k–45k | 1632×918 |
| High | 123–156 | 34k–49k | 1920×1080 |
| Ultra | 126–163 | 40k–54k | 1920×1080 |

This geometry load is small for a GTX 1050 Ti. The main GPU costs are pixel fill (resolution, MSAA), shadow-map rendering and bloom, which are exactly the settings the presets and the auto-adjuster scale.

## Tests

```bash
npm run build && npx vite preview &      # serve the production build on :4173
npm run test:physics     # headless vehicle tuning (0-100, top speed, braking, stability)
npm run test:gameplay    # 16 checks: driving, traffic, police dispatch/pursuit/escape, combat, explosions, missions, death/respawn
npm run test:missions    # drives all 6 missions through every step to completion
npm run test:smoke       # loads the game, plays briefly, saves screenshots, reports console errors
npm run bench:presets    # draw calls / triangles per preset
```

The browser tests use Playwright's Chromium. They step the simulation with synthetic timestamps, so the results don't depend on the software renderer's frame rate.

## Project layout

```
src/
  core/       Game loop, render pipeline, physics wrapper, input, settings, perf monitor, audio
  world/      City layout generator, chunk streaming renderer, shaders/materials, sky/water/day-night, traffic lights
  entities/   Player, vehicles (+ models, instanced renderer), traffic, pedestrians, police, weapons, effects, pickups
  gameplay/   Missions (data-driven step engine), mission markers
  ui/         HUD, minimap, full-screen map, settings menu
scripts/      Launcher + automated tests/benchmarks
```

## Known limitations / next steps

* Characters and vehicles are low-poly box models with procedural animation; there are no skinned meshes.
* Pedestrians stay on the sidewalks and don't cross streets.
* There are no police helicopters, boats, interiors or radio stations.
* FPS has not been measured on the target hardware yet. Run the game with F3 open to see it.
