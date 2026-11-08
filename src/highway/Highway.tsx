import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  ACC_EDGE_R, ACC_X, LANE, MEDIAN_X, NB_EDGE_L, NB_EDGE_R, NB_SHOULDER_L, NB_X, RAMP_SHOULDER_L, RAMP_SHOULDER_R, SB_EDGE_IN, SB_EDGE_OUT, SB_X,
  SHOULDER_R, Z_BEGIN_NB, Z_BEGIN_SB, Z_END, Z_FINISH, Z_GORE, Z_RAMP_BEND, Z_START, Z_TAPER, accRightEdge, nbPavementRight, rampX,
} from './layout'

type V3 = [number, number, number]
const CHUNK = 200
const chunkOf = (z: number) => Math.floor((z - Z_FINISH + 100) / CHUNK)
const NCH = Math.ceil((Z_START - Z_FINISH + 300) / CHUNK) + 1

/** geometry collected per 200 m chunk so only the stretch you can see is drawn */
class Buf {
  pos: number[][] = Array.from({ length: NCH }, () => [])
  nor: number[][] = Array.from({ length: NCH }, () => [])
  uv: number[][] = Array.from({ length: NCH }, () => [])
  col: number[][] = Array.from({ length: NCH }, () => [])
  tri(a: V3, b: V3, c: V3, n: V3, color: V3, uvs?: [number, number][]) {
    const k = Math.max(0, Math.min(NCH - 1, chunkOf((a[2] + b[2] + c[2]) / 3)))
    ;[a, b, c].forEach((p, i) => {
      this.pos[k].push(p[0], p[1], p[2])
      this.nor[k].push(n[0], n[1], n[2])
      this.uv[k].push(uvs ? uvs[i][0] : p[0] / 4, uvs ? uvs[i][1] : p[2] / 4)
      this.col[k].push(color[0], color[1], color[2])
    })
  }
  /** a flat quad facing up (corners in order around it) */
  flat(a: [number, number], b: [number, number], c: [number, number], d: [number, number], y: number, color: V3) {
    const A: V3 = [a[0], y, a[1]], B: V3 = [b[0], y, b[1]], C: V3 = [c[0], y, c[1]], D: V3 = [d[0], y, d[1]]
    const up: V3 = [0, 1, 0]
    this.tri(A, B, C, up, color)
    this.tri(A, C, D, up, color)
  }
  box(x: number, y0: number, z: number, w: number, h: number, d: number, color: V3) {
    const x0 = x - w / 2, x1 = x + w / 2, y1 = y0 + h, z0 = z - d / 2, z1 = z + d / 2
    const q = (a: V3, b: V3, c: V3, dd: V3, n: V3, shade = 1) => {
      const col: V3 = [color[0] * shade, color[1] * shade, color[2] * shade]
      this.tri(a, b, c, n, col)
      this.tri(a, c, dd, n, col)
    }
    q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], 1)
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 0.85)
    q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 0.85)
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 0.75)
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 0.75)
  }
  build(): THREE.BufferGeometry[] {
    const out: THREE.BufferGeometry[] = []
    for (let k = 0; k < NCH; k++) {
      if (!this.pos[k].length) continue
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos[k], 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor[k], 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv[k], 2))
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col[k], 3))
      g.computeBoundingSphere()
      out.push(g)
    }
    return out
  }
}

const WHITE: V3 = [0.9, 0.9, 0.88]
const YELLOW: V3 = [0.95, 0.74, 0.1]
const GUARD: V3 = [0.62, 0.64, 0.67]
const POST: V3 = [0.45, 0.46, 0.48]
const BARRIER: V3 = [0.6, 0.6, 0.6]

/** a strip between two edges that change along z: edges(z) -> [xLeft, xRight] */
function strip(buf: Buf, z0: number, z1: number, step: number, edges: (z: number) => [number, number], y: number, color: V3) {
  for (let z = z0; z > z1 + 0.001; z -= step) {
    const zn = Math.max(z - step, z1)
    const [al, ar] = edges(z)
    const [bl, br] = edges(zn)
    // z decreases along the strip: corners go (left,z) (right,z) (right,zn) (left,zn)
    buf.flat([al, z], [ar, z], [br, zn], [bl, zn], y, color)
  }
}
/** a line of constant width along an x(z) path; dashes optional */
function line(buf: Buf, z0: number, z1: number, xAt: (z: number) => number, w: number, color: V3, dash?: [number, number], step = 6) {
  const y = 0.02
  if (!dash) {
    for (let z = z0; z > z1 + 0.001; z -= step) {
      const zn = Math.max(z - step, z1)
      buf.flat([xAt(z) - w / 2, z], [xAt(z) + w / 2, z], [xAt(zn) + w / 2, zn], [xAt(zn) - w / 2, zn], y, color)
    }
    return
  }
  const [on, off] = dash
  for (let z = z0; z > z1 + 0.001; z -= on + off) {
    const ze = Math.max(z - on, z1)
    buf.flat([xAt(z) - w / 2, z], [xAt(z) + w / 2, z], [xAt(ze) + w / 2, ze], [xAt(ze) - w / 2, ze], y, color)
  }
}

interface Props { }
export function buildHighway() {
  const asphalt = new Buf(), marks = new Buf(), solid = new Buf()
  const ASPH: V3 = [1, 1, 1]
  const STEP = 20

  // ---- pavement ----
  // the ramp: one lane with shoulders
  strip(asphalt, Z_START + 5, Z_GORE, 10, (z) => [rampX(z) - LANE / 2 - RAMP_SHOULDER_L, rampX(z) + LANE / 2 + RAMP_SHOULDER_R], 0, ASPH)
  // the northbound carriageway with its merge lane
  strip(asphalt, Z_BEGIN_NB, Z_FINISH, STEP, (z) => [NB_EDGE_L - NB_SHOULDER_L, nbPavementRight(z)], 0, ASPH)
  // the southbound carriageway
  strip(asphalt, Z_BEGIN_SB, Z_FINISH, 40, () => [SB_EDGE_OUT - SHOULDER_R, SB_EDGE_IN + NB_SHOULDER_L], 0, ASPH)

  // ---- markings ----
  // northbound: yellow left edge, dashed lane dividers, white right edge (broken beside the merge lane)
  line(marks, Z_BEGIN_NB, Z_FINISH, () => NB_EDGE_L, 0.18, YELLOW, undefined, 40)
  for (const x of [NB_EDGE_L + LANE, NB_EDGE_L + 2 * LANE]) line(marks, Z_BEGIN_NB, Z_FINISH, () => x, 0.15, WHITE, [3, 9])
  line(marks, Z_END, Z_FINISH, () => NB_EDGE_R, 0.18, WHITE, undefined, 40) // right edge line after the merge lane ends
  line(marks, Z_BEGIN_NB, Z_END, () => NB_EDGE_R, 0.18, WHITE, [3, 9]) // dashed boundary between the highway and the merge lane
  // merge lane right edge (follows the taper)
  line(marks, Z_GORE, Z_END, accRightEdge, 0.18, WHITE, undefined, 6)
  // ramp edges
  line(marks, Z_START + 5, Z_GORE, (z) => rampX(z) - LANE / 2, 0.18, YELLOW, undefined, 10)
  line(marks, Z_START + 5, Z_GORE, (z) => rampX(z) + LANE / 2, 0.18, WHITE, undefined, 10)
  // southbound: white right edge, dashed dividers, yellow left edge
  line(marks, Z_BEGIN_SB, Z_FINISH, () => SB_EDGE_OUT, 0.18, WHITE, undefined, 40)
  for (const x of [SB_X[0] - LANE / 2 - LANE, SB_X[1] - LANE / 2 - LANE]) void x
  for (const x of [-12.85, -16.55]) line(marks, Z_BEGIN_SB, Z_FINISH, () => x, 0.15, WHITE, [3, 9])
  line(marks, Z_BEGIN_SB, Z_FINISH, () => SB_EDGE_IN, 0.18, YELLOW, undefined, 40)
  // the gore: chevron stripes where the ramp meets the highway
  for (let z = Z_GORE + 60; z > Z_GORE + 2; z -= 5) {
    const x0 = rampX(z) - LANE / 2 - 0.6, x1 = NB_EDGE_R + 0.15
    if (x0 > x1) {
      // diagonal stripes between the ramp's left edge and the highway's right edge line
      marks.flat([x1, z], [x1 + 0.35, z], [x0 + 0.35, z - 2.2], [x0, z - 2.2], 0.02, WHITE)
    }
  }
  // "stop bar" style lane arrow on the ramp: a merge arrow pointing up the lane
  for (const z of [Z_GORE + 260, Z_GORE + 90]) {
    const cx = rampX(z)
    marks.flat([cx - 0.15, z], [cx + 0.15, z], [cx + 0.15, z - 3], [cx - 0.15, z - 3], 0.02, WHITE)
    marks.flat([cx - 0.6, z - 3], [cx + 0.6, z - 3], [cx, z - 4.4], [cx, z - 4.4], 0.02, WHITE)
  }
  // painted "MERGE" arrows inside the merge lane (a curved merge arrow is drawn as a bent arrow)
  for (const z of [Z_GORE - 40, Z_TAPER + 70]) {
    const cx = ACC_X
    marks.flat([cx - 0.15, z], [cx + 0.15, z], [cx - 0.15 - 0.6, z - 5], [cx - 0.45 - 0.6, z - 5], 0.02, WHITE)
    marks.flat([cx - 1.55, z - 5], [cx - 0.3, z - 5], [cx - 1.25, z - 6.8], [cx - 1.25, z - 6.8], 0.02, WHITE)
  }
  // lane-end hatching at the very end of the merge lane
  for (let z = Z_END + 14; z > Z_END; z -= 1.4) marks.flat([NB_EDGE_R + 0.1, z], [accRightEdge(z) - 0.1, z], [accRightEdge(z - 0.5) - 0.1, z - 0.5], [NB_EDGE_R + 0.1, z - 0.5], 0.02, WHITE)

  // ---- crash barriers and guard rails ----
  const rail = (x: number, z0: number, z1: number, xOf?: (z: number) => number) => {
    for (let z = z0; z > z1; z -= 4) {
      const px = xOf ? xOf(z) : x
      solid.box(px, 0, z, 0.08, 0.2, 4.0, GUARD)
      solid.box(px, 0.45, z, 0.08, 0.2, 4.0, GUARD)
      solid.box(px, 0, z - 2, 0.1, 0.8, 0.1, POST)
    }
  }
  // median: concrete barrier between the carriageways
  for (let z = Z_BEGIN_SB; z > Z_FINISH; z -= 6) solid.box(MEDIAN_X, 0, z, 0.55, 0.85, 6.0, BARRIER)
  // outer guard rail along the ramp and the merge lane (beyond the shoulder)
  rail(0, Z_START, Z_GORE, (z) => rampX(z) + LANE / 2 + RAMP_SHOULDER_R + 0.4)
  rail(0, Z_GORE, Z_FINISH, (z) => (z > Z_END ? nbPavementRight(z) + 0.4 : NB_EDGE_R + SHOULDER_R + 0.4))
  rail(SB_EDGE_OUT - SHOULDER_R - 0.4, Z_BEGIN_SB, Z_FINISH)
  // a crash cushion at the gore nose
  solid.box(NB_EDGE_R + 1.6, 0, Z_GORE + 4, 1.0, 0.9, 2.0, [0.95, 0.72, 0.1])

  void Z_RAMP_BEND; void Props
  return { asphalt: asphalt.build(), marks: marks.build(), solid: solid.build() }
}

/* -------------------------------- signs -------------------------------- */
function signCanvas() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 512
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  const diamond = (x: number, y: number, draw: (g: CanvasRenderingContext2D) => void) => {
    g.save(); g.translate(x, y)
    g.fillStyle = '#f7c600'; g.strokeStyle = '#111'; g.lineWidth = 8
    g.beginPath(); g.moveTo(0, -120); g.lineTo(120, 0); g.lineTo(0, 120); g.lineTo(-120, 0); g.closePath(); g.fill(); g.stroke()
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round'
    draw(g)
    g.restore()
  }
  // 0: MERGE (two lanes joining)
  diamond(130, 130, (g) => {
    g.beginPath(); g.moveTo(-18, 70); g.lineTo(-18, -20); g.lineTo(-18, -60); g.stroke()
    g.beginPath(); g.moveTo(30, 70); g.quadraticCurveTo(30, 0, -12, -35); g.stroke()
    g.beginPath(); g.moveTo(-18, -78); g.lineTo(-40, -50); g.lineTo(2, -50); g.closePath(); g.fill()
  })
  // 1: RIGHT LANE ENDS
  diamond(390, 130, (g) => {
    g.beginPath(); g.moveTo(-28, 70); g.lineTo(-28, -50); g.stroke()
    g.lineWidth = 8; g.beginPath(); g.moveTo(32, 70); g.lineTo(32, 10); g.stroke()
    g.lineWidth = 14; g.beginPath(); g.moveTo(32, 10); g.lineTo(-10, -40); g.stroke()
    g.beginPath(); g.moveTo(-28, -78); g.lineTo(-50, -48); g.lineTo(-6, -48); g.closePath(); g.fill()
  })
  // 2: speed limit 65
  g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 8
  g.beginPath(); g.roundRect(530, 20, 220, 260, 16); g.fill(); g.stroke()
  g.fillStyle = '#111'; g.textAlign = 'center'; g.font = '700 46px system-ui, sans-serif'; g.fillText('SPEED', 640, 82); g.fillText('LIMIT', 640, 128)
  g.font = '700 120px system-ui, sans-serif'; g.fillText('65', 640, 250)
  // 3: green guide sign (highway)
  g.fillStyle = '#0a6b3a'; g.strokeStyle = '#fff'; g.lineWidth = 8
  g.beginPath(); g.roundRect(780, 40, 230, 220, 18); g.fill(); g.stroke()
  g.fillStyle = '#fff'; g.font = '700 40px system-ui, sans-serif'; g.fillText('HIGHWAY', 895, 112); g.font = '700 54px system-ui, sans-serif'; g.fillText('NORTH', 895, 176)
  // 4: advisory ramp speed 45
  g.fillStyle = '#f7c600'; g.strokeStyle = '#111'; g.lineWidth = 8
  g.beginPath(); g.roundRect(20, 290, 220, 200, 14); g.fill(); g.stroke()
  g.fillStyle = '#111'; g.font = '700 38px system-ui, sans-serif'; g.fillText('RAMP', 130, 346); g.fillText('SPEED', 130, 388); g.font = '700 70px system-ui, sans-serif'; g.fillText('45', 130, 466)
  // 5: white regulatory "MERGING TRAFFIC / LANE ENDS 1000 FT"
  g.fillStyle = '#fff'; g.strokeStyle = '#111'
  g.beginPath(); g.roundRect(270, 290, 430, 200, 14); g.fill(); g.stroke()
  g.fillStyle = '#111'; g.font = '700 46px system-ui, sans-serif'; g.fillText('MERGE LANE ENDS', 485, 360); g.font = '700 66px system-ui, sans-serif'; g.fillText('SIGNAL & MERGE', 485, 440)
  return c
}
const CELLS = [
  { u: 0, v: 0, w: 260, h: 260 }, // merge
  { u: 260, v: 0, w: 260, h: 260 }, // right lane ends
  { u: 520, v: 10, w: 240, h: 280 }, // speed 65
  { u: 770, v: 30, w: 250, h: 240 }, // green
  { u: 10, v: 280, w: 240, h: 220 }, // ramp 45
  { u: 260, v: 280, w: 450, h: 220 }, // merge lane ends
]
function signMesh(items: Array<{ x: number; z: number; cell: number; h: number; w: number; hh: number; face?: number }>) {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = []
  const post: number[] = []
  items.forEach((it, i) => {
    const c = CELLS[it.cell]
    const u0 = c.u / 1024, u1 = (c.u + c.w) / 1024, v0 = 1 - (c.v + c.h) / 512, v1 = 1 - c.v / 512
    const y0 = it.h, y1 = it.h + it.hh
    const x0 = it.x - it.w / 2, x1 = it.x + it.w / 2
    pos.push(x0, y0, it.z, x1, y0, it.z, x1, y1, it.z, x0, y1, it.z)
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
    for (let k = 0; k < 4; k++) nor.push(0, 0, 1)
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
    post.push(it.x, it.z, it.h)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  return { geo: g, posts: post }
}

function Props() { return null }

/** The whole course, drawn in 200 m chunks (only the nearby ones are rendered by the camera). */
export function Highway() {
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const data = useMemo(buildHighway, [])
  const res = useMemo(() => {
    const loader = new THREE.TextureLoader()
    const load = (name: string, srgb: boolean) => {
      const t = loader.load(`/tex/asphalt_${name}.jpg`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = Math.min(8, maxAniso)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    const atlas = new THREE.CanvasTexture(signCanvas())
    atlas.colorSpace = THREE.SRGBColorSpace
    atlas.anisotropy = Math.min(8, maxAniso)
    return {
      asphalt: new THREE.MeshStandardMaterial({ map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false), color: '#85858a', normalScale: new THREE.Vector2(1.3, 1.3) }),
      marks: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 }),
      signs: new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 }),
      atlas,
    }
  }, [maxAniso])
  useEffect(() => () => { res.asphalt.map?.dispose(); res.atlas.dispose() }, [res])

  // roadside signs (cell, x, z): standing on the right verge of the ramp / highway, facing the traffic
  const signs = useMemo(() => {
    const items: Array<{ x: number; z: number; cell: number; h: number; w: number; hh: number }> = []
    const rx = (z: number) => rampX(z) + LANE / 2 + RAMP_SHOULDER_R + 1.8
    items.push({ x: rx(1380), z: 1380, cell: 3, h: 1.6, w: 2.6, hh: 2.5 })
    items.push({ x: rx(1250), z: 1250, cell: 4, h: 1.6, w: 1.8, hh: 1.65 })
    items.push({ x: rx(1000), z: 1000, cell: 0, h: 1.6, w: 1.9, hh: 1.9 })
    items.push({ x: rx(700), z: 700, cell: 2, h: 1.6, w: 1.3, hh: 1.55 })
    items.push({ x: rx(520), z: 520, cell: 0, h: 1.6, w: 1.9, hh: 1.9 })
    // along the merge lane: lane-ends warnings (distance to the end) and the "merge lane ends" board
    const mr = (z: number) => accRightEdge(z) + 3.7
    items.push({ x: mr(380), z: 380, cell: 5, h: 1.6, w: 3.4, hh: 1.7 })
    items.push({ x: mr(300), z: 300, cell: 1, h: 1.6, w: 1.9, hh: 1.9 })
    items.push({ x: mr(150), z: 150, cell: 5, h: 1.6, w: 3.4, hh: 1.7 })
    items.push({ x: mr(60), z: 60, cell: 1, h: 1.6, w: 1.9, hh: 1.9 })
    for (let z = 0; z > Z_FINISH; z -= 600) items.push({ x: NB_EDGE_R + SHOULDER_R + 2.2, z, cell: 2, h: 1.6, w: 1.3, hh: 1.55 })
    return signMesh(items)
  }, [])
  void ACC_EDGE_R; void Z_TAPER; void Z_END; void SB_X; void NB_X

  // trees along both sides
  const trees = useMemo(() => {
    const out: Array<[number, number, number]> = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let z = Z_START; z > Z_FINISH; z -= 14 + rnd() * 16) {
      out.push([rampX(Math.max(z, Z_GORE)) + 12 + rnd() * 40, z, 0.8 + rnd() * 0.9])
      out.push([nbPavementRight(z) + 9 + rnd() * 50, z + rnd() * 6, 0.8 + rnd() * 0.9])
      out.push([SB_EDGE_OUT - SHOULDER_R - 8 - rnd() * 50, z + rnd() * 6, 0.8 + rnd() * 0.9])
    }
    return out
  }, [])
  const treeMesh = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.22, 0.3, 3, 6); trunk.translate(0, 1.5, 0)
    const crown = new THREE.IcosahedronGeometry(2.4, 0); crown.translate(0, 4.6, 0)
    const m1 = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 1 }), trees.length)
    const m2 = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: '#2f6b2f', roughness: 0.95, flatShading: true }), trees.length)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3()
    trees.forEach(([x, z, sc], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7)
      m.compose(p.set(x, 0, z), q, s.set(sc, sc, sc))
      m1.setMatrixAt(i, m)
      m2.setMatrixAt(i, m)
    })
    m1.frustumCulled = m2.frustumCulled = false
    return [m1, m2]
  }, [trees])
  const postMesh = useMemo(() => {
    const g = new THREE.BoxGeometry(0.1, 1, 0.1); g.translate(0, 0.5, 0)
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#6c7077', roughness: 0.6, metalness: 0.4 }), signs.posts.length / 3)
    const mat = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion()
    for (let i = 0; i < signs.posts.length; i += 3) {
      mat.compose(p.set(signs.posts[i], 0, signs.posts[i + 1] - 0.05), q, s.set(1, signs.posts[i + 2] + 1.5, 1))
      m.setMatrixAt(i / 3, mat)
    }
    m.frustumCulled = false
    return m
  }, [signs])

  return (
    <group>
      {data.asphalt.map((g, i) => <mesh key={'a' + i} geometry={g} material={res.asphalt} receiveShadow />)}
      {data.marks.map((g, i) => <mesh key={'m' + i} geometry={g} material={res.marks} renderOrder={1} />)}
      {data.solid.map((g, i) => <mesh key={'s' + i} geometry={g} material={res.solid} />)}
      <mesh geometry={signs.geo} material={res.signs} />
      <primitive object={postMesh} />
      <primitive object={treeMesh[0]} />
      <primitive object={treeMesh[1]} />
    </group>
  )
}
