import { useEffect } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { QUALITY } from './game/quality'
import { BrightnessContrast, EffectComposer, HueSaturation, N8AO, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
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
        {/* full-screen effects: one set per level (the composer takes a fixed list of effects) */}
        {fx === 'full' && (
        <EffectComposer key="full" multisampling={4}>
          <N8AO aoRadius={0.8} distanceFalloff={1} intensity={3} quality="low" />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <HueSaturation saturation={-0.14} />
          <BrightnessContrast brightness={-0.02} contrast={0.1} />
          <Noise opacity={0.06} />
          <Vignette offset={0.25} darkness={0.55} />
          <SMAA />
        </EffectComposer>
        )}
        {fx === 'light' && (
        <EffectComposer key="light" multisampling={0}>
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <HueSaturation saturation={-0.14} />
          <BrightnessContrast brightness={-0.02} contrast={0.1} />
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
