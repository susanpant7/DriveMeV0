import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { drawCluster } from './gauges'
import { WHEEL_AXIS, WHEEL_HUB, loadCarModel, type CarModel } from './carModel'
import { sim } from './sim'
import { useGame } from './store'

function useCanvasTexture(w: number, h: number) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return { ctx: c.getContext('2d')!, tex }
  }, [w, h])
}

/** Live instrument cluster, on the car's own instrument panel behind the wheel. */
function Displays() {
  const cluster = useCanvasTexture(1024, 400)
  const last = useRef(0)
  useFrame(() => {
    const now = performance.now()
    if (now - last.current < 50) return
    last.current = now
    drawCluster(cluster.ctx, 1024, 400, {
      speed: sim.speed,
      units: useGame.getState().units,
      rpm: sim.rpm,
      gear: sim.gear,
      signal: sim.signal,
      blink: Math.floor(now / 350) % 2 === 0,
      trip: sim.trip,
      cruise: sim.cruise,
      assist: sim.laneAssist ? (sim.laneActive ? 2 : 1) : 0,
    })
    cluster.tex.needsUpdate = true
  }, -1)
  useEffect(() => () => cluster.tex.dispose(), [cluster])
  return (
    <group position={[-0.333, 0.874, -0.836]} rotation={[-0.516, 0, 0]}>
      <mesh position={[0, 0, -0.004]}>
        <planeGeometry args={[0.36, 0.15]} />
        <meshBasicMaterial color="#050608" />
      </mesh>
      <mesh>
        <planeGeometry args={[0.34, 0.133]} />
        <meshBasicMaterial map={cluster.tex} toneMapped={false} />
      </mesh>
    </group>
  )
}

function useCarModel() {
  const [m, setM] = useState<CarModel | null>(null)
  useEffect(() => {
    let dead = false
    loadCarModel().then((mm) => { if (!dead) setM(mm) }).catch(() => {})
    return () => { dead = true }
  }, [])
  return m
}

/** Your car, inside and out: the modelled Camry, with a steering wheel that turns and live instruments. */
export function Cabin({ wheel }: { wheel: React.RefObject<THREE.Group> }) {
  const model = useCarModel()
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), WHEEL_AXIS), [])
  const qInv = useMemo(() => q.clone().invert(), [q])
  return (
    <group>
      {model && <primitive object={model.ext} />}
      {model && <primitive object={model.int} />}
      {/* the wheel turns about its own (tilted) column axis: local z of this group */}
      <group position={WHEEL_HUB} quaternion={q}>
        <group ref={wheel} name="SteeringWheel_Node">
          {model && (
            <group quaternion={qInv} position={WHEEL_HUB.clone().negate().applyQuaternion(qInv)}>
              <primitive object={model.wheel} />
            </group>
          )}
        </group>
      </group>
      <Displays />
    </group>
  )
}
