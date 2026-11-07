import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ON, OFF, glowGeo, glowMat, lampGeo, lampMat, leafGeo, leafMat, trunkGeo, trunkMat } from '../game/City'
import { facadeCanvases } from '../game/cityBuild'
import { sim } from '../game/sim'
import { useGame } from '../game/store'
import { edgeAt, type GEdge } from './graph'
import { axisOf, realSignal } from './signals'
import { inRealBuilding, WORLD } from './world'

const LANE_W = 3.4
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x) }
type V3 = [number, number, number]

/** Triangle soup with per-vertex colour and normal (0, 1, 0): used for flat road surfaces and paint. */
class Flat {
  constructor(private lift = 0) {}
  pos: number[] = []
  col: number[] = []
  uv: number[] = []
  quad(a: number[], b: number[], c: number[], d: number[], y: number, color: V3, uvScale = 5) {
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p[0], y + this.lift, p[1])
      this.col.push(color[0], color[1], color[2])
      this.uv.push(p[0] / uvScale, p[1] / uvScale)
    }
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    const n = new Float32Array(this.pos.length)
    for (let i = 1; i < n.length; i += 3) n[i] = 1
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3))
    g.computeBoundingSphere()
    return g
  }
}

/** points along an edge's centreline, offset sideways by `off` (right of travel is positive), from distance s0 to s1 */
function lane(e: GEdge, off: number, s0: number, s1: number, step = 2.5) {
  const out: number[][] = []
  const o = { x: 0, z: 0, dx: 0, dz: 0 }, a = { x: 0, z: 0, dx: 0, dz: 0 }, b = { x: 0, z: 0, dx: 0, dz: 0 }
  const n = Math.max(1, Math.ceil((s1 - s0) / step))
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n
    edgeAt(e, s, o)
    edgeAt(e, Math.max(0, s - 1), a)
    edgeAt(e, Math.min(e.len, s + 1), b)
    let tx = a.dx + b.dx, tz = a.dz + b.dz
    const l = Math.hypot(tx, tz) || 1
    tx /= l; tz /= l
    out.push([o.x - tz * off, o.z + tx * off])
  }
  return out
}
function ribbon(f: Flat, pts: number[][], offA: number, offB: number, y: number, color: V3, e: GEdge, s0: number, s1: number, uv = 5) {
  // pts carries the centre path; left / right edges are made from the path at two offsets
  const L = lane(e, offA, s0, s1), R = lane(e, offB, s0, s1)
  void pts
  for (let i = 1; i < L.length; i++) f.quad(L[i - 1], R[i - 1], R[i], L[i], y, color, uv)
}
const dashes = (len: number, on: number, off: number, from = 0, to = len) => {
  const r: Array<[number, number]> = []
  for (let s = from; s + on <= to; s += on + off) r.push([s, s + on])
  return r
}

const WHITE: V3 = [0.93, 0.93, 0.9]
const YELLOW: V3 = [0.95, 0.76, 0.12]

function buildRoads() {
  const g = WORLD.graph!
  const asphalt = new Flat(0.03) // sits a few centimetres above the ground plane (depth precision at a distance)
  const marks = new Flat(0.035)
  const E = (e: GEdge) => e.oneWay || e.id < e.reverse // one edge per physical road
  const widest = new Map<number, number>()
  for (const e of g.edges) {
    for (const n of [e.from, e.to]) widest.set(n, Math.max(widest.get(n) ?? 0, e.width))
    if (!E(e)) continue
    const hw = e.width / 2
    ribbon(asphalt, [], -hw, hw, 0, [1, 1, 1], e, 0, e.len, 5)
    const base = e.hw.replace('_link', '')
    if (e.len < 6) continue
    const trim0 = Math.min(10, e.len * 0.25), trim1 = e.len - trim0
    const major = base === 'primary' || base === 'secondary' || base === 'tertiary' || base === 'trunk' || base === 'motorway'
    if (!e.oneWay) {
      if (major) {
        ribbon(marks, [], -0.3, -0.12, 0.03, YELLOW, e, trim0, trim1, 5)
        ribbon(marks, [], 0.12, 0.3, 0.03, YELLOW, e, trim0, trim1, 5)
      } else if (base !== 'service') {
        for (const [a, b] of dashes(e.len, 3, 9, trim0, trim1)) ribbon(marks, [], -0.08, 0.08, 0.03, YELLOW, e, a, b, 5)
      }
    }
    // dashed white lane dividers
    const perSide = e.lanes
    for (let k = 1; k < perSide; k++) {
      for (const sg of e.oneWay ? [(k - perSide / 2) * LANE_W] : [k * LANE_W, -k * LANE_W]) {
        for (const [a, b] of dashes(e.len, 3, 9, trim0, trim1)) ribbon(marks, [], sg - 0.075, sg + 0.075, 0.03, WHITE, e, a, b, 5)
      }
    }
    // solid white edge lines on the bigger roads
    if (major) for (const sg of [-1, 1]) ribbon(marks, [], sg * (hw - 0.35), sg * (hw - 0.17), 0.03, WHITE, e, trim0 * 0.4, e.len - trim0 * 0.4, 5)
  }
  // junction discs smooth the corners and fill the overlaps
  for (const n of g.nodes.values()) {
    if (n.out.length + n.inn.length < 3) continue
    const r = (widest.get(n.id) ?? 7) / 2 + 0.6
    const seg = 14
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2
      asphalt.quad([n.x, n.z], [n.x + Math.cos(a0) * r, n.z + Math.sin(a0) * r], [n.x + Math.cos(a1) * r, n.z + Math.sin(a1) * r], [n.x, n.z], 0.002, [1, 1, 1], 5)
    }
  }
  // crosswalks and stop lines at traffic signals, on every incoming road
  const o = { x: 0, z: 0, dx: 0, dz: 0 }
  for (const n of g.nodes.values()) {
    if (!n.signal) continue
    for (const eid of n.inn) {
      const e = g.edges[eid]
      if (e.len < 22) continue
      const hw = e.width / 2
      const sCross = e.len - Math.max(7, (widest.get(n.id) ?? 7) / 2 + 1.5)
      edgeAt(e, sCross, o)
      const nx = -o.dz, nz = o.dx
      // zebra stripes across the whole road
      for (let v = -hw + 0.5; v < hw - 0.3; v += 1.2) {
        const c = [o.x + nx * v, o.z + nz * v]
        marks.quad([c[0] - o.dx * 1.5 - nx * 0.3, c[1] - o.dz * 1.5 - nz * 0.3], [c[0] - o.dx * 1.5 + nx * 0.3, c[1] - o.dz * 1.5 + nz * 0.3], [c[0] + o.dx * 1.5 + nx * 0.3, c[1] + o.dz * 1.5 + nz * 0.3], [c[0] + o.dx * 1.5 - nx * 0.3, c[1] + o.dz * 1.5 - nz * 0.3], 0.03, WHITE, 5)
      }
      // stop line across the arriving lanes
      const sStop = sCross - 2.4
      edgeAt(e, sStop, o)
      const nx2 = -o.dz, nz2 = o.dx
      const a = e.oneWay ? -hw : 0.2, b = hw - 0.2
      marks.quad([o.x + nx2 * a, o.z + nz2 * a], [o.x + nx2 * b, o.z + nz2 * b], [o.x + nx2 * b + o.dx * 0.5, o.z + nz2 * b + o.dz * 0.5], [o.x + nx2 * a + o.dx * 0.5, o.z + nz2 * a + o.dz * 0.5], 0.03, WHITE, 5)
    }
  }
  return { asphalt: asphalt.build(), marks: marks.build() }
}

function buildBuildings() {
  const city = WORLD.city!
  const CH = 160
  const chunks = new Map<string, THREE.BufferGeometry[]>()
  const PALETTE: V3[] = [[0.82, 0.76, 0.68], [0.72, 0.62, 0.55], [0.7, 0.72, 0.76], [0.78, 0.78, 0.74], [0.66, 0.5, 0.44], [0.62, 0.66, 0.6], [0.86, 0.82, 0.72]]
  city.buildings.forEach((b, id) => {
    const shape = new THREE.Shape()
    for (let i = 0; i < b.p.length; i += 2) {
      if (i === 0) shape.moveTo(b.p[i], -b.p[i + 1])
      else shape.lineTo(b.p[i], -b.p[i + 1])
    }
    let geo: THREE.BufferGeometry
    try { geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(3, b.h), bevelEnabled: false }) } catch { return }
    geo.rotateX(-Math.PI / 2)
    const g = geo.index ? geo.toNonIndexed() : geo
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal')
    const uv = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3)
    const c = PALETTE[Math.floor(hash(id + 3) * PALETTE.length)]
    for (let i = 0; i < pos.count; i++) {
      const wall = Math.abs(nor.getY(i)) < 0.5
      uv[i * 2] = wall ? (Math.abs(nor.getZ(i)) > Math.abs(nor.getX(i)) ? pos.getX(i) : pos.getZ(i)) / 8 : 0.02
      uv[i * 2 + 1] = wall ? pos.getY(i) / 8 : 0.02
      col.set(c, i * 3)
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const key = Math.floor(b.p[0] / CH) + ',' + Math.floor(b.p[1] / CH)
    const l = chunks.get(key)
    if (l) l.push(g)
    else chunks.set(key, [g])
  })
  return [...chunks.values()].map((l) => mergeGeometries(l, false)!).filter(Boolean)
}

interface Lamp { x: number; y: number; z: number; yaw: number; node: number; axis: 0 | 1; l: number }

/** Signal poles with a three-section head over each approach, placed on the right-hand verge just past the crosswalk. */
function buildSignals() {
  const g = WORLD.graph!
  const parts: THREE.BufferGeometry[] = []
  const lamps: Lamp[] = []
  const o = { x: 0, z: 0, dx: 0, dz: 0 }
  const dark = new THREE.Color(0.06, 0.06, 0.07), pole = new THREE.Color(0.42, 0.44, 0.48)
  const paint = (geo: THREE.BufferGeometry, c: THREE.Color) => {
    const n = geo.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return geo
  }
  for (const n of g.nodes.values()) {
    if (!n.signal) continue
    for (const eid of n.inn) {
      const e = g.edges[eid]
      if (e.len < 22) continue
      edgeAt(e, e.len - 1, o)
      const tx = o.dx, tz = o.dz // travel direction into the junction
      const rx = -tz, rz = tx // right of travel
      const hw = e.width / 2
      // far side of the junction, on the verge to the right of the arriving road, facing the arriving driver
      const px = n.x + tx * 6 + rx * (hw + 1.3), pz = n.z + tz * 6 + rz * (hw + 1.3)
      const yaw = Math.atan2(-tx, -tz)
      const tube = new THREE.CylinderGeometry(0.1, 0.17, 5.2, 10)
      tube.translate(px, 2.6, pz)
      parts.push(paint(tube, pole))
      const arm = new THREE.BoxGeometry(0.12, 0.12, 2.6)
      arm.translate(0, 0, -1.3)
      arm.rotateY(yaw + Math.PI)
      // the mast arm reaches back over the lanes
      arm.translate(px, 5.0, pz)
      parts.push(paint(arm, pole))
      for (const [dxx, yy, big] of [[-(hw * 0.5 + 0.7), 4.5, true], [0, 3.1, false]] as Array<[number, number, boolean]>) {
        const hx = px + rx * dxx - tx * 0 + (big ? -tx * 0 : 0), hz = pz + rz * dxx
        const hxx = big ? px - rx * (hw * 0.5 + 0.7) : px, hzz = big ? pz - rz * (hw * 0.5 + 0.7) : pz
        void hx; void hz
        const head = new THREE.BoxGeometry(0.46, 1.52, 0.3)
        head.rotateY(yaw)
        head.translate(hxx, yy, hzz)
        parts.push(paint(head, dark))
        const back = new THREE.BoxGeometry(0.82, 1.9, 0.04)
        back.rotateY(yaw)
        back.translate(hxx - Math.sin(yaw) * -0.12, yy, hzz - Math.cos(yaw) * -0.12)
        parts.push(paint(back, dark))
        for (let l = 0; l < 3; l++) lamps.push({ x: hxx + Math.sin(yaw) * 0.165, y: yy + 0.5 - l * 0.5, z: hzz + Math.cos(yaw) * 0.165, yaw, node: n.id, axis: axisOf(tx, tz), l })
      }
    }
  }
  return { geo: parts.length ? mergeGeometries(parts, false)! : null, lamps }
}

function buildTrees() {
  const g = WORLD.graph!
  const list: Array<{ x: number; z: number; s: number }> = []
  const o = { x: 0, z: 0, dx: 0, dz: 0 }
  for (const e of g.edges) {
    if (!(e.oneWay || e.id < e.reverse) || e.hw === 'service' || e.len < 20) continue
    for (let s = 11; s < e.len - 9; s += 22 + hash(e.id + s) * 8) {
      edgeAt(e, s, o)
      for (const sg of [1, -1]) {
        if (hash(e.id * 7 + s + sg) < 0.3) continue
        const off = e.width / 2 + 4.2
        const x = o.x - o.dz * off * sg, z = o.z + o.dx * off * sg
        if (inRealBuilding(x, z) || WORLD.index!.onRoad(x, z)) continue
        list.push({ x, z, s: 0.8 + hash(e.id + s * 3) * 0.6 })
      }
    }
  }
  return list.slice(0, 1800)
}

/** A real city: roads and paint, buildings, street trees and traffic lights, built from the downloaded map data. */
export function RealCity() {
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const data = useMemo(() => {
    const roads = buildRoads()
    return { ...roads, buildings: buildBuildings() ?? [], signals: buildSignals(), trees: buildTrees() }
  }, [])
  if (typeof window !== 'undefined') Object.assign(window, { __realData: data })
  const mats = useMemo(() => {
    const loader = new THREE.TextureLoader()
    const load = (name: string, srgb: boolean) => {
      const t = loader.load(`/tex/asphalt_${name}.jpg`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = Math.min(8, maxAniso)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    const fc = facadeCanvases()
    const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(cv)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = Math.min(8, maxAniso)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    return {
      asphalt: new THREE.MeshStandardMaterial({ map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false), color: '#9c9c9c', vertexColors: false, side: THREE.DoubleSide }),
      marks: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      buildings: new THREE.MeshStandardMaterial({ map: tex(fc.color, true), roughnessMap: tex(fc.rough, false), metalnessMap: tex(fc.metal, false), roughness: 1, metalness: 1, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
      poles: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }),
    }
  }, [maxAniso])

  const trunks = useRef<THREE.InstancedMesh>(null!)
  const leaves = useRef<THREE.InstancedMesh>(null!)
  const lampM = useRef<THREE.InstancedMesh>(null!)
  const glowM = useRef<THREE.InstancedMesh>(null!)
  const lampT = useRef(0)

  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color()
    data.trees.forEach((t, i) => {
      p.set(t.x, 0, t.z)
      sc.set(t.s, t.s * (0.9 + hash(i) * 0.3), t.s)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i + 9) * 6.28)
      m.compose(p, q, sc)
      trunks.current.setMatrixAt(i, m)
      leaves.current.setMatrixAt(i, m)
      leaves.current.setColorAt(i, col.setRGB(0.85 + hash(i) * 0.25, 0.9 + hash(i + 1) * 0.2, 0.8 + hash(i + 2) * 0.2))
    })
    trunks.current.instanceMatrix.needsUpdate = leaves.current.instanceMatrix.needsUpdate = true
    if (leaves.current.instanceColor) leaves.current.instanceColor.needsUpdate = true
    data.signals.lamps.forEach((l, i) => {
      p.set(l.x, l.y, l.z)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw)
      sc.set(1, 1, 1)
      m.compose(p, q, sc)
      lampM.current.setMatrixAt(i, m)
      lampM.current.setColorAt(i, col.setRGB(...OFF))
      p.set(l.x + Math.sin(l.yaw) * 0.04, l.y, l.z + Math.cos(l.yaw) * 0.04)
      m.compose(p, q, sc)
      glowM.current.setMatrixAt(i, m)
      glowM.current.setColorAt(i, col.setRGB(0, 0, 0))
    })
    lampM.current.instanceMatrix.needsUpdate = glowM.current.instanceMatrix.needsUpdate = true
  }, [data])

  useEffect(() => () => { data.asphalt.dispose(); data.marks.dispose(); data.buildings.forEach((g) => g.dispose()); data.signals.geo?.dispose() }, [data])

  useFrame((_, dt) => {
    lampT.current += dt
    if (lampT.current < 0.2) return
    lampT.current = 0
    const t = useGame.getState().status === 'menu' ? 0 : sim.t
    const arr = lampM.current.instanceColor!.array as Float32Array
    data.signals.lamps.forEach((l, i) => {
      const s = realSignal(l.node, l.axis, t)
      const lit = (l.l === 0 && s === 2) || (l.l === 1 && s === 1) || (l.l === 2 && s === 0)
      const c = lit ? ON[l.l] : OFF
      arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]
    })
    lampM.current.instanceColor!.needsUpdate = true
    ;(glowM.current.instanceColor!.array as Float32Array).set(arr)
    glowM.current.instanceColor!.needsUpdate = true
  }, -2)

  const n = Math.max(1, data.signals.lamps.length)
  return (
    <>
      <mesh geometry={data.asphalt} material={mats.asphalt} receiveShadow />
      <mesh geometry={data.marks} material={mats.marks} receiveShadow />
      {data.buildings.map((g, i) => <mesh key={i} geometry={g} material={mats.buildings} castShadow />)}
      {data.signals.geo && <mesh geometry={data.signals.geo} material={mats.poles} />}
      <instancedMesh ref={trunks} args={[trunkGeo, trunkMat, Math.max(1, data.trees.length)]} frustumCulled={false} />
      <instancedMesh ref={leaves} args={[leafGeo, leafMat, Math.max(1, data.trees.length)]} frustumCulled={false} />
      <instancedMesh ref={lampM} args={[lampGeo, lampMat, n]} frustumCulled={false} />
      <instancedMesh ref={glowM} args={[glowGeo, glowMat, n]} frustumCulled={false} renderOrder={4} />
    </>
  )
}
