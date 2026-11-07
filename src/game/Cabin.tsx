import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { faceEuler } from './cabinConfig'
import { drawCluster } from './gauges'
import { extrudeProfile } from './geom'
import { sim } from './sim'
import { useGame } from './store'

const UP = new THREE.Vector3(0, 1, 0)

// --- shared materials -----------------------------------------------------
const plastic = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.62, metalness: 0.08 })
const leather = new THREE.MeshStandardMaterial({ color: '#0e0e10', roughness: 0.55, metalness: 0.05 })
const trim = new THREE.MeshStandardMaterial({ color: '#9aa1aa', roughness: 0.3, metalness: 0.9 })
const headliner = new THREE.MeshStandardMaterial({ color: '#c3c3c7', roughness: 0.95 })
const door = new THREE.MeshStandardMaterial({ color: '#33363d', roughness: 0.7 })
export const paint = new THREE.MeshPhysicalMaterial({ color: '#a3201a', roughness: 0.32, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.1 })
const fabric = new THREE.MeshStandardMaterial({ color: '#34363c', roughness: 0.96 })
const redLeather = new THREE.MeshStandardMaterial({ color: '#8d1c18', roughness: 0.55 })
const chrome = new THREE.MeshStandardMaterial({ color: '#d8dce2', roughness: 0.12, metalness: 1 })
const glassMat = new THREE.MeshStandardMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.07, roughness: 0.02, metalness: 0, envMapIntensity: 3, depthWrite: false })
const matteBlack = new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.85 })

// --- static geometry ------------------------------------------------------
// profiles are (distance forward of cabin origin, height)
const geoDashPassenger = extrudeProfile(
  [[0.15, 0.45], [0.15, 0.82], [0.4, 0.93], [0.7, 0.97], [0.97, 0.99], [0.97, 0.5]],
  1.1,
  0.015,
)
const geoDashPod = extrudeProfile([[0.7, 0.5], [0.7, 0.9], [0.78, 0.98], [0.97, 0.99], [0.97, 0.5]], 0.56, 0.012)
const geoDashSide = extrudeProfile([[0.86, 0.5], [0.86, 0.97], [0.97, 0.99], [0.97, 0.5]], 0.3, 0.012)
function Beam({ from, to, t = 0.05, material = plastic }: { from: [number, number, number]; to: [number, number, number]; t?: number; material?: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    return {
      pos: a.clone().add(b).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()),
      len: dir.length(),
    }
  }, [from, to])
  return (
    <mesh position={pos} quaternion={quat} material={material}>
      <boxGeometry args={[t, len, t]} />
    </mesh>
  )
}

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

/** Live instrument cluster in a slim bezel. */
function Displays() {
  const cluster = useCanvasTexture(1024, 400)
  const last = useRef(0)
  const clusterPos = useMemo(() => new THREE.Vector3(-0.4, 0.82, -0.66), [])
  const clusterRot = useMemo(() => faceEuler(clusterPos), [clusterPos])

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
    })
    cluster.tex.needsUpdate = true
  }, -1)

  useEffect(() => () => cluster.tex.dispose(), [cluster])

  return (
    <group position={clusterPos} rotation={clusterRot} scale={0.64}>
      <mesh position={[0, 0, -0.012]} material={matteBlack}>
        <boxGeometry args={[0.54, 0.22, 0.02]} />
      </mesh>
      <mesh position={[0, 0.125, 0.02]} rotation={[-0.35, 0, 0]} material={plastic}>
        <boxGeometry args={[0.62, 0.014, 0.12]} />
      </mesh>
      <mesh>
        <planeGeometry args={[0.56, 0.22]} />
        <meshBasicMaterial map={cluster.tex} toneMapped={false} transparent depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Air vent: dark frame with louvres. Faces local +z. */
function Vent({ w, h, pos }: { w: number; h: number; pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh material={matteBlack}>
        <boxGeometry args={[w + 0.02, h + 0.02, 0.012]} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0, h / 2 - ((i + 0.5) * h) / 5, 0.006]} rotation={[0.35, 0, 0]} material={fabric}>
          <boxGeometry args={[w - 0.012, 0.006, 0.014]} />
        </mesh>
      ))}
      <mesh material={chrome} position={[0, 0, 0.002]}>
        <boxGeometry args={[w + 0.026, 0.004, 0.004]} />
      </mesh>
    </group>
  )
}

/** Centre stack: air vents, climate dials and buttons, on the face turned toward the driver. */
function CenterStack() {
  return (
    <group position={[0.2, 0.9, -0.8]}>
      <mesh material={plastic}>
        <boxGeometry args={[0.4, 0.2, 0.16]} />
      </mesh>
      <mesh position={[0, 0.101, 0]} material={chrome}>
        <boxGeometry args={[0.4, 0.004, 0.16]} />
      </mesh>
      <Vent w={0.13} h={0.06} pos={[-0.1, 0.045, 0.082]} />
      <Vent w={0.13} h={0.06} pos={[0.1, 0.045, 0.082]} />
      <mesh position={[0, 0.005, 0.081]} material={matteBlack}>
        <boxGeometry args={[0.1, 0.034, 0.004]} />
      </mesh>
      {[-0.115, 0.115].map((x) => (
        <group key={x} position={[x, -0.055, 0.082]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={chrome}>
            <cylinderGeometry args={[0.024, 0.024, 0.014, 20]} />
          </mesh>
          <mesh position={[0, 0, 0.008]} rotation={[Math.PI / 2, 0, 0]} material={matteBlack}>
            <cylinderGeometry args={[0.019, 0.019, 0.006, 20]} />
          </mesh>
        </group>
      ))}
      {[-0.06, -0.03, 0, 0.03, 0.06].map((x) => (
        <mesh key={x} position={[x, -0.055, 0.082]} material={matteBlack}>
          <boxGeometry args={[0.022, 0.018, 0.006]} />
        </mesh>
      ))}
    </group>
  )
}

/** Windshield glass with a tinted sun band at the top, wipers and the cowl vent at the base. */
function Windshield() {
  const band = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 4
    c.height = 128
    const g = c.getContext('2d')!
    const gr = g.createLinearGradient(0, 0, 0, 128)
    gr.addColorStop(0, 'rgba(25,70,120,0.55)')
    gr.addColorStop(1, 'rgba(25,70,120,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 4, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  const theta = Math.atan2(0.372, 0.623)
  return (
    <>
      <group position={[0, 1.31, -0.786]} rotation={[theta, 0, 0]}>
        <mesh material={glassMat} renderOrder={5}>
          <planeGeometry args={[1.74, 0.74]} />
        </mesh>
        <mesh position={[0, 0.28, 0.002]} renderOrder={6}>
          <planeGeometry args={[1.74, 0.18]} />
          <meshBasicMaterial map={band} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

export function Cabin({ wheel }: { wheel: React.RefObject<THREE.Group> }) {
  return (
    <group>
      {/* dashboard (driver side is cut low so the wheel sits in front of the binnacle) */}
      <mesh geometry={geoDashPassenger} material={plastic} position={[0.4, 0, 0]} />
      <mesh geometry={geoDashPod} material={plastic} position={[-0.4, 0, 0]} />
      <mesh geometry={geoDashSide} material={plastic} position={[-0.8, 0, 0]} />
      {/* chrome trim along the dash */}
      <mesh position={[0, 0.992, -0.972]} material={trim}>
        <boxGeometry args={[1.88, 0.01, 0.012]} />
      </mesh>

      {/* A-pillars, header, roof */}
      <Beam from={[-0.93, 0.99, -0.97]} to={[-0.82, 1.62, -0.6]} t={0.1} material={plastic} />
      <Beam from={[0.93, 0.99, -0.97]} to={[0.84, 1.62, -0.6]} t={0.06} material={fabric} />
      <mesh position={[0, 1.61, -0.64]} material={fabric}>
        <boxGeometry args={[1.72, 0.07, 0.1]} />
      </mesh>
      <Windshield />
      <CenterStack />
      <mesh position={[0, 1.65, 0.4]} material={headliner}>
        <boxGeometry args={[1.9, 0.05, 2.0]} />
      </mesh>
      {/* sun visors */}
      <mesh position={[-0.4, 1.57, -0.5]} material={headliner}>
        <boxGeometry args={[0.42, 0.04, 0.2]} />
      </mesh>
      <mesh position={[0.45, 1.57, -0.5]} material={headliner}>
        <boxGeometry args={[0.42, 0.04, 0.2]} />
      </mesh>
      {/* doors with armrests */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh position={[sd * 0.9, 0.7, 0.1]} material={door}>
            <boxGeometry args={[0.08, 0.5, 2.2]} />
          </mesh>
          <mesh position={[sd * 0.9, 0.97, 0.05]} material={trim}>
            <boxGeometry args={[0.085, 0.012, 2.05]} />
          </mesh>
          <mesh position={[sd * 0.8, 0.78, 0.45]} material={leather}>
            <boxGeometry args={[0.18, 0.07, 0.7]} />
          </mesh>
          <mesh position={[sd * 0.858, 0.78, 0.36]} material={redLeather}>
            <boxGeometry args={[0.012, 0.13, 1.25]} />
          </mesh>
          <mesh position={[sd * 0.848, 0.86, -0.05]} material={chrome}>
            <boxGeometry args={[0.03, 0.026, 0.24]} />
          </mesh>
          <mesh position={[sd * 0.82, 0.822, 0.62]} material={matteBlack}>
            <boxGeometry args={[0.05, 0.014, 0.16]} />
          </mesh>
        </group>
      ))}

      {/* centre console between seats */}
      <mesh position={[0.0, 0.62, 0.55]} material={leather}>
        <boxGeometry args={[0.28, 0.3, 1.0]} />
      </mesh>

      {/* steering column + wheel (tilted like a real column) */}
      <group position={[-0.4, 0.849, -0.337]} rotation={[-0.454, 0, 0]} scale={1.054}>
        <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]} material={plastic}>
          <cylinderGeometry args={[0.032, 0.04, 0.2, 14]} />
        </mesh>
        <group ref={wheel}>
          <mesh material={leather}>
            <torusGeometry args={[0.185, 0.0235, 16, 56]} />
          </mesh>
          <mesh material={trim}>
            <torusGeometry args={[0.185, 0.0035, 6, 56]} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={leather}>
            <cylinderGeometry args={[0.058, 0.065, 0.045, 20]} />
          </mesh>
          <mesh position={[0, 0, 0.024]} rotation={[Math.PI / 2, 0, 0]} material={trim}>
            <cylinderGeometry args={[0.028, 0.028, 0.004, 20]} />
          </mesh>
          <mesh position={[0, 0, 0]} material={leather}>
            <boxGeometry args={[0.37, 0.04, 0.022]} />
          </mesh>
          {/* centre mark at 12 o'clock so you can see the wheel turn */}
          <mesh position={[0, 0.185, 0.0255]} material={chrome}>
            <boxGeometry args={[0.008, 0.022, 0.004]} />
          </mesh>
          {/* stitching ring and spoke buttons */}
          <mesh position={[0, 0, 0.0245]} material={trim}>
            <torusGeometry args={[0.185, 0.0016, 6, 64]} />
          </mesh>
          {[-1, 1].map((sx) => (
            <group key={sx}>
              <mesh position={[sx * 0.105, 0, 0.0125]} material={matteBlack}>
                <boxGeometry args={[0.075, 0.03, 0.005]} />
              </mesh>
              {[-0.022, 0, 0.022].map((dx) => (
                <mesh key={dx} position={[sx * 0.105 + dx, 0, 0.0155]} material={chrome}>
                  <boxGeometry args={[0.012, 0.012, 0.003]} />
                </mesh>
              ))}
            </group>
          ))}
          <mesh position={[0, -0.1, 0]} material={leather}>
            <boxGeometry args={[0.04, 0.16, 0.022]} />
          </mesh>
        </group>
      </group>

      {/* floor and knee panel: nothing but cabin below the dash, so no road shows under the wheel */}
      <mesh position={[0, 0.3, 0.2]} material={fabric}>
        <boxGeometry args={[1.9, 0.04, 2.6]} />
      </mesh>
      <mesh position={[0, 0.5, -0.64]} material={plastic}>
        <boxGeometry args={[1.9, 0.4, 0.05]} />
      </mesh>
      <mesh position={[0, 0.5, -0.96]} material={matteBlack}>
        <boxGeometry args={[1.9, 0.4, 0.05]} />
      </mesh>
      <Displays />

      {/* mirror arms from the door to the mirror housings */}
      <Beam from={[-0.92, 0.9, -0.74]} to={[-1.03, 0.98, -0.62]} t={0.045} />
      <Beam from={[0.92, 0.9, -0.78]} to={[0.99, 0.98, -0.66]} t={0.045} />

    </group>
  )
}
