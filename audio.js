/**
 * Web Audio engine for the manual-transmission player.
 * Graph: media element -> lowpass (clutch muffling) -> dry/wet split
 *   wet -> waveshaper (redline overdrive) -> wet gain
 *   dry -> dry gain
 *   both -> master gain -> destination
 *
 * SFX are synthesized so the project needs no binary wav assets.
 * The playGearGrind / playEngineStall / playStarterMotor names stay
 * swap-friendly if you later drop in local .wav or base64 buffers.
 */

const TRACK_ID = "track-player"

let audioContext = null
let mediaSource = null
let lowpass = null
let shaper = null
let dryGain = null
let wetGain = null
let masterGain = null
let sfxGain = null
let objectUrl = null
let graphReady = false

const getTrack = () => document.getElementById(TRACK_ID)

const makeDistortionCurve = (amount) => {
  const samples = 44100
  const curve = new Float32Array(samples)
  const k = amount * 80
  if (k <= 0) {
    for (let i = 0; i < samples; i += 1) {
      curve[i] = (i * 2) / samples - 1
    }
    return curve
  }
  const deg = Math.PI / 180
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

const ensureContext = () => {
  if (audioContext) {
    return audioContext
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  audioContext = new AudioCtx()
  return audioContext
}

const connectGraph = () => {
  if (graphReady) {
    return
  }
  const ctx = ensureContext()
  const track = getTrack()
  mediaSource = ctx.createMediaElementSource(track)

  lowpass = ctx.createBiquadFilter()
  lowpass.type = "lowpass"
  lowpass.frequency.value = 18000
  lowpass.Q.value = 0.7

  shaper = ctx.createWaveShaper()
  shaper.curve = makeDistortionCurve(0)
  shaper.oversample = "4x"

  dryGain = ctx.createGain()
  dryGain.gain.value = 1
  wetGain = ctx.createGain()
  wetGain.gain.value = 0

  masterGain = ctx.createGain()
  masterGain.gain.value = 1

  sfxGain = ctx.createGain()
  sfxGain.gain.value = 0.85

  mediaSource.connect(lowpass)
  lowpass.connect(dryGain)
  lowpass.connect(shaper)
  shaper.connect(wetGain)
  dryGain.connect(masterGain)
  wetGain.connect(masterGain)
  masterGain.connect(ctx.destination)
  sfxGain.connect(ctx.destination)

  graphReady = true
}

export const initAudio = () => {
  const track = getTrack()
  track.preload = "auto"
  track.crossOrigin = "anonymous"
}

export const resumeAudio = async () => {
  const ctx = ensureContext()
  connectGraph()
  if (ctx.state === "suspended") {
    await ctx.resume()
  }
}

export const loadTrackFile = (file) => {
  const track = getTrack()
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
  }
  objectUrl = URL.createObjectURL(file)
  track.src = objectUrl
  track.load()
  connectGraph()
  return file.name
}

export const setClutchMuffle = (amount) => {
  if (!lowpass || !audioContext) {
    return
  }
  const clamped = Math.min(1, Math.max(0, amount))
  const freq = 18000 - clamped * 16500
  lowpass.frequency.setTargetAtTime(freq, audioContext.currentTime, 0.04)
}

export const setRedlineDistortion = (amount) => {
  if (!shaper || !dryGain || !wetGain || !audioContext) {
    return
  }
  const wet = Math.min(1, Math.max(0, amount))
  shaper.curve = makeDistortionCurve(wet)
  dryGain.gain.setTargetAtTime(1 - wet * 0.85, audioContext.currentTime, 0.05)
  wetGain.gain.setTargetAtTime(wet, audioContext.currentTime, 0.05)
}

export const setPlaybackRate = (rate) => {
  const track = getTrack()
  const safe = Math.max(0.05, Math.min(2, rate))
  track.playbackRate = safe
  track.preservesPitch = false
}

export const setMasterGain = (gain) => {
  if (!masterGain || !audioContext) {
    return
  }
  const safe = Math.min(1, Math.max(0, gain))
  masterGain.gain.setTargetAtTime(safe, audioContext.currentTime, 0.03)
}

export const duckMaster = (durationMs = 220) => {
  if (!masterGain || !audioContext) {
    return
  }
  const now = audioContext.currentTime
  masterGain.gain.cancelScheduledValues(now)
  masterGain.gain.setValueAtTime(masterGain.gain.value, now)
  masterGain.gain.linearRampToValueAtTime(0.18, now + 0.04)
  masterGain.gain.linearRampToValueAtTime(1, now + durationMs / 1000)
}

export const play = async () => {
  await resumeAudio()
  const track = getTrack()
  if (!track.src) {
    return false
  }
  try {
    await track.play()
    return true
  } catch (error) {
    return false
  }
}

export const pause = () => {
  getTrack().pause()
}

export const stopAndResetPitch = () => {
  const track = getTrack()
  track.pause()
  track.playbackRate = 1
}

export const getProgress = () => {
  const track = getTrack()
  if (!track.duration || Number.isNaN(track.duration)) {
    return 0
  }
  return track.currentTime / track.duration
}

export const hasTrack = () => Boolean(getTrack().src)
export const isPlaying = () => !getTrack().paused && !getTrack().ended

const noiseBuffer = (ctx, seconds) => {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1
  }
  return buffer
}

const playNoiseBurst = (duration, filterFreq, gainValue) => {
  const ctx = ensureContext()
  connectGraph()
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, duration)
  const filter = ctx.createBiquadFilter()
  filter.type = "bandpass"
  filter.frequency.value = filterFreq
  filter.Q.value = 4
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(gainValue, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(sfxGain)
  src.start()
  src.stop(ctx.currentTime + duration)
}

const playTone = (freq, duration, type, gainValue) => {
  const ctx = ensureContext()
  connectGraph()
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, ctx.currentTime)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(gainValue, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  osc.connect(gain)
  gain.connect(sfxGain)
  osc.start()
  osc.stop(ctx.currentTime + duration)
}

/** Loud metallic grind — swap-in point for gear_grind.wav */
export const playGearGrind = () => {
  resumeAudio()
  playNoiseBurst(0.28, 2400, 0.55)
  playNoiseBurst(0.22, 900, 0.4)
  playTone(180, 0.18, "square", 0.12)
  duckMaster(240)
}

/** Engine sputter / stall — swap-in point for engine_stall.wav */
export const playEngineStall = () => {
  resumeAudio()
  const ctx = ensureContext()
  connectGraph()
  const osc = ctx.createOscillator()
  osc.type = "sawtooth"
  osc.frequency.setValueAtTime(90, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(18, ctx.currentTime + 0.7)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.22, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75)
  osc.connect(gain)
  gain.connect(sfxGain)
  osc.start()
  osc.stop(ctx.currentTime + 0.75)
  playNoiseBurst(0.45, 220, 0.28)
}

/** Starter motor crank — swap-in point for starter_motor.wav */
export const playStarterMotor = () => {
  resumeAudio()
  playNoiseBurst(0.35, 420, 0.42)
  playTone(70, 0.3, "square", 0.1)
  playTone(140, 0.16, "sawtooth", 0.08)
}

export const scratchToStop = async () => {
  const track = getTrack()
  if (track.paused) {
    track.playbackRate = 1
    return
  }
  const start = track.playbackRate || 1
  const steps = 8
  for (let i = 1; i <= steps; i += 1) {
    track.playbackRate = Math.max(0.05, start * (1 - i / steps))
    await new Promise((resolve) => {
      window.setTimeout(resolve, 40)
    })
  }
  track.pause()
  track.playbackRate = 1
}
