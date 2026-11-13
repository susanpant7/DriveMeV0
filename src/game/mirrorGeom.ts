import * as THREE from 'three'
import { quality } from './quality'

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
  const thin = inner === 0 // the rear-view mirror has a slim border
  const rim = thin ? 0.006 : 0.016
  const sx = (w + rim * 2) / w
  const sy = (h + rim * 2) / h
  const base = mirrorShape(w, h, inner)

  const ring = scaledShape(base, sx, sy)
  ring.holes.push(scaledShape(base, 0.985, 0.98))
  const ringGeo = new THREE.ExtrudeGeometry(ring, {
    depth: 0.006,
    bevelEnabled: true,
    bevelSize: thin ? 0.003 : 0.006,
    bevelThickness: thin ? 0.004 : 0.008,
    bevelSegments: 3,
    curveSegments: 10,
  })
  ringGeo.translate(0, 0, 0.004)

  const shellGeo = new THREE.ExtrudeGeometry(scaledShape(base, sx * 1.01, sy * 1.01), {
    depth: 0.01,
    bevelEnabled: true,
    bevelSize: thin ? 0.007 : 0.022,
    bevelThickness: thin ? 0.012 : 0.026,
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
  uniform vec2 uTexel;
  uniform float uM0;
  uniform float uM1;
  uniform float uInner;
  uniform float uOwn;
  varying vec2 vLocal;

  // Your own car as seen in a door mirror: window glass on top, door panel below,
  // curved edge that widens toward the bottom, belt trim and a handle.
  vec3 ownCar( vec2 q, vec3 col ) {
    float e = uInner > 0.0 ? 1.0 - q.x : q.x;        // distance from the edge nearest the car
    float edge = 0.08 + 0.07 * ( 1.0 - q.y );
    float skin = 1.0 - smoothstep( edge - 0.01, edge + 0.01, e );
    float winEdge = edge - 0.022;
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
    vec2 uvm = 0.5 + ( p - 0.5 ) * m;
    vec3 col = texture2D( tDiffuse, uvm ).rgb;
    // a gentle sharpen (unsharp mask against the four neighbours): edges of cars, lane lines and signs read crisply in the glass
    vec3 blur = ( texture2D( tDiffuse, uvm + vec2( uTexel.x, 0.0 ) ).rgb + texture2D( tDiffuse, uvm - vec2( uTexel.x, 0.0 ) ).rgb
                + texture2D( tDiffuse, uvm + vec2( 0.0, uTexel.y ) ).rgb + texture2D( tDiffuse, uvm - vec2( 0.0, uTexel.y ) ).rgb ) * 0.25;
    col = max( col + ( col - blur ) * 0.55, 0.0 );
    vec2 q = vLocal / ( 2.0 * uHalf ) + 0.5;
    if ( uOwn > 0.5 ) col = ownCar( q, col );
    else if ( uInner == 0.0 ) {
      // the inside of the car's rear window: parcel shelf, C-pillars, head restraints and the window frame
      vec3 trim = vec3( 0.045, 0.047, 0.055 );
      float shelf = 1.0 - smoothstep( 0.1, 0.14, q.y + 0.02 * sin( q.x * 6.28 ) );
      float pillarL = 1.0 - smoothstep( 0.0, 0.025, q.x - ( 0.045 + 0.11 * ( 1.0 - q.y ) ) );
      float pillarR = 1.0 - smoothstep( 0.0, 0.025, ( 1.0 - q.x ) - ( 0.045 + 0.11 * ( 1.0 - q.y ) ) );
      float top = smoothstep( 0.9, 0.96, q.y );
      vec2 hl = ( q - vec2( 0.31, 0.2 ) ) * vec2( 1.0, 1.5 );
      vec2 hr = ( q - vec2( 0.69, 0.2 ) ) * vec2( 1.0, 1.5 );
      float rest = 1.0 - smoothstep( 0.075, 0.095, max( length( hl * vec2( 1.0, 1.0 ) ), 0.0 ) );
      rest = 0.0; // clean: no head restraints in the rear-view mirror
      float frame = clamp( max( max( shelf, pillarL ), max( max( pillarR, top * 0.8 ), rest ) ), 0.0, 1.0 );
      col = mix( col, trim, frame );
      // a soft glint along the top of the parcel shelf
      col += 0.05 * smoothstep( 0.02, 0.0, abs( q.y - 0.145 ) ) * shelf;
    }
    col *= vec3( 0.97, 0.985, 1.0 );          // a very faint cool tint of the glass (a clean mirror)
    col *= mix( 1.0, 0.9, smoothstep( 0.8, 1.2, rr ) );
    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    // the same grade as the view through the windows (a little more contrast), so the mirror picture does not look flat
    gl_FragColor.rgb = clamp( ( gl_FragColor.rgb - 0.5 ) * 1.1 + 0.5, 0.0, 1.0 );
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
  /** draw the flat painted overlay of your own car (off: the real 3D body panel is used instead) */
  own?: boolean
  /** refresh only every other frame (the rear-view mirror); side mirrors refresh every frame for a crisp, current picture */
  alt?: boolean
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
const _P = new THREE.Vector3()
const _DB = new THREE.Vector2()

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
  // mirrors refresh on alternate frames (the picture is half a frame old at most): halves the extra scene renders
  private static count = 0
  private readonly phase = MirrorGlass.count++ & 1
  private frame = 0
  private readonly alt: boolean
  private readonly rear: boolean
  private primed = false

  constructor(geometry: THREE.BufferGeometry, o: MirrorGlassOpts) {
    const wide = o.wide ?? 1
    // mipmapped, with anisotropic filtering: a mirror is often much smaller on screen than its picture, and without mipmaps the
    // picture shimmers and looks blocky when it is shrunk onto the glass
    const rt = new THREE.WebGLRenderTarget(o.res[0], o.res[1], {
      samples: 4, type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    })
    rt.texture.anisotropy = 16
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture },
        uHalf: { value: new THREE.Vector2(o.w / 2, o.h / 2) },
        uM0: { value: o.m0 ?? 1 / wide },
        uM1: { value: o.m1 ?? 1 / wide },
        uInner: { value: o.inner ?? 0 },
        uOwn: { value: o.own ? 1 : 0 },
        uTexel: { value: new THREE.Vector2(1 / o.res[0], 1 / o.res[1]) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    super(geometry, material)
    this.rt = rt
    this.alt = !!o.alt
    this.rear = (o.inner ?? 0) === 0
    this.half = new THREE.Vector2(o.w / 2, o.h / 2)
    this.wide = wide
    this.shift = o.shift ?? [0, 0]
    this.vcam.layers.enable(2)
    this.onBeforeRender = (renderer, scene, camera) => this.renderView(renderer, scene, camera)
  }

  private renderView(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.frame++
    const q = quality()
    const alt = this.alt || (this.rear ? q.rearAlt : q.sideAlt) // (on lower graphics levels, mirrors refresh every other frame)
    if (alt && this.primed && (this.frame & 1) !== this.phase) return
    const mw = this.matrixWorld
    _C.setFromMatrixPosition(mw)
    _N.set(0, 0, 1).transformDirection(mw)
    _R.set(1, 0, 0).transformDirection(mw)
    _U.set(0, 1, 0).transformDirection(mw)
    _E.setFromMatrixPosition(camera.matrixWorld)

    const dist = _E.clone().sub(_C).dot(_N)
    if (dist <= 0.02) return // looking at the back of the mirror
    this.fitResolution(renderer, camera)

    // eye reflected through the mirror plane
    _Ev.copy(_E).addScaledVector(_N, -2 * dist)

    // virtual camera axes aligned with the glass: x = -R (flipped), y = U, z = -N
    _X.copy(_R).negate()
    _Z.copy(_N).negate()
    _M.makeBasis(_X, _U, _Z)
    const v = this.vcam
    v.position.copy(_Ev)
    v.quaternion.setFromRotationMatrix(_M)
    v.far = (camera as THREE.PerspectiveCamera).far // the mirror sees as far as you do
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

    this.primed = true
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

  /**
   * Size the mirror's picture to how big the mirror is on screen right now (at the screen's real pixel density), with some headroom:
   * sharp when you look at a mirror and it fills much of the view, and no wasted work when it is small in a corner. Re-checked a few
   * times a second; the picture is only re-allocated when the right size has changed noticeably.
   */
  private fitT = 0
  private fitResolution(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (++this.fitT % 15 !== 1) return
    const db = renderer.getDrawingBufferSize(_DB)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      _P.set(cx * this.half.x, cy * this.half.y, 0).applyMatrix4(this.matrixWorld).project(camera)
      if (_P.z > 1) return // behind the camera: keep what we have
      x0 = Math.min(x0, _P.x); x1 = Math.max(x1, _P.x); y0 = Math.min(y0, _P.y); y1 = Math.max(y1, _P.y)
    }
    const pw = ((x1 - x0) / 2) * db.x, ph = ((y1 - y0) / 2) * db.y // the mirror's size on screen, in pixels
    const aspect = this.half.x / this.half.y
    // twice the on-screen size (supersampled: fine detail stays smooth and sharp), within sensible limits
    const q = quality()
    let w = Math.max(pw, ph * aspect) * q.mirrorScale * this.wide
    w = Math.max(this.minW, Math.min(q.mirrorMax, w))
    const h = w / aspect
    const cur = this.rt.width
    if (Math.abs(w - cur) / cur > 0.18) {
      this.rt.setSize(Math.round(w), Math.round(h))
      ;(this.material as THREE.ShaderMaterial).uniforms.uTexel.value.set(1 / Math.round(w), 1 / Math.round(h))
    }
  }
  private minW = 640

  dispose() {
    this.rt.dispose()
    ;(this.material as THREE.Material).dispose()
  }
}
