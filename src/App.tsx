import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { installInput } from './game/input'
import { PlayerRig } from './game/PlayerRig'
import { City } from './game/City'
import { HORIZON, Sky, SunLight } from './game/Scenery'
import { Traffic } from './game/Traffic'
import { Ground, Simulation } from './game/World'
import { Hud } from './ui/Hud'

const LOWFX = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lowfx')

export default function App() {
  useEffect(() => installInput(), [])
  return (
    <>
      <Canvas flat shadows dpr={[1, 1.5]} gl={{ antialias: false }} camera={{ fov: 70, near: 0.05, far: 460, position: [0, 1.2, 0] }}>
        <color attach="background" args={[HORIZON]} />
        <fog attach="fog" args={[HORIZON, 120, 400]} />
        <Sky />
        <SunLight />
        <Simulation />
        <Ground />
        <City />
        <Traffic />
        <PlayerRig />
        {!LOWFX && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={0.7} distanceFalloff={1} intensity={2.4} quality="medium" />
          <Bloom luminanceThreshold={0.9} intensity={0.35} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.3} darkness={0.45} />
          <SMAA />
        </EffectComposer>
        )}
      </Canvas>
      <Hud />
    </>
  )
}
