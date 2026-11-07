import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { P, hashN, signalColor } from './map'
import { ATLAS_H, ATLAS_W, buildCity, drawSpeedSign, facadeCanvases, makeAtlas } from './cityBuild'
import { sim } from './sim'
import { useGame } from './store'

const COPIES: Array<[number, number]> = []
for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) COPIES.push([di, dj])

const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3.2, 6)
trunkGeo.translate(0, 1.6, 0)
// foliage: three crossed vertical cards with a painted leafy texture (reads as a real canopy from a distance)
const leafGeo = (() => {
  const planes = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => {
    const g = new THREE.PlaneGeometry(5.4, 5.6)
    g.rotateY(a)
    g.translate(0, 5.3, 0)
    return g
  })
  return mergeGeometries(planes.map((g) => g.toNonIndexed()))!
})()

function foliageTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  for (let i = 0; i < 1500; i++) {
    // leaves clustered inside an irregular crown, darker toward the middle and bottom
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random())
    const x = 128 + Math.cos(a) * r * 112
    const y = 118 + Math.sin(a) * r * 100
    const shade = 0.55 + Math.random() * 0.45 - (r < 0.5 ? 0.2 : 0) - ((y - 118) / 100) * 0.12
    g.fillStyle = `rgb(${Math.round(40 * shade)},${Math.round(98 * shade + 20)},${Math.round(36 * shade)})`
    g.beginPath()
    g.ellipse(x, y, 5 + Math.random() * 6, 3 + Math.random() * 4, Math.random() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const lampGeo = new THREE.CircleGeometry(0.22, 18)
const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 1 })
const leafMat = new THREE.MeshStandardMaterial({ map: foliageTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 })
const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide })

const ON: Record<number, [number, number, number]> = { 0: [1.6, 0.18, 0.12], 1: [1.7, 1.1, 0.1], 2: [0.15, 1.8, 0.5] } // lamp l -> colour when lit (red, amber, green)
const OFF: [number, number, number] = [0.07, 0.07, 0.08]

/** The whole city: one period of static geometry drawn 3x3 around the player, plus lights and trees. */
export function City() {
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const data = useMemo(buildCity, [])
  const res = useMemo(() => {
    const loader = new THREE.TextureLoader()
    const load = (name: string, srgb: boolean) => {
      const t = loader.load(`/tex/asphalt_${name}.jpg`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = Math.min(8, maxAniso)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    const atlasCanvas = makeAtlas(useGame.getState().units)
    const atlas = new THREE.CanvasTexture(atlasCanvas)
    atlas.colorSpace = THREE.SRGBColorSpace
    atlas.anisotropy = Math.min(8, maxAniso)
    const fc = facadeCanvases()
    const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(cv)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = Math.min(8, maxAniso)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    const facade = tex(fc.color, true)
    return {
      atlasCanvas,
      atlas,
      asphalt: new THREE.MeshStandardMaterial({ map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false), color: '#a4a4a4', normalScale: new THREE.Vector2(1.2, 1.2) }),
      marks: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 }),
      buildings: new THREE.MeshStandardMaterial({ map: facade, roughnessMap: tex(fc.rough, false), metalnessMap: tex(fc.metal, false), roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 1.3 }),
      signs: new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 }),
    }
  }, [maxAniso])
  void ATLAS_W; void ATLAS_H

  const groups = useRef<Array<THREE.Group | null>>([])
  const trunks = useRef<Array<THREE.InstancedMesh | null>>([])
  const leaves = useRef<Array<THREE.InstancedMesh | null>>([])
  const lampMeshes = useRef<Array<THREE.InstancedMesh | null>>([])
  const state = useRef({ ci: NaN, cj: NaN, lampT: 0, units: useGame.getState().units })

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const sc = new THREE.Vector3()
    const col = new THREE.Color()
    for (let c = 0; c < COPIES.length; c++) {
      const tm = trunks.current[c], lm = leaves.current[c], lamp = lampMeshes.current[c]
      if (!tm || !lm || !lamp) continue
      data.trees.forEach((t, i) => {
        p.set(t.x, 0, t.z)
        sc.set(t.s * (0.9 + hashN(t.z, t.x, 4) * 0.3), t.s * (0.9 + hashN(t.x, t.z, 7) * 0.35), t.s * (0.9 + hashN(t.z, t.x, 8) * 0.3))
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hashN(t.x, t.z, 3) * 6.28)
        m.compose(p, q, sc)
        tm.setMatrixAt(i, m)
        lm.setMatrixAt(i, m)
        const g = hashN(t.x, t.z, 9)
        lm.setColorAt(i, col.setRGB(0.85 + g * 0.25, 0.9 + g * 0.2, 0.8 + g * 0.2))
      })
      tm.instanceMatrix.needsUpdate = lm.instanceMatrix.needsUpdate = true
      if (lm.instanceColor) lm.instanceColor.needsUpdate = true
      data.lamps.forEach((l, i) => {
        p.set(l.x, l.y, l.z)
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw)
        sc.set(1, 1, 1)
        m.compose(p, q, sc)
        lamp.setMatrixAt(i, m)
        lamp.setColorAt(i, col.setRGB(...OFF))
      })
      lamp.instanceMatrix.needsUpdate = true
    }
  }, [data])

  useEffect(
    () => () => {
      for (const list of [data.asphalt, data.marks, data.solid, data.buildings, data.signs]) list.forEach((g) => g.dispose())
      res.atlas.dispose()
    },
    [data, res],
  )

  useFrame((_, dt) => {
    const st = state.current
    const ci = Math.round(sim.x / P)
    const cj = Math.round(sim.z / P)
    if (ci !== st.ci || cj !== st.cj) {
      st.ci = ci
      st.cj = cj
      COPIES.forEach(([di, dj], k) => groups.current[k]?.position.set((ci + di) * P, 0, (cj + dj) * P))
    }
    // speed-limit sign follows the chosen units
    const units = useGame.getState().units
    if (units !== st.units) {
      st.units = units
      drawSpeedSign(res.atlasCanvas.getContext('2d')!, units)
      res.atlas.needsUpdate = true
    }
    // traffic-light lamps (5 Hz)
    st.lampT += dt
    if (st.lampT > 0.2) {
      st.lampT = 0
      const t = useGame.getState().status === 'menu' ? 0 : sim.t
      const first = lampMeshes.current[0]
      if (!first) return
      const arr = first.instanceColor!.array as Float32Array
      data.lamps.forEach((l, i) => {
        const s = signalColor(l.node, l.axis, t)
        const lit = (l.l === 0 && s === 2) || (l.l === 1 && s === 1) || (l.l === 2 && s === 0)
        const c = lit ? ON[l.l] : OFF
        arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]
      })
      first.instanceColor!.needsUpdate = true
      for (let k = 1; k < COPIES.length; k++) {
        const m = lampMeshes.current[k]
        if (!m?.instanceColor) continue
        ;(m.instanceColor.array as Float32Array).set(arr)
        m.instanceColor.needsUpdate = true
      }
    }
  }, -2)

  return (
    <>
      {COPIES.map(([di, dj], k) => (
        <group key={k} ref={(g) => { groups.current[k] = g }} position={[di * P, 0, dj * P]}>
          {data.asphalt.map((g, n) => <mesh key={'a' + n} geometry={g} material={res.asphalt} receiveShadow />)}
          {data.marks.map((g, n) => <mesh key={'m' + n} geometry={g} material={res.marks} receiveShadow />)}
          {data.solid.map((g, n) => <mesh key={'s' + n} geometry={g} material={res.solid} receiveShadow />)}
          {data.buildings.map((g, n) => <mesh key={'b' + n} geometry={g} material={res.buildings} />)}
          {data.signs.map((g, n) => <mesh key={'g' + n} geometry={g} material={res.signs} />)}
          <instancedMesh ref={(m) => { trunks.current[k] = m }} args={[trunkGeo, trunkMat, data.trees.length]} frustumCulled={false} />
          <instancedMesh ref={(m) => { leaves.current[k] = m }} args={[leafGeo, leafMat, data.trees.length]} frustumCulled={false} />
          <instancedMesh ref={(m) => { lampMeshes.current[k] = m }} args={[lampGeo, lampMat, data.lamps.length]} frustumCulled={false} />
        </group>
      ))}
    </>
  )
}
