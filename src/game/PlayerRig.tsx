import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Cabin } from './Cabin'
import { EYE, LOOK_TARGETS, MIRRORS, type MirrorCfg } from './cabinConfig'
import { MirrorGlass, housingGeometries, mirrorShape } from './mirrorGeom'
import { sim } from './sim'
import { useGame } from './store'

const UP = new THREE.Vector3(0, 1, 0)

const housingMat = new THREE.MeshPhysicalMaterial({ color: '#0d0f12', roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 })

/** A true planar mirror with a convex-style wide view, in a glossy shaped housing. */
function Mirror({ cfg }: { cfg: MirrorCfg }) {
  const [w, h] = cfg.size
  const side = cfg.id !== 'center'
  const { glass, ringGeo, shellGeo } = useMemo(() => {
    const geo = new THREE.ShapeGeometry(mirrorShape(w, h, cfg.inner), 12)
    const r = new MirrorGlass(geo, {
      w,
      h,
      res: cfg.res,
      // side mirrors are convex: they render a wider view and compress it toward the edges
      wide: side ? 1.25 : 1.0,
      m0: side ? 0.86 : 1.0,
      m1: side ? 1.0 : 1.0,
      shift: [0, 0],
      inner: cfg.inner,
    })
    r.position.copy(cfg.pos)
    r.quaternion.copy(cfg.quat)
    return { glass: r, ...housingGeometries(w, h, cfg.inner) }
  }, [cfg, w, h, side])
  useEffect(() => () => glass.dispose(), [glass])

  // door mirrors look smaller in your normal view and come up to full size when you glance at them
  const housing = useRef<THREE.Group>(null!)
  const k = useRef(side ? 0.6 : 1)
  useFrame((_, dt) => {
    if (!side) return
    const target = sim.look === cfg.id ? (cfg.id === 'right' ? 1.3 : 1.08) : 0.6
    k.current += (target - k.current) * (1 - Math.exp(-10 * dt))
    glass.scale.setScalar(k.current)
    housing.current.scale.setScalar(k.current)
  }, -2.5)

  return (
    <>
      <primitive object={glass} />
      <group ref={housing} position={cfg.pos} quaternion={cfg.quat}>
        <mesh geometry={ringGeo} material={housingMat} />
        <mesh geometry={shellGeo} material={housingMat} />
      </group>
    </>
  )
}

/** Driver's-eye camera + cabin + the three mirrors. */
export function PlayerRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const rig = useRef<THREE.Group>(null!)
  const wheel = useRef<THREE.Group>(null!)
  const view = useRef({ yaw: 0, pitch: 0, fov: 60.6, lean: new THREE.Vector3() })
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    camera.layers.enable(1)
    camera.rotation.order = 'YXZ'
    // Cabin + mirrors live on layer 1: the driver sees them, mirror cameras don't.
    rig.current.traverse((o) => {
      if ((o as THREE.Camera).isCamera) return
      // cabin = layer 1 (driver only); own-car bodywork = layer 2 (shows up only in the mirrors)
      o.layers.set(o.userData.exterior ? 2 : 1)
    })
  }, [camera])

  useFrame((_, dt) => {
    const crashed = useGame.getState().status === 'crashed'
    const g = rig.current
    g.position.set(sim.x, 0, sim.z)
    g.rotation.y = sim.h
    wheel.current.rotation.z = -sim.steerIn * 2.6

    const t = LOOK_TARGETS[sim.look]
    const k = 1 - Math.exp(-14 * dt)
    const v = view.current
    v.yaw += (t.yaw - v.yaw) * k
    v.pitch += (t.pitch - v.pitch) * k
    v.fov += (t.fov - v.fov) * k
    v.lean.lerp(t.lean, k)

    tmp.copy(EYE).add(v.lean).applyAxisAngle(UP, sim.h).add(g.position)
    camera.position.copy(tmp)

    let shake = 0
    if (crashed) shake = Math.exp(-sim.crashT * 4) * 0.05
    const vib = crashed ? 0 : (sim.speed / 30) * 0.0007 * Math.sin(performance.now() * 0.045)
    camera.rotation.set(
      v.pitch + vib + (shake ? (Math.random() - 0.5) * shake : 0) - (crashed ? Math.min(0.15, sim.crashT * 0.6) : 0),
      v.yaw + sim.h + (shake ? (Math.random() - 0.5) * shake : 0),
      -sim.steer * 0.15,
    )
    if (Math.abs(camera.fov - v.fov) > 0.01) {
      camera.fov = v.fov
      camera.updateProjectionMatrix()
    }
  }, -2)

  return (
    <group ref={rig}>
      <Cabin wheel={wheel} />

      {MIRRORS.map((m) => (
        <Mirror key={m.id} cfg={m} />
      ))}
    </group>
  )
}
