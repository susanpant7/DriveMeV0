import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { wrapD } from './map'
import { extrudeProfile } from './geom'
import { sim } from './sim'
import { MAX_CARS, cars } from './trafficAI'

type Pt = [number, number]
interface ModelDef {
  body: Pt[] // side profile (distance forward, height) of the paint-coloured shell
  bodyW: number
  glass: Pt[] // cabin / windows
  glassW: number
  halfLen: number
  halfW: number
  wheelZ: number
  tyre: number
}

const DEFS: ModelDef[] = [
  { // sedan
    body: [[-2.2, 0.35], [-2.2, 0.8], [-1.8, 0.93], [-0.9, 0.96], [0.9, 0.96], [1.65, 0.86], [2.2, 0.7], [2.2, 0.35]], bodyW: 1.78,
    glass: [[-1.45, 0.93], [-0.95, 1.4], [0.45, 1.4], [1.15, 0.93]], glassW: 1.58, halfLen: 2.2, halfW: 0.89, wheelZ: 1.4, tyre: 0.33,
  },
  { // SUV
    body: [[-2.15, 0.4], [-2.15, 1.1], [-1.95, 1.2], [0.5, 1.22], [1.5, 0.98], [2.15, 0.78], [2.15, 0.4]], bodyW: 1.84,
    glass: [[-1.95, 1.15], [-1.75, 1.68], [0.3, 1.68], [1.1, 1.17]], glassW: 1.64, halfLen: 2.15, halfW: 0.92, wheelZ: 1.38, tyre: 0.37,
  },
  { // van
    body: [[-2.45, 0.42], [-2.45, 2.05], [1.1, 2.05], [1.85, 1.25], [2.45, 0.95], [2.45, 0.42]], bodyW: 1.88,
    glass: [[-2.3, 1.3], [-2.3, 1.9], [1.1, 1.9], [1.7, 1.25]], glassW: 1.9, halfLen: 2.45, halfW: 0.94, wheelZ: 1.65, tyre: 0.35,
  },
]

const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g)
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return ni(g)
}

function buildModel(d: ModelDef) {
  // paint: shell + door mirrors; dark: windows, bumpers, grille, wheel-arch shadows
  const body = mergeGeometries([ni(extrudeProfile(d.body, d.bodyW, 0.06)), box(0.12, 0.09, 0.2, d.halfW + 0.06, d.glass[0][1] + 0.18, -(d.glass[2][0] + 0.15)), box(0.12, 0.09, 0.2, -d.halfW - 0.06, d.glass[0][1] + 0.18, -(d.glass[2][0] + 0.15))])!
  const dark = mergeGeometries([
    ni(extrudeProfile(d.glass, d.glassW, 0.03)),
    box(d.bodyW - 0.1, 0.22, 0.14, 0, 0.42, -d.halfLen + 0.02), // front bumper
    box(d.bodyW - 0.1, 0.2, 0.14, 0, 0.42, d.halfLen - 0.02), // rear bumper
    box(d.bodyW * 0.5, 0.16, 0.05, 0, 0.64, -d.halfLen - 0.005), // grille
    box(d.bodyW + 0.01, 0.05, d.halfLen * 2 - 0.4, 0, 0.36, 0), // sills
  ])!
  const wheels: Pt[] = [
    [d.halfW - 0.1, -d.wheelZ], [-(d.halfW - 0.1), -d.wheelZ], [d.halfW - 0.1, d.wheelZ], [-(d.halfW - 0.1), d.wheelZ],
  ]
  return { body, dark, wheels, d }
}

const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 18)
tyreGeo.rotateZ(Math.PI / 2)
const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.27, 12)
rimGeo.rotateZ(Math.PI / 2)
const lampGeo = new THREE.BoxGeometry(0.42, 0.13, 0.05)
const blinkGeo = new THREE.BoxGeometry(0.22, 0.11, 0.07) // amber indicator at a front / rear corner
const repeaterGeo = new THREE.BoxGeometry(0.05, 0.09, 0.22) // side repeater

const paintMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12 })
const darkMat = new THREE.MeshStandardMaterial({ color: '#10141a', roughness: 0.18, metalness: 0.8 })
const tyreMat = new THREE.MeshStandardMaterial({ color: '#0c0c0d', roughness: 0.95 })
const rimMat = new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.28, metalness: 0.9 })
const headMat = new THREE.MeshBasicMaterial({ color: '#fff3d0', toneMapped: false })
const tailMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
const amberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.25, 0.05), toneMapped: false })

const _m = new THREE.Matrix4()
const _w = new THREE.Matrix4()
const _l = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 1)
const _y = new THREE.Vector3(0, 1, 0)
const _c = new THREE.Color()
const TAIL_DIM = new THREE.Color(0.45, 0.03, 0.03)
const TAIL_ON = new THREE.Color(3, 0.15, 0.1)
const colorCache = new Map<string, THREE.Color>()
const colorOf = (hex: string) => {
  let c = colorCache.get(hex)
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)))
  return c
}

/** All AI traffic, drawn with instancing: any number of cars costs a handful of draw calls. */
export function Traffic() {
  const models = useMemo(() => DEFS.map(buildModel), [])
  const bodies = useRef<Array<THREE.InstancedMesh | null>>([])
  const darks = useRef<Array<THREE.InstancedMesh | null>>([])
  const tyres = useRef<THREE.InstancedMesh>(null!)
  const rims = useRef<THREE.InstancedMesh>(null!)
  const heads = useRef<THREE.InstancedMesh>(null!)
  const tails = useRef<THREE.InstancedMesh>(null!)
  const blinkers = useRef<THREE.InstancedMesh>(null!)
  const repeaters = useRef<THREE.InstancedMesh>(null!)

  useEffect(() => () => models.forEach((m) => { m.body.dispose(); m.dark.dispose() }), [models])

  useFrame(() => {
    const counts = [0, 0, 0]
    let nw = 0
    let nl = 0
    let nb = 0
    let nr = 0
    const now = performance.now()
    for (const c of cars) {
      if (!c.active) continue
      const dx = wrapD(c.x - sim.x)
      const dz = wrapD(c.z - sim.z)
      if (dx * dx + dz * dz > 320 * 320) continue
      _p.set(sim.x + dx, 0, sim.z + dz)
      _q.setFromAxisAngle(_y, c.h)
      _m.compose(_p, _q, _s)
      const k = c.kind
      const i = counts[k]++
      const md = models[k]
      bodies.current[k]!.setMatrixAt(i, _m)
      bodies.current[k]!.setColorAt(i, colorOf(c.color))
      darks.current[k]!.setMatrixAt(i, _m)
      for (const [wx, wz] of md.wheels) {
        _l.makeTranslation(wx, md.d.tyre, wz)
        _w.multiplyMatrices(_m, _l)
        tyres.current.setMatrixAt(nw, _w)
        rims.current.setMatrixAt(nw, _w)
        nw++
      }
      const hl = md.d.halfLen + 0.01
      for (const sx of [-0.66, 0.66]) {
        _l.makeTranslation(sx * (md.d.halfW / 0.89), 0.72, -hl)
        _w.multiplyMatrices(_m, _l)
        heads.current.setMatrixAt(nl, _w)
        _l.makeTranslation(sx * (md.d.halfW / 0.89), k === 2 ? 0.95 : 0.78, hl)
        _w.multiplyMatrices(_m, _l)
        tails.current.setMatrixAt(nl, _w)
        tails.current.setColorAt(nl, c.braking ? TAIL_ON : TAIL_DIM)
        nl++
      }
      // indicators: blink on the side the car is signalling (lane change or turn)
      if (c.sig !== 0 && (now / 380 + c.id * 0.37) % 2 < 1) {
        const sx = c.sig * (md.d.halfW - 0.13)
        _l.makeTranslation(sx, 0.72, -hl)
        _w.multiplyMatrices(_m, _l)
        blinkers.current.setMatrixAt(nb++, _w)
        _l.makeTranslation(sx, k === 2 ? 0.95 : 0.8, hl)
        _w.multiplyMatrices(_m, _l)
        blinkers.current.setMatrixAt(nb++, _w)
        _l.makeTranslation(c.sig * (md.d.halfW + 0.012), 0.82, -hl * 0.55)
        _w.multiplyMatrices(_m, _l)
        repeaters.current.setMatrixAt(nr++, _w)
      }
    }
    for (let k = 0; k < 3; k++) {
      const b = bodies.current[k]!
      const d = darks.current[k]!
      b.count = d.count = counts[k]
      b.instanceMatrix.needsUpdate = d.instanceMatrix.needsUpdate = true
      if (b.instanceColor) b.instanceColor.needsUpdate = true
    }
    tyres.current.count = rims.current.count = nw
    heads.current.count = tails.current.count = nl
    blinkers.current.count = nb
    repeaters.current.count = nr
    blinkers.current.instanceMatrix.needsUpdate = repeaters.current.instanceMatrix.needsUpdate = true
    tyres.current.instanceMatrix.needsUpdate = rims.current.instanceMatrix.needsUpdate = true
    heads.current.instanceMatrix.needsUpdate = tails.current.instanceMatrix.needsUpdate = true
    if (tails.current.instanceColor) tails.current.instanceColor.needsUpdate = true
  }, -2)

  void _c
  return (
    <>
      {models.map((m, k) => (
        <group key={k}>
          <instancedMesh ref={(r) => { bodies.current[k] = r }} args={[m.body, paintMat, MAX_CARS]} frustumCulled={false} castShadow />
          <instancedMesh ref={(r) => { darks.current[k] = r }} args={[m.dark, darkMat, MAX_CARS]} frustumCulled={false} castShadow />
        </group>
      ))}
      <instancedMesh ref={tyres} args={[tyreGeo, tyreMat, MAX_CARS * 4]} frustumCulled={false} castShadow />
      <instancedMesh ref={rims} args={[rimGeo, rimMat, MAX_CARS * 4]} frustumCulled={false} />
      <instancedMesh ref={heads} args={[lampGeo, headMat, MAX_CARS * 2]} frustumCulled={false} />
      <instancedMesh ref={tails} args={[lampGeo, tailMat, MAX_CARS * 2]} frustumCulled={false} />
      <instancedMesh ref={blinkers} args={[blinkGeo, amberMat, MAX_CARS * 2]} frustumCulled={false} />
      <instancedMesh ref={repeaters} args={[repeaterGeo, amberMat, MAX_CARS]} frustumCulled={false} />
    </>
  )
}
