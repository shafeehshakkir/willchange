/**
 * Central drivetrain: gamepad gates + clutch/throttle physics
 * become Web Audio playback, stalls, grinds, and redline abuse.
 *
 * Physics model follows transmission_logic.md — virtual RPM + virtualSpeed
 * (playbackRate), gear ratios, clutch disconnect/lock, stall & grind.
 */

import * as audio from "./audio.js"
import {
  describeBindings,
  formatBindingSummary,
  getHardwareDebugSnapshot,
  getListenTarget,
  getTriggerHardware,
  initKeyboardFallback,
  resetBindings,
  setInvertShiftY,
  setShifterStick,
  setTriggerHardware,
  startGamepadLoop,
  startListening,
  stopListening,
} from "./gamepad.js"

/** Gear ratios — lower gears multiply RPM harder vs speed. */
const GEAR_RATIO = {
  N: 0,
  1: 3.5,
  2: 2.0,
  3: 1.4,
  4: 1.0,
  5: 0.8,
  6: 0.6,
}

const IDLE_RPM = 800
const MAX_RPM = 7000
const STALL_RPM = 400
/** Tach face still reads to 8k so redline sits near the painted mark. */
const TACH_MAX_RPM = 8000
/**
 * At virtualSpeed 1.0 in 4th (ratio 1.0) → ~3000 RPM.
 * Target RPM = virtualSpeed * BASE_RPM_PER_SPEED * gearRatio
 */
const BASE_RPM_PER_SPEED = 3000
/** Throttle acceleration scale (× gear ratio) while clutch is locked. */
const ACCEL_FACTOR = 0.24
const COAST_FRICTION = 0.28
const ENGINE_BRAKE = 0.45
const REV_MATCH_JERK = 0.28
const PLAY_SPEED_MIN = 0.1
/** Below this speed, clutch slip still carries the engine (launch). */
const LAUNCH_SPEED = 0.42

const CLUTCH_SHIFT = 0.85
const CLUTCH_OPEN = 0.8
const CLUTCH_LOCK = 0.2
const CRANK_NEED = 5
const CRANK_WINDOW_MS = 2000
const GRIND_COOLDOWN_MS = 350
const RPM_RISE_OPEN = 0.011
const RPM_FALL_OPEN = 0.018
const RPM_LOCK = 0.035
const RPM_SLIP = 0.02

const STATE = {
  OFF: "OFF",
  CRANKING: "CRANKING",
  RUNNING: "RUNNING",
  STALLED: "STALLED",
}

const ui = {}
const rainDrops = []

const car = {
  state: STATE.OFF,
  gear: "N",
  lastGate: "N",
  rpm: 0,
  targetRpm: 0,
  virtualSpeed: 0,
  redlineMs: 0,
  inRedline: false,
  lastClutch: 0,
  grindAt: 0,
  crankPresses: [],
  stalling: false,
  catching: false,
  lastFrame: 0,
  wasLocked: false,
  audioPlayPending: false,
}

const qs = (id) => document.getElementById(id)

const bindUi = () => {
  ui.cabin = qs("cabin")
  ui.trackName = qs("track-name")
  ui.upload = qs("track-upload")
  ui.toggle = qs("radio-toggle")
  ui.rpmReadout = qs("rpm-readout")
  ui.needleArm = qs("tach-needle-arm")
  ui.tachTicks = qs("tach-ticks")
  ui.redlineFlag = qs("redline-flag")
  ui.cluster = document.querySelector(".dash-panel")
  ui.gearLed = qs("gear-led")
  ui.engineState = qs("engine-state")
  ui.clutchFill = qs("clutch-fill")
  ui.throttleFill = qs("throttle-fill")
  ui.clutchValue = qs("clutch-value")
  ui.throttleValue = qs("throttle-value")
  ui.clutchRail = qs("clutch-rail")
  ui.throttleRail = qs("throttle-rail")
  ui.hint = qs("hint")
  ui.knob = qs("h-knob")
  ui.gate = qs("h-gate")
  ui.rain = qs("rain-canvas")
  ui.bindStatus = qs("bind-status")
  ui.bindClutch = qs("bind-clutch")
  ui.bindThrottle = qs("bind-throttle")
  ui.bindShift = qs("bind-shift")
  ui.bindIgnition = qs("bind-ignition")
  ui.bindReset = qs("bind-reset")
  ui.bindStick = qs("bind-stick")
  ui.bindClutchLabel = qs("bind-clutch-label")
  ui.bindThrottleLabel = qs("bind-throttle-label")
  ui.bindIgnitionLabel = qs("bind-ignition-label")
  ui.bindInvertY = qs("bind-invert-y")
  ui.guide = qs("guide-panel")
  ui.guideToggle = qs("guide-toggle")
  ui.guideClose = qs("guide-close")
  ui.guideClutchBind = qs("guide-clutch-bind")
  ui.guideThrottleBind = qs("guide-throttle-bind")
  ui.guideStickBind = qs("guide-stick-bind")
  ui.guideBindingsLine = qs("guide-bindings-line")
  ui.debugPadId = qs("debug-pad-id")
  ui.debugB6 = qs("debug-b6")
  ui.debugB6Pressed = qs("debug-b6-pressed")
  ui.debugB7 = qs("debug-b7")
  ui.debugB7Pressed = qs("debug-b7-pressed")
  ui.debugAxes = qs("debug-axes")
  ui.debugClutch = qs("debug-clutch")
  ui.debugThrottle = qs("debug-throttle")
  ui.debugClutchSource = qs("debug-clutch-source")
  ui.debugClutchIndex = qs("debug-clutch-index")
  ui.debugClutchRange = qs("debug-clutch-range")
  ui.debugClutchApply = qs("debug-clutch-apply")
  ui.debugThrottleSource = qs("debug-throttle-source")
  ui.debugThrottleIndex = qs("debug-throttle-index")
  ui.debugThrottleRange = qs("debug-throttle-range")
  ui.debugThrottleApply = qs("debug-throttle-apply")
}

const fmt3 = (value) => Number(value || 0).toFixed(3)

const syncDebugFormFromHardware = () => {
  const hw = getTriggerHardware()
  if (!ui.debugClutchSource) {
    return
  }
  ui.debugClutchSource.value = hw.clutch.source
  ui.debugClutchIndex.value = String(hw.clutch.index)
  ui.debugClutchRange.value = hw.clutch.range || "minus1to1"
  ui.debugThrottleSource.value = hw.throttle.source
  ui.debugThrottleIndex.value = String(hw.throttle.index)
  ui.debugThrottleRange.value = hw.throttle.range || "minus1to1"
}

const updateGamepadDebugger = () => {
  if (!ui.debugAxes) {
    return
  }
  const snap = getHardwareDebugSnapshot()
  if (!snap.connected) {
    ui.debugPadId.textContent = "No pad connected — press any button"
    ui.debugB6.textContent = "0.000"
    ui.debugB6Pressed.textContent = "pressed: false"
    ui.debugB7.textContent = "0.000"
    ui.debugB7Pressed.textContent = "pressed: false"
    ui.debugAxes.textContent = "[]"
    ui.debugClutch.textContent = "0.000"
    ui.debugThrottle.textContent = "0.000"
    return
  }

  ui.debugPadId.textContent = `${snap.id} · mapping: ${snap.mapping}`
  ui.debugB6.textContent = fmt3(snap.button6Value)
  ui.debugB6Pressed.textContent = `pressed: ${snap.button6Pressed}`
  ui.debugB7.textContent = fmt3(snap.button7Value)
  ui.debugB7Pressed.textContent = `pressed: ${snap.button7Pressed}`
  ui.debugAxes.textContent = snap.axes
    .map((value, index) => `axes[${index}] = ${fmt3(value)}`)
    .join("\n")
  ui.debugClutch.textContent = fmt3(snap.clutchValue)
  ui.debugThrottle.textContent = fmt3(snap.throttleValue)
}

const applyDebugTrigger = (role) => {
  const source = role === "clutch" ? ui.debugClutchSource.value : ui.debugThrottleSource.value
  const index = role === "clutch" ? ui.debugClutchIndex.value : ui.debugThrottleIndex.value
  const range = role === "clutch" ? ui.debugClutchRange.value : ui.debugThrottleRange.value
  setTriggerHardware(role, source, index, range)
  syncBindingLabels()
  syncDebugFormFromHardware()
  lockHint(`${role} mapped to ${source}[${index}] — used everywhere on this page`)
  window.setTimeout(() => {
    unlockHintToBindings()
  }, 2500)
}

const TACH_CX = 120
const TACH_CY = 120
const TACH_START = 180

const drawTachTicks = () => {
  if (!ui.tachTicks) {
    return
  }
  const marks = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  const parts = marks.map((mark) => {
    const t = mark / 8
    const angle = ((TACH_START + t * 180) * Math.PI) / 180
    const inner = mark % 2 === 0 ? 78 : 84
    const outer = 94
    const x1 = TACH_CX + Math.cos(angle) * inner
    const y1 = TACH_CY + Math.sin(angle) * inner
    const x2 = TACH_CX + Math.cos(angle) * outer
    const y2 = TACH_CY + Math.sin(angle) * outer
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor" stroke-width="1.5" />`
  })
  ui.tachTicks.innerHTML = parts.join("")
}

const lockHint = (text) => {
  if (ui.hint) {
    ui.hint.dataset.locked = "1"
    ui.hint.textContent = text
  }
}

const unlockHintToBindings = () => {
  if (ui.hint) {
    delete ui.hint.dataset.locked
  }
  syncBindingLabels()
}

const setHint = (text) => {
  lockHint(text)
}

const stateLabel = () => {
  if (car.state === STATE.OFF) {
    return "Engine off"
  }
  if (car.state === STATE.CRANKING) {
    return "Cranking"
  }
  if (car.state === STATE.STALLED) {
    return "Stalled"
  }
  return "Running"
}

const shakeCabin = () => {
  ui.cabin.classList.remove("shake")
  void ui.cabin.offsetWidth
  ui.cabin.classList.add("shake")
  window.setTimeout(() => {
    ui.cabin.classList.remove("shake")
  }, 300)
}

const handleUpload = (event) => {
  const file = event.target.files?.[0]
  if (!file) {
    return
  }
  const name = audio.loadTrackFile(file)
  ui.trackName.textContent = name.toUpperCase()
  setHint("Tape loaded · mash A (or Space) to crank the starter")
}

const handleRadioToggle = async () => {
  await audio.resumeAudio()
  if (!audio.hasTrack()) {
    setHint("Load an MP3 before you try to start the car")
    return
  }
  if (car.state === STATE.RUNNING) {
    setHint("Manual only — use the clutch and throttle, coward")
    return
  }
  registerCrankPress()
}

const registerCrankPress = async () => {
  if (!audio.hasTrack() || car.stalling) {
    return
  }
  await audio.resumeAudio()
  const now = performance.now()
  if (car.state === STATE.RUNNING) {
    return
  }

  car.state = STATE.CRANKING
  audio.playStarterMotor()
  car.crankPresses = car.crankPresses.filter((t) => now - t < CRANK_WINDOW_MS)
  car.crankPresses.push(now)
  setHint(`Starter · ${car.crankPresses.length}/${CRANK_NEED} cranks`)

  if (car.crankPresses.length >= CRANK_NEED) {
    car.catching = true
    car.redlineMs = 0
    car.virtualSpeed = 0
    car.rpm = IDLE_RPM
    car.targetRpm = IDLE_RPM
    car.wasLocked = false
    audio.setPlaybackRate(0.6)
    audio.setMasterGain(1)
    const started = await audio.play()
    car.catching = false
    if (!started) {
      car.state = STATE.CRANKING
      setHint("Click the cabin once to wake the speakers, then mash A")
      return
    }
    car.state = STATE.RUNNING
    car.crankPresses = []
    audio.pause()
    setHint("Engine caught · clutch in, pick a gear, feed it throttle")
  }
}

const triggerGrind = (now) => {
  if (now - car.grindAt < GRIND_COOLDOWN_MS) {
    return
  }
  car.grindAt = now
  audio.playGearGrind()
  shakeCabin()
}

const handleShift = (input, now) => {
  const gate = input.gearIntent

  if (gate === "N") {
    car.gear = "N"
    car.lastGate = "N"
    return
  }

  if (gate === car.gear) {
    car.lastGate = gate
    return
  }

  // Grinding: reject gear change while clutch is not fully in.
  if (input.clutch >= CLUTCH_SHIFT) {
    car.gear = gate
  } else if (gate !== car.lastGate) {
    triggerGrind(now)
  }

  car.lastGate = gate
}

/** 1 = wheels locked to engine, 0 = fully disconnected. */
const clutchEngagement = (clutch, gear) => {
  if (gear === "N") {
    return 0
  }
  if (clutch >= CLUTCH_OPEN) {
    return 0
  }
  if (clutch <= CLUTCH_LOCK) {
    return 1
  }
  return 1 - (clutch - CLUTCH_LOCK) / (CLUTCH_OPEN - CLUTCH_LOCK)
}

const lockedRpmFromSpeed = (speed, gear) => {
  const ratio = GEAR_RATIO[gear] ?? 0
  if (ratio <= 0) {
    return IDLE_RPM
  }
  return speed * BASE_RPM_PER_SPEED * ratio
}

const detectStall = (clutch) => {
  if (car.state !== STATE.RUNNING || car.gear === "N" || car.stalling) {
    return false
  }
  const engage = clutchEngagement(clutch, car.gear)
  // Only stall when the clutch is essentially locked — mid-slip is allowed to lug.
  return engage > 0.92 && car.rpm < STALL_RPM
}

const beginStall = async () => {
  car.stalling = true
  car.state = STATE.STALLED
  car.crankPresses = []
  car.virtualSpeed = 0
  car.wasLocked = false
  car.audioPlayPending = false
  audio.playEngineStall()
  await audio.scratchToStop()
  audio.setRedlineDistortion(0)
  audio.setClutchMuffle(0)
  car.rpm = 0
  car.targetRpm = 0
  car.redlineMs = 0
  car.inRedline = false
  car.stalling = false
  setHint("Stalled · mash A to grind the starter again")
}

const smoothRpm = (dt, mode) => {
  const delta = car.targetRpm - car.rpm
  let rate = RPM_RISE_OPEN
  if (mode === "lock") {
    rate = RPM_LOCK
  } else if (mode === "slip") {
    rate = RPM_SLIP
  } else if (delta < 0) {
    rate = RPM_FALL_OPEN
  }
  const step = 1 - Math.exp(-rate * Math.max(1, dt))
  car.rpm += delta * step
  if (Math.abs(car.targetRpm - car.rpm) < 6) {
    car.rpm = car.targetRpm
  }
  car.rpm = Math.max(0, Math.min(MAX_RPM, car.rpm))
}

/**
 * Manual transmission physics each frame (transmission_logic.md).
 * virtualSpeed → MP3 playbackRate; RPM from throttle (open) or speed×ratio (locked).
 */
const driveDrivetrain = (input, dt) => {
  const dtSec = Math.max(0.001, Math.min(0.05, dt / 1000))

  if (car.state !== STATE.RUNNING) {
    audio.pause()
    audio.setPlaybackRate(1)
    audio.setClutchMuffle(0)
    audio.setRedlineDistortion(0)
    car.virtualSpeed = 0
    car.targetRpm = car.state === STATE.CRANKING ? 450 : 0
    car.inRedline = false
    car.wasLocked = false
    car.audioPlayPending = false
    return
  }

  const clutch = input.clutch
  const throttle = input.throttle
  const gear = car.gear
  const ratio = GEAR_RATIO[gear] ?? 0
  const engage = clutchEngagement(clutch, gear)
  const openRpm = IDLE_RPM + throttle * (MAX_RPM - IDLE_RPM)
  const launching = gear !== "N" && car.virtualSpeed < LAUNCH_SPEED

  audio.setClutchMuffle(clutch)

  // --- Speed ---
  let speed = car.virtualSpeed
  const redlining = car.rpm >= MAX_RPM - 20

  if (engage > 0.02 && ratio > 0) {
    if (throttle > 0.04 && !redlining) {
      // Slip still transfers torque — needed so launches don't freeze at 0 speed.
      const slipBoost = launching ? 0.55 + (1 - engage) * 0.35 : 1
      speed += throttle * ratio * ACCEL_FACTOR * Math.max(engage, launching ? 0.2 : engage) * slipBoost * dtSec
    } else if (engage > 0.5) {
      const brake = ENGINE_BRAKE * engage * Math.max(0.15, ratio) * (1 - throttle)
      speed = Math.max(0, speed - brake * dtSec * Math.max(speed, 0.15))
    }

    // Rev-match jerk on upshifts while moving — not on a standing launch.
    const justLocked = engage > 0.85 && !car.wasLocked
    if (justLocked && speed > 0.12) {
      const expected = lockedRpmFromSpeed(speed, gear)
      const mismatch = Math.min(1, Math.abs(car.rpm - expected) / MAX_RPM)
      if (mismatch > 0.12) {
        speed *= 1 - mismatch * REV_MATCH_JERK
        shakeCabin()
      }
    }
  } else {
    speed = Math.max(0, speed - COAST_FRICTION * dtSec * Math.max(speed, 0.08))
  }

  car.virtualSpeed = Math.max(0, Math.min(2.2, speed))
  car.wasLocked = engage > 0.85

  // --- RPM target ---
  const wheelRpm = lockedRpmFromSpeed(car.virtualSpeed, gear)
  if (engage <= 0.001 || gear === "N") {
    car.targetRpm = openRpm
  } else if (launching && throttle > 0.12) {
    // Clutch slip / launch: throttle keeps the engine alive while speed catches up.
    // Full wheel-lock would yank RPM to ~0 and freeze/stall the takeoff.
    const load = engage * (0.25 + car.virtualSpeed / LAUNCH_SPEED * 0.55)
    const floor = IDLE_RPM + throttle * 2200
    car.targetRpm = openRpm * (1 - load) + Math.max(wheelRpm, floor) * load
    car.targetRpm = Math.max(floor * 0.85, Math.min(MAX_RPM, car.targetRpm))
  } else if (engage >= 0.95) {
    car.targetRpm = Math.max(0, Math.min(MAX_RPM, wheelRpm))
  } else {
    car.targetRpm = openRpm * (1 - engage) + wheelRpm * engage
    car.targetRpm = Math.max(0, Math.min(MAX_RPM, car.targetRpm))
  }

  car.inRedline = car.rpm >= MAX_RPM - 80
  if (car.inRedline) {
    car.redlineMs += dt
    audio.setRedlineDistortion(Math.min(1, 0.35 + car.redlineMs / 2000))
  } else {
    car.redlineMs = Math.max(0, car.redlineMs - dt * 1.5)
    audio.setRedlineDistortion(Math.min(0.15, car.redlineMs / 2500))
  }

  // --- Song follows virtualSpeed ---
  if (car.virtualSpeed > PLAY_SPEED_MIN) {
    audio.setPlaybackRate(Math.max(PLAY_SPEED_MIN, Math.min(2, car.virtualSpeed)))
    if (!audio.isPlaying() && !car.audioPlayPending) {
      car.audioPlayPending = true
      audio.play().finally(() => {
        car.audioPlayPending = false
      })
    }
  } else {
    audio.pause()
    audio.setPlaybackRate(1)
    car.audioPlayPending = false
  }
}

const updateTach = () => {
  const rpm = Math.max(0, Math.min(TACH_MAX_RPM, car.rpm))
  const t = rpm / TACH_MAX_RPM
  const angle = TACH_START + t * 180
  ui.needleArm.setAttribute("transform", `rotate(${angle} ${TACH_CX} ${TACH_CY})`)
  ui.rpmReadout.textContent = String(Math.round(rpm)).padStart(4, "0")
  ui.cluster.classList.toggle("redline-active", car.inRedline)
}

const updatePedals = (input) => {
  // Direct 1:1 with analog pressure — no CSS lag.
  const clutchPct = Math.round(input.clutch * 100)
  const throttlePct = Math.round(input.throttle * 100)
  ui.clutchFill.style.height = `${clutchPct}%`
  ui.throttleFill.style.height = `${throttlePct}%`
  ui.clutchValue.textContent = `${clutchPct}%`
  ui.throttleValue.textContent = `${throttlePct}%`
  ui.clutchRail.setAttribute("aria-valuenow", String(clutchPct))
  ui.throttleRail.setAttribute("aria-valuenow", String(throttlePct))
}

const updateKnob = (x, y, gear, intent) => {
  // Match CSS rail centers: left/mid/right verticals + horizontal crossbar.
  const railX = 39.5
  const railY = 38
  const left = 50 + (Math.max(-1, Math.min(1, x)) / 0.85) * railX
  const top = 50 + (Math.max(-1, Math.min(1, y)) / 0.85) * railY
  ui.knob.style.left = `${left}%`
  ui.knob.style.top = `${top}%`
  ui.gate.querySelectorAll("[data-gate]").forEach((label) => {
    const gate = label.dataset.gate
    label.classList.toggle("is-active", gate === gear)
    label.classList.toggle("is-near", gate === intent && intent !== gear && intent !== "N")
  })
}

const updateChrome = (input) => {
  ui.gearLed.textContent = car.gear
  ui.engineState.textContent = stateLabel()
  ui.toggle.textContent = car.state === STATE.RUNNING ? "ON" : "CRANK"
  updateTach()
  updatePedals(input)
  updateKnob(input.x, input.y, car.gear, input.gearIntent)

  // Clear the post-start lock so live driving hints can show.
  if (car.state === STATE.RUNNING && ui.hint?.dataset.locked === "1") {
    const lockedText = ui.hint.textContent || ""
    if (lockedText.includes("Engine caught") || car.inRedline) {
      delete ui.hint.dataset.locked
    }
  }
  if (car.state === STATE.RUNNING && ui.hint && !ui.hint.dataset.locked) {
    if (car.inRedline || car.rpm > MAX_RPM - 900) {
      ui.hint.textContent = "Redline · clutch in and shift up"
    } else if (car.gear !== "N" && car.virtualSpeed > PLAY_SPEED_MIN) {
      ui.hint.textContent = `Gear ${car.gear} · speed ${car.virtualSpeed.toFixed(2)}×`
    }
  }
}

const syncBindingLabels = () => {
  const info = describeBindings()
  const summary = info.summary || formatBindingSummary()

  ui.bindClutchLabel.textContent = info.clutch
  ui.bindThrottleLabel.textContent = info.throttle
  ui.bindIgnitionLabel.textContent = info.ignition
  ui.bindStick.value = info.shifterStick
  ui.bindInvertY.checked = info.invertShiftY

  if (ui.guideClutchBind) {
    ui.guideClutchBind.textContent = `${info.clutch} = clutch`
  }
  if (ui.guideThrottleBind) {
    ui.guideThrottleBind.textContent = `${info.throttle} = throttle`
  }
  if (ui.guideStickBind) {
    ui.guideStickBind.textContent = summary.stick
  }
  if (ui.guideBindingsLine) {
    ui.guideBindingsLine.textContent = `Current map: ${summary.line}`
  }

  const listening = getListenTarget()
  const buttons = {
    clutch: ui.bindClutch,
    throttle: ui.bindThrottle,
    shift: ui.bindShift,
    ignition: ui.bindIgnition,
  }
  Object.entries(buttons).forEach(([key, button]) => {
    const active = listening === key
    button.classList.toggle("is-listening", active)
    button.textContent = active ? "Waiting" : "Listen"
  })
  if (listening) {
    ui.bindStatus.textContent = `Press ${listening} on the pad`
    return
  }
  ui.bindStatus.textContent = summary.line
  // Keep the footer hint aligned with the live map unless a temporary status is more useful.
  if (ui.hint && !ui.hint.dataset.locked) {
    ui.hint.textContent = summary.line
  }
}

const handleBindListen = (target) => {
  const current = getListenTarget()
  if (current === target) {
    stopListening()
    syncBindingLabels()
    return
  }
  startListening(target, () => {
    syncBindingLabels()
    syncDebugFormFromHardware()
    lockHint("Binding saved — pedals, shifter, and hints now use this map")
    window.setTimeout(() => {
      unlockHintToBindings()
    }, 2500)
  })
  syncBindingLabels()
}

const initRain = () => {
  const canvas = ui.rain
  const ctx = canvas.getContext("2d")
  const resize = () => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  resize()
  window.addEventListener("resize", resize)

  for (let i = 0; i < 140; i += 1) {
    rainDrops.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      len: 10 + Math.random() * 18,
      speed: 8 + Math.random() * 14,
    })
  }

  const drawRain = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "rgba(180, 200, 220, 0.22)"
    ctx.lineWidth = 1
    for (const drop of rainDrops) {
      ctx.beginPath()
      ctx.moveTo(drop.x, drop.y)
      ctx.lineTo(drop.x + 2, drop.y + drop.len)
      ctx.stroke()
      drop.y += drop.speed
      drop.x += 0.8
      if (drop.y > canvas.height) {
        drop.y = -20
        drop.x = Math.random() * canvas.width
      }
    }
    window.requestAnimationFrame(drawRain)
  }
  window.requestAnimationFrame(drawRain)
}

const expireCrank = (now) => {
  if (car.state !== STATE.CRANKING || car.catching) {
    return
  }
  car.crankPresses = car.crankPresses.filter((t) => now - t < CRANK_WINDOW_MS)
  if (car.crankPresses.length === 0) {
    car.state = audio.hasTrack() ? STATE.STALLED : STATE.OFF
    setHint("Starter died · mash A faster")
  }
}

const setGuideOpen = (open) => {
  if (!ui.guide) {
    return
  }
  ui.guide.classList.toggle("is-open", open)
  ui.guide.setAttribute("aria-hidden", open ? "false" : "true")
  if (ui.guideToggle) {
    ui.guideToggle.setAttribute("aria-expanded", open ? "true" : "false")
  }
}

const tick = (input, timestamp) => {
  const dt = car.lastFrame ? timestamp - car.lastFrame : 16
  car.lastFrame = timestamp

  if (input.aEdge) {
    registerCrankPress()
  }

  expireCrank(timestamp)
  handleShift(input, timestamp)

  if (car.stalling) {
    car.targetRpm = 0
    smoothRpm(dt, "open")
    car.lastClutch = input.clutch
    updateChrome(input)
    updateGamepadDebugger()
    return
  }

  driveDrivetrain(input, dt)
  const engage = clutchEngagement(input.clutch, car.gear)
  const launching = car.gear !== "N" && car.virtualSpeed < LAUNCH_SPEED
  let rpmMode = "open"
  if (engage > 0.95 && !launching) {
    rpmMode = "lock"
  } else if (engage > 0.05 && car.gear !== "N") {
    rpmMode = "slip"
  }
  smoothRpm(dt, rpmMode)
  car.lastClutch = input.clutch

  if (detectStall(input.clutch)) {
    beginStall()
  }

  updateChrome(input)
  updateGamepadDebugger()
}

const handleUploadKey = (event) => {
  if (event.code === "Enter" || event.code === "Space") {
    event.preventDefault()
    ui.upload.click()
  }
}

const boot = () => {
  bindUi()
  audio.initAudio()
  initKeyboardFallback()
  initRain()

  drawTachTicks()
  syncBindingLabels()
  syncDebugFormFromHardware()

  ui.upload.addEventListener("change", handleUpload)
  ui.toggle.addEventListener("click", handleRadioToggle)
  ui.toggle.addEventListener("keydown", (event) => {
    if (event.code === "Enter") {
      handleRadioToggle()
    }
  })
  document.querySelector('label[for="track-upload"]').addEventListener("keydown", handleUploadKey)
  window.addEventListener(
    "pointerdown",
    () => {
      audio.resumeAudio()
    },
    { once: false }
  )

  ui.bindClutch.addEventListener("click", () => handleBindListen("clutch"))
  ui.bindThrottle.addEventListener("click", () => handleBindListen("throttle"))
  ui.bindShift.addEventListener("click", () => handleBindListen("shift"))
  ui.bindIgnition.addEventListener("click", () => handleBindListen("ignition"))
  ui.bindReset.addEventListener("click", () => {
    stopListening()
    resetBindings()
    syncBindingLabels()
    syncDebugFormFromHardware()
    unlockHintToBindings()
  })
  ui.bindStick.addEventListener("change", (event) => {
    setShifterStick(event.target.value)
    syncBindingLabels()
  })
  ui.bindInvertY.addEventListener("change", (event) => {
    setInvertShiftY(event.target.checked)
    syncBindingLabels()
  })

  if (ui.debugClutchApply) {
    ui.debugClutchApply.addEventListener("click", () => applyDebugTrigger("clutch"))
  }
  if (ui.debugThrottleApply) {
    ui.debugThrottleApply.addEventListener("click", () => applyDebugTrigger("throttle"))
  }

  if (ui.guideToggle) {
    ui.guideToggle.addEventListener("click", () => {
      setGuideOpen(!ui.guide.classList.contains("is-open"))
    })
  }
  if (ui.guideClose) {
    ui.guideClose.addEventListener("click", () => setGuideOpen(false))
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setGuideOpen(false)
    }
    if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
      setGuideOpen(!ui.guide.classList.contains("is-open"))
    }
  })

  startGamepadLoop(tick)
}

boot()
