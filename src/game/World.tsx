import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { updateAudio } from './audio'
import { sim, stepSim } from './sim'
import { useGame } from './store'

/** Advances the simulation before anything is drawn this frame. */
export function Simulation() {
  useFrame((_, dt) => {
    stepSim(Math.min(dt, 0.05))
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
