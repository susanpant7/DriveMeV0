import { roadPoint, laneC, G, wrapD, nodeX, nodeZ, armOne, jTypeOf, LANE_W, DIRS, armClosed, HORIZONTAL_NAMES, VERTICAL_NAMES, clearance, dirv, laneOff, mod, nodeKind, type NodeKind } from './map'

/** Practice modes (no highway yet). */
export type Mode = 'residential' | 'city' | 'highway' | 'roundabout' | 'mixed'
export const MODES: Array<{ id: Mode; title: string; blurb: string }> = [
  { id: 'residential', title: 'Residential', blurb: 'Quiet 25 mph streets: STOP signs, all-way stops and YIELD signs. Stop fully, then go when it is your turn.' },
  { id: 'city', title: 'City', blurb: 'Traffic lights at every junction: stop lines, left-turn arrows, turn lanes and lane changes in traffic.' },
  { id: 'highway', title: 'Highway', blurb: 'Merge, move to the lane you are asked for, follow the overhead signs at exits and splits onto other highways (I-80 West, US-101 North...); faster traffic keeps left, jams on Traffic 5.' },
  { id: 'roundabout', title: 'Roundabouts', blurb: 'A country route of roundabouts only. You are told which exit to take (1st to 4th): take the wrong one and it is game over.' },
  { id: 'mixed', title: 'Mixed', blurb: 'Everything together: traffic lights, roundabouts, stop and yield signs, turn lanes and lane changes.' },
]
/** the road layout each mode is driven on */
export const layoutOf = (m: Mode) => (m === 'roundabout' ? 'rb' : m === 'residential' ? 'res' : m === 'mixed' ? 'mixed' : 'lights') as 'rb' | 'res' | 'mixed' | 'lights'

/** A node (junction) on the route. Coordinates are unwrapped grid indices; directions: 0 east, 1 north, 2 west, 3 south. */
export interface Step {
  i: number
  j: number
  din: number // direction of travel when arriving
  out: number // direction of travel when leaving
  kind: NodeKind
}

export const nav = {
  mode: 'mixed' as Mode,
  steps: [] as Step[],
  k: 0,
  dest: { i: 0, j: 0 },
  arrived: 0,
  /** Mixed course: the junctions still to visit on the way to the highway entrance, and whether you are past the last junction
   *  and heading for the entrance itself */
  goals: [] as Goal[],
  toRamp: false,
  /** where the next town leg starts: in the residential district (a fresh start) or in the city (just off the highway) */
  start: 'res' as 'res' | 'city',
  // read by the HUD / map screen
  text: '',
  sub: '',
  icon: 'S',
  dist: 0,
}

const rnd = (n: number) => Math.floor(Math.random() * n)

/* ------------------------------------------------------------------ */
/* Mixed course: residential -> city -> highway entrance               */
/* ------------------------------------------------------------------ */
/** how far along the road past RAMP the entrance leaves it (m from the junction centre) */
export const RAMP_U = 150
/** The highway entrance: a slip road on the right of the eastbound main road just after the junction RAMP (it leaves eastward). */
export const RAMP = { i: 2, j: 3, out: 0 }
type Goal = { i: number; j: number } | 'ramp'
const RES_NODES: Array<[number, number]> = [[0, 1], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [0, 0], [0, 2]]
const CITY_NODES: Array<[number, number]> = [[2, 1], [3, 0], [3, 1], [3, 2], [3, 3], [2, 0], [2, 2]]
const pickNode = (list: Array<[number, number]>) => { const [i, j] = list[rnd(list.length)]; return { i, j } }
/** goals for a town leg of the Mixed course */
function mixedGoals(from: 'res' | 'city'): Goal[] {
  return from === 'res' ? [pickNode(RES_NODES), pickNode(CITY_NODES), 'ramp'] : [pickNode(RES_NODES), pickNode(CITY_NODES), 'ramp']
}
/** Shortest route (fewest junctions, no U-turns) from arriving at (i, j) heading d to a junction where `goal` holds.
 *  The last step's `out` is left as the heading it arrived with (the caller sets it). */
function bfs(i: number, j: number, d: number, goal: (i: number, j: number, d: number) => boolean): Step[] | null {
  type S = { i: number; j: number; d: number; prev: S | null }
  const seen = new Set<string>()
  const q: S[] = [{ i, j, d, prev: null }]
  for (let h = 0; h < q.length && h < 4000; h++) {
    const s = q[h]
    const key = `${mod(s.i, G)},${mod(s.j, G)},${s.d}`
    if (seen.has(key)) continue
    seen.add(key)
    if (h > 0 && goal(s.i, s.j, s.d)) {
      const chain: S[] = []
      for (let c: S | null = s; c; c = c.prev) chain.unshift(c)
      return chain.map((c, k) => ({ i: c.i, j: c.j, din: c.d, out: k + 1 < chain.length ? chain[k + 1].d : c.d, kind: nodeKind(c.i, c.j) }))
    }
    // no U-turns, except all the way round a roundabout (the only way on at a one-exit roundabout)
    const outs = nodeKind(s.i, s.j) === 'round' ? [s.d, mod(s.d + 1, 4), mod(s.d + 3, 4), mod(s.d + 2, 4)] : [s.d, mod(s.d + 1, 4), mod(s.d + 3, 4)]
    for (const out of outs) {
      if (armClosed(s.i, s.j, out)) continue
      q.push({ i: s.i + DIRS[out][0], j: s.j + DIRS[out][1], d: out, prev: s })
    }
  }
  return null
}
/** the whole route through the remaining goals, starting on arrival at (i, j) heading d */
function planMixed(i: number, j: number, d: number, goals: Goal[]): Step[] {
  let steps: Step[] = []
  let cur = { i, j, d }
  let first = true
  for (const g of goals) {
    const pred = g === 'ramp'
      ? (a: number, b: number, dd: number) => mod(a, G) === RAMP.i && mod(b, G) === RAMP.j && dd !== mod(RAMP.out + 2, 4)
      : (a: number, b: number) => mod(a, G) === g.i && mod(b, G) === g.j
    // the first goal may be the very junction we are arriving at: then it counts at once
    let seg = first && pred(cur.i, cur.j, cur.d) ? [{ i: cur.i, j: cur.j, din: cur.d, out: cur.d, kind: nodeKind(cur.i, cur.j) }] : bfs(cur.i, cur.j, cur.d, pred)
    if (!seg) continue
    if (!first && steps.length) steps.pop() // the junction we stopped at begins the next part
    first = false
    const last = seg[seg.length - 1]
    steps = steps.concat(seg)
    cur = { i: last.i, j: last.j, d: last.din }
    if (g === 'ramp') last.out = RAMP.out // (a waypoint's way out is set below, from the next part of the route)
  }
  // stitch: each step's out leads to the next step's junction
  for (let k = 0; k + 1 < steps.length; k++) {
    const a = steps[k], b = steps[k + 1]
    if (a.i === b.i && a.j === b.j) { steps.splice(k + 1, 1); k-- }
  }
  for (let k = 0; k + 1 < steps.length; k++) steps[k].out = steps[k + 1].din
  return steps.length ? steps : makeSteps('city', i, j, d)
}
export const nodeName = (i: number, j: number) => `${VERTICAL_NAMES[mod(i, 4)]} & ${HORIZONTAL_NAMES[mod(j, 4)]}`
/** name of the road you are on after leaving node (i, j) in direction d */
const roadName = (i: number, j: number, d: number) => (d % 2 === 0 ? HORIZONTAL_NAMES[mod(j, 4)] : VERTICAL_NAMES[mod(i, 4)])

export const headingOfDir = (d: number) => {
  const [dx, dz] = dirv(d)
  return Math.atan2(-dx, -dz)
}

/* ------------------------------------------------------------------ */
/* Route generation                                                    */
/* ------------------------------------------------------------------ */
/** If the road we wanted is closed (a roundabout with fewer exits, a T-junction), take the nearest open one: straight, left, right, then back. */
function openOut(i: number, j: number, din: number, want: number) {
  if (!armClosed(i, j, want)) return want
  const options = [din, mod(din + 1, 4), mod(din + 3, 4), mod(din + 2, 4)].filter((o) => !armClosed(i, j, o))
  return options.length ? options[Math.floor(Math.random() * Math.min(options.length, 2))] : want
}

function walk(mode: Mode, i: number, j: number, d: number, count: number): Step[] {
  const steps: Step[] = []
  for (let n = 0; n < count; n++) {
    const kind = nodeKind(i, j)
    let out = d
    const r = Math.random()
    const turn = () => (Math.random() < 0.5 ? mod(d + 1, 4) : mod(d + 3, 4))
    if (mode === 'roundabout') {
      // exits counted from the entry: 1st = right, 2nd = straight on, 3rd = left, 4th = back the way you came
      if (kind === 'round') out = r < 0.25 ? mod(d + 3, 4) : r < 0.55 ? d : r < 0.8 ? mod(d + 1, 4) : mod(d + 2, 4)
    } else if (r >= 0.5) out = turn()
    out = openOut(i, j, d, out)
    steps.push({ i, j, din: d, out, kind })
    d = out
    i += DIRS[d][0]
    j += DIRS[d][1]
  }
  return steps
}

const turnsIn = (steps: Step[]) => steps.filter((s) => s.out !== s.din).length

function makeSteps(mode: Mode, i: number, j: number, d: number) {
  const count = mode === 'roundabout' ? 8 : 7
  let steps = walk(mode, i, j, d, count)
  for (let tries = 0; tries < 30; tries++) {
    const ok = mode === 'roundabout' ? turnsIn(steps) >= 1 : turnsIn(steps) >= 2
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
    out = openOut(i, j, d, out)
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
  nav.toRamp = false
  let dir = 0
  let i0 = 0, j0 = 0
  for (let tries = 0; tries < 40; tries++) {
    dir = rnd(2) === 0 ? 0 : 2 // east or west
    if (mode === 'roundabout') { dir = rnd(4); i0 = rnd(4); j0 = rnd(4) }
    else if (mode === 'mixed' && nav.start === 'res') { dir = rnd(2) === 0 ? 1 : 3; i0 = rnd(2); j0 = 1 + 2 * rnd(2) } // on a residential street
    else if (mode === 'mixed') { dir = rnd(2) === 0 ? 0 : 2; i0 = 2 + rnd(2); j0 = 1 + 2 * rnd(2) } // just off the highway, in the city
    else { i0 = rnd(4); j0 = 1 + 2 * rnd(2) }
    const besideRamp = mode === 'mixed' && mod(i0, G) === RAMP.i + 1 && mod(j0, G) === RAMP.j && dir === 0 // not right beside the entrance
    if (!armClosed(i0, j0, mod(dir + 2, 4)) && nodeKind(i0, j0) === 'signal' && !besideRamp) break // the road we start on must exist
  }
  if (mode === 'mixed') {
    nav.goals = mixedGoals(nav.start)
    setSteps(planMixed(i0, j0, dir, nav.goals))
  } else setSteps(makeSteps(mode, i0, j0, dir))
  const [dx, dz] = dirv(dir)
  const [rx, rz] = dirv(dir - 1)
  // the outer lane of the 2-lane road; a residential street has just the one, which sits beyond the centre turn lane where there is one
  const lane = armOne(i0, j0, dir) ? (jTypeOf(i0, j0, dir % 2)?.mw ?? 0) * LANE_W + laneC(0, true) : laneOff(1)
  // 100 m before the first junction, in the lane, facing along the road (which may bend)
  const back = mod(dir + 2, 4)
  const [x, z] = roadPoint(nodeX(i0), nodeZ(j0), back, 100, -lane)
  const [x2, z2] = roadPoint(nodeX(i0), nodeZ(j0), back, 98, -lane)
  void dx; void dz; void rx; void rz
  return { x, z, h: Math.atan2(-(x2 - x), -(z2 - z)) }
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
/** the number of the exit that this step asks for (1st is on the right) */
export function exitNumber(step: Step) {
  const order = [mod(step.din + 3, 4), step.din, mod(step.din + 1, 4), mod(step.din + 2, 4)]
  return order.slice(0, order.indexOf(step.out) + 1).filter((o) => !armClosed(step.i, step.j, o)).length || 1
}
export const turnName = (din: number, out: number): 'right' | 'straight' | 'left' | 'back' => (['straight', 'left', 'back', 'right'] as const)[mod(out - din, 4)]
export function describe(step: Step | undefined, last: boolean) {
  if (!step) return { text: '', sub: '', icon: 'S' }
  if (last) return { text: 'Destination ahead', sub: nodeName(step.i, step.j), icon: 'F' }
  const turn = mod(step.out - step.din, 4) // 0 straight, 1 left, 3 right, 2 U-turn
  const onto = roadName(step.i, step.j, step.out)
  if (step.kind === 'round') {
    // exits are counted anticlockwise from the entry (right, straight, left, back), skipping roads this roundabout does not have
    const order = [mod(step.din + 3, 4), step.din, mod(step.din + 1, 4), mod(step.din + 2, 4)]
    const exit = order.slice(0, order.indexOf(step.out) + 1).filter((o) => !armClosed(step.i, step.j, o)).length || 1
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
  nav.dist = Math.max(0, Math.hypot(px - nodeX(st.i), pz - nodeZ(st.j)) - clearance(st.i, st.j, st.din % 2))
  const last = nav.k === nav.steps.length - 1
  const d = describe(st, last)
  nav.text = d.text
  nav.sub = d.sub
  nav.icon = d.icon
  if (nav.mode === 'mixed') {
    if (nav.toRamp) {
      // past the last junction: the entrance is on the right, a little way along
      const along = wrapD(px - nodeX(RAMP.i)) * DIRS[RAMP.out][0] + wrapD(pz - nodeZ(RAMP.j)) * DIRS[RAMP.out][1]
      nav.text = 'Take the highway entrance'
      nav.sub = 'on the right · I-5 North'
      nav.icon = 'R'
      nav.dist = Math.max(0, RAMP_U - along)
      if (along > RAMP_U + 60) { // missed it: go round the block and try again
        nav.toRamp = false
        const ni = RAMP.i + DIRS[RAMP.out][0], nj = RAMP.j + DIRS[RAMP.out][1]
        setSteps(planMixed(ni, nj, RAMP.out, ['ramp']))
        return 'missed'
      }
    } else if (last) {
      nav.text = d.text === 'Destination ahead' ? 'Continue straight' : d.text
      nav.sub = 'then the highway entrance on the right'
    }
    return null
  }
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
    if (nav.mode === 'mixed' && nav.k === nav.steps.length - 1) nav.toRamp = true // the last junction: the entrance is next
    const g0 = nav.goals[0]
    if (nav.mode === 'mixed' && g0 && g0 !== 'ramp' && mod(g0.i, G) === mod(i, G) && mod(g0.j, G) === mod(j, G)) nav.goals.shift()
    nav.k = Math.min(nav.k + 1, nav.steps.length - 1)
    return 'ok'
  }
  if (nav.mode === 'mixed') {
    // recalculate through the goals not yet reached (a waypoint counts once you have driven through it)
    const reached = nav.goals.findIndex((g) => g !== 'ramp' && mod(g.i, G) === mod(i, G) && mod(g.j, G) === mod(j, G))
    if (reached >= 0) nav.goals = nav.goals.slice(reached + 1)
    setSteps(planMixed(i + DIRS[dOut][0], j + DIRS[dOut][1], dOut, nav.goals.length ? nav.goals : ['ramp']))
    return 'wrong'
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
