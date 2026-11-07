// Tiny synthesized engine / indicator / crash audio (no asset files). Press M to mute.
let ctx: AudioContext | null = null
let engineGain: GainNode
let windGain: GainNode
let osc1: OscillatorNode
let osc2: OscillatorNode
let muted = false
let master: GainNode

export function initAudio() {
  if (ctx) {
    void ctx.resume()
    return
  }
  try {
    ctx = new AudioContext()
  } catch {
    return
  }
  master = ctx.createGain()
  master.gain.value = muted ? 0 : 0.6
  master.connect(ctx.destination)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 420
  engineGain = ctx.createGain()
  engineGain.gain.value = 0
  osc1 = ctx.createOscillator()
  osc1.type = 'sawtooth'
  osc2 = ctx.createOscillator()
  osc2.type = 'square'
  osc1.connect(lp)
  osc2.connect(lp)
  lp.connect(engineGain).connect(master)
  osc1.start()
  osc2.start()

  const len = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource()
  noise.buffer = buf
  noise.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 700
  windGain = ctx.createGain()
  windGain.gain.value = 0
  noise.connect(bp).connect(windGain).connect(master)
  noise.start()
}

export function updateAudio(rpm: number, speed: number, running: boolean) {
  if (!ctx) return
  const t = ctx.currentTime
  const f = (rpm / 60) * 2 // 4-cylinder firing frequency
  osc1.frequency.setTargetAtTime(f, t, 0.05)
  osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05)
  engineGain.gain.setTargetAtTime(running ? 0.05 + (rpm / 8000) * 0.07 : 0, t, 0.1)
  windGain.gain.setTargetAtTime(running ? (speed / 32) * 0.06 : 0, t, 0.2)
}

export function tick() {
  if (!ctx || muted) return
  const t = ctx.currentTime
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.frequency.value = 1800
  g.gain.setValueAtTime(0.12, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.04)
}

export function crashSound() {
  if (!ctx) return
  const t = ctx.currentTime
  const len = Math.floor(ctx.sampleRate * 0.7)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1500
  const g = ctx.createGain()
  g.gain.value = 0.8
  src.connect(lp).connect(g).connect(master)
  src.start(t)
}

export function toggleMute() {
  muted = !muted
  if (ctx) master.gain.value = muted ? 0 : 0.6
}
