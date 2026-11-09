import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CARPLAY } from './cabinConfig'
import { drawNavMap } from './navMap'
import { sim } from './sim'
import { useGame } from './store'
import { drawHighwayMap } from '../highway/hwMap'

const CW = 675, CH = 400

/** A Honda-style infotainment screen on the dash: it shows the map, and while an indicator is on it switches to that side's mirror camera. */
export function CarPlay() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = CW; c.height = CH
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return { c, g: c.getContext('2d')!, t }
  }, [])
  const mapMesh = useRef<THREE.Mesh>(null!)
  const last = useRef(0)
  useFrame(() => {
    const showMap = sim.signal !== 1 && !useGame.getState().adjusting
    mapMesh.current.visible = showMap
    if (!showMap) return
    const now = performance.now()
    const dt = (now - last.current) / 1000
    if (dt < 1 / 12) return
    last.current = now
    const g = tex.g
    const units = useGame.getState().units
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#0b1018'
    g.fillRect(0, 0, CW, CH)
    if (useGame.getState().mode === 'highway') {
      g.save(); g.translate(86, 0); g.beginPath(); g.rect(0, 0, CW - 86, CH); g.clip()
      drawHighwayMap(g, CW - 86, CH)
      g.restore()
    } else {
      g.save(); g.translate(86, 0)
      drawNavMap(g, CW - 86, CH, Math.min(dt, 0.1), units, false, false)
      g.restore()
    }
    // CarPlay-style app column on the left
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, 86, CH)
    const apps = ['#2fcf6a', '#ff4d6a', '#2f7bff', '#ffb02e', '#8c5cff']
    apps.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.roundRect(14, 14 + i * 76, 58, 58, 14); g.fill() })
    tex.t.needsUpdate = true
  }, -1)
  useEffect(() => () => tex.t.dispose(), [tex])

  const W = CARPLAY.W, H = CARPLAY.H
  // dark matte bezel with rounded corners and a slight chamfer, as a frame around the (recessed) screen
  const bezel = useMemo(() => {
    const bw = W + 0.03, bh = H + 0.03, r = 0.012
    const sh = new THREE.Shape()
    sh.moveTo(-bw / 2 + r, -bh / 2); sh.lineTo(bw / 2 - r, -bh / 2); sh.quadraticCurveTo(bw / 2, -bh / 2, bw / 2, -bh / 2 + r)
    sh.lineTo(bw / 2, bh / 2 - r); sh.quadraticCurveTo(bw / 2, bh / 2, bw / 2 - r, bh / 2); sh.lineTo(-bw / 2 + r, bh / 2)
    sh.quadraticCurveTo(-bw / 2, bh / 2, -bw / 2, bh / 2 - r); sh.lineTo(-bw / 2, -bh / 2 + r); sh.quadraticCurveTo(-bw / 2, -bh / 2, -bw / 2 + r, -bh / 2)
    const hole = new THREE.Path()
    hole.moveTo(-W / 2, -H / 2); hole.lineTo(W / 2, -H / 2); hole.lineTo(W / 2, H / 2); hole.lineTo(-W / 2, H / 2); hole.closePath()
    sh.holes.push(hole)
    return new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 })
  }, [W, H])
  useEffect(() => () => bezel.dispose(), [bezel])
  return (
    <group position={CARPLAY.pos} rotation={CARPLAY.rot}>
      <mesh geometry={bezel} position={[0, 0, -0.004]} renderOrder={1001}>
        <meshStandardMaterial depthTest={false} color="#1a1a1a" roughness={0.75} metalness={0.1} />
      </mesh>
      {/* the display sits slightly behind the bezel's front edge */}
      <mesh position={[0, 0, -0.007]} renderOrder={1000}>
        <boxGeometry args={[W + 0.004, H + 0.004, 0.004]} />
        <meshStandardMaterial depthTest={false} color="#05070a" roughness={0.4} />
      </mesh>
      {/* housing that joins the screen to the dash: no gap underneath, it runs down into the dashboard */}
      <mesh position={[0, -H / 2 - 0.07, -0.05]}>
        <boxGeometry args={[W + 0.03, 0.16, 0.09]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.75} metalness={0.1} />
      </mesh>
      <mesh ref={mapMesh} position={[0, 0, -0.003]} renderOrder={1002}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial depthTest={false} map={tex.t} toneMapped={false} />
      </mesh>
      {/* anti-glare glass: a clear, glossy skin that picks up soft reflections */}
      <mesh position={[0, 0, 0.001]} renderOrder={1003}>
        <planeGeometry args={[W, H]} />
        <meshPhysicalMaterial depthTest={false} color="#ffffff" transparent opacity={0.06} roughness={0.12} metalness={0} clearcoat={0.8} clearcoatRoughness={0.1} depthWrite={false} />
      </mesh>
    </group>
  )
}
