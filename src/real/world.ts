import { WORLD_PERIOD } from '../game/map'
import { buildGraph, RoadIndex, type CityData, type Graph } from './graph'

/** Which world is being driven: the built-in grid city, or a real city loaded from OpenStreetMap. */
export const WORLD = {
  real: false,
  /** the highway-merge course (a flat world of its own) */
  highway: false,
  city: null as CityData | null,
  graph: null as Graph | null,
  index: null as RoadIndex | null,
  bcell: new Map<string, number[]>(), // building index grid (cell -> building ids)
  /** the road surface test the simulation uses: real roads here */
  onRoad(x: number, z: number) { return !!this.index && this.index.onRoad(x, z) },
}
const CELL = 30

export function enterRealCity(city: CityData) {
  const graph = buildGraph(city)
  WORLD.city = city
  WORLD.graph = graph
  WORLD.index = new RoadIndex(graph)
  WORLD.real = true
  WORLD_PERIOD.v = 1e7
  WORLD.bcell.clear()
  city.buildings.forEach((b, id) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i < b.p.length; i += 2) { x0 = Math.min(x0, b.p[i]); x1 = Math.max(x1, b.p[i]); z0 = Math.min(z0, b.p[i + 1]); z1 = Math.max(z1, b.p[i + 1]) }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = cx + ',' + cz
      const l = WORLD.bcell.get(k)
      if (l) l.push(id)
      else WORLD.bcell.set(k, [id])
    }
  })
}

export function leaveRealCity() {
  WORLD.real = false
  WORLD.city = null
  WORLD.graph = null
  WORLD.index = null
  WORLD.bcell.clear()
  WORLD_PERIOD.v = 800
}

/** Is this point inside a building footprint? (buildings are solid; roads take priority, so a point on a road is never a building) */
export function inRealBuilding(x: number, z: number) {
  const ids = WORLD.bcell.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL))
  if (!ids || !WORLD.city) return false
  for (const id of ids) {
    const p = WORLD.city.buildings[id].p
    let inside = false
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
    }
    if (inside) return true
  }
  return false
}
