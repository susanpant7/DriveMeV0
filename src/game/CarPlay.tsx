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
  // the map is drawn on the car's own centre screen (the model has the bezel and stand)
  return (
    <group position={CARPLAY.pos} rotation={CARPLAY.rot}>
      <mesh ref={mapMesh} position={[0, 0, 0.002]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex.t} toneMapped={false} />
      </mesh>
    </group>
  )
}
