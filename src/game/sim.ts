import { crashSound, initAudio, tick } from './audio'
import { streetLimit, resStyle, PARKED, jLanes, roadBend, roadPoint, laneC, resCol, rampAt, nodeX, nodeZ, nearX, nearZ, cellX, cellZ, flare, medW, pocketW, jTypeOf, setLayout, oneLane, armCtrl, speedLimit, WORLD_PERIOD, hasLeftArrow, LINKS, PIECES, rbShift, ringDelta, SPEED_LIMIT, clearance, nodeIndex, BOX, HALF_ROAD, LANE_W, P, dirv, inIsland, insideBuilding, laneOff, mod, nearestNode, onAsphalt, signalColor, wrapD } from './map'
import { FRONT_PITCH, MIRROR_AIM, adjust } from './cabinConfig'
import { layoutOf, nav, navJunctionExit, navUpdate, startRoute, turnName } from './nav'
import { WORLD } from './course'
import { LD1, NB_EDGE_L, NB_EDGE_R, NB_X, SPAWN_Z, Z_END, Z_GORE, EXIT_C, FORK_Z, forkShift, scen, type HwType, onRoad as hwOnRoad, recoverPose, startPose } from '../highway/layout'
import { rampHeading, rampX, forkHeading, NB_X as HW_LANES } from '../highway/layout'
import { clearLane, initHighwayTraffic, setHighwayCount, stepHighwayTraffic } from '../highway/traffic'
import { initialHud, useGame, type Look, type Msg, type Signal } from './store'
import { CAR_L, CAR_W, setTrafficTarget, whyStuck, junctionBusy, cars, initTraffic, ringBusy, setActiveCount, stepTraffic, type AiCar } from './trafficAI'

export { CAR_L, CAR_W }
export const WHEELBASE = 2.7
export const LIMIT = SPEED_LIMIT // city speed limit: 30 mph (about 48 km/h), in m/s
/**
 * Traffic depends on where you drive. For each level (1 light .. 5 heavy) the number of cars in the area around you (about 340 m
 * each way): a residential street is quiet even when busy, the city has two to three times as many, the highway the most (see
 * highway/traffic.ts). Roughly: heavy traffic means about 5 cars near you in a residential street, 10-15 in the city, 50 on the highway.
 */
export const TRAFFIC_RES = [4, 8, 12, 16, 20]
export const TRAFFIC_CITY = [10, 20, 30, 40, 50]
export const TRAFFIC_COUNTRY = [8, 14, 20, 26, 32] // the roundabout course (open country)

// Rules-engine tuning
const SIGNAL_MIN = 1.0 // signal must be on this long before moving
const SIDE_CHECK_WINDOW = 5 // side-mirror glance must be this recent
const REAR_CHECK_WINDOW = 8 // rear-view glance must be this recent
const GLANCE_TIME = 0.3 // a glance only counts after looking this long
const BLIND_CHECK_WINDOW = 6 // a look into the blind spot must be this recent when you change lanes

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
  /** a double press of A (+1) / D (-1): look over that shoulder into the blind spot */
  blind: 0 as 0 | 1 | -1,
  space: false, // Space (or the ⦿ button) is held: keep the car in the middle of its lane
  /** a quick double tap of the accelerator: toggles cruise control */
  gasTap: false,
  yaw: 0,
  pitch: 0,
}
let freeWas = false
let headFree = false
const headSet = { y: 0, p: 0 }
let blindGoal: number | null = null // where a double-pressed A / D is turning the head (rad)
let blindHeld = false
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
  /** what the lane you entered from allows ('L', 'SL', 'S', 'SR', 'R', 'SLR'), or '' if not known */
  laneUse: string
  /** when the right indicator was last seen on while you were in the junction / on the roundabout */
  rightAt: number
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
  /** when you last looked over your shoulder into the left / right blind spot (the only check the game asks for) */
  lastBlind: { left: -99, right: -99 },
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
  /** the steering wheel position, -1 .. 1 (+/- 1.5 turns); it turns while a key is held and returns to 0 on release */
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
/** Points: every rule followed is +2, every mistake (a warning or alert) is -2. The score can go below zero. */
const RULE_POINTS = 2
/** a rule followed: +2, with a short note */
function good(text: string) {
  sim.score += RULE_POINTS
  say(`${text}  +${RULE_POINTS}`, 'good')
}

let fadeId = 0
/** Mixed course: from the end of the town's on-ramp onto the highway (the highway's own on-ramp, merge first) */
function enterHighway() {
  useGame.setState({ leg: 'highway', fade: { id: ++fadeId, text: 'I-5 North', sub: 'Build up speed on the ramp, then merge' } })
  resetSim('merge', true)
}
/** Mixed course: off the highway exit and back into the city (the route then leads through the residential district again) */
function leaveHighway() {
  nav.start = 'city'
  useGame.setState({ leg: 'town', fade: { id: ++fadeId, text: 'Exit 12 · City Centre', sub: 'Slow down: 30 mph in town' } })
  resetSim('merge', true)
}
const mixedHw = () => useGame.getState().mode === 'mixed'

/** Move on to the next scenario: back to the start of the course, with the traffic carried along (the plain highway looks the same). */
function advanceHighway() {
  const cur = scen.type
  if (cur === 'exit' && hw.exitTaken) say('You took the exit and are back on the highway.', 'info') // no second merge: the course just carries on
  if (cur === 'merge') good('Merged onto the highway')
  else if (cur === 'exit' && hw.exitTaken) good('Took the exit')
  else if (cur === 'lanedrop' && hw.crossed) good('Moved over before the lane ended')
  else if (cur === 'fork') good('Kept to your lanes through the split')
  if (cur === 'fork') say(sim.x > 12 ? 'You are now on I-405 East.' : 'You are now on I-5 North.', 'info')
  const pool: HwType[] = ['exit', 'fork', 'lanedrop']
  // on the Mixed course the next thing after merging is the exit back into the city (a missed exit comes round again)
  const next: HwType = mixedHw() ? 'exit' : pool[Math.floor(Math.random() * pool.length)]
  if (mixedHw() && cur === 'exit' && !hw.exitTaken) say('You missed the exit. Take the next one: get into the right lane early.', 'warn')
  else if (mixedHw() && cur === 'merge') say('Next: take the exit on the right back into the city.', 'info')
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
        if (sim.t - sim.lastBlind.left > BLIND_CHECK_WINDOW) say('Check your left blind spot before merging.', 'warn')
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
    }
    if (hw.crossed && !hw.exitTaken && z <= gore) hw.exitTaken = x > NB_EDGE_R
    if (hw.exitTaken && !hw.sigOffWarn && z < gore - 120 && sim.signal !== 0) { hw.sigOffWarn = true; say('Turn your indicator off.', 'warn') }
    if (mixedHw() && hw.exitTaken && z < -150) { good('Took the exit'); leaveHighway(); return false }
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
      if (sim.t - sim.lastBlind.left > BLIND_CHECK_WINDOW) say('Check your left blind spot before moving over.', 'warn')
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
let steerHold = 0, steerHoldDir = 0 // how long a steering key has been held, and which way
const autoCentre = { on: false, t: 0, ok: 0, prevH: NaN, dhS: 0 }

/** state of the highway merge attempt */
const hw = { stage: 'ramp' as 'ramp' | 'merge' | 'merged', crossed: false, mergedAt: 0, doneT: 0, sigOffWarn: false, exitTaken: false, warned: false, lane: -99, alertT: -99 }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const normAngle = (a: number) => mod(a + Math.PI, Math.PI * 2) - Math.PI
const playerObs = () => (WORLD.highway ? { x: sim.x, z: sim.z, h: sim.h, speed: sim.speed } : { x: mod(sim.x, P), z: mod(sim.z, P), h: sim.h, speed: sim.speed })

/* ---------- lifecycle ---------- */
let brakeHold = 0 // how long the brake has been held (s)
let overFor = 0, overWarnT = -99 // over the limit (within the margin): for how long, and when you were last reminded
let sigArmed = false // the wheel has been turned the way the indicator shows (it cancels when the wheel comes back)
let streetLim = speedLimit() // the limit of the street you are on (or last were on): it holds through a junction

export function resetSim(hwType: HwType = 'merge', keepScore = false) {
  const keep = keepScore ? sim.score : 0
  // the highway course is its own flat world (no wrapping); the grid city repeats every 800 m
  WORLD.highway = useGame.getState().mode === 'highway' || (useGame.getState().mode === 'mixed' && useGame.getState().leg === 'highway')
  autoCentre.on = false
  overFor = 0; overWarnT = -99
  hw.stage = 'ramp'; hw.crossed = false; hw.mergedAt = 0; hw.doneT = 0; hw.sigOffWarn = false; hw.exitTaken = false; hw.lane = -99
  if (WORLD.highway) { scen.type = hwType; useGame.setState((st) => ({ hwType, hwVersion: st.hwVersion + 1 })) }
  setLayout(layoutOf(useGame.getState().mode))
  WORLD_PERIOD.v = WORLD.highway ? 1e7 : P // (after the layout: it sets the town's period)
  const pose = WORLD.highway ? startPose() : startRoute(useGame.getState().mode) // where the practice route starts
  Object.assign(sim, {
    t: 0, x: pose.x, z: pose.z, h: pose.h, speed: 0, thr: 0, brk: 0, steerIn: 0, steer: 0, rpm: 900, gear: 1, tickT: 0,
    signal: 0, signalSince: 0, look: 'front', lookSince: 0, lastCheck: { left: -99, center: -99, right: -99 }, lastBlind: { left: -99, right: -99 },
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
/** 1 deep in the residential district, 0 deep in the city, in between near the boundary */
function resDistrictShare(x: number) {
  const c = cellX(x), f = (x - nodeX(c)) / (nodeX(c + 1) - nodeX(c)) // which block, and how far across it
  const here = resCol(c) ? 1 : 0, next = resCol(c + 1) ? 1 : 0, prev = resCol(c - 1) ? 1 : 0
  return f < 0.5 ? here + (prev - here) * Math.max(0, 0.5 - f) : here + (next - here) * Math.max(0, f - 0.5)
}
/** how many cars there should be around you right now, for the traffic level and where you are */
function trafficHere() {
  const L = useGame.getState().traffic - 1
  const m = useGame.getState().mode
  if (m === 'roundabout') return TRAFFIC_COUNTRY[L]
  if (m === 'residential') return TRAFFIC_RES[L]
  // the Mixed course: by the district you are in (blended over the last block either side of the boundary)
  if (m === 'mixed') { const r = resDistrictShare(sim.x); return Math.round(TRAFFIC_RES[L] * r + TRAFFIC_CITY[L] * (1 - r)) }
  return TRAFFIC_CITY[L]
}
export function applyTraffic() {
  if (WORLD.highway) return
  setActiveCount(trafficHere(), playerObs())
}
let trafficCheckT = 0
resetSim()

export function startGame() {
  initAudio()
  nav.start = 'res' // the Mixed course starts in the residential district
  useGame.setState({ leg: 'town', fade: null })
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

/** While the mirrors are being adjusted (paused): turn the head to a mirror and select it; null = face the road again. */
export function adjustMirror(k: 'left' | 'center' | 'right' | null) {
  adjust.sel = k
  adjust.dragging = false
  input.free = false
  input.yaw = input.pitch = 0
  sim.head.yaw = sim.head.pitch = 0
  input.look = k ?? 'front'
  sim.look = k ?? 'front'
}

export function resumeGame() {
  adjust.sel = null; adjust.dragging = false
  input.look = 'front'; sim.look = 'front' // the head may have been turned to a mirror while adjusting it
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
  const ns = Math.abs(nn.rx) <= Math.abs(nn.rz)
  // the outer lane of the 2-lane road; a residential street has just the one (beyond its centre turn lane, where there is one)
  const lane = (ns ? oneLane(1, nn.i) : oneLane(0, nn.j)) ? (jTypeOf(nn.i, nn.j, ns ? 1 : 0)?.mw ?? 0) * LANE_W + laneC(0, true) : laneOff(1)
  let x: number, z: number, h: number
  if (Math.abs(nn.rx) <= Math.abs(nn.rz)) {
    // nearest road runs north-south (x = the node's column)
    const north = fz < 0
    const out = nn.rz < 0 ? 1 : 3 // the arm the car is on (north or south of the junction)
    ;[x, z] = roadPoint(nn.cx, nn.cz, out, Math.max(Math.abs(nn.rz), clr), (out === 1) === north ? lane : -lane)
    h = north ? 0 : Math.PI
  } else {
    // nearest road runs east-west
    const east = fx > 0
    const out = nn.rx < 0 ? 2 : 0
    ;[x, z] = roadPoint(nn.cx, nn.cz, out, Math.max(Math.abs(nn.rx), clr), (out === 0) === east ? lane : -lane)
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
  sim.signal = sim.signal === dir ? 0 : dir // pressing the same side again switches it off
  sim.signalSince = sim.t
  sigArmed = false
}

/* ---------- messages ---------- */
function say(text: string, kind: Msg['kind']) {
  if (kind === 'warn' || kind === 'alert') { sim.errors++; sim.score -= RULE_POINTS; text = `${text}  −${RULE_POINTS}` } // a mistake costs 2 points
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

  // ---- the indicator cancels itself like a real one: once the wheel has been turned the way it shows and comes back to straight ----
  if (sim.signal !== 0) {
    if (Math.sign(sim.steerIn) === sim.signal && Math.abs(sim.steerIn) > 0.3) sigArmed = true
    else if (sigArmed && Math.abs(sim.steerIn) < 0.08) { sim.signal = 0; sigArmed = false }
  } else sigArmed = false
  // ---- pedals and longitudinal dynamics ----
  if (input.down) sim.cruise = 0 // the brake switches cruise control off
  if (input.gasTap) { input.gasTap = false; if (sim.cruise) sim.cruise = 0; else if (sim.speed > 5) { sim.cruise = sim.speed; say(`Cruise control on`, 'info') } }
  const thrT = input.up ? 1 : sim.cruise ? clamp((sim.cruise - sim.speed) * 0.7 + 0.12, 0, 1) : 0
  const brkT = input.down ? 1 : 0
  sim.thr += (thrT - sim.thr) * Math.min(1, dt * (thrT ? 7 : 6))
  sim.brk += (brkT - sim.brk) * Math.min(1, dt * (brkT ? 12 : 12)) // the brakes bite a touch more progressively
  const v = sim.speed
  const aEng = sim.thr * 5.6 * Math.max(0, 1 - (v / 44) ** 2)
  const drag = v > 0.05 ? 0.25 + 0.0009 * v * v : 0 // rolling + air resistance
  const engBrake = (1 - sim.thr) * (v > 0.2 ? 0.6 : 0) // lifting off the pedal: engine braking, about 1 m/s2 in all at 30 mph (a normal petrol car)
  // Progressive brake, like a real pedal: a tap is a gentle stop; keep holding and it presses harder,
  // to a firm stop after about a second and an emergency stop after about two (totals include engine braking and drag)
  brakeHold = input.down ? brakeHold + dt : 0
  const bt = brakeHold
  const brakeDecel = bt < 0.35 ? 2.3 : bt < 1.1 ? 2.3 + (4 - 2.3) * ((bt - 0.35) / 0.75) : bt < 1.9 ? 4 + (7.6 - 4) * ((bt - 1.1) / 0.8) : 7.6
  const aBrk = sim.brk * brakeDecel
  const aOff = !onRoad && v > 0.05 ? 5 : 0
  sim.speed = Math.max(0, v + (aEng - drag - engBrake - aBrk - aOff) * dt)
  updateEngine(dt)

  // ---- steering (bicycle model) ----
  const sens = [0.32, 0.46, 0.62, 0.82, 1.05][useGame.getState().steerSens - 1]
  // The arrow keys / buttons turn the wheel a little and it STAYS there (like holding a real wheel); Space centres it.
  if (input.recentre) { blindGoal = null; sim.wheel = 0; sim.head.yaw = 0; sim.head.pitch = 0; input.recentre = false; autoCentre.on = true; autoCentre.t = 0; autoCentre.ok = 0; autoCentre.prevH = NaN }
  // while Space is HELD the car keeps itself in the middle of its lane, on straights, curves and roundabouts (steering by hand, braking or
  // slowing right down hands control back until the key is let go and pressed again)
  if (input.space && !autoLane.on && !autoCentre.on && !input.left && !input.right && !input.down && sim.speed >= 1.5) { autoCentre.on = true; autoCentre.t = 0; autoCentre.ok = 0; autoCentre.prevH = NaN; autoCentre.dhS = 0 }
  if (!autoLane.on && !autoCentre.on) {
    // the wheel keeps turning while an arrow (or the on-screen button) is held and springs back to straight when it is released
    const dirIn = (input.right ? 1 : 0) - (input.left ? 1 : 0)
    if (dirIn) {
      // it answers at once and winds on faster the longer the key is held; steering back against the lock is quicker still
      steerHold = dirIn === steerHoldDir ? steerHold + dt : 0
      steerHoldDir = dirIn
      const against = sim.wheel * dirIn < 0
      const wr = against ? 2.6 : 0.9 + 1.3 * Math.min(1, steerHold / 0.5)
      sim.wheel = clamp(sim.wheel + dirIn * wr * dt, -1, 1)
    } else {
      steerHold = 0; steerHoldDir = 0
      sim.wheel = Math.abs(sim.wheel) < 2.2 * dt ? 0 : sim.wheel - Math.sign(sim.wheel) * 2.2 * dt
    }
  }
  let target = sim.wheel
  // double-tap lane change: the car steers itself over to the next lane, then straightens up
  if (input.laneShift) {
    if (sim.speed > 2) {
      const h0 = Math.round(sim.h / (Math.PI / 2)) * (Math.PI / 2)
      if (Math.abs(sim.h - h0) < 0.35) {
        const rxv = Math.cos(h0), rzv = -Math.sin(h0)
        const w = WORLD.highway ? 3.7 : LANE_W
        autoLane.h0 = h0; autoLane.dir = input.laneShift; autoLane.p0 = sim.x * rxv + sim.z * rzv; autoLane.w = w
        autoLane.on = true; autoLane.t = 0; autoLane.sig = false // the indicator is yours to work (Q / E or the buttons): the arrows never touch it
      }
    }
    input.laneShift = 0
  }
  if (autoLane.on) {
    const rxv = Math.cos(autoLane.h0), rzv = -Math.sin(autoLane.h0)
    const err = autoLane.p0 + autoLane.dir * autoLane.w - (sim.x * rxv + sim.z * rzv)
    autoLane.t += dt
    const hrel = sim.h - autoLane.h0
    // steer towards a heading that shrinks as the car nears the middle of the new lane, and damp the swing (yaw rate) so it settles there
    // without running past the middle and coming back
    const sp = clamp(15 / Math.max(sim.speed, 1), 0.3, 1) // the car answers the wheel faster at speed: ask for less
    const des = clamp(-err * 0.04 * sp, -0.085 * sp, 0.085 * sp)
    target = -clamp(((des - hrel) * 4 * 0.7 * sp - sim.yawRate * 0.9) / sens, -1, 1) // the self-steer works the same at any sensitivity
    const done = Math.abs(err) < 0.12 && Math.abs(hrel) < 0.02 && Math.abs(sim.yawRate) < 0.03
    if (done) { // settle exactly in the middle of the new lane, pointing straight
      sim.h = autoLane.h0; sim.yawRate = 0; sim.steerIn = 0
      const dx = err * rxv, dz = err * rzv; sim.x += dx; sim.z += dz
    }
    if (done || sim.speed < 1.5 || input.down || (autoLane.t > 0.6 && (input.left || input.right))) { autoLane.on = false; sim.wheel = done ? 0 : sim.wheel; target = sim.wheel }
  }
  if (autoCentre.on && !autoLane.on) {
    autoCentre.t += dt
    const lt = laneTarget()
    const hold = input.space
    if (!lt || sim.speed < 1.5 || input.down || input.left || input.right || (!hold && autoCentre.t > 12)) { autoCentre.on = false; autoCentre.prevH = NaN; sim.wheel = 0 }
    else {
      const rx = Math.cos(lt.h), rz = -Math.sin(lt.h)
      const e = (sim.x - lt.x) * rx + (sim.z - lt.z) * rz // how far to the right of the lane centre the car is
      const hrel = Math.atan2(Math.sin(sim.h - lt.h), Math.cos(sim.h - lt.h))
      // how fast the lane itself is turning (a bend or a roundabout): steer for it ahead of time instead of lagging behind
      const dhRaw = Number.isNaN(autoCentre.prevH) ? 0 : Math.atan2(Math.sin(lt.h - autoCentre.prevH), Math.cos(lt.h - autoCentre.prevH)) / Math.max(dt, 1e-3)
      autoCentre.prevH = lt.h
      autoCentre.dhS += (clamp(dhRaw, -1.5, 1.5) - autoCentre.dhS) * (1 - Math.exp(-dt / 0.35)) // smoothed: the lane's heading is read off short straight pieces
      const dh = autoCentre.dhS
      const gain = (0.55 * sens) / (1 + (sim.speed / 9) ** 2)
      const ff = (-Math.atan((WHEELBASE * dh) / Math.max(sim.speed, 1.5)) / gain)
      const des = clamp(e * 0.04, -0.08, 0.08)
      const fb = -clamp(((des - hrel) * 4 * 0.7 - (sim.yawRate - dh) * 0.9) / sens, -1, 1) // the yaw-rate term damps it so it settles without wobbling
      target = clamp(ff + fb, -1, 1)
      sim.wheel = 0
      // once it has settled in the middle of the lane, pointing along it, for a moment, hand control back (unless Space is still held)
      if (!hold) {
        if (Math.abs(e) < 0.1 && Math.abs(hrel) < 0.012 && Math.abs(sim.yawRate - dh) < 0.015) { autoCentre.ok += dt; if (autoCentre.ok > 0.8) { autoCentre.on = false; target = 0 } } else autoCentre.ok = 0
      }
    }
  }
  const manual = !autoLane.on && !autoCentre.on
  const rate = manual ? 6 : target ? 1.5 + sens : 3
  // the wheel eases toward where you point it (and returns to centre gently), like a real wheel under the hands
  const err = target - sim.steerIn
  // by hand the road wheels follow the steering wheel directly (no extra lag: what you press is what the car does)
  {
    // ease toward the target and never step past it (stepping past made the wheel flutter about its target)
    const k = 1 - Math.exp(-dt * (manual ? 16 : target ? 5 : 7))
    let step = err * k + Math.sign(err) * Math.min(Math.abs(err) * (1 - k), rate * dt * 0.25)
    step = clamp(step, -rate * dt, rate * dt)
    sim.steerIn += Math.abs(step) > Math.abs(err) ? err : step
  }
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
    let dyaw = (input.kA ? 1 : 0) - (input.kD ? 1 : 0)
    if (input.blind) { blindGoal = input.blind * 2.09; blindHeld = true; input.blind = 0 } // 120 degrees round
    if (blindGoal !== null) {
      if (!input.kA && !input.kD) blindHeld = false
      else if (!blindHeld) blindGoal = null // a fresh press of A / D takes over again
      dyaw = 0
      if (blindGoal !== null) sim.head.yaw += clamp(blindGoal - sim.head.yaw, -6 * dt, 6 * dt)
    }
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
  if ((sim.look === 'blindL' || sim.look === 'blindR') && sim.t - sim.lookSince >= GLANCE_TIME) sim.lastBlind[sim.look === 'blindL' ? 'left' : 'right'] = sim.t

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
  // cars parked along the kerb of a dense residential street
  if (!WORLD.highway) {
    const px = mod(sim.x, P), pz = mod(sim.z, P)
    for (const q of PARKED) {
      const ox = wrapD(px - q.x), oz = wrapD(pz - q.z)
      if (ox * ox + oz * oz > 40) continue
      for (const [a, b] of [[2.2, 0.9], [2.2, -0.9], [-2.2, 0.9], [-2.2, -0.9], [0, 0.9], [0, -0.9]]) {
        const cx = ox + fx * a + rx * b, cz = oz + fz * a + rz * b // a point of your car, relative to the parked one
        if (Math.abs(cx * q.tx + cz * q.tz) < 2.25 && Math.abs(-cx * q.tz + cz * q.tx) < 0.92) return crash('You hit a parked car.', ['On a narrow street, slow down and keep to the middle of your side, clear of the parked cars.'])
      }
    }
  }
  // leaving the road stops the game (resume puts you back on it)
  sim.offRoadT = onRoad ? 0 : sim.offRoadT + dt
  if (sim.offRoadT > 0.5) return pauseOffRoad()

  // ---- traffic ----
  // the Mixed course: the amount of traffic follows the district you are driving in (re-checked every couple of seconds)
  if (!WORLD.highway && useGame.getState().mode === 'mixed' && (trafficCheckT += dt) > 2) { trafficCheckT = 0; setTrafficTarget(trafficHere()) }
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
  // Mixed course: at the end of the on-ramp you are taken onto the highway
  if (!WORLD.highway && useGame.getState().mode === 'mixed' && (rampAt(sim.x, sim.z) ?? 0) > 72) { enterHighway(); return }
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
  const fx = -Math.sin(sim.h)
  const fz = -Math.cos(sim.h)
  const clr = clearance(nn.i, nn.j, Math.abs(fz) > Math.abs(fx) ? 1 : 0) // where the approach you are on ends
  // across the nearest north-south / east-west road, measured from its centre line (a residential street may bend)
  const xm = sim.x - nodeX(nearX(sim.x)) + roadBend(nearX(sim.x), cellZ(sim.z), 1, sim.z - nodeZ(cellZ(sim.z)))
  const zm = sim.z - nodeZ(nearZ(sim.z)) - roadBend(cellX(sim.x), nearZ(sim.z), 0, sim.x - nodeX(cellX(sim.x)))
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
  // Between signalised junctions each carriageway sits one lane out from the centre line (a median); the left-turn lane opens up in
  // that median ahead of a junction. Lane 0 is then the turn lane, and the through lanes sit beyond it.
  const alongZ = Math.abs(fz) > 0.9
  const pos = alongZ ? sim.z : sim.x
  const fwd = alongZ ? fz : fx
  const cell = alongZ ? cellZ(pos) : cellX(pos)
  const behind = fwd > 0 ? cell : cell + 1, ahead = fwd > 0 ? cell + 1 : cell
  const at = (c: number) => (alongZ ? nodeZ(c) : nodeX(c))
  const ci = alongZ ? nearX(sim.x) : nearZ(sim.z)
  const nodeAt = (c: number) => (alongZ ? [ci, c] : [c, ci]) as [number, number]
  const tBehind = jTypeOf(...nodeAt(behind), alongZ ? 1 : 0), tAhead = jTypeOf(...nodeAt(ahead), alongZ ? 1 : 0)
  const ax = alongZ ? 1 : 0
  const med = medW(tBehind, tAhead, clearance(...nodeAt(behind), ax), clearance(...nodeAt(ahead), ax), Math.abs(pos - at(behind)), Math.abs(at(ahead) - at(behind)))
  const dAhead = Math.abs(pos - at(ahead)) - clearance(...nodeAt(ahead), ax)
  const rPocket = tAhead?.rOnly ? LANE_W * flare(dAhead) : 0
  if (tBehind?.centre && tAhead?.centre) {
    // centre-turn-lane avenue: the middle lane (half of it lies on each side of the centre line) may be used to turn left
    const h = LANE_W / 2
    const nC = 1 + (oneLane(alongZ ? 1 : 0, ci) ? 1 : 2) // the centre lane and the through lane(s)
    if (r < -h) return { d, r, k: -1, e: r + h, left: false, nTurnL: 1, rTurn: -1, n: nC }
    if (r < h) return { d, r, k: 0, e: r, left: true, nTurnL: 1, rTurn: -1, n: nC }
    const j = Math.floor((r - h) / LANE_W)
    return { d, r, k: j + 1, e: r - h - laneC(j, oneLane(alongZ ? 1 : 0, ci)), left: false, nTurnL: 1, rTurn: -1, n: nC }
  }
  if (med > 0.01 || rPocket > 0.01) {
    const pocket = pocketW(tAhead, dAhead, med) // width of the left-turn lane(s)
    const nP = pocket > 0.01 ? tAhead!.nL : 0
    const yellow = Math.max(0, med - pocket)
    let k: number, e: number, left = false
    if (r < yellow) { k = -1; e = r - yellow }
    else if (r < med && nP) { const pw = pocket / nP, idx = Math.min(nP - 1, Math.floor((r - yellow) / pw)); k = idx; e = r - (yellow + pw * (idx + 0.5)); left = true }
    else {
      const j = Math.max(0, Math.floor((r - med) / LANE_W))
      k = j + nP
      e = j >= 2 ? r - med - 2 * LANE_W - rPocket / 2 : r - med - LANE_W * (j + 0.5)
    }
    // lane indices run left to right: the nP left-turn lanes first, then the through lanes, then the right-turn lane (if it has opened)
    return { d, r, k, e, left, nTurnL: nP, rTurn: rPocket > 0.01 ? nP + 2 : -1, n: nP + (oneLane(alongZ ? 1 : 0, ci) ? 1 : 2) + (rPocket > 0.01 ? 1 : 0) }
  }
  const k = r < 0 ? -1 : r < LANE_W || oneLane(alongZ ? 1 : 0, ci) ? 0 : r < 2 * LANE_W ? 1 : r < 3 * LANE_W ? 2 : 3
  return { d, r, k, e: k < 0 ? r : r - laneC(k, oneLane(alongZ ? 1 : 0, ci)), left: false, nTurnL: 0, rTurn: -1, n: oneLane(alongZ ? 1 : 0, ci) ? 1 : 2 }
}

function trackLane() {
  const L = laneInfo()
  if (!L || sim.speed < 3) {
    sim.man = null
    return
  }
  const { k, e: err } = L
  // close to a junction you are turning, not changing lanes: drifting out of the right lane to turn right, or out of the left lane
  // to turn left, needs no blind-spot check (and is not crossing the centre line)
  const nnL = nearestNode(sim.x, sim.z)
  const toJunction = Math.max(Math.abs(nnL.rx), Math.abs(nnL.rz)) - clearance(nnL.i, nnL.j, L.d % 2)
  if (!sim.man && toJunction < 14) return
  if (!sim.man) {
    if (k >= 0 && k <= 2) {
      const e = err
      if (Math.abs(e) > 1.15) {
        const dir: -1 | 1 = e < 0 ? -1 : 1
        const target = k + dir
        if (target < 0) {
          // only a solid (double) yellow line may not be crossed: a dense residential street has no line, a normal one a broken line
          const st = resStyle(L.d % 2, L.d % 2 === 0 ? nearZ(sim.z) : nearX(sim.x))
          if (st !== 'dense' && st !== 'normal' && sim.t - sim.warnT.centre > 3) {
            sim.warnT.centre = sim.t
            say('Do not cross the double yellow line!', 'warn')
          }
        } else if (target <= 2 && target < L.n) { // (moving right out of the right-hand lane is not a lane change: there is no lane there)
          // moving from the outermost lane into a turn lane that has opened on that side (left lane -> left-turn lane, right lane ->
          // right-turn lane) is part of the turn: there is no traffic lane beside you there, so no blind-spot check is needed
          const intoTurnLane = (dir < 0 && target < L.nTurnL) || (dir > 0 && target === L.rTurn)
          startManeuver(dir, k, target, intoTurnLane)
        }
      }
    } else if (k === -1 && sim.t - sim.warnT.wrong > 3 && !(resStyle(L.d % 2, L.d % 2 === 0 ? nearZ(sim.z) : nearX(sim.x)) === 'dense' && L.r > -1.6)) { // (on an unmarked street, only once you are clearly over the middle)
      sim.warnT.wrong = sim.t
      say('You are on the wrong side of the road!', 'warn')
    }
    return
  }
  const m = sim.man
  if (k === m.target && Math.abs(err) < 0.9) finishManeuver(m)
  else if (k === m.k0 && Math.abs(err) < 0.5) sim.man = null // changed their mind
  else if (k !== m.k0 && k !== m.target) sim.man = null
}

function startManeuver(dir: -1 | 1, k0: number, target: number, intoTurnLane = false) {
  const side = dir < 0 ? 'left' : 'right'
  const infractions: string[] = []
  if (sim.signal !== dir) infractions.push(`No ${side} signal`)
  else if (sim.t - sim.signalSince < SIGNAL_MIN) infractions.push('Signalled too late')
  // (mirror glances are not checked: only the look over your shoulder into the blind spot)
  if (!intoTurnLane && sim.t - sim.lastBlind[side] > BLIND_CHECK_WINDOW) infractions.push(`Did not check your ${side} blind spot`)
  sim.man = { dir, k0, target, infractions }
  infractions.forEach((m) => say(m, 'warn'))
}

function finishManeuver(m: Maneuver) {
  sim.man = null
  sim.changes++
  if (m.infractions.length === 0) { sim.clean++; good('Clean lane change') }
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
/** the lane you are in on the way into the junction ahead, and what it allows there */
const approachLane = { n: -1, use: '' }
function trackApproachLane() {
  const L = laneInfo()
  if (!L || L.k < 0) return
  // the junction ahead, along the road you are driving
  const ai = L.d === 0 ? cellX(sim.x) + 1 : L.d === 2 ? cellX(sim.x) : nearX(sim.x)
  const aj = L.d === 3 ? cellZ(sim.z) + 1 : L.d === 1 ? cellZ(sim.z) : nearZ(sim.z)
  const jt = jTypeOf(ai, aj, L.d % 2)
  approachLane.n = nodeIndex(ai, aj)
  approachLane.use = jt ? jLanes(jt)[L.k]?.use ?? '' : ''
}
function trackJunction() {
  trackApproachLane()
  const nn = nearestNode(sim.x, sim.z)
  const inside = nn.kind === 'signal' ? Math.abs(nn.rx) < clearance(nn.i, nn.j, 0) + 1 && Math.abs(nn.rz) < clearance(nn.i, nn.j, 1) + 1 : Math.hypot(nn.rx, nn.rz) < nn.spec!.outer
  if (inside && !sim.jn) {
    sim.jn = { n: nn.n, i: nn.i, j: nn.j, kind: nn.kind, h0: sim.h, sig: sim.signal, yieldFail: false, laneUse: approachLane.n === nn.n ? approachLane.use : '', rightAt: sim.signal === 1 ? sim.t : -99 }
    if (nn.kind === 'round') {
      const arm = mod(Math.round(Math.atan2(-nn.rz, nn.rx) / (Math.PI / 2)), 4)
      if (ringBusy(nn.n, arm, playerObs()) && sim.speed > 2) {
        sim.jn.yieldFail = true
        say('Yield to traffic already on the roundabout!', 'warn')
      }
    }
  } else if (inside && sim.jn && sim.signal === 1) {
    sim.jn.rightAt = sim.t // (the indicator may cancel itself as the wheel straightens on the way out: remember you used it)
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
      if (res === 'ok') good('Correct exit')
    } else if (res === 'wrong') say('Wrong turn: recalculating the route', 'warn')
    const dh = normAngle(sim.h - jn.h0) // positive = turned left
    if (jn.kind === 'signal') {
      if (Math.abs(dh) < 0.6) return
      const want: Signal = dh > 0 ? -1 : 1
      sim.changes++
      if (jn.sig === want) { sim.clean++; good(`Signalled ${dh > 0 ? 'left' : 'right'} for the turn`) }
      else say(`Signal ${dh > 0 ? 'left' : 'right'} before you turn`, 'warn')
      // the lane you turned from must allow the turn (the arrows on the road): no left turn from a straight-on lane
      if (jn.laneUse && dh > 0 && !jn.laneUse.includes('L')) say('Wrong lane: you turned left from a lane that does not allow left turns. Use the left-turn lane.', 'warn')
      else if (jn.laneUse && dh < 0 && !jn.laneUse.includes('R')) say('Wrong lane: you turned right from a lane that does not allow right turns.', 'warn')
    } else if (!jn.yieldFail) {
      sim.changes++
      if (jn.sig === 1 || sim.signal === 1 || sim.t - jn.rightAt < 6) { sim.clean++; good('Signalled right to leave the roundabout') }
      else say('Signal right when you leave a roundabout', 'warn')
    }
    // (the indicator is not switched off here: it cancels itself when the wheel comes back to straight, or press it again)
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
  for (let d = 0; d < 4; d++) {
    const LINE = rbSig ? half + 17 : clearance(nn.i, nn.j, d % 2) + 2
    const [ox, oz] = dirv(d)
    const [lx, lz] = dirv(d + 1)
    const u = nn.rx * ox + nn.rz * oz
    const lat = nn.rx * lx + nn.rz * lz
    if (u <= 0 || u > half + 45 || Math.abs(lat) > HALF_ROAD + 1.5 || fx * ox + fz * oz > -0.6) continue
    let st = sim.stop
    if (!st || st.n !== nn.n || st.d !== d) st = sim.stop = { n: nn.n, d, prevU: u, passed: false, credited: false }
    const ctl = rbSig ? 'light' : armCtrl(nn.n, d % 2)
    if (ctl !== 'light') {
      // ---- STOP and YIELD signs ----
      const st2 = st as typeof st & { stoppedAt?: number }
      if (ctl === 'stop' && !st.passed && sim.speed < 0.35 && u > LINE - 1.5 && u < LINE + 14 && st2.stoppedAt === undefined) st2.stoppedAt = sim.t
      // committed: the nose is over the line and you are moving
      if (!st.passed && u < LINE - 2.5 && sim.speed > 0.6) {
        st.passed = true
        if (ctl === 'stop' && st2.stoppedAt === undefined) say('You did not stop at the STOP sign! Come to a complete stop behind the line.', 'warn')
        else if (ctl !== 'free' && junctionBusy(nn.n, d, null, st2.stoppedAt ?? sim.t, null, 3.2)) {
          const all = armCtrl(nn.n, 1 - (d % 2)) === 'stop'
          say(ctl === 'yield' ? 'YIELD: give way to traffic on the main road' : all ? 'All-way stop: the driver who stopped first goes first. Wait your turn.' : 'After stopping, wait for a safe gap in the cross traffic', 'warn')
        } else if (ctl === 'stop') good('Full stop at the STOP sign')
        else if (ctl === 'yield') good('Gave way at the YIELD sign')
      }
      st.prevU = u
      return
    }
    // the left lane has its own left-turn arrow; everyone else follows the through signal
    const col = signalColor(nn.n, d % 2 === 0 ? 0 : 1, sim.t, laneInfo()?.left ? 'L' : 'T')
    if (!st.passed && st.prevU >= LINE && u < LINE) {
      st.passed = true
      // turning left on a plain green (no arrow): you must give way to oncoming traffic
      if (col === 0 && laneInfo()?.left && !hasLeftArrow(nn.n, d % 2) && sim.signal === -1 && sim.speed > 0.5) {
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
      good(col === 2 ? 'Stopped for the red light' : 'Stopped for the amber light')
    }
    st.prevU = u
    return
  }
  sim.stop = null
}

function currentLimit() {
  if (WORLD.highway) return scen.type === 'merge' && sim.z > Z_GORE + 30 ? 40 : 31.3 // 70 mph on the highway; the on-ramp lets you build speed
  // 25 mph on a residential street, 30 on the town's main roads (the last street's limit holds through a junction)
  const L = laneInfo()
  if (L) streetLim = L.d % 2 === 0 ? streetLimit(0, nearZ(sim.z)) : streetLimit(1, nearX(sim.x))
  return streetLim
}

/**
 * Speeding. How far over the limit is tolerated depends on the limit (in mph): up to 25 -> +5, up to 50 -> +10, up to 75 -> +15,
 * above that +20. Over the limit but within that margin you are told to slow down (no points lost); beyond it, it is a mistake.
 */
export function speedMargin(limitMph: number) { return limitMph <= 25 ? 5 : limitMph <= 50 ? 10 : limitMph <= 75 ? 15 : 20 }
function trackSpeed(dt: number) {
  const limit = currentLimit()
  const limMph = Math.round(limit / 0.44704), vMph = sim.speed / 0.44704
  const margin = speedMargin(limMph)
  const u = useGame.getState().units
  const shown = u === 'kmh' ? Math.round((limMph * 1.609) / 5) * 5 + ' km/h' : limMph + ' mph'
  // beyond the margin: speeding (a mistake)
  if (vMph > limMph + margin) sim.speedingFor += dt
  else sim.speedingFor = 0
  if (sim.speedingFor > 2 && sim.t - sim.warnT.speed > 6) {
    sim.warnT.speed = sim.t
    say(`Speeding! The limit is ${shown}`, 'warn')
  }
  // over the limit but within the margin: a reminder only
  if (vMph > limMph + 0.5 && vMph <= limMph + margin) overFor += dt
  else overFor = 0
  if (overFor > 2 && sim.t - overWarnT > 8 && sim.speedingFor === 0) {
    overWarnT = sim.t
    say(`You are over the speed limit (${shown}): ease off`, 'info')
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
if (typeof window !== 'undefined') Object.assign(window, { __resetSim: resetSim, __sim: sim, __cars: cars, __why: (c: AiCar) => whyStuck(c, sim.t, playerObs()), __step: stepSim, __input: input, __start: startGame, __store: useGame, __resume: resumeGame, __onRoad: onAsphalt, __pieces: PIECES, __signal: signalColor, __nodeIndex: nodeIndex, __links: LINKS, __nav: nav, __world: WORLD, __legs: { enterHighway, leaveHighway }, __laneInfo: () => laneInfo(), __ramp: rampAt, __navfn: { startRoute, navUpdate, navJunctionExit } })
