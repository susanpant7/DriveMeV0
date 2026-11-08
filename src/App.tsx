import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { BrightnessContrast, EffectComposer, HueSaturation, N8AO, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { installInput } from './game/input'
import { PlayerRig } from './game/PlayerRig'
import { City } from './game/City'
import { RealCity } from './real/RealCity'
import { Highway } from './highway/Highway'
import { useGame } from './game/store'
import { HORIZON, Sky, SunLight } from './game/Scenery'
import { Traffic } from './game/Traffic'
import { Ground, Simulation } from './game/World'
import { IS_COARSE } from './game/device'
import { Hud } from './ui/Hud'
import { ContextLostNotice, GraphicsBoundary } from './ui/GraphicsGuard'

// ?lowfx forces the light renderer; phones and tablets use it automatically
const LOWFX = IS_COARSE || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('lowfx'))

export default function App() {
  useEffect(() => installInput(), [])
  const world = useGame((s) => s.world)
  const realName = useGame((s) => s.realName)
  const mode = useGame((s) => s.mode)
  return (
    <>
      <GraphicsBoundary>
      <Canvas flat shadows dpr={IS_COARSE ? [1, 1.25] : [1, 1.5]} gl={{ antialias: LOWFX, powerPreference: 'high-performance' }} camera={{ fov: 70, near: 0.05, far: 460, position: [0, 1.2, 0] }}>
        <color attach="background" args={[HORIZON]} />
        <fog attach="fog" args={[HORIZON, 120, 400]} />
        <Sky />
        <SunLight />
        <Simulation />
        <Ground />
        {world === 'real' ? <RealCity key={realName} /> : mode === 'highway' ? <Highway /> : <City />}
        <Traffic />
        <PlayerRig />
        {!LOWFX && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={0.8} distanceFalloff={1} intensity={3} quality="low" halfRes />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <HueSaturation saturation={-0.14} />
          <BrightnessContrast brightness={-0.02} contrast={0.1} />
          <Noise opacity={0.06} />
          <Vignette offset={0.25} darkness={0.55} />
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
