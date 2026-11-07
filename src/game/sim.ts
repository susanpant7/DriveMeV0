import { crashSound, initAudio, tick } from './audio'
import { LINKS, PIECES, rbShift, SPEED_LIMIT, clearance, nodeIndex, B, BOX, HALF_ROAD, LANE_W, P, dirv, inIsland, insideBuilding, laneOff, mod, nearestNode, onAsphalt, signalColor, wrapD } from './map'
import { nav, navJunctionExit, navUpdate, startRoute } from './nav'
import { realNavUpdate, rnav, startRealRoute } from '../real/nav'
import { locate } from '../real/player'
import { realSignal, axisOf } from '../real/signals'
import { initRealTraffic, setRealCount, stepRealTraffic } from '../real/traffic'
import { edgeAt } from '../real/graph'
import { WORLD, inRealBuilding } from '../real/world'
import { initialHud, useGame, type Look, type Msg, type Signal } from './store'
import { CAR_L, CAR_W, cars, initTraffic, ringBusy, setActiveCount, stepTraffic, type AiCar } from './trafficAI'

export { CAR_L, CAR_W }
export const WHEELBASE = 2.7
export const LIMIT = SPEED_LIMIT // city speed limit: 30 mph (about 48 km/h), in m/s
export const TRAFFIC_LEVELS = [30, 110, 280, 520, 850]

// Rules-engine tuning
const SIGNAL_MIN = 1.0 // signal must be on this long before moving
const SIDE_CHECK_WINDOW = 5 // side-mirror glance must be this recent
const REAR_CHECK_WINDOW = 8 // rear-view glance must be this recent
const GLANCE_TIME = 0.3 // a glance only counts after looking this long

/* ---------- input & simulation state (read by r3f components each frame) ---------- */
export const input = { look: 'front' as Look, up: false, down: false, left: false, right: false }

interface Maneuver {
  dir: -1 | 1
  k0: number
  target: number
  infractions: string[]
}
interface JunctionVisit {
  n: number
  i: number // unwrapped grid position of the junction (for following the route)
  j: number
  kind: 'signal' | 'round'
  h0: number
  sig: Signal
  yieldFail: boolean
}
interface StopTrack {
  n: number
  d: number
  prevU: number
  passed: boolean
  credited: boolean
}

export const sim = {
  t: 0,
  x: 0,
  z: 0,
  h: 0, // heading; forward = (-sin h, -cos h)
  speed: 0,
  thr: 0,
  brk: 0,
  steerIn: 0, // -1 (left) .. 1 (right)
  steer: 0, // road-wheel angle, rad (right positive)
  rpm: 900,
  gear: 1,
  tickT: 0,
  signal: 0 as Signal,
  signalSince: 0,
  look: 'front' as Look,
  lookSince: 0,
  lastCheck: { left: -99, center: -99, right: -99 },
  score: 0,
  changes: 0,
  clean: 0,
  crashT: 0,
  hudTimer: 0,
  msgId: 0,
  man: null as Maneuver | null,
  jn: null as JunctionVisit | null,
  stop: null as StopTrack | null,
  warnT: { off: -99, centre: -99, wrong: -99, speed: -99 },
  speedingFor: 0,
  trip: 0,
  offRoadT: 0,
  errors: 0,
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const normAngle = (a: number) => mod(a + Math.PI, Math.PI * 2) - Math.PI
const playerObs = () => (WORLD.real ? { x: sim.x, z: sim.z, h: sim.h, speed: sim.speed } : { x: mod(sim.x, P), z: mod(sim.z, P), h: sim.h, speed: sim.speed })

/* ---------- lifecycle ---------- */
export function resetSim() {
  const pose = WORLD.real ? startRealRoute() : startRoute(useGame.getState().mode) // where the practice route starts
  Object.assign(sim, {
    t: 0, x: pose.x, z: pose.z, h: pose.h, speed: 0, thr: 0, brk: 0, steerIn: 0, steer: 0, rpm: 900, gear: 1, tickT: 0,
    signal: 0, signalSince: 0, look: 'front', lookSince: 0, lastCheck: { left: -99, center: -99, right: -99 },
    score: 0, changes: 0, clean: 0, crashT: 0, hudTimer: 0, man: null, jn: null, stop: null,
    warnT: { off: -99, centre: -99, wrong: -99, speed: -99 }, speedingFor: 0, trip: 0, offRoadT: 0, errors: 0,
  })
  input.look = 'front'
  input.up = input.down = input.left = input.right = false
  if (WORLD.real) initRealTraffic()
  else initTraffic()
  applyTraffic()
}
export function applyTraffic() {
  const n = TRAFFIC_LEVELS[useGame.getState().traffic - 1]
  if (WORLD.real) setRealCount(Math.round(n * 0.55), playerObs()) // real streets are narrower: fewer cars than the grid city for the same feel
  else setActiveCount(n, playerObs())
}
resetSim()

export function startGame() {
  initAudio()
  resetSim()
  useGame.setState({ status: 'playing', pauseReason: 'user', messages: [], crashReason: '', crashTips: [], hud: { ...initialHud } })
}

export function goMenu() {
  input.look = 'front'
  input.up = input.down = input.left = input.right = false
  useGame.setState({ status: 'menu', pauseReason: 'user' })
}

export function pauseGame() {
  if (useGame.getState().status !== 'playing') return
  input.look = 'front'
  input.up = input.down = input.left = input.right = false
  useGame.setState({ status: 'paused', pauseReason: 'user' })
}

export function resumeGame() {
  if (useGame.getState().status !== 'paused') return
  if (useGame.getState().pauseReason === 'offroad') recoverToRoad()
  applyTraffic()
  useGame.setState({ status: 'playing', pauseReason: 'user' })
}

/** Put the car back on the nearest road, in the right-hand lane, facing the way it was heading. */
function recoverToRoad() {
  if (WORLD.real) {
    // nearest real road: the lane on its right, facing the way we were heading, at rest
    const n = WORLD.index!.nearest(sim.x, sim.z) ?? { edge: WORLD.graph!.edges[0], s: 5, d: 0, side: 0 }
    let e = n.edge
    const t = { x: 0, z: 0, dx: 0, dz: 0 }
    edgeAt(e, n.s, t)
    let s = Math.min(Math.max(n.s, 6), e.len - 6)
    if (t.dx * -Math.sin(sim.h) + t.dz * -Math.cos(sim.h) < 0 && e.reverse >= 0) { e = WORLD.graph!.edges[e.reverse]; s = Math.min(Math.max(e.len - n.s, 6), e.len - 6) }
    edgeAt(e, s, t)
    const lane = e.oneWay ? Math.floor((e.lanes - 1) / 2) : e.lanes - 1
    const off = e.oneWay ? (lane - (e.lanes - 1) / 2) * 3.4 : (lane + 0.5) * 3.4
    const x = t.x - t.dz * off, z = t.z + t.dx * off
    Object.assign(sim, { x, z, h: Math.atan2(-t.dx, -t.dz), speed: 0, thr: 0, brk: 0, steerIn: 0, steer: 0, signal: 0, man: null, jn: null, stop: null, offRoadT: 0 })
    for (const c of cars) if (c.active && Math.hypot(c.x - x, c.z - z) < 20) c.active = false
    return
  }
  const nn = nearestNode(sim.x, sim.z)
  const clr = clearance(nn.i, nn.j) + 10
  const fx = -Math.sin(sim.h)
  const fz = -Math.cos(sim.h)
  const lane = laneOff(1) // the outer lane of the 2-lane road
  let x: number, z: number, h: number
  if (Math.abs(nn.rx) <= Math.abs(nn.rz)) {
    // nearest road runs north-south (x = the node's column)
    const north = fz < 0
    x = nn.cx + (north ? lane : -lane)
    z = nn.cz + (nn.rz < 0 ? -1 : 1) * Math.max(Math.abs(nn.rz), clr)
    h = north ? 0 : Math.PI
  } else {
    // nearest road runs east-west
    const east = fx > 0
    z = nn.cz + (east ? lane : -lane)
    x = nn.cx + (nn.rx < 0 ? -1 : 1) * Math.max(Math.abs(nn.rx), clr)
    h = east ? -Math.PI / 2 : Math.PI / 2
  }
  Object.assign(sim, { x, z, h, speed: 0, thr: 0, brk: 0, steerIn: 0, steer: 0, signal: 0, man: null, jn: null, stop: null, offRoadT: 0 })
  // clear any traffic standing where we're being placed
  for (const c of cars) {
    if (c.active && Math.hypot(wrapD(c.x - mod(x, P)), wrapD(c.z - mod(z, P))) < 20) c.active = false
  }
}

function pauseOffRoad() {
  input.look = 'front'
  input.up = input.down = input.left = input.right = false
  useGame.setState({ status: 'paused', pauseReason: 'offroad' })
}

export function toggleSignal(dir: -1 | 1) {
  if (useGame.getState().status !== 'playing') return
  sim.signal = sim.signal === dir ? 0 : dir
  sim.signalSince = sim.t
}

/* ---------- messages ---------- */
function say(text: string, kind: Msg['kind']) {
  if (kind === 'warn') sim.errors++
  const msg: Msg = { id: ++sim.msgId, text, kind, until: sim.t + 4.5 }
  useGame.setState((s) => ({ messages: [...s.messages.filter((m) => m.until > sim.t).slice(-3), msg] }))
}

/* ---------- per-frame step ---------- */
export function stepSim(dt: number) {
  const status = useGame.getState().status
  if (status === 'crashed') {
    sim.crashT += dt
    return
  }
  if (status !== 'playing') return
  sim.t += dt

  const onRoad = WORLD.real ? WORLD.onRoad(sim.x, sim.z) : onAsphalt(sim.x, sim.z)

  // ---- pedals and longitudinal dynamics ----
  const thrT = input.up ? 1 : 0
  const brkT = input.down ? 1 : 0
  sim.thr += (thrT - sim.thr) * Math.min(1, dt * (thrT ? 2.5 : 5))
  sim.brk += (brkT - sim.brk) * Math.min(1, dt * (brkT ? 7 : 10))
  const v = sim.speed
  const aEng = sim.thr * 3.8 * Math.max(0, 1 - (v / 44) ** 2)
  const drag = v > 0.05 ? 0.25 + 0.0009 * v * v : 0 // rolling + air resistance
  const engBrake = (1 - sim.thr) * (v > 0.2 ? 0.7 : 0) // lifting off the pedal slows the car
  const aBrk = sim.brk * 8.5
  const aOff = !onRoad && v > 0.05 ? 5 : 0
  sim.speed = Math.max(0, v + (aEng - drag - engBrake - aBrk - aOff) * dt)
  updateEngine(dt)

  // ---- steering (bicycle model) ----
  const target = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const rate = target ? 2.2 : 3.5
  sim.steerIn += clamp(target - sim.steerIn, -rate * dt, rate * dt)
  sim.steer = sim.steerIn * (0.55 / (1 + (sim.speed / 9) ** 2))
  sim.h += -(sim.speed / WHEELBASE) * Math.tan(sim.steer) * dt
  sim.x += -Math.sin(sim.h) * sim.speed * dt
  sim.z += -Math.cos(sim.h) * sim.speed * dt
  sim.trip += sim.speed * dt

  // indicator ticking
  if (sim.signal !== 0) {
    sim.tickT += dt
    if (sim.tickT > 0.35) { sim.tickT = 0; tick() }
  } else sim.tickT = 0

  // ---- looking at mirrors: a glance only counts after a short dwell ----
  if (input.look !== sim.look) {
    sim.look = input.look
    sim.lookSince = sim.t
  }
  if (sim.look !== 'front' && sim.t - sim.lookSince >= GLANCE_TIME) sim.lastCheck[sim.look] = sim.t

  // ---- hard obstacles ----
  if (!WORLD.real && inIsland(sim.x, sim.z)) return crash('You drove into the roundabout island.', ['Go around the island, keeping it on your left.'])
  const fx = -Math.sin(sim.h)
  const fz = -Math.cos(sim.h)
  const rx = Math.cos(sim.h)
  const rz = -Math.sin(sim.h)
  for (const [a, b] of [[2, 0.9], [2, -0.9], [-2, 0.9], [-2, -0.9], [0, 0]]) {
    const bx = sim.x + fx * a + rx * b, bz = sim.z + fz * a + rz * b
    if (WORLD.real ? !WORLD.onRoad(bx, bz) && inRealBuilding(bx, bz) : insideBuilding(bx, bz)) return crash('You hit a building.', ['Stay on the road.'])
  }
  // leaving the road stops the game (resume puts you back on it)
  sim.offRoadT = onRoad ? 0 : sim.offRoadT + dt
  if (sim.offRoadT > 0.5) return pauseOffRoad()

  // ---- traffic ----
  if (WORLD.real) stepRealTraffic(dt, sim.t, playerObs())
  else stepTraffic(dt, sim.t, playerObs())
  for (const c of cars) {
    if (c.active && hits(c)) return crashInto(c)
  }

  // ---- navigation ----
  if (WORLD.real) {
    const m = realNavUpdate(sim.x, sim.z, sim.h)
    if (m) say(m, m.startsWith('You have') ? 'good' : 'warn')
  } else {
    const arrivedAt = navUpdate(sim.x, sim.z)
    if (arrivedAt) say(`You have arrived: ${arrivedAt}`, 'good')
  }

  // ---- rules ----
  if (WORLD.real) trackRealRules()
  else {
    trackLane()
    trackJunction()
    trackStop()
  }
  trackSpeed(dt)

  sim.hudTimer += dt
  if (sim.hudTimer > 0.1) {
    sim.hudTimer = 0
    syncHud()
  }
}

const RATIOS = [90, 55, 38, 29, 24, 20] // rpm per km/h in gears 1..6
function updateEngine(dt: number) {
  const kmh = sim.speed * 3.6
  let g = RATIOS.findIndex((r) => kmh * r < 2800)
  if (g < 0) g = RATIOS.length - 1
  const target = Math.max(850, kmh * RATIOS[g]) + sim.thr * 900
  sim.rpm += (target - sim.rpm) * (1 - Math.exp(-6 * dt))
  sim.gear = g + 1
}

/* ---------- collisions (oriented boxes, separating-axis test) ---------- */
function hits(c: AiCar) {
  const ox = sim.x + wrapD(c.x - sim.x)
  const oz = sim.z + wrapD(c.z - sim.z)
  const dx = ox - sim.x
  const dz = oz - sim.z
  if (dx * dx + dz * dz > 36) return false
  const axes: Array<[number, number]> = [
    [-Math.sin(sim.h), -Math.cos(sim.h)], [Math.cos(sim.h), -Math.sin(sim.h)],
    [-Math.sin(c.h), -Math.cos(c.h)], [Math.cos(c.h), -Math.sin(c.h)],
  ]
  const hl = CAR_L / 2 - 0.15
  const hw = CAR_W / 2 - 0.08
  const radius = (h: number, ax: number, az: number) =>
    Math.abs(-Math.sin(h) * ax - Math.cos(h) * az) * hl + Math.abs(Math.cos(h) * ax - Math.sin(h) * az) * hw
  for (const [ax, az] of axes) {
    if (Math.abs(dx * ax + dz * az) > radius(sim.h, ax, az) + radius(c.h, ax, az)) return false
  }
  return true
}

function crashInto(c: AiCar) {
  const ox = wrapD(c.x - sim.x)
  const oz = wrapD(c.z - sim.z)
  const along = ox * -Math.sin(sim.h) + oz * -Math.cos(sim.h)
  const headingDiff = Math.abs(normAngle(c.h - sim.h))
  const tips: string[] = []
  let reason: string
  if (sim.man) {
    const side = sim.man.dir < 0 ? 'left' : 'right'
    reason = `You merged into a car in the ${side} lane.`
    tips.push(...sim.man.infractions)
    if (!tips.length) tips.push('You did the checks, but the gap was too small. Wait for a bigger gap and remember the blind spot.')
  } else if (headingDiff > 2.2) {
    reason = 'Head-on collision with oncoming traffic.'
    tips.push('Stay on your side of the road, and give way to oncoming traffic when turning across it.')
  } else if (headingDiff > 0.9) {
    reason = 'You collided with crossing traffic.'
    tips.push('Obey the traffic lights and give way at junctions and roundabouts.')
  } else if (along > 0) {
    reason = 'You rear-ended the car ahead.'
    tips.push('Brake early and keep a safe distance.')
  } else {
    reason = 'A car hit you from behind.'
    tips.push('Avoid braking hard with traffic close behind and check your rear-view mirror.')
  }
  crash(reason, tips)
}

function crash(reason: string, tips: string[]) {
  sim.crashT = 0
  crashSound()
  useGame.setState({ status: 'crashed', crashReason: reason, crashTips: tips })
  syncHud()
}

/* ---------- rules: lane changes ---------- */
function laneInfo() {
  const nn = nearestNode(sim.x, sim.z)
  const clr = nn.spec ? nn.spec.outer : BOX
  const fx = -Math.sin(sim.h)
  const fz = -Math.cos(sim.h)
  const xm = mod(sim.x + B / 2, B) - B / 2
  const zm = mod(sim.z + B / 2, B) - B / 2
  let d = -1
  let r = 0
  if (Math.abs(xm) < HALF_ROAD + 0.3 && Math.abs(zm) > clr + 3 && Math.abs(fz) > 0.9) {
    d = fz > 0 ? 3 : 1
    r = xm * dirv(d - 1)[0]
  } else if (Math.abs(zm) < HALF_ROAD + 0.3 && Math.abs(xm) > clr + 3 && Math.abs(fx) > 0.9) {
    d = fx > 0 ? 0 : 2
    r = zm * dirv(d - 1)[1]
  }
  if (d < 0) return null
  // near a roundabout the lanes flare outward beside the splitter island: measure from the shifted lane edge
  if (nn.kind === 'round' && r > 0) r = Math.max(0, r - rbShift((d % 2 === 0 ? Math.abs(xm) : Math.abs(zm)) - clr))
  return { d, r, k: r < 0 ? -1 : r < LANE_W ? 0 : r < 2 * LANE_W ? 1 : r < 3 * LANE_W ? 2 : 3 }
}

function trackLane() {
  const L = laneInfo()
  if (!L || sim.speed < 3) {
    sim.man = null
    return
  }
  const { k, r } = L
  if (!sim.man) {
    if (k >= 0 && k <= 2) {
      const e = r - laneOff(k)
      if (Math.abs(e) > 1.15) {
        const dir: -1 | 1 = e < 0 ? -1 : 1
        const target = k + dir
        if (target < 0) {
          if (sim.t - sim.warnT.centre > 3) {
            sim.warnT.centre = sim.t
            say('Do not cross the double yellow line!', 'warn')
          }
        } else if (target <= 2) startManeuver(dir, k, target)
      }
    } else if (k === -1 && sim.t - sim.warnT.wrong > 3) {
      sim.warnT.wrong = sim.t
      say('You are on the wrong side of the road!', 'warn')
    }
    return
  }
  const m = sim.man
  if (k === m.target && Math.abs(r - laneOff(k)) < 0.9) finishManeuver(m)
  else if (k === m.k0 && Math.abs(r - laneOff(k)) < 0.5) sim.man = null // changed their mind
  else if (k !== m.k0 && k !== m.target) sim.man = null
}

function startManeuver(dir: -1 | 1, k0: number, target: number) {
  const side = dir < 0 ? 'left' : 'right'
  const infractions: string[] = []
  if (sim.signal !== dir) infractions.push(`No ${side} signal`)
  else if (sim.t - sim.signalSince < SIGNAL_MIN) infractions.push('Signalled too late')
  if (sim.t - sim.lastCheck[side] > SIDE_CHECK_WINDOW) infractions.push(`Did not check ${side} mirror`)
  if (sim.t - sim.lastCheck.center > REAR_CHECK_WINDOW) infractions.push('Did not check rear-view mirror')
  sim.man = { dir, k0, target, infractions }
  infractions.forEach((m) => say(m, 'warn'))
}

function finishManeuver(m: Maneuver) {
  sim.man = null
  sim.changes++
  if (sim.signal === m.dir) sim.signal = 0
  if (m.infractions.length === 0) sim.clean++
}

/* ---------- rules: turns and roundabouts ---------- */
function trackJunction() {
  const nn = nearestNode(sim.x, sim.z)
  const inside = nn.kind === 'signal' ? Math.abs(nn.rx) < BOX + 1 && Math.abs(nn.rz) < BOX + 1 : Math.hypot(nn.rx, nn.rz) < nn.spec!.outer
  if (inside && !sim.jn) {
    sim.jn = { n: nn.n, i: nn.i, j: nn.j, kind: nn.kind, h0: sim.h, sig: sim.signal, yieldFail: false }
    if (nn.kind === 'round') {
      const arm = mod(Math.round(Math.atan2(-nn.rz, nn.rx) / (Math.PI / 2)), 4)
      if (ringBusy(nn.n, arm, playerObs()) && sim.speed > 2) {
        sim.jn.yieldFail = true
        say('Yield to traffic already on the roundabout!', 'warn')
      }
    }
  } else if (!inside && sim.jn) {
    const jn = sim.jn
    sim.jn = null
    // which way did we leave? (from where we are relative to the junction: more reliable than the heading mid-turn)
    const dOut = Math.abs(nn.rx) > Math.abs(nn.rz) ? (nn.rx > 0 ? 0 : 2) : nn.rz > 0 ? 3 : 1
    if (navJunctionExit(jn.i, jn.j, dOut) === 'wrong') say('Wrong turn: recalculating the route', 'warn')
    const dh = normAngle(sim.h - jn.h0) // positive = turned left
    if (jn.kind === 'signal') {
      if (Math.abs(dh) < 0.6) return
      const want: Signal = dh > 0 ? -1 : 1
      sim.changes++
      if (jn.sig === want) sim.clean++
      else say(`Signal ${dh > 0 ? 'left' : 'right'} before you turn`, 'warn')
    } else if (!jn.yieldFail) {
      sim.changes++
      if (jn.sig === 1 || sim.signal === 1) sim.clean++
      else say('Signal right when you leave a roundabout', 'warn')
    }
    sim.signal = 0
  }
}

/* ---------- rules: traffic lights ---------- */
function trackStop() {
  const nn = nearestNode(sim.x, sim.z)
  const rbSig = !!nn.spec?.signals // a signalised roundabout has its own stop lines, before the crosswalk
  if (nn.kind !== 'signal' && !rbSig) {
    sim.stop = null
    return
  }
  const fx = -Math.sin(sim.h)
  const fz = -Math.cos(sim.h)
  const half = nn.spec ? nn.spec.outer : BOX
  const LINE = rbSig ? half + 17 : BOX + 2
  for (let d = 0; d < 4; d++) {
    const [ox, oz] = dirv(d)
    const [lx, lz] = dirv(d + 1)
    const u = nn.rx * ox + nn.rz * oz
    const lat = nn.rx * lx + nn.rz * lz
    if (u <= 0 || u > half + 45 || Math.abs(lat) > HALF_ROAD + 1.5 || fx * ox + fz * oz > -0.6) continue
    let st = sim.stop
    if (!st || st.n !== nn.n || st.d !== d) st = sim.stop = { n: nn.n, d, prevU: u, passed: false, credited: false }
    // the left lane has its own left-turn arrow; everyone else follows the through signal
    const col = signalColor(nn.n, d % 2 === 0 ? 0 : 1, sim.t, laneInfo()?.k === 0 ? 'L' : 'T')
    if (!st.passed && st.prevU >= LINE && u < LINE) {
      st.passed = true
      if (col === 2 && sim.speed > 0.5) {
        say('You ran a red light!', 'warn')
      }
    }
    if (!st.passed && !st.credited && sim.speed < 0.3 && u > LINE && u < LINE + 22 && col !== 0) {
      st.credited = true
    }
    st.prevU = u
    return
  }
  sim.stop = null
}

/** Rules on real streets: wrong side of the road, and red lights at signals. */
const rstop = { edge: -1, prev: 99, done: false }
function trackRealRules() {
  const loc = locate(sim.x, sim.z, sim.h)
  if (!loc || loc.d > loc.e.width / 2 + 0.5) return
  const { e, s, d, side } = loc
  // two-way road: keep to the right of the centre line
  if (!e.oneWay && sim.speed > 2 && d > 0.8 && side < -0.3) {
    if (sim.t - sim.warnT.wrong > 3) { sim.warnT.wrong = sim.t; say('You are on the wrong side of the road!', 'warn') }
  }
  // red light: crossing the stop line (about 11 m before the junction) while the light is red
  const node = WORLD.graph!.nodes.get(e.to)!
  const toEnd = e.len - s
  if (!node.signal) { rstop.edge = -1; return }
  if (rstop.edge !== e.id) { rstop.edge = e.id; rstop.prev = toEnd; rstop.done = false }
  edgeAt(e, e.len - 0.5, {x: 0, z: 0, dx: 0, dz: 0})
  const t = { x: 0, z: 0, dx: 0, dz: 0 }
  edgeAt(e, e.len - 0.5, t)
  const col = realSignal(node.id, axisOf(t.dx, t.dz), sim.t)
  if (!rstop.done && rstop.prev >= 11 && toEnd < 11) {
    rstop.done = true
    if (col === 2 && sim.speed > 0.5) say('You ran a red light!', 'warn')
  }
  rstop.prev = toEnd
}

function currentLimit() {
  if (!WORLD.real) return LIMIT
  return locate(sim.x, sim.z, sim.h)?.e.speed ?? LIMIT
}

function trackSpeed(dt: number) {
  const limit = currentLimit()
  if (sim.speed > limit * 1.12) sim.speedingFor += dt
  else sim.speedingFor = 0
  if (sim.speedingFor > 2 && sim.t - sim.warnT.speed > 6) {
    sim.warnT.speed = sim.t
    const u = useGame.getState().units
    say(`Speeding! The limit is ${u === 'kmh' ? Math.round((limit * 3.6) / 5) * 5 + ' km/h' : Math.round((limit * 2.237) / 5) * 5 + ' mph'}`, 'warn')
  }
}

function syncHud() {
  useGame.setState((s) => ({
    hud: {
      speed: sim.speed,
      signal: sim.signal,
      look: sim.look,
      checks: {
        left: sim.t - sim.lastCheck.left < SIDE_CHECK_WINDOW,
        center: sim.t - sim.lastCheck.center < REAR_CHECK_WINDOW,
        right: sim.t - sim.lastCheck.right < SIDE_CHECK_WINDOW,
      },
      score: sim.score,
      distance: 0,
      changes: sim.changes,
      clean: sim.clean,
      errors: sim.errors,
      limit: currentLimit(),
    },
    nav: { text: nav.text, sub: nav.sub, icon: nav.icon, dist: nav.dist, arrived: nav.arrived },
    messages: s.messages.filter((m) => m.until > sim.t),
  }))
}

// handy for debugging in the browser console
if (typeof window !== 'undefined') Object.assign(window, { __sim: sim, __cars: cars, __step: stepSim, __input: input, __start: startGame, __store: useGame, __resume: resumeGame, __onRoad: onAsphalt, __pieces: PIECES, __signal: signalColor, __nodeIndex: nodeIndex, __links: LINKS, __nav: nav, __rnav: rnav, __world: WORLD, __edgeAt: edgeAt, __realSignal: realSignal, __axisOf: axisOf, __navfn: { startRoute, navUpdate, navJunctionExit } })
