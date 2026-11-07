import * as THREE from 'three'

/**
 * Outline of a side-mirror glass: a rounded shape with the lower corner nearest the
 * car body cut at an angle (like real door mirrors). `inner` is the side of the glass
 * (in glass-local x) that faces the car body: +1 for the left mirror, -1 for the
 * right one, 0 for a plain rounded rectangle (rear-view mirror).
 */
export function mirrorShape(w: number, h: number, inner: 1 | -1 | 0): THREE.Shape {
  const hw = w / 2
  const hh = h / 2
  const s = inner || 1
  const r = Math.min(hh * 0.55, 0.045)
  const cut = inner ? Math.min(hh * 0.8, 0.085) : r
  const X = (x: number) => x * s
  const sh = new THREE.Shape()
  sh.moveTo(X(-hw + r * 1.6), -hh)
  sh.lineTo(X(hw - cut), -hh)
  if (inner) sh.lineTo(X(hw), -hh + cut)
  else sh.quadraticCurveTo(X(hw), -hh, X(hw), -hh + r)
  sh.lineTo(X(hw), hh - r)
  sh.quadraticCurveTo(X(hw), hh, X(hw - r), hh)
  sh.lineTo(X(-hw + r * 1.6), hh)
  sh.quadraticCurveTo(X(-hw), hh, X(-hw), hh - r * 1.6)
  sh.lineTo(X(-hw), -hh + r * 1.6)
  sh.quadraticCurveTo(X(-hw), -hh, X(-hw + r * 1.6), -hh)
  return sh
}

/** Scales a shape about its centre (used to build an evenly thick rim around the glass). */
function scaledShape(shape: THREE.Shape, sx: number, sy: number) {
  const pts = shape.getPoints(10).map((p) => new THREE.Vector2(p.x * sx, p.y * sy))
  return new THREE.Shape(pts)
}

/** Slim glossy housing: a thin rim around the glass, plus a shell behind it. */
export function housingGeometries(w: number, h: number, inner: 1 | -1 | 0) {
  const rim = 0.016
  const sx = (w + rim * 2) / w
  const sy = (h + rim * 2) / h
  const base = mirrorShape(w, h, inner)

  const ring = scaledShape(base, sx, sy)
  ring.holes.push(scaledShape(base, 0.985, 0.98))
  const ringGeo = new THREE.ExtrudeGeometry(ring, {
    depth: 0.006,
    bevelEnabled: true,
    bevelSize: 0.006,
    bevelThickness: 0.008,
    bevelSegments: 3,
    curveSegments: 10,
  })
  ringGeo.translate(0, 0, 0.004)

  const shellGeo = new THREE.ExtrudeGeometry(scaledShape(base, sx * 1.01, sy * 1.01), {
    depth: 0.01,
    bevelEnabled: true,
    bevelSize: 0.022,
    bevelThickness: 0.026,
    bevelSegments: 5,
    curveSegments: 10,
  })
  shellGeo.translate(0, 0, -0.05)
  return { ringGeo, shellGeo }
}

const VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uHalf;
  uniform float uM0;
  uniform float uM1;
  uniform float uInner;
  varying vec2 vLocal;

  // Your own car as seen in a door mirror: window glass on top, door panel below,
  // curved edge that widens toward the bottom, belt trim and a handle.
  vec3 ownCar( vec2 q, vec3 col ) {
    float e = uInner > 0.0 ? 1.0 - q.x : q.x;        // distance from the edge nearest the car
    float edge = 0.15 + 0.13 * ( 1.0 - q.y );
    float skin = 1.0 - smoothstep( edge - 0.01, edge + 0.01, e );
    float winEdge = edge - 0.04;
    float above = smoothstep( 0.49, 0.505, q.y );
    float win = skin * above * ( 1.0 - smoothstep( winEdge - 0.008, winEdge + 0.008, e ) );
    vec3 glass = mix( vec3( 0.62, 0.76, 0.88 ), vec3( 0.34, 0.48, 0.64 ), smoothstep( 0.5, 1.0, q.y ) );
    glass += 0.12 * smoothstep( 0.02, 0.0, abs( e - 0.05 ) );
    vec3 paint = vec3( 0.34, 0.035, 0.03 ) * ( 0.7 + 0.6 * q.y );
    paint += vec3( 0.28, 0.12, 0.10 ) * smoothstep( 0.035, 0.0, abs( e - 0.075 ) ) * ( 1.0 - above );
    // black window frame and belt-line trim
    float frame = skin * above * ( smoothstep( winEdge - 0.008, winEdge + 0.008, e ) );
    float belt = skin * smoothstep( 0.012, 0.0, abs( q.y - 0.487 ) );
    // door handle
    float handle = skin * step( 0.045, e ) * step( e, 0.12 ) * step( 0.22, q.y ) * step( q.y, 0.26 );
    vec3 door = paint;
    door = mix( door, glass, win );
    door = mix( door, vec3( 0.02 ), clamp( frame + belt, 0.0, 1.0 ) );
    door = mix( door, vec3( 0.7, 0.72, 0.75 ), handle );
    door *= mix( 1.0, 0.55, smoothstep( edge - 0.05, edge, e ) ); // darker toward the curved edge
    return mix( col, door, skin );
  }

  void main() {
    vec2 p = vLocal / ( 2.0 * uHalf ) + 0.5;
    p.x = 1.0 - p.x;                          // mirror image is flipped left-right
    float rr = length( vLocal / uHalf );
    float m = mix( uM0, uM1, rr * rr );       // convex: more compression toward the edges
    vec3 col = texture2D( tDiffuse, 0.5 + ( p - 0.5 ) * m ).rgb;
    vec2 q = vLocal / ( 2.0 * uHalf ) + 0.5;
    if ( uInner != 0.0 ) col = ownCar( q, col );
    else {
      // rear window pillars / head restraints at the bottom corners of the rear-view mirror
      float c1 = 1.0 - smoothstep( 0.17, 0.21, length( ( q - vec2( 0.03, 0.0 ) ) * vec2( 1.0, 2.6 ) ) );
      float c2 = 1.0 - smoothstep( 0.17, 0.21, length( ( q - vec2( 0.97, 0.0 ) ) * vec2( 1.0, 2.6 ) ) );
      col = mix( col, vec3( 0.025 ), max( c1, c2 ) );
    }
    col *= vec3( 0.93, 0.96, 1.0 );           // faint cool tint of the glass
    col *= mix( 1.0, 0.82, smoothstep( 0.7, 1.15, rr ) );
    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

export interface MirrorGlassOpts {
  w: number
  h: number
  res: [number, number]
  /** how much wider than a flat mirror the rendered view is (1 = flat) */
  wide?: number
  /** centre / edge sampling scale for the convex look (1/wide = flat) */
  m0?: number
  m1?: number
  /** shifts the viewed window (metres, in the mirror plane): +x = toward the outer side for a left mirror */
  shift?: [number, number]
  /** which side of the glass faces your car: +1 right (left mirror), -1 left (right mirror), 0 none */
  inner?: 1 | -1 | 0
}

const _C = new THREE.Vector3()
const _N = new THREE.Vector3()
const _R = new THREE.Vector3()
const _U = new THREE.Vector3()
const _E = new THREE.Vector3()
const _Ev = new THREE.Vector3()
const _X = new THREE.Vector3()
const _Z = new THREE.Vector3()
const _M = new THREE.Matrix4()

/**
 * A planar mirror that renders exactly what the driver's eye would see through the
 * mirror window. The virtual camera sits at the eye's reflection and uses an off-axis
 * frustum through the glass, so the picture is physically correct, view-dependent, and
 * every texel is used (no wasted resolution). Objects on layer 2 (your own car's side)
 * appear in the reflection but not in the driver's direct view.
 */
export class MirrorGlass extends THREE.Mesh {
  readonly rt: THREE.WebGLRenderTarget
  private readonly vcam = new THREE.PerspectiveCamera()
  private readonly half: THREE.Vector2
  private readonly wide: number
  private readonly shift: [number, number]

  constructor(geometry: THREE.BufferGeometry, o: MirrorGlassOpts) {
    const wide = o.wide ?? 1
    const rt = new THREE.WebGLRenderTarget(o.res[0], o.res[1], { samples: 4, type: THREE.HalfFloatType })
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture },
        uHalf: { value: new THREE.Vector2(o.w / 2, o.h / 2) },
        uM0: { value: o.m0 ?? 1 / wide },
        uM1: { value: o.m1 ?? 1 / wide },
        uInner: { value: o.inner ?? 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    super(geometry, material)
    this.rt = rt
    this.half = new THREE.Vector2(o.w / 2, o.h / 2)
    this.wide = wide
    this.shift = o.shift ?? [0, 0]
    this.vcam.layers.enable(2)
    this.onBeforeRender = (renderer, scene, camera) => this.renderView(renderer, scene, camera)
  }

  private renderView(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const mw = this.matrixWorld
    _C.setFromMatrixPosition(mw)
    _N.set(0, 0, 1).transformDirection(mw)
    _R.set(1, 0, 0).transformDirection(mw)
    _U.set(0, 1, 0).transformDirection(mw)
    _E.setFromMatrixPosition(camera.matrixWorld)

    const dist = _E.clone().sub(_C).dot(_N)
    if (dist <= 0.02) return // looking at the back of the mirror

    // eye reflected through the mirror plane
    _Ev.copy(_E).addScaledVector(_N, -2 * dist)

    // virtual camera axes aligned with the glass: x = -R (flipped), y = U, z = -N
    _X.copy(_R).negate()
    _Z.copy(_N).negate()
    _M.makeBasis(_X, _U, _Z)
    const v = this.vcam
    v.position.copy(_Ev)
    v.quaternion.setFromRotationMatrix(_M)
    v.far = (camera as THREE.PerspectiveCamera).far
    v.updateMatrixWorld(true)

    // off-axis frustum through the glass window (scaled by `wide` for the convex look)
    const dx = _C.clone().sub(_Ev)
    const cx = dx.dot(_X) + this.shift[0]
    const cy = dx.dot(_U) + this.shift[1]
    const n = dist * 0.999
    const f = n / dist
    const e = mw.elements
    const sx = Math.hypot(e[0], e[1], e[2])
    const sy = Math.hypot(e[4], e[5], e[6])
    const hw = this.half.x * sx * this.wide
    const hh = this.half.y * sy * this.wide
    v.projectionMatrix.makePerspective((cx - hw) * f, (cx + hw) * f, (cy + hh) * f, (cy - hh) * f, n, v.far)
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert()

    this.visible = false
    const prevRT = renderer.getRenderTarget()
    const prevXr = renderer.xr.enabled
    const prevShadow = renderer.shadowMap.autoUpdate
    renderer.xr.enabled = false
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.rt)
    renderer.state.buffers.depth.setMask(true)
    if (renderer.autoClear === false) renderer.clear()
    renderer.render(scene, v)
    renderer.xr.enabled = prevXr
    renderer.shadowMap.autoUpdate = prevShadow
    renderer.setRenderTarget(prevRT)
    this.visible = true
  }

  dispose() {
    this.rt.dispose()
    ;(this.material as THREE.Material).dispose()
  }
}
