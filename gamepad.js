/**
 * HTML5 Gamepad poller for an Xbox-style XInput pad
 * (Ant Esports GP365 Pro and similar).
 *
 * ---------------------------------------------------------------------------
 * LINUX TRIGGER MAP — edit these after watching the Gamepad Debugger overlay.
 * On Linux, LT/RT often arrive as axes (smooth floats) while buttons[6]/[7]
 * are digital 0/1 only. Pull the triggers in the debugger, then swap below.
 *
 * Examples that often work on Linux Chrome/Firefox:
 *   clutch:   { source: "axis", index: 2, range: "minus1to1" }
 *   throttle: { source: "axis", index: 5, range: "minus1to1" }
 *   clutch:   { source: "axis", index: 3, range: "zeroToOne" }
 *   throttle: { source: "axis", index: 4, range: "zeroToOne" }
 * Windows XInput default:
 *   clutch:   { source: "button", index: 6, range: "zeroToOne" }
 *   throttle: { source: "button", index: 7, range: "zeroToOne" }
 * ---------------------------------------------------------------------------
 */

export const TRIGGER_HARDWARE = {
  // Linux GP365 defaults that give smooth analog pedals.
  clutch: { source: "axis", index: 2, range: "minus1to1" },
  throttle: { source: "axis", index: 5, range: "minus1to1" },
}

const NEUTRAL_RADIUS = 0.22
const KEY_RAMP = 0.12
const STORAGE_KEY = "nightdrive-bindings-v6"
const TRIGGER_STORAGE_KEY = "nightdrive-trigger-hardware-v5"

/** Ideal stick targets for each H-gate (Y-up is negative on XInput). */
export const GATE_X = 0.85
export const GATE_Y = 0.85
/** How far into a vertical rail before a gear engages (else Neutral on the crossbar). */
const GATE_THROW = 0.3
const LANE_XS = [-GATE_X, 0, GATE_X]
const JUNCTION_EPS = 0.07
const STICK_DEADZONE = 0.22
/** Knob travel speed along rails at full stick (units / second). */
const H_MOVE_SPEED = 5.2
const H_KEY_SPEED = 9

export const GATE_TARGETS = {
  N: { x: 0, y: 0 },
  1: { x: -GATE_X, y: -GATE_Y },
  2: { x: -GATE_X, y: GATE_Y },
  3: { x: 0, y: -GATE_Y },
  4: { x: 0, y: GATE_Y },
  5: { x: GATE_X, y: -GATE_Y },
  6: { x: GATE_X, y: GATE_Y },
}

/** Live knob position — always on the H pathway (never free 2D). */
let knobX = 0
let knobY = 0
let lastPollAt = 0

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const moveToward = (value, target, step) => {
  if (Math.abs(target - value) <= step) {
    return target
  }
  return value + Math.sign(target - value) * step
}

const nearestLaneX = (x) => {
  let best = 0
  let bestDist = Infinity
  for (const lane of LANE_XS) {
    const dist = Math.abs(x - lane)
    if (dist < bestDist) {
      bestDist = dist
      best = lane
    }
  }
  return best
}

const applyStickDeadzone = (value) => (Math.abs(value) < STICK_DEADZONE ? 0 : value)

/**
 * Gated H-pattern: knob only moves along the current rail.
 * Vertical slots only move vertically; crossbar only horizontally.
 * Enter/leave a slot only at the junction (y ≈ 0 on a lane).
 * This prevents jumping 1 → 3 without traveling the pathway.
 */
export const advanceHKnobFromStick = (stickX, stickY, dtSec) => {
  const sx = applyStickDeadzone(stickX)
  const sy = applyStickDeadzone(stickY)
  if (sx === 0 && sy === 0) {
    // Stick centered — latch knob where it is (gamepads spring to center).
    return { x: knobX, y: knobY }
  }

  const step = H_MOVE_SPEED * Math.max(0.001, dtSec)

  if (Math.abs(knobY) > JUNCTION_EPS) {
    // Locked in a vertical gate — only slide along that lane.
    knobX = nearestLaneX(knobX)
    const nextY = knobY + sy * step
    // Crossing the crossbar always stops at Neutral on this lane.
    if (sy !== 0 && (Math.sign(knobY) !== Math.sign(nextY) || Math.abs(nextY) <= JUNCTION_EPS)) {
      knobY = 0
    } else {
      knobY = clamp(nextY, -GATE_Y, GATE_Y)
    }
  } else {
    // On the horizontal crossbar.
    knobY = 0
    // Prefer left/right lane changes when the stick has a horizontal bias,
    // so you can leave a gate and slide to the next without re-entering.
    const wantLaneChange = Math.abs(sx) > 0 && Math.abs(sx) >= Math.abs(sy) * 0.75
    if (wantLaneChange) {
      knobX = clamp(knobX + sx * step, -GATE_X, GATE_X)
    } else if (Math.abs(sy) > 0) {
      const lane = nearestLaneX(knobX)
      if (Math.abs(knobX - lane) <= JUNCTION_EPS) {
        knobX = lane
        knobY = clamp(sy * step, -GATE_Y, GATE_Y)
      } else {
        // Drift onto the nearest lane before entering a vertical gate.
        knobX = moveToward(knobX, lane, step)
      }
    }
  }

  return { x: knobX, y: knobY }
}

/**
 * Move knob toward a target along the H pathway only (for keyboard gears).
 */
export const advanceHKnobToward = (targetX, targetY, dtSec) => {
  const step = H_KEY_SPEED * Math.max(0.001, dtSec)
  const sameLane = Math.abs(knobX - targetX) <= JUNCTION_EPS

  if (Math.abs(knobY) > JUNCTION_EPS) {
    knobX = nearestLaneX(knobX)
    if (!sameLane || Math.sign(knobY) !== Math.sign(targetY) && Math.abs(targetY) > JUNCTION_EPS) {
      // Leave current gate to the crossbar before changing lanes.
      knobY = moveToward(knobY, 0, step)
      if (Math.abs(knobY) <= JUNCTION_EPS) {
        knobY = 0
      }
      return { x: knobX, y: knobY }
    }
    knobY = moveToward(knobY, targetY, step)
    return { x: knobX, y: knobY }
  }

  knobY = 0
  if (Math.abs(knobX - targetX) > JUNCTION_EPS) {
    knobX = moveToward(knobX, targetX, step)
    return { x: knobX, y: knobY }
  }

  knobX = targetX
  knobY = moveToward(knobY, targetY, step)
  return { x: knobX, y: knobY }
}

/** Snap helper kept for any UI that still wants nearest-rail projection. */
export const projectOntoHPattern = (x, y) => {
  // Prefer current pathway rules: if already near a rail, stay gated.
  if (Math.abs(y) > JUNCTION_EPS) {
    return { x: nearestLaneX(x), y: clamp(y, -GATE_Y, GATE_Y) }
  }
  return { x: clamp(x, -GATE_X, GATE_X), y: 0 }
}

export const DEFAULT_BINDINGS = {
  clutch: { type: "axis", index: 2 },
  throttle: { type: "axis", index: 5 },
  // Non-standard Linux pads (mapping: none) usually put right stick on 2/3.
  shiftX: { type: "axis", index: 2 },
  shiftY: { type: "axis", index: 3 },
  invertShiftY: false,
  ignition: { type: "button", index: 0 },
  shifterStick: "right",
}

const keyboard = {
  clutch: 0,
  throttle: 0,
  gear: "N",
  aHeld: false,
  clutchHeld: false,
  throttleHeld: false,
}

let bindings = null
let triggerHardware = null
let previousA = false
let listenTarget = null
let listenReadyAt = 0
let listenHandler = null
/** Once the user uses Listen or Apply, never auto-overwrite their map. */
let userLockedMapping = false
/** Baseline captured when Listen starts — bind the control that changes most. */
let listenBaselineAxes = null
let listenBaselineButtons = null

const clamp01 = (value) => Math.min(1, Math.max(0, value))

const cloneBindings = (source) => ({
  clutch: { ...source.clutch },
  throttle: { ...source.throttle },
  shiftX: { ...source.shiftX },
  shiftY: { ...source.shiftY },
  invertShiftY: Boolean(source.invertShiftY),
  ignition: { ...source.ignition },
  shifterStick: source.shifterStick === "left" ? "left" : "right",
})

const cloneTriggerHardware = (source) => ({
  clutch: { ...source.clutch },
  throttle: { ...source.throttle },
})

const loadTriggerHardware = () => {
  try {
    const raw = window.localStorage.getItem(TRIGGER_STORAGE_KEY)
    if (!raw) {
      return cloneTriggerHardware(TRIGGER_HARDWARE)
    }
    const parsed = JSON.parse(raw)
    return cloneTriggerHardware({
      clutch: { ...TRIGGER_HARDWARE.clutch, ...parsed.clutch },
      throttle: { ...TRIGGER_HARDWARE.throttle, ...parsed.throttle },
    })
  } catch (error) {
    return cloneTriggerHardware(TRIGGER_HARDWARE)
  }
}

const loadBindings = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return cloneBindings(DEFAULT_BINDINGS)
    }
    const parsed = JSON.parse(raw)
    return cloneBindings({ ...DEFAULT_BINDINGS, ...parsed })
  } catch (error) {
    return cloneBindings(DEFAULT_BINDINGS)
  }
}

bindings = loadBindings()
triggerHardware = loadTriggerHardware()
// Only treat stored maps as user-locked (Apply / Listen). Fresh defaults stay editable.
try {
  userLockedMapping = Boolean(window.localStorage.getItem(TRIGGER_STORAGE_KEY))
} catch (error) {
  userLockedMapping = false
}

const persistBindings = () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
}

const persistTriggerHardware = () => {
  window.localStorage.setItem(TRIGGER_STORAGE_KEY, JSON.stringify(triggerHardware))
}

/** Keep bindings.clutch / bindings.throttle aligned with trigger hardware. */
const syncBindingsFromTriggers = () => {
  ;["clutch", "throttle"].forEach((role) => {
    const hw = triggerHardware[role]
    if (!hw || hw.source === "auto") {
      return
    }
    bindings[role] = {
      type: hw.source === "axis" ? "axis" : "button",
      index: Number(hw.index),
    }
  })
  persistBindings()
}

export const getBindings = () => cloneBindings(bindings)

export const getTriggerHardware = () => cloneTriggerHardware(triggerHardware)

/**
 * Swap clutch/throttle to a button or axis after reading the debugger.
 * range: "minus1to1" (-1 released → 1 pressed) or "zeroToOne" (0 → 1)
 */
export const setTriggerHardware = (role, source, index, range = "minus1to1") => {
  if (role !== "clutch" && role !== "throttle") {
    return getTriggerHardware()
  }
  const normalizedSource = source === "axis" ? "axis" : "button"
  triggerHardware[role] = {
    source: normalizedSource,
    index: Number(index),
    range:
      normalizedSource === "axis"
        ? range === "zeroToOne"
          ? "zeroToOne"
          : "minus1to1"
        : "zeroToOne",
  }
  userLockedMapping = true
  syncBindingsFromTriggers()
  persistTriggerHardware()
  // If the new pedal axis was the shifter, move the stick to a free pair.
  if (
    normalizedSource === "axis" &&
    (Number(index) === bindings.shiftX.index || Number(index) === bindings.shiftY.index)
  ) {
    applyShifterAxesForStick(bindings.shifterStick)
    persistBindings()
  }
  return getTriggerHardware()
}

export const resetBindings = () => {
  bindings = cloneBindings(DEFAULT_BINDINGS)
  triggerHardware = cloneTriggerHardware(TRIGGER_HARDWARE)
  userLockedMapping = false
  listenBaselineAxes = null
  listenBaselineButtons = null
  knobX = 0
  knobY = 0
  persistBindings()
  persistTriggerHardware()
  applyShifterAxesForStick(bindings.shifterStick)
  return getBindings()
}

const triggerAxisIndexes = () => {
  const used = new Set()
  ;["clutch", "throttle"].forEach((role) => {
    const hw = triggerHardware?.[role]
    if (hw?.source === "axis") {
      used.add(Number(hw.index))
    }
  })
  return used
}

/** Pick stick axes that do not collide with mapped clutch/throttle axes. */
const applyShifterAxesForStick = (side) => {
  bindings.shifterStick = side === "left" ? "left" : "right"
  if (bindings.shifterStick === "left") {
    bindings.shiftX = { type: "axis", index: 0 }
    bindings.shiftY = { type: "axis", index: 1 }
    return
  }

  const used = triggerAxisIndexes()
  const candidates = [
    [2, 3],
    [3, 4],
    [0, 1],
  ]
  for (const pair of candidates) {
    if (!used.has(pair[0]) && !used.has(pair[1])) {
      bindings.shiftX = { type: "axis", index: pair[0] }
      bindings.shiftY = { type: "axis", index: pair[1] }
      return
    }
  }

  const free = []
  for (let i = 0; i < 8; i += 1) {
    if (!used.has(i)) {
      free.push(i)
    }
    if (free.length === 2) {
      break
    }
  }
  bindings.shiftX = { type: "axis", index: free[0] ?? 2 }
  bindings.shiftY = { type: "axis", index: free[1] ?? 3 }
}

export const setShifterStick = (side) => {
  applyShifterAxesForStick(side)
  persistBindings()
  return getBindings()
}

// Avoid pedal/shifter axis collisions from older saved bindings.
{
  const used = triggerAxisIndexes()
  if (used.has(bindings.shiftX.index) || used.has(bindings.shiftY.index)) {
    applyShifterAxesForStick(bindings.shifterStick)
    persistBindings()
  }
}

export const setInvertShiftY = (invert) => {
  bindings.invertShiftY = Boolean(invert)
  persistBindings()
  return getBindings()
}

/**
 * Read a GamepadButton's analog .value ONLY — never .pressed.
 * .pressed is boolean and makes triggers feel digital.
 */
const readButtonAnalogValue = (pad, index) => {
  const button = pad.buttons[index]
  if (!button || typeof button.value !== "number") {
    return 0
  }
  return clamp01(button.value)
}

const axisValue = (pad, index) => {
  if (!pad.axes || index < 0 || index >= pad.axes.length) {
    return 0
  }
  return pad.axes[index]
}

/** Map a raw axis float into 0..1 pedal pressure. */
const normalizeAxisToPedal = (raw, range) => {
  if (range === "zeroToOne") {
    return clamp01(raw)
  }
  // Default Linux-style trigger axis: released ≈ -1, pressed ≈ +1
  return clamp01((raw + 1) / 2)
}

const readHardwareTrigger = (pad, role) => {
  const config = triggerHardware[role] || TRIGGER_HARDWARE[role]
  if (!config) {
    return 0
  }

  if (config.source === "axis") {
    const raw = axisValue(pad, Number(config.index))
    return normalizeAxisToPedal(raw, config.range || "minus1to1")
  }

  return readButtonAnalogValue(pad, Number(config.index))
}

const friendlyControl = (binding, role) => {
  if (role === "clutch" || role === "throttle") {
    const hw = triggerHardware[role]
    if (hw?.source === "axis") {
      return `Axis ${hw.index}`
    }
    if (hw?.source === "button") {
      if (hw.index === 6) {
        return "LT · Button 6"
      }
      if (hw.index === 7) {
        return "RT · Button 7"
      }
      return `Button ${hw.index}`
    }
    if (hw?.source === "auto") {
      return "Auto-detect"
    }
  }
  if (role === "ignition") {
    const index = binding?.index ?? 0
    if (index === 0) {
      return "A · Button 0"
    }
    return `Button ${index}`
  }
  if (binding?.type === "axis") {
    return `Axis ${binding.index}`
  }
  return `Button ${binding?.index ?? "?"}`
}

/** Short live summary for hints / status across the UI. */
export const formatBindingSummary = () => {
  const clutch = friendlyControl(bindings.clutch, "clutch")
  const throttle = friendlyControl(bindings.throttle, "throttle")
  const stick = bindings.shifterStick === "left" ? "left stick" : "right stick"
  const ignition = friendlyControl(bindings.ignition, "ignition")
  return {
    clutch,
    throttle,
    stick,
    ignition,
    line: `${clutch} clutch · ${throttle} throttle · ${stick} H-gate · ${ignition} start`,
  }
}

export const describeBindings = () => ({
  clutch: friendlyControl(bindings.clutch, "clutch"),
  throttle: friendlyControl(bindings.throttle, "throttle"),
  ignition: friendlyControl(bindings.ignition, "ignition"),
  shifterStick: bindings.shifterStick,
  listening: listenTarget,
  invertShiftY: bindings.invertShiftY,
  triggerHardware: getTriggerHardware(),
  summary: formatBindingSummary(),
})

/**
 * Snapshot for the Gamepad Debugger overlay.
 * Shows raw buttons[6]/[7].value and every axis so you can find LT/RT.
 */
export const getHardwareDebugSnapshot = () => {
  const pad = readPad()
  if (!pad) {
    return {
      connected: false,
      id: "",
      mapping: "",
      button6Value: 0,
      button6Pressed: false,
      button7Value: 0,
      button7Pressed: false,
      axes: [],
      clutchValue: 0,
      throttleValue: 0,
      triggerHardware: getTriggerHardware(),
    }
  }

  const b6 = pad.buttons[6]
  const b7 = pad.buttons[7]

  return {
    connected: true,
    id: pad.id || "unknown",
    mapping: pad.mapping || "(none)",
    button6Value: typeof b6?.value === "number" ? b6.value : 0,
    button6Pressed: Boolean(b6?.pressed),
    button7Value: typeof b7?.value === "number" ? b7.value : 0,
    button7Pressed: Boolean(b7?.pressed),
    axes: Array.from(pad.axes || []).map((value) => Number(value) || 0),
    clutchValue: readHardwareTrigger(pad, "clutch"),
    throttleValue: readHardwareTrigger(pad, "throttle"),
    triggerHardware: getTriggerHardware(),
  }
}

/**
 * Gear from knob position on the H rails.
 * Easy engage once you push a bit into a gate slot.
 */
export const resolveHGate = (x, y) => {
  if (Math.abs(y) < GATE_THROW) {
    return "N"
  }

  const lane = nearestLaneX(x)
  if (Math.abs(x - lane) > JUNCTION_EPS * 2) {
    return "N"
  }

  if (y < 0) {
    if (lane < -GATE_X * 0.5) {
      return "1"
    }
    if (lane > GATE_X * 0.5) {
      return "5"
    }
    return "3"
  }

  if (lane < -GATE_X * 0.5) {
    return "2"
  }
  if (lane > GATE_X * 0.5) {
    return "6"
  }
  return "4"
}

const readPad = () => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  for (let i = 0; i < pads.length; i += 1) {
    const pad = pads[i]
    if (pad) {
      return pad
    }
  }
  return null
}

const pollKeyboard = () => {
  if (keyboard.clutchHeld) {
    keyboard.clutch = Math.min(1, keyboard.clutch + KEY_RAMP)
  } else {
    keyboard.clutch = Math.max(0, keyboard.clutch - KEY_RAMP)
  }
  if (keyboard.throttleHeld) {
    keyboard.throttle = Math.min(1, keyboard.throttle + KEY_RAMP)
  } else {
    keyboard.throttle = Math.max(0, keyboard.throttle - KEY_RAMP)
  }
}

const finishListen = () => {
  const handler = listenHandler
  listenTarget = null
  listenHandler = null
  listenBaselineAxes = null
  listenBaselineButtons = null
  if (handler) {
    handler(getBindings())
  }
}

const detectListen = (pad) => {
  if (!listenTarget || performance.now() < listenReadyAt) {
    return false
  }

  // Pad connected after Listen started — capture a fresh baseline once.
  if (!listenBaselineAxes || !listenBaselineButtons) {
    listenBaselineAxes = Array.from(pad.axes, (value) => Number(value) || 0)
    listenBaselineButtons = Array.from(pad.buttons, (button) =>
      typeof button?.value === "number" ? button.value : 0
    )
    listenReadyAt = performance.now() + 200
    return false
  }

  if (listenTarget === "shift") {
    const used = triggerAxisIndexes()
    const ranked = []
    for (let i = 0; i < pad.axes.length; i += 1) {
      if (used.has(i)) {
        continue
      }
      const raw = axisValue(pad, i)
      const base = listenBaselineAxes?.[i] ?? 0
      const delta = Math.abs(raw - base)
      if (delta > 0.28) {
        ranked.push({ index: i, delta })
      }
    }
    ranked.sort((a, b) => b.delta - a.delta)
    if (ranked.length === 0) {
      return false
    }

    // Pair with a sibling axis on the same stick when possible.
    const primary = ranked[0].index
    let secondary = ranked.find((entry) => Math.abs(entry.index - primary) === 1)?.index
    if (secondary == null) {
      const guess = primary % 2 === 0 ? primary + 1 : primary - 1
      secondary = guess >= 0 && guess < pad.axes.length && !used.has(guess) ? guess : primary
    }
    const xIndex = Math.min(primary, secondary)
    const yIndex = Math.max(primary, secondary)
    bindings.shifterStick = xIndex <= 1 ? "left" : "right"
    bindings.shiftX = { type: "axis", index: xIndex }
    bindings.shiftY = { type: "axis", index: yIndex }
    persistBindings()
    finishListen()
    return true
  }

  if (listenTarget === "clutch" || listenTarget === "throttle") {
    let bestAxis = -1
    let bestAxisDelta = 0.22
    for (let i = 0; i < pad.axes.length; i += 1) {
      const raw = axisValue(pad, i)
      const base = listenBaselineAxes?.[i] ?? raw
      const delta = Math.abs(raw - base)
      if (delta > bestAxisDelta) {
        bestAxisDelta = delta
        bestAxis = i
      }
    }

    let bestButton = -1
    let bestButtonDelta = 0.45
    for (let i = 0; i < pad.buttons.length; i += 1) {
      const value = readButtonAnalogValue(pad, i)
      const base = listenBaselineButtons?.[i] ?? 0
      const delta = Math.abs(value - base)
      if (delta > bestButtonDelta) {
        bestButtonDelta = delta
        bestButton = i
      }
    }

    // On Linux LT/RT often move a digital button AND an axis together.
    // Prefer the axis so Listen captures smooth analog, not 0/1.
    if (bestAxis >= 0) {
      const raw = axisValue(pad, bestAxis)
      const base = listenBaselineAxes?.[bestAxis] ?? 0
      const range = raw < -0.05 || base < -0.05 ? "minus1to1" : "zeroToOne"
      setTriggerHardware(listenTarget, "axis", bestAxis, range)
      finishListen()
      return true
    }

    if (bestButton >= 0) {
      setTriggerHardware(listenTarget, "button", bestButton, "zeroToOne")
      finishListen()
      return true
    }

    return false
  }

  let bestButton = -1
  let bestButtonDelta = 0.45
  for (let i = 0; i < pad.buttons.length; i += 1) {
    const value = readButtonAnalogValue(pad, i)
    const base = listenBaselineButtons?.[i] ?? 0
    const delta = Math.abs(value - base)
    if (delta > bestButtonDelta) {
      bestButtonDelta = delta
      bestButton = i
    }
  }

  if (bestButton < 0) {
    return false
  }

  bindings[listenTarget] = { type: "button", index: bestButton }
  persistBindings()
  finishListen()
  return true
}

export const startListening = (target, onBound) => {
  listenTarget = target
  listenReadyAt = performance.now() + 350
  listenHandler = onBound
  const pad = readPad()
  listenBaselineAxes = pad ? Array.from(pad.axes, (value) => Number(value) || 0) : null
  listenBaselineButtons = pad
    ? Array.from(pad.buttons, (button) => (typeof button?.value === "number" ? button.value : 0))
    : null
}

export const stopListening = () => {
  listenTarget = null
  listenHandler = null
  listenBaselineAxes = null
  listenBaselineButtons = null
}

export const getListenTarget = () => listenTarget

export const pollInput = () => {
  const pad = readPad()
  pollKeyboard()

  const now = performance.now()
  const dtSec = lastPollAt ? Math.min(0.05, (now - lastPollAt) / 1000) : 0.016
  lastPollAt = now

  let clutch = 0
  let throttle = 0
  let stickX = 0
  let stickY = 0
  let aPressed = keyboard.aHeld

  if (pad) {
    detectListen(pad)

    // Pedals stay on TRIGGER_HARDWARE only — never the shifter axes.
    clutch = readHardwareTrigger(pad, "clutch")
    throttle = readHardwareTrigger(pad, "throttle")

    stickX = axisValue(pad, bindings.shiftX.index)
    stickY = axisValue(pad, bindings.shiftY.index)
    if (bindings.invertShiftY) {
      stickY = -stickY
    }

    aPressed = aPressed || readButtonAnalogValue(pad, bindings.ignition.index) > 0.5
  } else {
    clutch = keyboard.clutch
    throttle = keyboard.throttle
  }

  if (keyboard.gear !== "N") {
    const target = GATE_TARGETS[keyboard.gear] || GATE_TARGETS.N
    advanceHKnobToward(target.x, target.y, dtSec)
  } else if (pad) {
    advanceHKnobFromStick(stickX, stickY, dtSec)
  } else {
    advanceHKnobToward(0, 0, dtSec)
  }

  const gearIntent = resolveHGate(knobX, knobY)
  const aEdge = aPressed && !previousA
  previousA = aPressed

  return {
    clutch,
    throttle,
    x: knobX,
    y: knobY,
    gearIntent,
    aPressed,
    aEdge,
    padConnected: Boolean(pad),
  }
}

export const startGamepadLoop = (onFrame) => {
  const loop = (timestamp) => {
    try {
      onFrame(pollInput(), timestamp)
    } catch (error) {
      console.error("[stick-shift] frame error", error)
    }
    window.requestAnimationFrame(loop)
  }
  window.requestAnimationFrame(loop)
}

const handleKeyDown = (event) => {
  if (event.repeat) {
    if (event.code === "Space") {
      event.preventDefault()
    }
    return
  }
  if (event.code === "KeyQ") {
    keyboard.clutchHeld = true
  }
  if (event.code === "KeyE") {
    keyboard.throttleHeld = true
  }
  if (event.code === "Space") {
    event.preventDefault()
    keyboard.aHeld = true
  }
  if (event.key === "n" || event.key === "N" || event.key === "0") {
    keyboard.gear = "N"
  }
  if (["1", "2", "3", "4", "5", "6"].includes(event.key)) {
    keyboard.gear = event.key
  }
}

const handleKeyUp = (event) => {
  if (event.code === "KeyQ") {
    keyboard.clutchHeld = false
  }
  if (event.code === "KeyE") {
    keyboard.throttleHeld = false
  }
  if (event.code === "Space") {
    event.preventDefault()
    keyboard.aHeld = false
  }
  if (["1", "2", "3", "4", "5", "6", "0"].includes(event.key) || event.key === "n" || event.key === "N") {
    keyboard.gear = "N"
  }
}

export const initKeyboardFallback = () => {
  window.addEventListener("keydown", handleKeyDown)
  window.addEventListener("keyup", handleKeyUp)
}
