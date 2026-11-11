import { crashSound, initAudio, tick } from './audio'
import { setLayout, WORLD_PERIOD, hasLeftArrow, LINKS, PIECES, rbShift, ringDelta, SPEED_LIMIT, clearance, nodeIndex, B, BOX, HALF_ROAD, LANE_W, P, dirv, inIsland, insideBuilding, laneOff, mod, nearestNode, onAsphalt, signalColor, wrapD } from './map'
import { FRONT_PITCH, MIRROR_AIM, adjust } from './cabinConfig'
import { nav, navJunctionExit, navUpdate, startRoute, turnName } from './nav'
import { WORLD } from './course'
import { LD1, NB_EDGE_L, NB_EDGE_R, NB_X, SPAWN_Z, Z_END, Z_GORE, EXIT_C, FORK_Z, forkShift, scen, type HwType, onRoad as hwOnRoad, recoverPose, startPose } from '../highway/layout'
import { rampHeading, rampX, forkHeading, NB_X as HW_LANES } from '../highway/layout'
import { clearLane, initHighwayTraffic, setHighwayCount, stepHighwayTraffic } from '../highway/traffic'
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
export const input = {
  look: 'front' as Look,
  up: false,
  down: false,
  left: false,
  right: false,
  /** touch free-look: head turn (rad, + = left) and tilt (rad, + = up), used while `free` is true */
  free: false,
  /** set by a double tap of an arrow key: -1 = move one lane left, 1 = one lane right */
  laneShift: 0 as -1 | 0 | 1,
  /** head keys: A (left), W (up), D (right) */
  kA: false,
  kS: false,
  kW: false,
  kD: false,
  /** true while the head is being moved by the keys (the camera then follows a little more slowly) */
  slow: false,
  /** a quick tap on the Space key / centre button: wheel back to straight */
  recentre: false,
  /** a quick double tap of the accelerator: toggles cruise control */
  gasTap: false,
  yaw: 0,
  pitch: 0,
}
let freeWas = false
let headFree = false
const headSet = { y: 0, p: 0 }
const GAZE_TOL = 0.42 // rad (about 24 degrees): how close the head must point to a mirror to count as looking at it

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
  yawRate: 0,
  /** the head position set by the A / W / D keys (rad) */
  head: { yaw: 0, pitch: 0 },
  /** the steering wheel position, -1 .. 1 (+/- 1.5 turns); it stays where you leave it */
  wheel: 0,
  /** roundabout lane tracking: which node, and which circulating lane (0 inner, 1 outer) the car first took */
  rbl: { node: -1, lane: -1 },
  /** cruise control: the set speed in m/s, 0 = off */
  cruise: 0,
  trip: 0,
  offRoadT: 0,
  errors: 0,
}

/* ---------- the highway merge course ---------- */
/** points for the highway course (shown in the corner); they only ever go up */
function award(n: number) { if (n > 0) sim.score += n }

/** Move on to the next scenario: back to the start of the course, with the traffic carried along (the plain highway looks the same). */
function advanceHighway() {
  const cur = scen.type
  if (cur === 'exit' && hw.exitTaken) {
    award(100)
    say('You joined a new highway.', 'info')
    resetSim('merge', true) // the exit ramp leads onto another highway's on-ramp
    return
  }
  award(cur === 'fork' ? 50 : cur === 'merge' || (cur === 'lanedrop' && hw.crossed) ? 100 : 0)
  if (cur === 'fork') say(sim.x > 12 ? 'You are now on I-405 East.' : 'You are now on I-5 North.', 'info')
  const pool: HwType[] = ['exit', 'fork', 'lanedrop']
  const next: HwType = pool[Math.floor(Math.random() * pool.length)]
  if (next === 'lanedrop') clearLane(4)
  const baseX = sim.x - (cur === 'fork' ? forkShift(sim.z) : 0)
  const dz = SPAWN_Z - sim.z
  for (const c of cars) if (c.active) c.z += dz
  sim.z = SPAWN_Z
  sim.x = Math.max(-1, Math.min(15.5, baseX))
  sim.h = 0
  sim.yawRate = 0
  hw.stage = 'ramp'; hw.crossed = false; hw.mergedAt = 0; hw.doneT = 0; hw.sigOffWarn = false; hw.exitTaken = false; hw.warned = false
  scen.type = next
  useGame.setState((st) => ({ hwType: next, hwVersion: st.hwVersion + 1 }))
}

/** Returns true when the run ended (game over). */
function trackHighway(): boolean {
  const x = sim.x, z = sim.z
  const halfW = CAR_W / 2 + 0.05
  const type = scen.type
  {
    const lane = Math.floor((x - NB_EDGE_L) / 3.7)
    if (hw.lane !== -99 && lane !== hw.lane && sim.speed > 6 && sim.t - hw.alertT > 4 && lane >= 0 && lane <= 4 && hw.lane >= 0 && hw.lane <= 4) {
      const dir = lane > hw.lane ? 1 : -1
      if (sim.signal !== dir && !autoLane.on) { hw.alertT = sim.t; say('ALERT: you changed lanes without signalling!', 'alert') }
    }
    hw.lane = lane
  }
  sim.score += sim.speed * 0.02 // a point for every ~50 m driven safely
  const banner = (text: string, sub: string, icon: string, dist: number) => { nav.text = text; nav.sub = sub; nav.icon = icon; nav.dist = Math.max(0, dist) }
  if (type === 'merge') {
    if (z > Z_GORE) banner('Follow the on-ramp', 'Build up speed for the highway', 'S', z - Z_GORE)
    else if (hw.stage !== 'merged') banner('Merge onto the highway', sim.signal === -1 ? 'Check your mirror, then move over' : 'Signal left, check mirrors, match speed', 'M', z - Z_END)
    else banner('You are on the highway', 'Keep a safe distance', 'S', 0)
    if (hw.stage === 'ramp' && z <= Z_GORE) hw.stage = 'merge'
    if (hw.stage === 'merge') {
      if (!hw.crossed && x - halfW < NB_EDGE_R - 0.15 && z <= Z_GORE) {
        hw.crossed = true
        if (sim.signal !== -1) say('ALERT: you changed lanes without signalling!', 'alert')
        if (sim.t - sim.lastCheck.left > 6 && sim.t - sim.lastCheck.center > 6) say('Check your left mirror / blind spot before merging.', 'warn')
        if (sim.speed < 22) say('Too slow: match the speed of the highway traffic before you merge.', 'warn')
      }
      if (hw.crossed && x + halfW <= NB_EDGE_R + 0.2) { hw.stage = 'merged'; hw.mergedAt = sim.t }
      if (z <= Z_END && x > NB_EDGE_R - 0.3) return fail('The merge lane ended before you merged.', ['Start looking for a gap early: speed up along the merge lane, signal left and move over well before the lane ends.', 'If there is no gap, keep speed and look for the next one: do not stop in the merge lane.'])
    }
    if (hw.stage === 'merged' && !hw.sigOffWarn && sim.signal !== 0 && sim.t - hw.mergedAt > 5) { hw.sigOffWarn = true; say('Turn your indicator off.', 'warn') }
    if (hw.stage === 'merged' && z < Z_END - 420) advanceHighway()
    return false
  }
  if (type === 'exit') {
    const gore = EXIT_C - Z_GORE // where the ramp leaves the highway
    const start = EXIT_C - Z_END // where the exit lane begins
    if (hw.exitTaken) banner('Follow the exit ramp', 'Slow down for the ramp', 'S', z + 150)
    else if (z > gore) banner('Take the exit on the right', 'Move to the right lane and signal right', 'R', z - gore)
    else banner('Exit passed', 'Continue on the highway', 'S', 0)
    if (!hw.crossed && x - halfW > NB_EDGE_R - 0.05 && z <= start && z > gore - 20) {
      hw.crossed = true
      if (sim.signal !== 1) say('ALERT: you changed lanes without signalling!', 'alert')
      if (sim.t - sim.lastCheck.right > 6) say('Check your right mirror before moving over.', 'warn')
    }
    if (hw.crossed && !hw.exitTaken && z <= gore) hw.exitTaken = x > NB_EDGE_R
    if (hw.exitTaken && !hw.sigOffWarn && z < gore - 120 && sim.signal !== 0) { hw.sigOffWarn = true; say('Turn your indicator off.', 'warn') }
    if (z < (hw.exitTaken ? -150 : -350)) advanceHighway()
    return false
  }
  if (type === 'lanedrop') {
    const ldEdge = NB_X[3] + 1.85 // the divider between the last two lanes
    if (z > 450) banner('Right lane ends ahead', 'Signal left and move over', 'M', z - LD1)
    else banner('Lane ending', 'Move left now', 'M', z - LD1)
    if (!hw.crossed && x - halfW < ldEdge - 0.1 && z < 700) {
      hw.crossed = true
      if (sim.signal !== -1) say('ALERT: you changed lanes without signalling!', 'alert')
      if (sim.t - sim.lastCheck.left > 6) say('Check your left mirror / blind spot before moving over.', 'warn')
    }
    if (z <= LD1 + 15 && x > ldEdge) return fail('Your lane ended before you moved over.', ['Look for a gap early when you see "Right lane ends": signal, check your mirror and blind spot, then move left.'])
    if (z < -250) advanceHighway()
    return false
  }
  // fork: the right two lanes become I-405 East, the left three carry on as I-5 North
  if (z > FORK_Z) banner('Highway splits ahead', 'Left 3 lanes: I-5 North · Right 2 lanes: I-405 East', 'S', z - FORK_Z)
  else banner(x > 12 ? 'I-405 East' : 'I-5 North', 'Keep to your lane', 'S', 0)
  if (z < -300) advanceHighway()
  return false
}
function fail(reason: string, tips: string[]) {
  crash(reason, tips)
  return true
}

/** the car's self-steered lane change (double tap) */
const autoLane = { t: 0, on: false, h0: 0, dir: 1 as -1 | 1, p0: 0, w: 4.7, sig: false }

/** Space: an "auto" mode that steers the car smoothly into the middle of its lane and straightens it, then lets go */
const autoCentre = { on: false, t: 0, ok: 0 }

/** state of the highway merge attempt */
const hw = { stage: 'ramp' as 'ramp' | 'merge' | 'merged', crossed: false, mergedAt: 0, doneT: 0, sigOffWarn: false, exitTaken: false, warned: false, lane: -99, alertT: -99 }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const normAngle = (a: number) => mod(a + Math.PI, Math.PI * 2) - Math.PI
const playerObs = () => (WORLD.highway ? { x: sim.x, z: sim.z, h: sim.h, speed: sim.speed } : { x: mod(sim.x, P), z: mod(sim.z, P), h: sim.h, speed: sim.speed })

/* ---------- lifecycle ---------- */
export function resetSim(hwType: HwType = 'merge', keepScore = false) {
  const keep = keepScore ? sim.score : 0
  // the highway course is its own flat world (no wrapping); the grid city repeats every 800 m
  WORLD.highway = useGame.getState().mode === 'highway'
  WORLD_PERIOD.v = WORLD.highway ? 1e7 : P
  autoCentre.on = false
  hw.stage = 'ramp'; hw.crossed = false; hw.mergedAt = 0; hw.doneT = 0; hw.sigOffWarn = false; hw.exitTaken = false; hw.lane = -99
  if (WORLD.highway) { scen.type = hwType; useGame.setState((st) => ({ hwType, hwVersion: st.hwVersion + 1 })) }
  setLayout(useGame.getState().mode === 'roundabout')
  const pose = WORLD.highway ? startPose() : startRoute(useGame.getState().mode) // where the practice route starts
  Object.assign(sim, {
    t: 0, x: pose.x, z: pose.z, h: pose.h, speed: 0, thr: 0, brk: 0, steerIn: 0, steer: 0, rpm: 900, gear: 1, tickT: 0,
    signal: 0, signalSince: 0, look: 'front', lookSince: 0, lastCheck: { left: -99, center: -99, right: -99 },
    score: keep, changes: 0, clean: 0, crashT: 0, hudTimer: 0, man: null, jn: null, stop: null,
    warnT: { off: -99, centre: -99, wrong: -99, speed: -99 }, speedingFor: 0, trip: 0, offRoadT: 0, errors: 0, yawRate: 0, head: { yaw: 0, pitch: 0 }, wheel: 0, cruise: 0, rbl: { node: -1, lane: -1 },
  })
  input.look = 'front'
  input.up = input.down = input.left = input.right = false
  input.free = false
  input.yaw = input.pitch = 0
  if (WORLD.highway) { setHighwayCount(useGame.getState().traffic); initHighwayTraffic(pose.z) }
  else initTraffic()
  applyTraffic()
}
export function applyTraffic() {
  const n = TRAFFIC_LEVELS[useGame.getState().traffic - 1]
  if (WORLD.highway) return
  setActiveCount(useGame.getState().mode === 'roundabout' ? Math.round(n * 0.4) : n, playerObs()) // the roundabout course is a small loop: fewer cars keep it flowing
}
resetSim()

export function startGame() {
  initAudio()
  resetSim()
  useGame.setState({ status: 'playing', pauseReason: 'user', adjusting: false, messages: [], crashReason: '', crashTips: [], crashDiag: null, hud: { ...initialHud } })
}

export function goMenu() {
  input.look = 'front'
  input.up = input.down = input.left = input.right = false
  useGame.setState({ status: 'menu', pauseReason: 'user', adjusting: false })
}

export function pauseGame() {
  if (useGame.getState().status !== 'playing') return
  input.look = 'front'
  input.up = input.down = input.left = input.right = false
  input.free = false
  input.yaw = input.pitch = 0
  useGame.setState({ status: 'paused', pauseReason: 'user' })
}

export function resumeGame() {
  adjust.sel = null; adjust.dragging = false
  useGame.setState({ adjusting: false })
  if (useGame.getState().status !== 'paused') return
  if (useGame.getState().pauseReason === 'offroad') recoverToRoad()
  applyTraffic()
  useGame.setState({ status: 'playing', pauseReason: 'user' })
}

/** Put the car back on the nearest road, in the right-hand lane, facing the way it was heading. */
function recoverToRoad() {
  if (WORLD.highway) {
    const p = recoverPose(sim.x, sim.z)
    Object.assign(sim, { x: p.x, z: p.z, h: p.h, speed: 0, thr: 0, brk: 0, steerIn: 0, steer: 0, signal: 0, man: null, offRoadT: 0, yawRate: 0 })
    for (const c of cars) if (c.active && Math.hypot(c.x - p.x, c.z - p.z) < 30) c.active = false
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
  if (kind === 'warn' || kind === 'alert') sim.errors++
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

  const onRoad = WORLD.highway ? hwOnRoad(sim.x, sim.z) : onAsphalt(sim.x, sim.z)

  // ---- pedals and longitudinal dynamics ----
  if (input.down) sim.cruise = 0 // the brake switches cruise control off
  if (input.gasTap) { input.gasTap = false; if (sim.cruise) sim.cruise = 0; else if (sim.speed > 5) { sim.cruise = sim.speed; say(`Cruise control on`, 'info') } }
  const thrT = input.up ? 1 : sim.cruise ? clamp((sim.cruise - sim.speed) * 0.7 + 0.12, 0, 1) : 0
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
  const sens = [0.32, 0.46, 0.62, 0.82, 1.05][useGame.getState().steerSens - 1]
  // The arrow keys / buttons turn the wheel a little and it STAYS there (like holding a real wheel); Space centres it.
  if (input.recentre) { sim.wheel = 0; sim.head.yaw = 0; sim.head.pitch = 0; input.recentre = false; autoCentre.on = true; autoCentre.t = 0; autoCentre.ok = 0 }
  if (!autoLane.on && !autoCentre.on) sim.wheel = clamp(sim.wheel + ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 0.45 * dt, -1, 1)
  let target = sim.wheel
  // double-tap lane change: the car steers itself over to the next lane, then straightens up
  if (input.laneShift) {
    if (sim.speed > 2) {
      const h0 = Math.round(sim.h / (Math.PI / 2)) * (Math.PI / 2)
      if (Math.abs(sim.h - h0) < 0.35) {
        const rxv = Math.cos(h0), rzv = -Math.sin(h0)
        const w = WORLD.highway ? 3.7 : LANE_W
        autoLane.h0 = h0; autoLane.dir = input.laneShift; autoLane.p0 = sim.x * rxv + sim.z * rzv; autoLane.w = w
        autoLane.on = true; autoLane.t = 0; autoLane.sig = sim.signal === 0
        if (autoLane.sig) { sim.signal = input.laneShift; sim.signalSince = sim.t - SIGNAL_MIN }
      }
    }
    input.laneShift = 0
  }
  if (autoLane.on) {
    const rxv = Math.cos(autoLane.h0), rzv = -Math.sin(autoLane.h0)
    const err = autoLane.p0 + autoLane.dir * autoLane.w - (sim.x * rxv + sim.z * rzv)
    autoLane.t += dt
    const hrel = sim.h - autoLane.h0
    const des = clamp(-err * 0.045, -0.09, 0.09)
    target = -clamp(((des - hrel) * 4 * 0.7) / sens, -1, 1) // the self-steer works the same at any sensitivity
    const done = Math.abs(err) < 0.12 && Math.abs(hrel) < 0.02 && Math.abs(sim.yawRate) < 0.03
    if (done) { // settle exactly in the middle of the new lane, pointing straight
      sim.h = autoLane.h0; sim.yawRate = 0; sim.steerIn = 0
      const dx = err * rxv, dz = err * rzv; sim.x += dx; sim.z += dz
    }
    if (done || sim.speed < 1.5 || input.down || (autoLane.t > 0.6 && (input.left || input.right))) { autoLane.on = false; sim.wheel = done ? 0 : sim.wheel; target = sim.wheel; if (autoLane.sig && sim.signal === autoLane.dir) sim.signal = 0 }
  }
  if (autoCentre.on && !autoLane.on) {
    autoCentre.t += dt
    const lt = laneTarget()
    if (!lt || sim.speed < 1.5 || input.down || input.left || input.right || autoCentre.t > 12) { autoCentre.on = false; sim.wheel = 0 }
    else {
      const rx = Math.cos(lt.h), rz = -Math.sin(lt.h)
      const e = (sim.x - lt.x) * rx + (sim.z - lt.z) * rz // how far to the right of the lane centre the car is
      const hrel = Math.atan2(Math.sin(sim.h - lt.h), Math.cos(sim.h - lt.h))
      const des = clamp(e * 0.04, -0.08, 0.08)
      target = -clamp(((des - hrel) * 4 * 0.7 - sim.yawRate * 0.9) / sens, -1, 1) // the yaw-rate term damps it so it settles without wobbling
      sim.wheel = 0
      // once it has settled in the middle of the lane, pointing along it, for a moment, hand control back
      if (Math.abs(e) < 0.1 && Math.abs(hrel) < 0.012 && Math.abs(sim.yawRate) < 0.015) { autoCentre.ok += dt; if (autoCentre.ok > 0.8) { autoCentre.on = false; target = 0 } } else autoCentre.ok = 0
    }
  }
  const rate = target ? 1.5 + sens : 3
  // the wheel eases toward where you point it (and returns to centre gently), like a real wheel under the hands
  const err = target - sim.steerIn
  sim.steerIn += clamp(err * Math.min(1, dt * (target ? 5 : 7)) + Math.sign(err) * Math.min(Math.abs(err), rate * dt * 0.25), -rate * dt, rate * dt)
  sim.steer = sim.steerIn * (0.55 * sens / (1 + (sim.speed / 9) ** 2))
  // the car's heading turns with a little inertia, so a turn starts and ends smoothly instead of snapping
  const yawTarget = -(sim.speed / WHEELBASE) * Math.tan(sim.steer)
  sim.yawRate += (yawTarget - sim.yawRate) * (1 - Math.exp(-9 * dt))
  sim.h += sim.yawRate * dt
  sim.x += -Math.sin(sim.h) * sim.speed * dt
  sim.z += -Math.cos(sim.h) * sim.speed * dt
  sim.trip += sim.speed * dt

  // indicator ticking
  if (sim.signal !== 0) {
    sim.tickT += dt
    if (sim.tickT > 0.35) { sim.tickT = 0; tick() }
  } else sim.tickT = 0

  // ---- head keys: A / D turn the head gradually, W tilts it up; letting go brings it gently back (like a person's head) ----
  {
    if (headFree && (input.yaw !== headSet.y || input.pitch !== headSet.p)) { headFree = false; input.slow = false; sim.head.yaw = sim.head.pitch = 0 } // the mouse / finger took over
    // like the steering wheel: each press turns the head a little and it STAYS there; Space brings it (and the wheel) back to straight
    const dyaw = (input.kA ? 1 : 0) - (input.kD ? 1 : 0)
    if (dyaw) sim.head.yaw = clamp(sim.head.yaw + dyaw * 1.25 * dt, -2.3, 2.3)
    const dpit = (input.kW ? 1 : 0) - (input.kS ? 1 : 0)
    if (dpit) sim.head.pitch = clamp(sim.head.pitch + dpit * 0.9 * dt, -0.3, 0.95)
    const moving = Math.abs(sim.head.yaw) > 0.012 || Math.abs(sim.head.pitch) > 0.012
    if (moving && (!input.free || headFree)) { input.free = true; headFree = true; input.slow = true; input.yaw = sim.head.yaw; input.pitch = sim.head.pitch; headSet.y = input.yaw; headSet.p = input.pitch }
    else if (headFree) { headFree = false; input.slow = false; input.free = false; input.yaw = input.pitch = 0 }
  }
  // ---- free-look (touch, mouse or keys): what the head is facing decides which mirror you are looking at ----
  if (input.free) {
    const gy = input.yaw, gp = FRONT_PITCH + input.pitch
    let best: Look = 'front'
    let bd = GAZE_TOL
    for (const k of ['left', 'center', 'right'] as const) {
      const d = Math.hypot(gy - MIRROR_AIM[k].yaw, gp - MIRROR_AIM[k].pitch)
      if (d < bd) { bd = d; best = k }
    }
    if (best === 'front' && input.yaw > 1.5) best = 'blindL' // looking over the shoulder counts as a blind-spot check
    else if (best === 'front' && input.yaw < -1.5) best = 'blindR'
    input.look = best
    freeWas = true
  } else if (freeWas) {
    freeWas = false
    input.look = 'front' // free-look ended (finger or key released): eyes back on the road
  }
  // ---- looking at mirrors: a glance only counts after a short dwell ----
  if (input.look !== sim.look) {
    sim.look = input.look
    sim.lookSince = sim.t
  }
  if (sim.look !== 'front' && sim.t - sim.lookSince >= GLANCE_TIME) sim.lastCheck[sim.look === 'blindL' ? 'left' : sim.look === 'blindR' ? 'right' : sim.look] = sim.t

  // ---- hard obstacles ----
  if (!WORLD.highway && inIsland(sim.x, sim.z)) return crash('You drove into the roundabout island.', ['Go around the island, keeping it on your left.'])
  const fx = -Math.sin(sim.h)
  const fz = -Math.cos(sim.h)
  const rx = Math.cos(sim.h)
  const rz = -Math.sin(sim.h)
  for (const [a, b] of [[2, 0.9], [2, -0.9], [-2, 0.9], [-2, -0.9], [0, 0]]) {
    const bx = sim.x + fx * a + rx * b, bz = sim.z + fz * a + rz * b
    if (WORLD.highway) continue
    if (insideBuilding(bx, bz)) return crash('You hit a building.', ['Stay on the road.'])
  }
  // leaving the road stops the game (resume puts you back on it)
  sim.offRoadT = onRoad ? 0 : sim.offRoadT + dt
  if (sim.offRoadT > 0.5) return pauseOffRoad()

  // ---- traffic ----
  if (WORLD.highway) stepHighwayTraffic(dt, sim.t, playerObs())
  else stepTraffic(dt, sim.t, playerObs())
  for (const c of cars) {
    if (c.active && hits(c)) return crashInto(c)
  }

  // ---- navigation ----
  if (WORLD.highway) {
    // (the highway course keeps its own instructions, see trackHighway)
  } else {
    const arrivedAt = navUpdate(sim.x, sim.z)
    if (arrivedAt) say(`You have arrived: ${arrivedAt}`, 'good')
  }

  // ---- rules ----
  if (WORLD.highway) { if (trackHighway()) return }
  else {
    trackLane()
    trackJunction()
    trackStop()
  }
  if (useGame.getState().mode === 'roundabout' && !WORLD.highway) { if (trackRbLane()) return }
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
  if (dx * dx + dz * dz > ((c.len ?? 0) > 8 ? 400 : 36)) return false
  const axes: Array<[number, number]> = [
    [-Math.sin(sim.h), -Math.cos(sim.h)], [Math.cos(sim.h), -Math.sin(sim.h)],
    [-Math.sin(c.h), -Math.cos(c.h)], [Math.cos(c.h), -Math.sin(c.h)],
  ]
  const hl = CAR_L / 2 - 0.15
  const hw = CAR_W / 2 - 0.08
  const ohl = (c.len ?? CAR_L) / 2 - 0.15 // trucks are longer and wider
  const ohw = (c.wid ?? CAR_W) / 2 - 0.08
  const radius = (h: number, ax: number, az: number, own = true) =>
    Math.abs(-Math.sin(h) * ax - Math.cos(h) * az) * (own ? hl : ohl) + Math.abs(Math.cos(h) * ax - Math.sin(h) * az) * (own ? hw : ohw)
  for (const [ax, az] of axes) {
    if (Math.abs(dx * ax + dz * az) > radius(sim.h, ax, az) + radius(c.h, ax, az, false)) return false
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
  if (WORLD.highway && sim.z < Z_GORE + 20) {
    reason = along > 0 ? 'You ran into the vehicle ahead on the highway.' : 'You merged into another vehicle.'
    tips.push('Check your left mirror and blind spot, match the speed of the traffic on the highway, then move into a gap.')
  } else if (sim.man) {
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

/** The centre of the lane the car is mostly in (the nearest lane running the way it is heading): a point on it and the lane's heading. */
function laneTarget(): { x: number; z: number; h: number } | null {
  if (WORLD.highway) {
    if (sim.x > NB_EDGE_R + 1) return { x: rampX(sim.z), z: sim.z, h: rampHeading(sim.z) }
    let best = 0
    const lx = (k: number) => HW_LANES[k] + (k >= 3 ? forkShift(sim.z) : 0)
    for (let k = 1; k < HW_LANES.length; k++) if (Math.abs(sim.x - lx(k)) < Math.abs(sim.x - lx(best))) best = k
    return { x: lx(best), z: sim.z, h: best >= 3 ? forkHeading(sim.z) : 0 }
  }
  const fx = -Math.sin(sim.h), fz = -Math.cos(sim.h)
  const px = mod(sim.x, P), pz = mod(sim.z, P)
  let bd = 8, bx = 0, bz = 0, bdx = 0, bdz = 0, found = false
  for (const pc of PIECES) {
    for (let i = 1; i < pc.x.length; i++) {
      const ax = pc.x[i - 1], az = pc.z[i - 1]
      const dx = pc.x[i] - ax, dz = pc.z[i] - az
      const len = Math.hypot(dx, dz)
      if (len < 1e-6 || (dx * fx + dz * fz) / len < 0.4) continue // not pointing the way we are going
      const rx = wrapD(px - ax), rz = wrapD(pz - az)
      const t = clamp((rx * dx + rz * dz) / (len * len), 0, 1)
      const qx = rx - t * dx, qz = rz - t * dz
      const d = Math.hypot(qx, qz)
      if (d < bd) { bd = d; found = true; bx = -qx; bz = -qz; bdx = dx / len; bdz = dz / len }
    }
  }
  return found ? { x: sim.x + bx, z: sim.z + bz, h: Math.atan2(-bdx, -bdz) } : null
}

/* ---------- rules: lanes inside a two-lane roundabout ---------- */
/** the lane the rules want for a manoeuvre: right turn = right (outer) lane, left turn or going back = left (inner) lane, straight on = either */
const lanePref = (turn: 'right' | 'straight' | 'left' | 'back'): 'inner' | 'outer' | 'either' => (turn === 'right' ? 'outer' : turn === 'straight' ? 'either' : 'inner')
function trackRbLane(): boolean {
  const nn = nearestNode(sim.x, sim.z)
  const spec = nn.spec
  if (!spec || spec.laneR.length < 2) return false
  const r = Math.hypot(nn.rx, nn.rz)
  if (r > spec.outer + 3) { sim.rbl.node = -1; sim.rbl.lane = -1; return false }
  if (r < spec.laneR[0] - 3 || r > spec.laneR[1] + 3.5) return false
  const ang = Math.atan2(-nn.rz, nn.rx)
  const off = Math.abs(mod(ang + Math.PI / 4, Math.PI / 2) - Math.PI / 4) // angular distance from the nearest arm
  if (off < ringDelta(spec, 1) + 0.12) return false // still in the entry / exit zone of an arm
  const mid = (spec.laneR[0] + spec.laneR[1]) / 2
  if (Math.abs(r - mid) < 0.8 || sim.speed < 1) return false
  const lane = r < mid ? 0 : 1
  if (sim.rbl.node !== nn.n) {
    sim.rbl.node = nn.n
    sim.rbl.lane = lane
    const st = nav.steps[nav.k]
    if (st && st.i === nn.i && st.j === nn.j) {
      const turn = turnName(st.din, st.out)
      const want = lanePref(turn)
      if ((want === 'outer' && lane !== 1) || (want === 'inner' && lane !== 0)) {
        useGame.setState({ crashDiag: { correct: { turn, lane: want }, took: { turn, lane: lane === 0 ? 'inner' : 'outer' } } })
        crash('You were in the wrong lane for that exit.', [`You were asked: "${nav.text}". ${want === 'outer' ? 'To turn right (the 1st exit) use the right-hand (outer) lane.' : 'To take the 3rd exit, or to go back the way you came, use the left-hand (inner) lane.'}`, 'Choose your lane before you enter: the arrows on the road show it. Stay in that lane until you leave.'])
        return true
      }
    }
    return false
  }
  if (lane !== sim.rbl.lane) {
    const st = nav.steps[nav.k]
    const turn = st ? turnName(st.din, st.out) : 'straight'
    useGame.setState({ crashDiag: { correct: { turn, lane: sim.rbl.lane === 0 ? 'inner' : 'outer' }, took: { turn, lane: lane === 0 ? 'inner' : 'outer' } } })
    crash('You changed lanes inside the roundabout.', ['Pick the right lane before you enter and stay in it all the way round.', 'You may only move across when you are leaving, once you are past the last exit before yours and have checked and signalled.'])
    return true
  }
  return false
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
    const asked = nav.text
    const stBefore = nav.steps[nav.k]
    const res = navJunctionExit(jn.i, jn.j, dOut)
    if (useGame.getState().mode === 'roundabout' && jn.kind === 'round') {
      if (res === 'wrong' && stBefore) {
        const lane = sim.rbl.lane === 0 ? 'inner' : sim.rbl.lane === 1 ? 'outer' : 'either'
        useGame.setState({ crashDiag: { correct: { turn: turnName(stBefore.din, stBefore.out), lane: lanePref(turnName(stBefore.din, stBefore.out)) }, took: { turn: turnName(stBefore.din, dOut), lane } } })
      }
      if (res === 'wrong') return crash('You took the wrong exit.', [`The instruction was: "${asked}". Count the exits from where you entered: 1st is on your right, 2nd straight on, 3rd on your left, 4th takes you back the way you came.`])
      if (res === 'ok') { sim.score += 100; say(`Correct exit! +100`, 'good') }
    } else if (res === 'wrong') say('Wrong turn: recalculating the route', 'warn')
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
      // turning left on a plain green (no arrow): you must give way to oncoming traffic
      if (col === 0 && laneInfo()?.k === 0 && !hasLeftArrow(nn.n) && sim.signal === -1 && sim.speed > 0.5) {
        const fxp = -Math.sin(sim.h), fzp = -Math.cos(sim.h)
        const cxn = nn.cx, czn = nn.cz
        for (const c of cars) {
          if (!c.active) continue
          const dx = wrapD(c.x - cxn), dz = wrapD(c.z - czn)
          const away = -Math.sin(c.h) * fxp + -Math.cos(c.h) * fzp
          if (Math.hypot(dx, dz) < 40 && c.speed > 2 && away < -0.7) { say('Yield to oncoming traffic when you turn left', 'warn'); break }
        }
      }
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

function currentLimit() {
  if (WORLD.highway) return scen.type === 'merge' && sim.z > Z_GORE + 30 ? 40 : 31.3 // 70 mph on the highway; the on-ramp lets you build speed
  return LIMIT
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
if (typeof window !== 'undefined') Object.assign(window, { __resetSim: resetSim, __sim: sim, __cars: cars, __step: stepSim, __input: input, __start: startGame, __store: useGame, __resume: resumeGame, __onRoad: onAsphalt, __pieces: PIECES, __signal: signalColor, __nodeIndex: nodeIndex, __links: LINKS, __nav: nav, __world: WORLD, __navfn: { startRoute, navUpdate, navJunctionExit } })
