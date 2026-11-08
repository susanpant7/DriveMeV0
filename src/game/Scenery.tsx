import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { sim } from './sim'

export const HORIZON = '#b9d3e6'

/** Direction of the sun (from the HDRI), shared with the shadow-casting light. */
export const sunDir = new THREE.Vector3(0.4, 0.8, 0.4).normalize()

function halfToFloat(h: number) {
  const e = (h >> 10) & 0x1f
  const m = h & 0x3ff
  const v = e === 0 ? m * 2 ** -24 : e === 31 ? 65504 : (1 + m / 1024) * 2 ** (e - 15)
  return h & 0x8000 ? -v : v
}

/** Photographic HDRI sky: background, lighting and reflections all come from it. */
export function Sky() {
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    let tex: THREE.DataTexture | null = null
    let dead = false
    new RGBELoader().load('/env/sky.hdr', (t) => {
      if (dead) return
      tex = t
      t.mapping = THREE.EquirectangularReflectionMapping
      scene.background = t
      scene.environment = t
      scene.environmentIntensity = 1.0

      // find the sun (brightest texel) and the horizon colour (for matching the fog)
      const { width: w, height: h, data } = t.image as unknown as { width: number; height: number; data: Uint16Array }
      let best = -1, bx = 0, by = 0
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const g = halfToFloat(data[(y * w + x) * 4 + 1])
        if (g > best) { best = g; bx = x; by = y }
      }
      const phi = ((bx + 0.5) / w - 0.5) * Math.PI * 2
      let theta = (0.5 - (by + 0.5) / h) * Math.PI
      theta = Math.abs(theta) // the sun is above the horizon
      sunDir.set(Math.cos(phi) * Math.cos(theta), Math.sin(theta), Math.sin(phi) * Math.cos(theta)).normalize()

      const row = Math.floor(h * 0.5) - 6
      let r = 0, g2 = 0, b2 = 0
      for (let x = 0; x < w; x += 4) {
        r += halfToFloat(data[(row * w + x) * 4])
        g2 += halfToFloat(data[(row * w + x) * 4 + 1])
        b2 += halfToFloat(data[(row * w + x) * 4 + 2])
      }
      const n = Math.ceil(w / 4)
      if (scene.fog) scene.fog.color.setRGB(r / n, g2 / n, b2 / n)
    })
    return () => {
      dead = true
      scene.background = null
      scene.environment = null
      tex?.dispose()
    }
  }, [scene])
  return null
}

/** Sun with soft shadows; the shadow box follows the player. */
export function SunLight() {
  const light = useRef<THREE.DirectionalLight>(null!)
  useFrame(() => {
    const l = light.current
    l.position.set(sim.x + sunDir.x * 80, sunDir.y * 80, sim.z + sunDir.z * 80)
    l.target.position.set(sim.x, 0, sim.z)
    l.target.updateMatrixWorld()
  }, -2)
  return (
    <directionalLight
      ref={light}
      castShadow
      intensity={1.7}
      color="#fff6e6"
      shadow-mapSize={[1536, 1536]}
      shadow-camera-left={-32}
      shadow-camera-right={32}
      shadow-camera-top={32}
      shadow-camera-bottom={-32}
      shadow-camera-near={5}
      shadow-camera-far={200}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
    />
  )
}
