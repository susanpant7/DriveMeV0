# DriveMe

Browser driving trainer: first-person cabin view, three working mirrors, lane changes. Crash = game over.

```
npm install
npm run dev
```

## Controls
| Key | Action |
|---|---|
| **↑** (hold) / release | accelerator: keeps speeding up while held, you slow down (engine braking + drag) when you let go |
| **↓** | brake |
| **←** / **→** | steer (hold) |
| **Q** / **E** | left / right indicator |
| hold **A** / **W** / **D** | look at left mirror / rear-view / right mirror |
| **Esc** or **P** | pause (also pauses when the tab loses focus) |
| **U** | switch km/h <-> mph (menu / pause screen) |
| **1**-**5** | traffic level: 1 = about 20 cars, 5 = about 400 cars in the city (menu / pause screen) |
| **M** | mute |
| **Enter** | start / restart |

Add `?lowfx` to the URL to switch the post-processing off on slower machines.

## The city
A 4x4 grid of junctions repeats forever (800 m period): 12 signalled junctions and 4 roundabouts, three lanes each way,
right-hand traffic. Overhead gantry signs, street-name plates, speed-limit / pedestrian / signal / roundabout / give-way
signs, painted lane arrows, a lane-use sign, zebra crossings, stop lines and mast-arm traffic lights.

## Rules the game checks
- lane changes: indicator (on >= 1 s before), side-mirror and rear-view glance
- turns at junctions: indicate before turning
- red lights: running one costs points, stopping correctly earns points
- roundabouts: give way to circulating traffic, indicate right when leaving
- speeding, wrong side of the road, off the road, and any collision ends the game

## Structure
- `src/game/map.ts` – the road network (lane paths, junctions, roundabouts), traffic-light timing, building lots.
- `src/game/trafficAI.ts` – AI cars: follow lane paths, IDM car-following, obey lights, give way at roundabouts.
- `src/game/sim.ts` – player physics (pedals, steering) and the rules engine. Plain TS, no rendering.
- `src/game/cityBuild.ts` / `City.tsx` – builds and draws the city (chunked, culled), signs atlas, signal lamps.
- `src/game/PlayerRig.tsx`, `Cabin.tsx`, `mirrorGeom.ts` – cabin, camera, mirrors.
- `src/ui/Hud.tsx` – overlay, settings.

## Realism notes
- **Mirrors** are true planar reflections (`three` `Reflector`), angled like a real adjusted mirror. Glancing turns the head part-way and leans; there is no zoom. The blind spot comes from the optics.
- **Lighting:** photographic HDRI sky (sun direction read from the HDRI drives the shadow-casting light), PBR asphalt/grass, soft shadows, post-processing (ambient occlusion, bloom, filmic tone mapping, vignette, SMAA).
- **Credits:** HDRI and textures are CC0 from [Poly Haven](https://polyhaven.com) (see `public/CREDITS.txt`).
