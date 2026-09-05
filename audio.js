/**
 * Web Audio engine for the manual-transmission player.
 * Graph: media element -> mediaGate -> lowpass (clutch muffling) -> dry/wet split
 *   wet -> waveshaper (redline overdrive) -> wet gain
 *   dry -> dry gain
 *   both -> master gain -> destination
 * Reverse gear uses a reversed AudioBuffer into bufferGate -> lowpass
 * (Chromium cannot use negative HTMLMediaElement.playbackRate).
 *
 * SFX are synthesized so the project needs no binary wav assets.
 * The playGearGrind / playEngineStall / playStarterMotor names stay
 * swap-friendly if you later drop in local .wav or base64 buffers.
 */

const TRACK_ID = "track-player"

let audioContext = null
let mediaSource = null
let mediaGate = null
let bufferGate = null
let lowpass = null
let shaper = null
let dryGain = null
let wetGain = null
let masterGain = null
let sfxGain = null
let objectUrl = null
let graphReady = false
let lastClutchMuffle = -1
let lastRedlineWet = -1
let lastPlaybackRate = 1
const distortionCurveCache = new Map()

let decodedBuffer = null
let reversedBuffer = null
let activeBufferSource = null
let reverseMode = false
let bufferPlaying = false
let bufferRate = 1
let bufferAnchorMediaTime = 0
let bufferAnchorCtxTime = 0
let decodeGeneration = 0

/** Chromium rejects rates below ~0.0625 — keep a safe floor. */
const MIN_PLAYBACK_RATE = 0.1
const MAX_PLAYBACK_RATE = 2

const getTrack = () => document.getElementById(TRACK_ID)

const makeDistortionCurve = (amount) => {
  const samples = 2048
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

const getDistortionCurve = (amount) => {
  const key = Math.round(amount * 20) / 20
  let curve = distortionCurveCache.get(key)
  if (!curve) {
    curve = makeDistortionCurve(key)
    distortionCurveCache.set(key, curve)
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

  mediaGate = ctx.createGain()
  mediaGate.gain.value = 1
  bufferGate = ctx.createGain()
  bufferGate.gain.value = 0

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

  mediaSource.connect(mediaGate)
  mediaGate.connect(lowpass)
  bufferGate.connect(lowpass)
  lowpass.connect(dryGain)
  lowpass.connect(shaper)
  shaper.connect(wetGain)
  dryGain.connect(masterGain)
  wetGain.connect(masterGain)
  masterGain.connect(ctx.destination)
  sfxGain.connect(ctx.destination)

  graphReady = true
}

const buildReversedBuffer = (buffer) => {
  const ctx = ensureContext()
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const src = buffer.getChannelData(channel)
    const dst = reversed.getChannelData(channel)
    for (let i = 0, j = src.length - 1; i < src.length; i += 1, j -= 1) {
      dst[i] = src[j]
    }
  }
  return reversed
}

const ensureReversedBuffer = () => {
  if (reversedBuffer) {
    return reversedBuffer
  }
  if (!decodedBuffer) {
    return null
  }
  reversedBuffer = buildReversedBuffer(decodedBuffer)
  return reversedBuffer
}

const clampTime = (time, duration) => Math.min(duration, Math.max(0, time))

const getMediaTimelinePos = () => {
  const track = getTrack()
  const duration = decodedBuffer?.duration || track.duration || 0
  if (reverseMode && bufferPlaying && audioContext) {
    const elapsed = (audioContext.currentTime - bufferAnchorCtxTime) * bufferRate
    return clampTime(bufferAnchorMediaTime - elapsed, duration)
  }
  return track.currentTime || 0
}

const stopBufferPlayback = () => {
  if (activeBufferSource) {
    try {
      activeBufferSource.onended = null
      activeBufferSource.stop()
    } catch (error) {
      /* already stopped */
    }
    try {
      activeBufferSource.disconnect()
    } catch (error) {
      /* ignore */
    }
    activeBufferSource = null
  }
  bufferPlaying = false
  if (bufferGate) {
    bufferGate.gain.value = 0
  }
}

const startReverseAt = (mediaTime, rate) => {
  const ctx = ensureContext()
  connectGraph()
  const reversed = ensureReversedBuffer()
  if (!reversed) {
    return false
  }

  stopBufferPlayback()
  const track = getTrack()
  track.pause()
  mediaGate.gain.value = 0
  bufferGate.gain.value = 1

  const safeRate = Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, rate || 1))
  const offset = clampTime(reversed.duration - mediaTime, reversed.duration)
  activeBufferSource = ctx.createBufferSource()
  activeBufferSource.buffer = reversed
  activeBufferSource.playbackRate.value = safeRate
  activeBufferSource.connect(bufferGate)
  bufferAnchorMediaTime = clampTime(mediaTime, reversed.duration)
  bufferAnchorCtxTime = ctx.currentTime
  bufferRate = safeRate
  activeBufferSource.onended = () => {
    bufferPlaying = false
  }
  try {
    activeBufferSource.start(0, offset)
    bufferPlaying = true
    return true
  } catch (error) {
    bufferPlaying = false
    return false
  }
}

const decodeTrackBuffer = async (file, generation) => {
  try {
    const ctx = ensureContext()
    const arrayBuffer = await file.arrayBuffer()
    if (generation !== decodeGeneration) {
      return
    }
    decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    reversedBuffer = null
  } catch (error) {
    if (generation === decodeGeneration) {
      decodedBuffer = null
      reversedBuffer = null
    }
  }
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
  stopBufferPlayback()
  reverseMode = false
  if (mediaGate) {
    mediaGate.gain.value = 1
  }
  decodedBuffer = null
  reversedBuffer = null
  decodeGeneration += 1
  const generation = decodeGeneration

  objectUrl = URL.createObjectURL(file)
  track.src = objectUrl
  track.load()
  connectGraph()
  decodeTrackBuffer(file, generation)
  return file.name
}

export const setClutchMuffle = (amount) => {
  if (!lowpass || !audioContext) {
    return
  }
  const clamped = Math.min(1, Math.max(0, amount))
  if (Math.abs(clamped - lastClutchMuffle) < 0.01) {
    return
  }
  lastClutchMuffle = clamped
  const freq = 18000 - clamped * 16500
  lowpass.frequency.setTargetAtTime(freq, audioContext.currentTime, 0.04)
}

export const setRedlineDistortion = (amount) => {
  if (!shaper || !dryGain || !wetGain || !audioContext) {
    return
  }
  const wet = Math.min(1, Math.max(0, amount))
  if (Math.abs(wet - lastRedlineWet) < 0.03) {
    return
  }
  lastRedlineWet = wet
  shaper.curve = getDistortionCurve(wet)
  dryGain.gain.setTargetAtTime(1 - wet * 0.85, audioContext.currentTime, 0.05)
  wetGain.gain.setTargetAtTime(wet, audioContext.currentTime, 0.05)
}

export const setPlaybackReverse = (wantReverse) => {
  connectGraph()
  const next = Boolean(wantReverse)
  if (next === reverseMode) {
    return
  }

  const pos = getMediaTimelinePos()
  if (next) {
    reverseMode = true
    const rate = Math.abs(lastPlaybackRate) >= MIN_PLAYBACK_RATE ? Math.abs(lastPlaybackRate) : 1
    if (!startReverseAt(pos, rate)) {
      getTrack().currentTime = pos
    }
    return
  }

  reverseMode = false
  stopBufferPlayback()
  if (mediaGate) {
    mediaGate.gain.value = 1
  }
  const track = getTrack()
  try {
    track.currentTime = pos
  } catch (error) {
    /* ignore */
  }
}

export const isPlaybackReverse = () => reverseMode

export const setPlaybackRate = (rate) => {
  const track = getTrack()
  if (!track) {
    return
  }
  const safe = Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Math.abs(Number(rate) || 1)))
  if (Math.abs(safe - Math.abs(lastPlaybackRate)) < 0.004 && !(reverseMode && bufferPlaying)) {
    lastPlaybackRate = safe
    return
  }
  lastPlaybackRate = safe

  if (reverseMode) {
    if (activeBufferSource && bufferPlaying && audioContext) {
      const pos = getMediaTimelinePos()
      activeBufferSource.playbackRate.value = safe
      bufferAnchorMediaTime = pos
      bufferAnchorCtxTime = audioContext.currentTime
      bufferRate = safe
    }
    return
  }

  try {
    track.playbackRate = safe
    track.preservesPitch = false
  } catch (error) {
    try {
      track.playbackRate = 1
      lastPlaybackRate = 1
    } catch (fallbackError) {
      lastPlaybackRate = 1
    }
  }
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

  if (reverseMode) {
    if (bufferPlaying) {
      return true
    }
    const pos = getMediaTimelinePos()
    const rate = Math.abs(lastPlaybackRate) >= MIN_PLAYBACK_RATE ? Math.abs(lastPlaybackRate) : 1
    return startReverseAt(pos, rate)
  }

  try {
    if (mediaGate) {
      mediaGate.gain.value = 1
    }
    await track.play()
    return true
  } catch (error) {
    return false
  }
}

export const pause = () => {
  if (reverseMode) {
    const pos = getMediaTimelinePos()
    stopBufferPlayback()
    const track = getTrack()
    try {
      track.currentTime = pos
    } catch (error) {
      /* ignore */
    }
    return
  }
  getTrack().pause()
}

export const stopAndResetPitch = () => {
  const track = getTrack()
  if (reverseMode) {
    reverseMode = false
    stopBufferPlayback()
    if (mediaGate) {
      mediaGate.gain.value = 1
    }
  }
  track.pause()
  track.playbackRate = 1
  lastPlaybackRate = 1
}

export const getProgress = () => {
  const track = getTrack()
  const duration = decodedBuffer?.duration || track.duration
  if (!duration || Number.isNaN(duration)) {
    return 0
  }
  return getMediaTimelinePos() / duration
}

export const hasTrack = () => Boolean(getTrack().src)

export const isPlaying = () => {
  if (reverseMode) {
    return bufferPlaying
  }
  const track = getTrack()
  return !track.paused && !track.ended
}

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
  if (reverseMode) {
    pause()
    reverseMode = false
    if (mediaGate) {
      mediaGate.gain.value = 1
    }
    lastPlaybackRate = 1
    return
  }

  const track = getTrack()
  if (track.paused) {
    track.playbackRate = 1
    lastPlaybackRate = 1
    return
  }
  const start = track.playbackRate || 1
  const steps = 8
  for (let i = 1; i <= steps; i += 1) {
    const next = Math.max(MIN_PLAYBACK_RATE, start * (1 - i / steps))
    try {
      track.playbackRate = next
      lastPlaybackRate = next
    } catch (error) {
      break
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 40)
    })
  }
  track.pause()
  try {
    track.playbackRate = 1
  } catch (error) {
    /* ignore */
  }
  lastPlaybackRate = 1
}
