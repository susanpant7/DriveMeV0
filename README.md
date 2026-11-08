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
| press and drag the mouse, or swipe with two fingers on a trackpad | turn your head. Aim at a side mirror or the rear-view mirror to check it; let go and your view returns to the road. (Holding **C** or the right mouse button works too.) |
| hold **A** / **W** / **D** | optional shortcut: snap to the left mirror / rear-view / right mirror |
| **Esc** or **P** | pause (also pauses when the tab loses focus) |
| **U** | switch km/h <-> mph (menu / pause screen) |
| **1**-**5** | traffic level: 1 = about 20 cars, 5 = about 400 cars in the city (menu / pause screen) |
| **M** | mute |
| **Enter** | start / restart |

Add `?lowfx` to the URL to switch the post-processing off on slower machines.

## Phones and tablets
On touch screens (and narrow windows) on-screen buttons appear along the bottom: steer left / right (bottom left), indicators and
look-at-mirror buttons (centre, hold to look), brake and gas (bottom right). Play in landscape; portrait pauses the game and asks you to rotate.
Touch devices automatically use the lighter renderer (no post-processing, half-size mirror textures).

## Practice modes and navigation
Pick one on the menu: **City driving** (follow the map across town), **Roundabouts**, **Junctions & lights**, **Lane changes**
(a long multi-lane road). A navigation screen sits on the dash to the right of the wheel (heading-up map, blue route, next
instruction and distance) and the next instruction is also shown at the top-left. A wrong turn is flagged and the route is
recalculated; reaching the destination starts a new leg. No highway mode yet.

## The city
A 4x4 grid of junctions repeats forever (800 m period): 12 signalled junctions and 4 roundabouts, two lanes each way (a third, right-turn lane is added on the approach to each signalised junction),
right-hand traffic. Overhead gantry signs, street-name plates, speed-limit / pedestrian / signal / roundabout / give-way
signs, painted lane arrows, a lane-use sign, zebra crossings, stop lines and mast-arm traffic lights.

## Left turns: arrow or yield
Six junctions have a protected left-turn arrow (through green, then a green arrow for left turns). The other six are
"left turn yield on green": the left lane turns left on the ordinary green light and must give way to oncoming traffic (a
"LEFT TURN YIELD ON GREEN" sign hangs over the left lane). Cars and the rules check follow the same split.

## Traffic signals
Four-phase signals with protected left turns, on a 54 s cycle: north-south through + right (left turns red), north-south left arrow
(through red), then the same two phases for east-west. The left lane has its own arrow head; the other lanes show round lamps.

## Lanes
Ordinary roads are 2 lanes each way. About 110 m before a signalised junction the road widens over 30 m on the approaching side
and a third, outer lane opens: left lane = left turn, middle = straight, outer = right turn only (painted arrows and the
lane-use sign match). Roundabout approaches stay 2 lanes; AI cars enter from the outer lane.

## Roundabouts
Four different designs, one per roundabout in the city:
- **Two-lane** (big, 42 m radius, 5 m lanes): left lane straight / left (inner ring lane), right lane right / straight (outer lane).
- **Signalised** two-lane (46 m): traffic lights and stop bars at every entry, plus the yield to circulating traffic.
- **Single-lane** (27 m): one wide circulating lane, both approach lanes merge into it.
- **Mini** (16 m): a small domed island ringed with paint, painted splitters, no raised kerbs.

Every arm has a splitter island (raised, with a keep-right sign, except at the mini roundabout), a crosswalk set back from a
dashed yield line (white "shark teeth"), and roadside signs. Entrances flare outward so each lane keeps its full width.
AI cars slow down on approach, stop at the yield line if a car is coming round, and go when it is clear.

## Navigation map
A 2D screen at the bottom right, drawn on top of the game (heading-up, smoothly moving, zooming out with speed). Roads have
outlines and street names, roundabouts are drawn with their real shape, and the blue route follows the actual arc around
a roundabout and the rounded corner through a junction.

## Real cities
On the menu choose **Real city**: search any place, or pick a preset (Palo Alto, Austin, Boston, Seattle, Chicago, San Diego,
Paris, Berlin). The game downloads about 1 km² of OpenStreetMap data (roads, junctions, traffic signals, buildings), saves it on
your device (IndexedDB) so it is only downloaded once, then you drive on it with traffic, signals, speed limits and turn-by-turn
navigation. Data (c) OpenStreetMap contributors, ODbL. Left-hand-traffic countries are not supported yet.

- `src/real/osm.ts`: place search (Nominatim), download (Overpass, several servers, retries), saved-city cache.
- `src/real/graph.ts`: road network (lanes, widths, speed limits, one-ways, roundabouts, signals) and the road-surface test.
- `src/real/RealCity.tsx`: roads, lane paint, crosswalks, buildings, street trees, traffic lights.
- `src/real/traffic.ts`: AI cars (follow lanes, obey signals, take turns at unsignalised junctions, yield at roundabouts and when turning left).
- `src/real/nav.ts`: route planning, instructions, wrong-turn recalculation. `scripts/bake-city.mjs` pre-bakes a city into `public/cities/` (Palo Alto ships with the game).

## Traffic
Cars live in a window around you and are recycled once they fall behind, so level 5 (about 850 cars) is genuinely dense
near you. Levels: 30 / 110 / 280 / 520 / 850 cars.

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
