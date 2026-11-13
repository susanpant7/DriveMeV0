import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { updateAudio } from './audio'
import { sim, stepSim } from './sim'
import { MAX_CARS, cars } from './trafficAI'
import { useGame } from './store'

/** Advances the simulation before anything is drawn this frame. */
/**
 * The car, the traffic and the rules move in fixed steps of 1/60 s, whatever the frame rate: the driving feels the same on a slow phone
 * and a fast computer, and a dropped frame never makes the car jump. The camera shows the car between its last two steps (renderPose),
 * so the view stays smooth on screens faster or slower than 60 Hz.
 */
const STEP = 1 / 60
export const renderPose = { x: 0, z: 0, h: 0 }
/** where each traffic car was before the last step, and how far between that and now to draw it (like your own car: smooth at any frame rate) */
export const trafficPrev = { x: new Float32Array(MAX_CARS), z: new Float32Array(MAX_CARS), a: 1 }
export function Simulation() {
  const acc = useRef(0)
  const prev = useRef({ x: 0, z: 0, h: 0 })
  useFrame((_, dt) => {
    acc.current += Math.min(dt, 0.25)
    let n = 0
    while (acc.current >= STEP && n < 6) {
      prev.current.x = sim.x; prev.current.z = sim.z; prev.current.h = sim.h
      for (let i = 0; i < cars.length; i++) { trafficPrev.x[i] = cars[i].x; trafficPrev.z[i] = cars[i].z }
      stepSim(STEP)
      acc.current -= STEP
      n++
    }
    if (n === 6) acc.current = 0 // far behind (a long hitch): drop the backlog rather than race to catch up
    const a = acc.current / STEP, p = prev.current
    trafficPrev.a = a
    // a reset or a jump to a new place: no blending across it
    if (Math.hypot(sim.x - p.x, sim.z - p.z) > 15) { renderPose.x = sim.x; renderPose.z = sim.z; renderPose.h = sim.h }
    else {
      renderPose.x = p.x + (sim.x - p.x) * a
      renderPose.z = p.z + (sim.z - p.z) * a
      const dh = Math.atan2(Math.sin(sim.h - p.h), Math.cos(sim.h - p.h))
      renderPose.h = p.h + dh * a
    }
    updateAudio(sim.rpm, sim.speed, useGame.getState().status === 'playing')
  }, -3)
  return null
}

const TILE = 10
const SIZE = 2400

/** Grass / ground that follows the player; the texture is anchored to the world. */
export function Ground() {
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const ground = useRef<THREE.Mesh>(null!)
  const maps = useMemo(() => {
    const loader = new THREE.TextureLoader()
    const load = (suffix: string, srgb: boolean) => {
      const t = loader.load(`/tex/grass_${suffix}.jpg`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(SIZE / TILE, SIZE / TILE)
      t.anisotropy = Math.min(8, maxAniso)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    return { map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false) }
  }, [maxAniso])
  useEffect(() => () => Object.values(maps).forEach((t) => t.dispose()), [maps])

  useFrame(() => {
    ground.current.position.set(sim.x, -0.05, sim.z)
    const u = (sim.x / TILE) % 1
    const v = (-sim.z / TILE) % 1
    for (const t of Object.values(maps)) t.offset.set(u, v)
  }, -2)

  return (
    <mesh ref={ground} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[SIZE, SIZE]} />
      <meshStandardMaterial {...maps} color="#9fb080" />
    </mesh>
  )
}
