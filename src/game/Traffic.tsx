import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
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
    // wheel arches: a dark disc on each flank around every wheel, so the wheels sit in wells
    ...[1, -1].flatMap((sx) => [-1, 1].map((sz) => {
      const g = new THREE.CylinderGeometry(d.tyre + 0.07, d.tyre + 0.07, 0.03, 24)
      g.rotateZ(Math.PI / 2)
      g.translate(sx * (d.halfW + 0.004), d.tyre, sz * d.wheelZ)
      return ni(g)
    })),
    // door seams and handles on both sides
    ...[1, -1].flatMap((sx) => [-0.35, 0.55].map((z) => box(0.012, d.glass[2][1] > 1.6 ? 0.85 : 0.5, 0.014, sx * (d.halfW + 0.002), d.glass[0][1] - 0.2, z))),
    ...[1, -1].map((sx) => box(0.02, 0.025, 0.16, sx * (d.halfW + 0.008), d.glass[0][1] - 0.06, 0.12)),
    box(d.bodyW * 0.42, 0.012, 0.012, 0, d.body[3][1] + 0.002, -d.halfLen * 0.45), // hood shut-line
  ])!
  const wheels: Pt[] = [
    [d.halfW - 0.1, -d.wheelZ], [-(d.halfW - 0.1), -d.wheelZ], [d.halfW - 0.1, d.wheelZ], [-(d.halfW - 0.1), d.wheelZ],
  ]
  return { body, dark, wheels, d }
}

const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 18)
tyreGeo.rotateZ(Math.PI / 2)
// the rim: a light disc with five dark spokes (vertex colours), so you can see the wheel turn
const rimGeo = (() => {
  const disc = new THREE.CylinderGeometry(0.21, 0.21, 0.27, 20)
  disc.rotateZ(Math.PI / 2)
  const parts: THREE.BufferGeometry[] = [disc.toNonIndexed()]
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.BoxGeometry(0.29, 0.065, 0.2)
    sp.translate(0, 0, 0.1)
    sp.rotateX((k * 2 * Math.PI) / 5)
    parts.push(sp.toNonIndexed())
  }
  const cols: number[] = []
  parts.forEach((g, gi) => { const n = g.getAttribute('position').count; for (let q = 0; q < n; q++) cols.push(gi === 0 ? 0.78 : 0.07, gi === 0 ? 0.8 : 0.07, gi === 0 ? 0.84 : 0.08) })
  const m = mergeGeometries(parts)!
  m.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  return m
})()
const lampGeo = new THREE.BoxGeometry(0.42, 0.13, 0.05)
const blinkGeo = new THREE.BoxGeometry(0.22, 0.11, 0.07) // amber indicator at a front / rear corner
const repeaterGeo = new THREE.BoxGeometry(0.05, 0.09, 0.22) // side repeater

const paintMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12 })
const darkMat = new THREE.MeshStandardMaterial({ color: '#10141a', roughness: 0.18, metalness: 0.8 })
const tyreMat = new THREE.MeshStandardMaterial({ color: '#0c0c0d', roughness: 0.95 })
const rimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 })
const headMat = new THREE.MeshBasicMaterial({ color: '#fff3d0', toneMapped: false })
const tailMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
const amberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.25, 0.05), toneMapped: false })

const _m = new THREE.Matrix4()
const _w = new THREE.Matrix4()
const _l = new THREE.Matrix4()
const _s2 = new THREE.Vector3()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 1)
const _c = new THREE.Color()
const TAIL_DIM = new THREE.Color(0.45, 0.03, 0.03)
const TAIL_ON = new THREE.Color(3, 0.15, 0.1)
const colorCache = new Map<string, THREE.Color>()
const colorOf = (hex: string) => {
  let c = colorCache.get(hex)
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)))
  return c
}

interface Motion { spin: number; h: number; pitch: number; roll: number; speed: number; rawH: number; x: number; z: number; ok: boolean }
const motion: Motion[] = Array.from({ length: MAX_CARS }, () => ({ spin: 0, h: 0, pitch: 0, roll: 0, speed: 0, rawH: 0, x: 0, z: 0, ok: false }))
const _e = new THREE.Euler(0, 0, 0, 'YXZ')
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/** Real car models, loaded from public/models. Until they arrive the built-in boxy cars are used. */
interface GlbPart { geo: THREE.BufferGeometry; mat: THREE.Material; tint: boolean }
interface GlbCar {
  parts: GlbPart[]
  halfLen: number
  halfW: number
  height: number
  wheels: Array<{ x: number; z: number }>
  r: number
}
// kind index -> model file. 0-2 take the paint colour (white paint tinted per car); the rest keep their own colours.
const GLB_FILES: Array<{ name: string; meta: 'meta' | 'meta2'; tint: boolean }> = [
  { name: 'sedan', meta: 'meta', tint: true },
  { name: 'pickup', meta: 'meta', tint: true },
  { name: 'van', meta: 'meta', tint: true },
  { name: 'challenger', meta: 'meta2', tint: false },
  { name: 'impala', meta: 'meta2', tint: false },
  { name: 'volga', meta: 'meta2', tint: false },
  // highway trucks (kinds 6-8)
  { name: 'dump', meta: 'meta2', tint: false },
  { name: 'tanker', meta: 'meta2', tint: false },
  { name: 'semi', meta: 'meta2', tint: false },
]

function useCarModels() {
  const [cars, setCars] = useState<Array<GlbCar | null>>(() => GLB_FILES.map(() => null))
  useEffect(() => {
    let dead = false
    const loader = new GLTFLoader()
    Promise.all([fetch('/models/meta.json').then((r) => r.json()), fetch('/models/meta2.json').then((r) => r.json())])
      .then(([m1, m2]) => {
        GLB_FILES.forEach((f, k) => {
          loader.load(`/models/${f.name}.glb`, (g) => {
            if (dead) return
            const meshes: THREE.Mesh[] = []
            g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
            if (!meshes.length) return
            const m = (f.meta === 'meta' ? m1 : m2)[f.name]
            const parts: GlbPart[] = meshes.map((me) => {
              const src = me.material as THREE.MeshStandardMaterial
              let mat: THREE.Material
              const isPaint = f.tint || src.name === 'paint' // the Tesla's body parts take the car's colour, its glass and wheels keep theirs
              if (isPaint) mat = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.38, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.15 })
              else { mat = src.clone(); (mat as THREE.MeshStandardMaterial).envMapIntensity = 1; (mat as THREE.MeshStandardMaterial).side = THREE.FrontSide }
              if ((mat as THREE.MeshStandardMaterial).map) (mat as THREE.MeshStandardMaterial).map!.anisotropy = 4
              return { geo: me.geometry, mat, tint: isPaint }
            })
            const w = m.wheels as Array<{ x: number; z: number; r: number }>
            const car: GlbCar = { parts, halfLen: m.length / 2, halfW: m.width / 2, height: m.height, wheels: w.map((q) => ({ x: q.x, z: q.z })), r: w.length ? w[0].r : 0.33 }
            setCars((prev) => { const n = prev.slice(); n[k] = car; return n })
          })
        })
      })
      .catch(() => {})
    return () => { dead = true }
  }, [])
  return cars
}

/** All AI traffic, drawn with instancing: any number of cars costs a handful of draw calls. */
export function Traffic() {
  const models = useMemo(() => DEFS.map(buildModel), [])
  const glb = useCarModels()
  const glbRef = useRef(glb)
  glbRef.current = glb
  const partRefs = useRef<Array<Array<THREE.InstancedMesh | null>>>(GLB_FILES.map(() => []))
  const bodies = useRef<Array<THREE.InstancedMesh | null>>([])
  const darks = useRef<Array<THREE.InstancedMesh | null>>([])
  const tyres = useRef<THREE.InstancedMesh>(null!)
  const rims = useRef<THREE.InstancedMesh>(null!)
  const heads = useRef<THREE.InstancedMesh>(null!)
  const tails = useRef<THREE.InstancedMesh>(null!)
  const blinkers = useRef<THREE.InstancedMesh>(null!)
  const repeaters = useRef<THREE.InstancedMesh>(null!)

  useEffect(() => () => models.forEach((m) => { m.body.dispose(); m.dark.dispose() }), [models])

  useFrame((_, dt) => {
    const counts = GLB_FILES.map(() => 0)
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
      // smooth the car's motion for display: heading follows the road gently, the nose dips when it brakes, the body rolls in a turn
      const mo = motion[c.id]
      const step = Math.min(dt, 0.1) || 1 / 60
      if (!mo.ok || Math.hypot(c.x - mo.x, c.z - mo.z) > 6) { mo.h = c.h; mo.pitch = 0; mo.roll = 0; mo.speed = c.speed; mo.rawH = c.h; mo.ok = true }
      const accel = (c.speed - mo.speed) / step
      const yaw = angDiff(mo.rawH, c.h) / step
      mo.speed = c.speed; mo.rawH = c.h; mo.x = c.x; mo.z = c.z
      mo.spin = (mo.spin + (c.speed * step) / 0.34) % (Math.PI * 2) // the wheels roll as far as the car travels
      mo.h += angDiff(mo.h, c.h) * (1 - Math.exp(-14 * step))
      const kk = 1 - Math.exp(-6 * step)
      mo.pitch += (Math.max(-9, Math.min(4, accel)) * 0.0045 - mo.pitch) * kk
      mo.roll += (-Math.max(-1.2, Math.min(1.2, yaw)) * c.speed * 0.0032 - mo.roll) * kk
      _e.set(mo.pitch, mo.h, mo.roll, 'YXZ')
      _q.setFromEuler(_e)
      _m.compose(_p, _q, _s)
      let k = c.kind < 3 || glbRef.current[c.kind] ? c.kind : 0 // a model that has not loaded yet is drawn as a sedan
      if (k >= 3 && counts[k] >= 80) k = 0
      const i = counts[k]++
      const md = models[Math.min(k, 2)]
      const gm = glbRef.current[k]
      if (gm) {
        const ps = partRefs.current[k]
        for (let pi = 0; pi < gm.parts.length; pi++) {
          const im = ps[pi]
          if (!im) continue
          im.setMatrixAt(i, _m)
          if (gm.parts[pi].tint) im.setColorAt(i, colorOf(c.color))
        }
      } else {
        bodies.current[k]!.setMatrixAt(i, _m)
        bodies.current[k]!.setColorAt(i, colorOf(c.color))
        darks.current[k]!.setMatrixAt(i, _m)
      }
      const wheelsAt = gm ? gm.wheels.map((w) => [w.x, w.z] as [number, number]) : md.wheels
      const tyreR = gm ? gm.r : md.d.tyre
      const tsc = tyreR / 0.34
      for (const [wx, wz] of wheelsAt) {
        _l.makeRotationX(-mo.spin)
        _l.scale(_s2.set(tsc, tsc, tsc))
        _l.setPosition(wx, tyreR, wz)
        _w.multiplyMatrices(_m, _l)
        tyres.current.setMatrixAt(nw, _w)
        rims.current.setMatrixAt(nw, _w)
        nw++
      }
      const hl = (gm ? gm.halfLen - 0.02 : md.d.halfLen + 0.01)
      const hw = gm ? gm.halfW : md.d.halfW
      const lampY = gm ? [gm.height * 0.4, gm.height * (k === 2 ? 0.52 : 0.5)] : [0.72, k === 2 ? 0.95 : 0.78]
      for (const sx of [-0.66, 0.66]) {
        _l.makeTranslation(sx * (hw / 0.89), gm ? -10 : lampY[0], -hl) // real models have painted headlights
        _w.multiplyMatrices(_m, _l)
        heads.current.setMatrixAt(nl, _w)
        _l.makeTranslation(gm ? Math.sign(sx) * hw * 0.55 : sx * (hw / 0.89), lampY[1], gm ? hl - 0.2 : hl)
        _w.multiplyMatrices(_m, _l)
        tails.current.setMatrixAt(nl, _w)
        tails.current.setColorAt(nl, c.braking ? TAIL_ON : TAIL_DIM)
        nl++
      }
      // indicators: blink on the side the car is signalling (lane change or turn)
      if (c.sig !== 0 && (now / 380 + c.id * 0.37) % 2 < 1) {
        if (gm) {
          // real bodies: the measured width includes the door mirrors, so tuck the lights well inside the corners
          const sx = c.sig * gm.halfW * 0.62
          _l.makeScale(0.7, 0.7, 0.7)
          _l.setPosition(sx, lampY[0], -(gm.halfLen - 0.2))
          _w.multiplyMatrices(_m, _l)
          blinkers.current.setMatrixAt(nb++, _w)
          _l.setPosition(sx, lampY[1], gm.halfLen - 0.2)
          _w.multiplyMatrices(_m, _l)
          blinkers.current.setMatrixAt(nb++, _w)
        } else {
          const sx = c.sig * (hw - 0.13)
          _l.makeTranslation(sx, lampY[0], -hl)
          _w.multiplyMatrices(_m, _l)
          blinkers.current.setMatrixAt(nb++, _w)
          _l.makeTranslation(sx, lampY[1], hl)
          _w.multiplyMatrices(_m, _l)
          blinkers.current.setMatrixAt(nb++, _w)
          _l.makeTranslation(c.sig * (hw + 0.012), lampY[1], -hl * 0.55)
          _w.multiplyMatrices(_m, _l)
          repeaters.current.setMatrixAt(nr++, _w)
        }
      }
    }
    for (let k = 0; k < GLB_FILES.length; k++) {
      const gm = glbRef.current[k]
      if (gm) {
        for (const im of partRefs.current[k]) {
          if (!im) continue
          im.count = counts[k]
          im.instanceMatrix.needsUpdate = true
          if (im.instanceColor) im.instanceColor.needsUpdate = true
        }
      }
      if (k < 3) {
        const b = bodies.current[k]
        const d = darks.current[k]
        if (b && d) {
          b.count = gm ? 0 : counts[k]
          d.count = gm ? 0 : counts[k]
          b.instanceMatrix.needsUpdate = d.instanceMatrix.needsUpdate = true
          if (b.instanceColor) b.instanceColor.needsUpdate = true
        }
      }
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
          <instancedMesh ref={(r) => { bodies.current[k] = r }} args={[m.body, paintMat, MAX_CARS]} frustumCulled={false} />
          <instancedMesh ref={(r) => { darks.current[k] = r }} args={[m.dark, darkMat, MAX_CARS]} frustumCulled={false} />
        </group>
      ))}
      {glb.map((g, k) => g && (
        <group key={'g' + k}>
          {g.parts.map((p, pi) => (
            <instancedMesh key={pi} ref={(r) => { partRefs.current[k][pi] = r }} args={[p.geo, p.mat, k < 3 ? MAX_CARS : 80]} frustumCulled={false} />
          ))}
        </group>
      ))}
      <instancedMesh ref={tyres} args={[tyreGeo, tyreMat, MAX_CARS * 4]} frustumCulled={false} />
      <instancedMesh ref={rims} args={[rimGeo, rimMat, MAX_CARS * 4]} frustumCulled={false} />
      <instancedMesh ref={heads} args={[lampGeo, headMat, MAX_CARS * 2]} frustumCulled={false} />
      <instancedMesh ref={tails} args={[lampGeo, tailMat, MAX_CARS * 2]} frustumCulled={false} />
      <instancedMesh ref={blinkers} args={[blinkGeo, amberMat, MAX_CARS * 2]} frustumCulled={false} />
      <instancedMesh ref={repeaters} args={[repeaterGeo, amberMat, MAX_CARS]} frustumCulled={false} />
    </>
  )
}
