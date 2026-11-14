/** minimal typings for troika-three-text (sharp, signed-distance-field text for three.js) */
declare module 'troika-three-text' {
  import type { Material, Mesh } from 'three'
  export class Text extends Mesh {
    text: string
    font: string
    fontSize: number
    anchorX: number | string
    anchorY: number | string
    color: number | string
    letterSpacing: number
    outlineWidth: number | string
    outlineColor: number | string
    sdfGlyphSize: number
    material: Material
    sync(cb?: () => void): void
    dispose(): void
  }
  export function preloadFont(opts: { font: string; characters?: string }, cb: () => void): void
}
