import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Cabin } from './Cabin'
import { CarPlay } from './CarPlay'
import { EYE, FRONT_PITCH, FRONT_YAW, CARPLAY, adjust, mirrorAdj, mirrorScreen, saveMirrors, LOOK_TARGETS, MIRROR_AIM, MIRRORS, type MirrorCfg } from './cabinConfig'
import { MirrorGlass, housingGeometries, mirrorShape } from './mirrorGeom'
import { input, sim } from './sim'
import { useGame } from './store'

const UP = new THREE.Vector3(0, 1, 0)

const housingMat = new THREE.MeshPhysicalMaterial({ color: '#0d0f12', roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 })

const selMat = new THREE.MeshBasicMaterial({ color: '#3b9dff' })

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
      wide: !side ? 1.0 : 1.0,
      m0: !side ? 1.0 : 1.0,
      m1: side ? 1.0 : 1.0,
      shift: [0, 0],
      inner: cfg.inner,
      alt: !side,
    })
    r.position.copy(cfg.pos)
    r.quaternion.copy(cfg.quat)
    if (cfg.id !== 'center') r.frustumCulled = false // keep rendering even when it is out of view: the dash repeater shows it
    return { glass: r, ...housingGeometries(w, h, cfg.inner) }
  }, [cfg, w, h, side])
  useEffect(() => () => glass.dispose(), [glass])
  // the dash screen shows this mirror's picture while the matching indicator is on (left = -1, right = +1)
  const repeater = useMemo(() => {
    if (cfg.id === 'center') return null
    const m = glass.material as THREE.ShaderMaterial
    // a screen-shaped window onto the same picture: full width, the middle of the height (no stretching)
    const Ws = CARPLAY.W, Hs = CARPLAY.H
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...m.uniforms, uHalf: { value: new THREE.Vector2(Ws / 2, Hs / 1.4) }, uInner: { value: 1 } },
      vertexShader: m.vertexShader,
      fragmentShader: m.fragmentShader,
    })
    mat.depthTest = false
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Ws, Hs), mat)
    mesh.renderOrder = 1002
    mesh.frustumCulled = false
    return { mesh, mat }
  }, [cfg, glass])
  useEffect(() => () => repeater?.mat.dispose(), [repeater])
  // only the right indicator brings the right mirror onto the dash screen (the left indicator keeps the map)
  const feedGroup = useRef<THREE.Group>(null)
  const housing = useRef<THREE.Group>(null)
  const ringMesh = useRef<THREE.Mesh>(null)
  const AX = useMemo(() => new THREE.Vector3(1, 0, 0), [])
  const AY = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const qa = useMemo(() => new THREE.Quaternion(), [])
  const qb = useMemo(() => new THREE.Quaternion(), [])
  useFrame(() => {
    if (feedGroup.current) feedGroup.current.visible = cfg.id === 'right' && (sim.signal === 1 || useGame.getState().adjusting)
    // the driver's own mirror adjustment turns the glass (and its housing) a little
    const a = mirrorAdj[cfg.id as 'left' | 'center' | 'right']
    qa.setFromAxisAngle(AY, a.yaw)
    qb.setFromAxisAngle(AX, -a.pitch)
    glass.quaternion.copy(qa).multiply(qb).multiply(cfg.quat)
    if (housing.current) housing.current.quaternion.copy(glass.quaternion)
    if (ringMesh.current) ringMesh.current.material = adjust.sel === cfg.id ? selMat : housingMat
  })

  // A mirror is a fixed object: it never changes size. It only looks bigger when your head moves closer or turns to face it.
  return (
    <>
      <primitive object={glass} />
      <group ref={housing} position={cfg.pos} quaternion={cfg.quat}>
        <mesh ref={ringMesh} geometry={ringGeo} material={housingMat} />
        <mesh geometry={shellGeo} material={housingMat} />
      </group>
      {repeater && (
        <group ref={feedGroup} position={CARPLAY.pos} rotation={CARPLAY.rot} visible={false}>
          <group position={[0, 0, 0.004]}>
            <primitive object={repeater.mesh} />
          </group>
        </group>
      )}
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
  // body motion (smoothed): longitudinal / lateral acceleration felt by the driver's head
  const body = useRef({ lastSpeed: 0, lastH: 0, accel: 0, lat: 0, roll: 0, pitch: 0, sway: 0, bump: 0, fov: 0, init: false })

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

  const size = useThree((st) => st.size)
  const proj = useMemo(() => new THREE.Vector3(), [])
  // Press a mirror (or the dash screen while it shows the right mirror) to select it, then drag to move the view in it.
  // Arrow keys also nudge the selected mirror. Pressing anywhere else deselects.
  useEffect(() => {
    let last = { x: 0, y: 0 }
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.tagName !== 'CANVAS' || useGame.getState().status !== 'paused' || !useGame.getState().adjusting) return // mirrors can only be adjusted while paused
      let best: 'left' | 'center' | 'right' | null = null
      let bd = Infinity
      for (const k of ['left', 'center', 'carplay'] as const) {
        const m = mirrorScreen[k]
        if (!m.ok || (k === 'carplay' && !useGame.getState().adjusting && sim.signal !== 1)) continue
        const d = Math.hypot(e.clientX - m.x, e.clientY - m.y)
        if (d < m.r && d < bd) { bd = d; best = k === 'carplay' ? 'right' : k }
      }
      if (!best) { adjust.sel = null; adjust.dragging = false; return }
      if (adjust.sel !== best) {
        adjust.sel = best
        sim.msgId++
        const text = `Adjusting the ${best} mirror`
        useGame.setState((s) => ({ messages: [...s.messages.slice(-3), { id: sim.msgId, text, kind: 'info' as const, until: sim.t + 6 }] }))
      }
      adjust.dragging = true
      last = { x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent) => {
      if (!adjust.dragging || !adjust.sel) return
      const a = mirrorAdj[adjust.sel]
      a.yaw = Math.max(-0.6, Math.min(0.6, a.yaw + (e.clientX - last.x) * 0.004))
      a.pitch = Math.max(-0.6, Math.min(0.6, a.pitch - (e.clientY - last.y) * 0.004))
      last = { x: e.clientX, y: e.clientY }
    }
    const up = () => { if (adjust.dragging) { adjust.dragging = false; saveMirrors() } }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  useFrame((_, dt) => {
    // where the mirrors are on screen (for clicking)
    for (const [k, p, rad] of [['left', MIRRORS[0].pos, 0.2], ['center', MIRRORS[1].pos, 0.16], ['carplay', CARPLAY.pos, 0.3]] as Array<[string, THREE.Vector3, number]>) {
      const wp = p.clone().applyAxisAngle(UP, sim.h).add(rig.current.position)
      const dist = camera.position.distanceTo(wp)
      proj.copy(wp).project(camera)
      const e = mirrorScreen[k]
      e.ok = proj.z < 1 && Math.abs(proj.x) < 1.3 && Math.abs(proj.y) < 1.3
      e.x = (proj.x * 0.5 + 0.5) * size.width
      e.y = (-proj.y * 0.5 + 0.5) * size.height
      e.r = Math.max(30, (rad * size.height * 1.3) / Math.max(0.3, dist))
    }
    const crashed = useGame.getState().status === 'crashed'
    const g = rig.current
    g.position.set(sim.x, 0, sim.z)
    g.rotation.y = sim.h
    wheel.current.rotation.z = -sim.steerIn * Math.PI * 2 * 1.5 // like a real car: three turns from lock to lock

    // touch free-look turns the head to wherever the thumb points; the keys snap to a mirror. The lens never zooms.
    const front = LOOK_TARGETS.front
    let t: { yaw: number; pitch: number; fov: number; lean: THREE.Vector3 } = LOOK_TARGETS[sim.look]
    if (input.free) {
      // Free look: the head goes where the thumb / mouse points. Close to a mirror, a gentle magnet pulls the view onto it
      // and the head leans toward it (like a real driver), so the mirror is centred and larger on screen. The lens never zooms.
      const gy = FRONT_YAW + input.yaw, gp = FRONT_PITCH + input.pitch
      let best: 'left' | 'center' | 'right' | null = null
      let bd = 0.55
      for (const kk of ['left', 'center', 'right'] as const) {
        const dd = Math.hypot(gy - MIRROR_AIM[kk].yaw, gp - MIRROR_AIM[kk].pitch)
        if (dd < bd) { bd = dd; best = kk }
      }
      const lean = new THREE.Vector3(-gy * 0.06, 0, -Math.abs(gy) * 0.02)
      let yaw = gy, pitch = front.pitch + input.pitch
      if (best) {
        const w = 1 - bd / 0.55
        const a = MIRROR_AIM[best]
        yaw = gy + (a.yaw - gy) * 0.75 * w
        pitch = gp + (a.pitch - gp) * 0.75 * w
        const m = MIRRORS[best === 'left' ? 0 : best === 'center' ? 1 : 2].pos
        lean.add(new THREE.Vector3(m.x - EYE.x, (m.y - EYE.y) * 0.3, m.z - EYE.z).normalize().multiplyScalar(0.28 * w))
      }
      t = { yaw, pitch, fov: front.fov, lean }
    }
    const k = 1 - Math.exp(-14 * dt)
    const v = view.current
    v.yaw += (t.yaw - v.yaw) * k
    v.pitch += (t.pitch - v.pitch) * k
    v.fov += (t.fov - v.fov) * k
    v.lean.lerp(t.lean, k)

    // ---- how the car moves under you: nose dips when braking, lifts on throttle, body rolls in a turn ----
    const bd = body.current
    if (!bd.init || dt > 0.2) { bd.lastSpeed = sim.speed; bd.lastH = sim.h; bd.init = true }
    const stepDt = Math.max(dt, 1e-3)
    const accelRaw = (sim.speed - bd.lastSpeed) / stepDt
    const yawRate = ((((sim.h - bd.lastH) + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) / stepDt
    bd.lastSpeed = sim.speed
    bd.lastH = sim.h
    const kf = 1 - Math.exp(-2.5 * dt)
    bd.accel += (Math.max(-9, Math.min(5, accelRaw)) - bd.accel) * kf
    bd.lat += (Math.max(-6, Math.min(6, yawRate * sim.speed)) - bd.lat) * kf
    const moving = Math.min(1, sim.speed / 4)
    const k2 = 1 - Math.exp(-7 * dt)
    bd.pitch += (bd.accel * 0.0022 * moving - bd.pitch) * k2 // braking (negative accel) pitches the view down
    bd.roll += (-bd.lat * 0.0042 - bd.roll) * k2
    bd.sway += (-bd.lat * 0.012 - bd.sway) * k2 // the head slides the other way in a turn
    // road texture: a slow suspension heave plus small bumps that grow with speed
    bd.bump = 0 // no heave: the view stays steady, it must not bob up and down
    bd.fov += ((sim.speed / 30) * 5 - bd.fov) * (1 - Math.exp(-2 * dt)) // the world opens up a little at speed
    const bodyOn = crashed ? 0 : 1
    tmp.copy(EYE).add(v.lean).add(new THREE.Vector3(bd.sway * bodyOn, bd.bump * 6 * bodyOn, bd.pitch * -0.5 * bodyOn)).applyAxisAngle(UP, sim.h).add(g.position)
    camera.position.copy(tmp)

    let shake = 0
    if (crashed) shake = Math.exp(-sim.crashT * 4) * 0.05
    const vib = 0
    camera.rotation.set(
      v.pitch + vib + bd.pitch * bodyOn + bd.bump * bodyOn + (shake ? (Math.random() - 0.5) * shake : 0) - (crashed ? Math.min(0.15, sim.crashT * 0.6) : 0),
      v.yaw + sim.h + (shake ? (Math.random() - 0.5) * shake : 0),
      -sim.steer * 0.15 + bd.roll * bodyOn,
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
    const fovNow = v.fov + (input.free ? 0 : bd.fov * bodyOn)
    if (Math.abs(camera.fov - fovNow) > 0.01) {
      camera.fov = fovNow
      camera.updateProjectionMatrix()
    }
  }, -2)

  return (
    <group ref={rig}>
      <Cabin wheel={wheel} />
      <CarPlay />

      {MIRRORS.map((m) => (
        <Mirror key={m.id} cfg={m} />
      ))}
    </group>
  )
}
