import { B, DIRS, HORIZONTAL_NAMES, VERTICAL_NAMES, clearance, dirv, laneOff, mod, nodeKind, type NodeKind } from './map'

/** Practice modes (no highway yet). */
export type Mode = 'city' | 'roundabout' | 'junction' | 'lanes'
export const MODES: Array<{ id: Mode; title: string; blurb: string }> = [
  { id: 'city', title: 'City driving', blurb: 'Follow the map across town: junctions, roundabouts and lane changes together.' },
  { id: 'roundabout', title: 'Roundabouts', blurb: 'Give way, pick the right exit and signal out. Several in a row.' },
  { id: 'junction', title: 'Junctions & lights', blurb: 'Turn left and right at traffic lights: stop lines, arrows, mirrors and signals.' },
  { id: 'lanes', title: 'Lane changes', blurb: 'A long multi-lane road. Mirror, signal, then move. Overtake slow traffic.' },
]

/** A node (junction) on the route. Coordinates are unwrapped grid indices; directions: 0 east, 1 north, 2 west, 3 south. */
export interface Step {
  i: number
  j: number
  din: number // direction of travel when arriving
  out: number // direction of travel when leaving
  kind: NodeKind
}

export const nav = {
  mode: 'city' as Mode,
  steps: [] as Step[],
  k: 0,
  dest: { i: 0, j: 0 },
  arrived: 0,
  // read by the HUD / map screen
  text: '',
  sub: '',
  icon: 'S',
  dist: 0,
}

const rnd = (n: number) => Math.floor(Math.random() * n)
export const nodeName = (i: number, j: number) => `${VERTICAL_NAMES[mod(i, 4)]} & ${HORIZONTAL_NAMES[mod(j, 4)]}`
/** name of the road you are on after leaving node (i, j) in direction d */
const roadName = (i: number, j: number, d: number) => (d % 2 === 0 ? HORIZONTAL_NAMES[mod(j, 4)] : VERTICAL_NAMES[mod(i, 4)])

export function dirOfHeading(h: number) {
  const fx = -Math.sin(h)
  const fz = -Math.cos(h)
  let best = 0
  let bd = -2
  DIRS.forEach(([dx, dz], d) => {
    const v = dx * fx + dz * fz
    if (v > bd) { bd = v; best = d }
  })
  return best
}
export const headingOfDir = (d: number) => {
  const [dx, dz] = dirv(d)
  return Math.atan2(-dx, -dz)
}

/* ------------------------------------------------------------------ */
/* Route generation                                                    */
/* ------------------------------------------------------------------ */
function walk(mode: Mode, i: number, j: number, d: number, count: number): Step[] {
  const steps: Step[] = []
  for (let n = 0; n < count; n++) {
    const kind = nodeKind(i, j)
    let out = d
    const r = Math.random()
    const turn = () => (Math.random() < 0.5 ? mod(d + 1, 4) : mod(d + 3, 4))
    if (mode === 'roundabout') {
      if (kind === 'round') out = r < 0.4 ? d : r < 0.7 ? mod(d + 1, 4) : mod(d + 3, 4)
    } else if (mode === 'junction') {
      if (mod(i, 2) === 1 && mod(j, 2) === 1 && r < 0.8) out = turn()
    } else if (mode === 'city') {
      if (r >= 0.5) out = turn()
    } // 'lanes': straight on
    steps.push({ i, j, din: d, out, kind })
    d = out
    i += DIRS[d][0]
    j += DIRS[d][1]
  }
  return steps
}

const turnsIn = (steps: Step[]) => steps.filter((s) => s.out !== s.din).length

function makeSteps(mode: Mode, i: number, j: number, d: number) {
  const count = mode === 'city' ? 7 : mode === 'roundabout' ? 8 : mode === 'junction' ? 9 : 8
  let steps = walk(mode, i, j, d, count)
  for (let tries = 0; tries < 30; tries++) {
    const ok = mode === 'junction' ? turnsIn(steps) >= 3 : mode === 'roundabout' ? turnsIn(steps) >= 1 : mode === 'city' ? turnsIn(steps) >= 2 : true
    if (ok) break
    steps = walk(mode, i, j, d, count)
  }
  return steps
}

/** Shortest sensible path to the destination (no U-turns), used to recalculate after a wrong turn. */
function pathTo(di: number, dj: number, i: number, j: number, d: number): Step[] {
  const steps: Step[] = []
  for (let n = 0; n < 40; n++) {
    const kind = nodeKind(i, j)
    if (i === di && j === dj) {
      steps.push({ i, j, din: d, out: d, kind })
      break
    }
    const left = mod(d + 1, 4)
    const right = mod(d + 3, 4)
    const ahead = (di - i) * DIRS[d][0] + (dj - j) * DIRS[d][1]
    const side = (di - i) * DIRS[left][0] + (dj - j) * DIRS[left][1]
    let out = d
    if (ahead < 0) out = side < 0 ? right : left // destination is behind us: turn off first
    else {
      let bd = Infinity
      for (const c of [d, left, right]) {
        const dist = Math.abs(i + DIRS[c][0] - di) + Math.abs(j + DIRS[c][1] - dj) + (c === d ? 0 : 0.1)
        if (dist < bd) { bd = dist; out = c }
      }
    }
    steps.push({ i, j, din: d, out, kind })
    d = out
    i += DIRS[d][0]
    j += DIRS[d][1]
  }
  return steps
}

/** Starts a fresh route for a mode and returns where to put the car (a lane's centre, 100 m before the first junction). */
export function startRoute(mode: Mode) {
  nav.mode = mode
  nav.arrived = 0
  const dir = rnd(2) === 0 ? 0 : 2 // east or west
  let i0: number, j0: number
  if (mode === 'roundabout') { i0 = 2 * rnd(2); j0 = 2 * rnd(2) }
  else if (mode === 'junction') { i0 = 1 + 2 * rnd(2); j0 = 1 + 2 * rnd(2) }
  else { i0 = rnd(4); j0 = 1 + 2 * rnd(2) }
  setSteps(makeSteps(mode, i0, j0, dir))
  const [dx, dz] = dirv(dir)
  const [rx, rz] = dirv(dir - 1)
  const lane = laneOff(1) // the outer lane of the 2-lane road
  return { x: i0 * B - dx * 100 + rx * lane, z: j0 * B - dz * 100 + rz * lane, h: headingOfDir(dir) }
}

function setSteps(steps: Step[]) {
  nav.steps = steps
  nav.k = 0
  const last = steps[steps.length - 1]
  nav.dest = { i: last.i, j: last.j }
}

/* ------------------------------------------------------------------ */
/* Following the route                                                 */
/* ------------------------------------------------------------------ */
export function describe(step: Step | undefined, last: boolean) {
  if (!step) return { text: '', sub: '', icon: 'S' }
  if (last) return { text: 'Destination ahead', sub: nodeName(step.i, step.j), icon: 'F' }
  const turn = mod(step.out - step.din, 4) // 0 straight, 1 left, 3 right, 2 U-turn
  const onto = roadName(step.i, step.j, step.out)
  if (step.kind === 'round') {
    const exit = turn === 3 ? 1 : turn === 0 ? 2 : turn === 1 ? 3 : 4
    return { text: `Roundabout: take exit ${exit}`, sub: `onto ${onto}`, icon: `O${exit}` }
  }
  if (turn === 1) return { text: 'Turn left', sub: `onto ${onto}`, icon: 'L' }
  if (turn === 3) return { text: 'Turn right', sub: `onto ${onto}`, icon: 'R' }
  if (turn === 2) return { text: 'Make a U-turn', sub: onto, icon: 'U' }
  return { text: 'Continue straight', sub: `on ${onto}`, icon: 'S' }
}

/** Per-frame: distance to the next junction and the instruction. Returns the destination name on arrival. */
export function navUpdate(px: number, pz: number): string | null {
  const st = nav.steps[nav.k]
  if (!st) return null
  nav.dist = Math.max(0, Math.hypot(px - st.i * B, pz - st.j * B) - clearance(st.i, st.j))
  const last = nav.k === nav.steps.length - 1
  const d = describe(st, last)
  nav.text = d.text
  nav.sub = d.sub
  nav.icon = d.icon
  if (last && nav.dist < 4) {
    nav.arrived++
    const name = nodeName(st.i, st.j)
    // carry on with a new leg from the next junction ahead
    setSteps(makeSteps(nav.mode, st.i + DIRS[st.din][0], st.j + DIRS[st.din][1], st.din))
    return name
  }
  return null
}

/** Called when the player leaves a junction. 'wrong' means they left the route (it has been recalculated). */
export function navJunctionExit(i: number, j: number, dOut: number): 'ok' | 'wrong' | 'ignore' {
  const st = nav.steps[nav.k]
  if (!st || st.i !== i || st.j !== j) return 'ignore'
  if (dOut === st.out) {
    nav.k = Math.min(nav.k + 1, nav.steps.length - 1)
    return 'ok'
  }
  setSteps(pathTo(nav.dest.i, nav.dest.j, i + DIRS[dOut][0], j + DIRS[dOut][1], dOut))
  return 'wrong'
}

/** Distance formatting for the chosen units. */
export function fmtDist(m: number, units: 'kmh' | 'mph') {
  if (units === 'mph') {
    const ft = m * 3.28084
    return ft < 1000 ? `${Math.max(10, Math.round(ft / 10) * 10)} ft` : `${(ft / 5280).toFixed(1)} mi`
  }
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`
}
