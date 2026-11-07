/** Fixed-time signals for real-city junctions: two phases (north-south and east-west) with an all-red gap, never both green. */
export const CYCLE = 44
const offset = (node: number) => (((Math.sin(node * 12.9898) * 43758.5453) % 1) + 1) % 1 * CYCLE
/** 0 green, 1 amber, 2 red. axis 0 = approaching east-west, 1 = north-south. */
export function realSignal(node: number, axis: 0 | 1, t: number): 0 | 1 | 2 {
  const ph = (((t + offset(node)) % CYCLE) + CYCLE) % CYCLE
  const a = axis === 1 ? ph : (ph + 22) % CYCLE // east-west runs 22 s later
  if (a < 17) return 0
  if (a < 20) return 1
  return 2
}
export const axisOf = (dx: number, dz: number): 0 | 1 => (Math.abs(dx) > Math.abs(dz) ? 0 : 1)
