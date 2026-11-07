import * as THREE from 'three'

/**
 * Extrudes a side profile into a solid. Profile points are (d, y): d = distance
 * forward of the car/cabin origin, y = height. The solid is `width` wide in x,
 * centred on x = 0, and faces -z (forward).
 */
export function extrudeProfile(points: Array<[number, number]>, width: number, bevel = 0.02) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)))
  shape.closePath()
  const depth = Math.max(0.001, width - 2 * bevel)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  })
  geo.translate(0, 0, -depth / 2)
  geo.rotateY(Math.PI / 2) // shape +x -> world -z, extrusion z -> world +x
  return geo
}
