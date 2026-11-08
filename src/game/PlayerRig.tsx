import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Cabin } from './Cabin'
import { EYE, LOOK_TARGETS, MIRRORS, type MirrorCfg } from './cabinConfig'
import { MirrorGlass, housingGeometries, mirrorShape } from './mirrorGeom'
import { input, sim } from './sim'
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
      // the driver's mirror is nearly flat; the passenger-side one is gently convex ("objects are closer than they appear")
      wide: !side ? 1.0 : cfg.id === 'left' ? 1.08 : 1.3,
      m0: !side ? 1.0 : cfg.id === 'left' ? 0.96 : 0.86,
      m1: side ? 1.0 : 1.0,
      shift: [0, 0],
      inner: cfg.inner,
    })
    r.position.copy(cfg.pos)
    r.quaternion.copy(cfg.quat)
    return { glass: r, ...housingGeometries(w, h, cfg.inner) }
  }, [cfg, w, h, side])
  useEffect(() => () => glass.dispose(), [glass])

  // A mirror is a fixed object: it never changes size. It only looks bigger when your head moves closer or turns to face it.
  return (
    <>
      <primitive object={glass} />
      <group position={cfg.pos} quaternion={cfg.quat}>
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

    // touch free-look turns the head to wherever the thumb points; the keys snap to a mirror. The lens never zooms.
    const front = LOOK_TARGETS.front
    const t = input.free ? { yaw: input.yaw, pitch: front.pitch + input.pitch, fov: front.fov, lean: LOOK_TARGETS.front.lean.clone().set(-input.yaw * 0.08, 0, -Math.abs(input.yaw) * 0.03) } : LOOK_TARGETS[sim.look]
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
    ;(window as unknown as { __view?: unknown }).__view = { yaw: v.yaw, pitch: v.pitch, fov: v.fov }
    // dev hook: window.__dbgCam = { p: [x, y, z], t: [x, y, z], fov } looks at the world from anywhere
    const dbg = (window as unknown as { __dbgCam?: { p: number[]; t: number[]; fov: number } }).__dbgCam
    if (dbg) {
      camera.position.set(dbg.p[0], dbg.p[1], dbg.p[2])
      camera.lookAt(dbg.t[0], dbg.t[1], dbg.t[2])
      if (camera.fov !== dbg.fov) camera.fov = dbg.fov
      camera.updateProjectionMatrix()
      return
    }
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
