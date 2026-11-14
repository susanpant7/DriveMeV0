import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { QUALITY, autoQ } from './game/quality'
import { BrightnessContrast, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { installInput } from './game/input'
import { PlayerRig } from './game/PlayerRig'
import { City } from './game/City'
import { setLayout } from './game/map'
import { layoutOf } from './game/nav'
import { Highway } from './highway/Highway'
import { useGame } from './game/store'
import { HORIZON, Sky, SunLight } from './game/Scenery'
import { Traffic } from './game/Traffic'
import { Ground, Simulation } from './game/World'
import { IS_COARSE } from './game/device'
import { Hud } from './ui/Hud'
import { ContextLostNotice, GraphicsBoundary } from './ui/GraphicsGuard'

// ?lowfx forces the light renderer; phones and tablets use it automatically
const FORCE_LOW = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lowfx')
/** Automatic quality: watch the frame rate; below about 48 fps scale the resolution and mirror pictures down a step, back up above 57 */
function AutoQuality() {
  const setDpr = useThree((s) => s.setDpr)
  const g = useGame((s) => s.graphics)
  const w = useRef({ t: 0, n: 0, low: 0, high: 0 })
  useEffect(() => { autoQ.scale = 1; setDpr(QUALITY[g].dpr) }, [g, setDpr])
  useFrame((_, dt) => {
    const s = w.current
    s.t += dt; s.n++
    if (s.t < 1) return
    const fps = s.n / s.t
    s.t = 0; s.n = 0
    if (document.hidden || useGame.getState().status !== 'playing') return
    if (fps < 48) { s.low++; s.high = 0 } else if (fps > 57) { s.high++; s.low = 0 } else { s.low = 0; s.high = 0 }
    let next = autoQ.scale
    if (s.low >= 2) { next = Math.max(0.6, autoQ.scale - 0.15); s.low = 0 }
    else if (s.high >= 4 && autoQ.scale < 1) { next = Math.min(1, autoQ.scale + 0.1); s.high = 0 }
    if (next !== autoQ.scale) { autoQ.scale = next; setDpr(Math.max(0.75, QUALITY[useGame.getState().graphics].dpr * next)) }
  })
  return null
}
/** the camera's view distance and the haze follow the graphics level */
function ViewDistance() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const g = useGame((s) => s.graphics)
  useEffect(() => {
    const q = QUALITY[g]
    camera.far = q.far; camera.updateProjectionMatrix()
    if (scene.fog instanceof THREE.Fog) { scene.fog.near = q.fogNear; scene.fog.far = q.far - 60 }
  }, [g, camera, scene])
  return null
}

export default function App() {
  useEffect(() => installInput(), [])
  const mode = useGame((s) => s.mode)
  const leg = useGame((s) => s.leg)
  const gfx = useGame((s) => s.graphics)
  const q = QUALITY[gfx]
  // full-screen effects: phones never get the heavy ones
  const fx = FORCE_LOW ? 'none' : IS_COARSE && q.fx === 'full' ? 'light' : q.fx
  const hwLeg = mode === 'highway' || (mode === 'mixed' && leg === 'highway') // the Mixed course drives out onto the highway and back
  setLayout(layoutOf(mode)) // the road data must match the chosen course before the scene is built
  return (
    <>
      <GraphicsBoundary>
      <Canvas onCreated={(st) => { Object.assign(window, { __gl: st.gl, __scene: st.scene, __camera: st.camera }) }} flat dpr={[1, q.dpr]} gl={{ antialias: fx === 'none', powerPreference: 'high-performance' }} camera={{ fov: 70, near: 0.05, far: 460, position: [0, 1.2, 0] }}>
        <color attach="background" args={[HORIZON]} />
        <fog attach="fog" args={[HORIZON, 120, 400]} />
        <Sky />
        <SunLight />
        <Simulation />
        <Ground />
        {hwLeg && <Highway />}
        {mode !== 'highway' && <group visible={!hwLeg}><City key={layoutOf(mode)} /></group>}
        <Traffic />
        <PlayerRig />
        <ViewDistance />
        <AutoQuality />
        {/* full-screen effects: one set per level (the composer takes a fixed list of effects) */}
        {fx === 'full' && (
        <EffectComposer key="full" multisampling={4}>
          {/* clarity first: true colours (neutral tone mapping), no film grain, no darkened edges, no washed-out colour; a light touch of
              contact shadow under the cars keeps them standing on the road */}
          <N8AO aoRadius={0.6} distanceFalloff={1} intensity={1.4} quality="low" />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <BrightnessContrast brightness={0.02} contrast={0.08} />
          <SMAA />
        </EffectComposer>
        )}
        {fx === 'light' && (
        <EffectComposer key="light" multisampling={0}>
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <BrightnessContrast brightness={0.02} contrast={0.08} />
          <SMAA />
        </EffectComposer>
        )}
      </Canvas>
      </GraphicsBoundary>
      <ContextLostNotice />
      <Hud />
    </>
  )
}
