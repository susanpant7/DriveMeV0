import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Your own car: a 2019 Toyota Camry (public/models/camry.glb, see CREDITS), already in the game's frame: metres, wheels on y = 0,
 * nose toward -z, the driver's eye at x = -0.335, z = 0. It comes in groups:
 *  - `ext`   the bodywork, wheels, lamps and window glass: seen by the driver AND in the mirrors (layers 1 + 2)
 *  - `int`   the cabin: dash, doors, seats, console (driver only, layer 1)
 *  - `wheel` the steering wheel on its own, so it can turn
 *  - the three mirror glasses, replaced in the game by real reflecting glass of the same outline
 */
export interface CarModel {
  ext: THREE.Object3D
  int: THREE.Object3D
  wheel: THREE.Object3D
  glass: Record<'left' | 'center' | 'right', THREE.BufferGeometry>
}

/** steering wheel hub and the direction its axis points (toward the driver) */
export const WHEEL_HUB = new THREE.Vector3(-0.335, 0.855, -0.58)
export const WHEEL_AXIS = new THREE.Vector3(0, 0.358, 0.934).normalize()

let p: Promise<CarModel> | null = null
export function loadCarModel(): Promise<CarModel> {
  if (!p) p = new Promise((resolve, reject) => {
    new GLTFLoader().load('/models/camry.glb', (g) => {
      const get = (n: string) => g.scene.getObjectByName(n)!
      const ext = get('ext'), int = get('int'), wheel = get('wheel')
      const tune = (o: THREE.Object3D, exterior: boolean) => o.traverse((c) => {
        c.layers.set(1)
        if (exterior) c.layers.enable(2)
        const me = c as THREE.Mesh
        if (!me.isMesh) return
        me.castShadow = false; me.receiveShadow = false
        me.frustumCulled = false // you sit inside it: it is always around the camera
        const m = me.material as THREE.MeshPhysicalMaterial
        const name = m.name
        if (/WINDOWS|D_GLASS/.test(name)) {
          // clear glass with a faint tint: the road must stay bright through the windshield
          m.transparent = true; m.opacity = 0.1; m.depthWrite = false; m.transmission = 0; m.roughness = 0.05; m.metalness = 0
          m.color.set('#bcd4e6'); m.side = THREE.DoubleSide; me.renderOrder = 5
        } else if (/GLASS_LIGHT/.test(name)) { m.transparent = true; m.depthWrite = false; m.transmission = 0 }
        else if (exterior) { m.envMapIntensity = /CARPAINT/.test(name) ? 0.22 : 0.9; if (/CARPAINT/.test(name)) { m.roughness = 0.45; m.metalness = 0.25; m.clearcoat = 0; m.specularIntensity = 0.3; m.color.set('#8a1410') } }
        else {
          // cabin trim: matte, so the sky does not glare off the dash
          m.envMapIntensity = 0.45
          m.roughness = Math.max(m.roughness, name === 'CHORME' || name === 'METAL' ? 0.25 : 0.55)
          if (name !== 'CHORME' && name !== 'METAL') m.metalness = Math.min(m.metalness, 0.15)
          if (/L_Plas|PLASTIC|INT1_BLACK|suliaonew3|FLOOR/.test(name) && m.color.r < 0.06) m.color.set('#17181b') // pure black reads as a hole
        }
      })
      tune(ext, true); tune(int, false); tune(wheel, false)
      // the model's own instrument and centre screens are replaced by the live ones
      for (const n of ['int_DISPLAY_1', 'int_DISPLAY_2']) { const o = int.getObjectByName(n); if (o) o.visible = false }
      const geo = (n: string) => { let gg: THREE.BufferGeometry | null = null; get(n).traverse((c) => { const me = c as THREE.Mesh; if (me.isMesh) gg = me.geometry }); return gg! }
      resolve({ ext, int, wheel, glass: { left: geo('mirL'), center: geo('mirC'), right: geo('mirR') } })
    }, undefined, reject)
  })
  return p
}
