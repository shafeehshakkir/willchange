/**
 * Isolated synthwave backdrop. Own rAF loop — failures stay here,
 * never throw into the drivetrain / gamepad tick.
 */

let canvas = null
let ctx = null
let running = false
let gridOffset = 0
let sunPulse = 0
let stars = []

const state = {
  speed: 0,
  rpm: 0,
  abuse: 0,
  playing: false,
  reverse: false,
  engineOn: false,
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  bins: null,
}

const lerp = (a, b, t) => a + (b - a) * t

const seedStars = () => {
  stars = []
  if (!canvas) {
    return
  }
  const count = Math.max(40, Math.floor((canvas.width * canvas.height) / 18000))
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: Math.random(),
      y: Math.random() * 0.55,
      r: Math.random() * 1.4 + 0.3,
      a: 0.25 + Math.random() * 0.55,
    })
  }
}

const resize = () => {
  if (!canvas) {
    return
  }
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  seedStars()
}

const drawSky = (w, horizon) => {
  const energy = state.energy
  const abuse = state.abuse
  const top = state.reverse ? "#1a0a2e" : "#070b1a"
  const mid = state.reverse ? "#3a1458" : "#1a1040"
  const hot = state.reverse
    ? `rgba(80, 220, 255, ${0.22 + energy * 0.3})`
    : `rgba(255, 70, 160, ${0.18 + energy * 0.35 + abuse * 0.2})`

  const g = ctx.createLinearGradient(0, 0, 0, horizon)
  g.addColorStop(0, top)
  g.addColorStop(0.45, mid)
  g.addColorStop(0.78, hot)
  g.addColorStop(1, state.reverse ? "#0d2a3a" : "#2a1030")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, horizon)

  const starDim = Math.max(0.12, 1 - state.speed * 0.5 - energy * 0.45)
  for (const star of stars) {
    ctx.fillStyle = `rgba(220, 230, 255, ${star.a * starDim})`
    ctx.beginPath()
    ctx.arc(star.x * w, star.y * horizon, star.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

const drawSun = (w, h, horizon) => {
  const cx = w * 0.5
  const baseR = Math.min(w, h) * (0.11 + state.speed * 0.04 + state.bass * 0.05)
  const cy = horizon - baseR * 0.35
  sunPulse = lerp(sunPulse, state.bass * 16 + state.abuse * 8, 0.12)
  const r = Math.max(8, baseR + sunPulse)

  const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.2)
  glow.addColorStop(0, `rgba(255, 200, 80, ${0.3 + state.energy * 0.3})`)
  glow.addColorStop(0.45, `rgba(255, 60, 140, ${0.15 + state.mid * 0.22})`)
  glow.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, horizon + 40)

  const body = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
  if (state.reverse) {
    body.addColorStop(0, "#7ef0ff")
    body.addColorStop(0.55, "#3a8cff")
    body.addColorStop(1, "#b44dff")
  } else {
    body.addColorStop(0, "#ffe566")
    body.addColorStop(0.45, "#ff6b2d")
    body.addColorStop(1, "#ff2d7b")
  }
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = body
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  for (let i = 0; i < 9; i += 1) {
    const t = i / 9
    const y = cy - r + t * r * 2
    ctx.fillStyle = `rgba(8, 10, 28, ${0.15 + t * 0.55})`
    ctx.fillRect(cx - r, y, r * 2, 2 + t * 5 + state.treble * 3)
  }
  ctx.restore()
}

const drawMountains = (w, horizon) => {
  const layers = [
    { amp: 48, color: "rgba(40, 20, 70, 0.9)", seed: 1.7 },
    { amp: 32, color: "rgba(90, 30, 110, 0.75)", seed: 3.1 },
    { amp: 18, color: "rgba(180, 40, 120, 0.45)", seed: 5.2 },
  ]
  for (const layer of layers) {
    ctx.beginPath()
    ctx.moveTo(0, horizon)
    for (let i = 0; i <= 28; i += 1) {
      const x = (i / 28) * w
      const n =
        Math.sin(i * layer.seed + state.mid * 2) * 0.55 +
        Math.sin(i * layer.seed * 0.4) * 0.45
      const y = horizon - (0.35 + Math.abs(n)) * layer.amp * (0.85 + state.energy * 0.3)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, horizon)
    ctx.closePath()
    ctx.fillStyle = layer.color
    ctx.fill()
  }
}

const drawGrid = (w, h, horizon) => {
  const floorH = h - horizon
  if (floorH < 8) {
    return
  }

  const speed = state.playing ? state.speed : 0
  const dir = state.reverse ? -1 : 1
  gridOffset = (gridOffset + (0.35 + speed * 4 + state.bass * 1.1) * dir) % 1
  if (gridOffset < 0) {
    gridOffset += 1
  }

  const vanishX = w * 0.5
  const accent = state.reverse ? "0, 220, 255" : "255, 45, 150"
  const secondary = state.reverse ? "180, 80, 255" : "80, 220, 255"

  const floor = ctx.createLinearGradient(0, horizon, 0, h)
  floor.addColorStop(0, "rgba(10, 6, 24, 0.2)")
  floor.addColorStop(1, "rgba(4, 2, 12, 0.95)")
  ctx.fillStyle = floor
  ctx.fillRect(0, horizon, w, floorH)

  ctx.lineWidth = 1
  for (let i = 0; i < 18; i += 1) {
    const t = (i + gridOffset) / 18
    const y = horizon + Math.pow(t, 1.65) * floorH
    ctx.strokeStyle = `rgba(${accent}, ${0.08 + t * 0.45 + state.mid * 0.12})`
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  for (let i = -16; i <= 16; i += 1) {
    const edgeX = vanishX + i * (w / 16) * 1.35
    ctx.strokeStyle = `rgba(${secondary}, ${0.1 + Math.abs(i) / 16 * 0.2})`
    ctx.beginPath()
    ctx.moveTo(vanishX, horizon)
    ctx.lineTo(edgeX, h)
    ctx.stroke()
  }

  ctx.strokeStyle = `rgba(${accent}, ${0.5 + state.energy * 0.35})`
  ctx.lineWidth = 2 + state.bass * 2.5
  ctx.beginPath()
  ctx.moveTo(0, horizon)
  ctx.lineTo(w, horizon)
  ctx.stroke()
}

const drawSpectrum = (w, h, horizon) => {
  const bins = state.bins
  if (!bins || !state.playing) {
    return
  }
  const count = 48
  const step = Math.max(1, Math.floor(bins.length / count))
  const barW = w / count
  const maxH = (h - horizon) * 0.4

  for (let i = 0; i < count; i += 1) {
    const v = bins[Math.min(bins.length - 1, i * step)] / 255
    const barH = v * maxH * (0.55 + state.speed * 0.4)
    if (barH < 1) {
      continue
    }
    const x = i * barW
    const y = h - barH
    const g = ctx.createLinearGradient(x, y, x, h)
    if (state.reverse) {
      g.addColorStop(0, "rgba(120, 255, 255, 0.8)")
      g.addColorStop(1, "rgba(80, 40, 200, 0.05)")
    } else {
      g.addColorStop(0, "rgba(255, 80, 200, 0.85)")
      g.addColorStop(0.55, "rgba(80, 220, 255, 0.4)")
      g.addColorStop(1, "rgba(255, 120, 40, 0.05)")
    }
    ctx.fillStyle = g
    ctx.fillRect(x + 1, y, Math.max(1, barW - 2), barH)
  }
}

const drawScanlines = (w, h) => {
  ctx.fillStyle = "rgba(0, 0, 0, 0.1)"
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1)
  }
  if (state.abuse > 0.2) {
    ctx.fillStyle = `rgba(255, 40, 100, ${state.abuse * 0.1})`
    ctx.fillRect(0, 0, w, h)
  }
}

const frame = () => {
  if (!running || !ctx || !canvas) {
    return
  }
  try {
    const w = canvas.width
    const h = canvas.height
    if (w < 2 || h < 2) {
      window.requestAnimationFrame(frame)
      return
    }
    const horizon = h * (0.52 - Math.min(0.06, state.speed * 0.03))
    ctx.clearRect(0, 0, w, h)
    drawSky(w, horizon)
    drawSun(w, h, horizon)
    drawMountains(w, horizon)
    drawGrid(w, h, horizon)
    drawSpectrum(w, h, horizon)
    drawScanlines(w, h)
    if (!state.engineOn) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)"
      ctx.fillRect(0, 0, w, h)
    }
  } catch (error) {
    /* keep loop alive */
  }
  window.requestAnimationFrame(frame)
}

export const initSynthwave = (target) => {
  if (!target || typeof target.getContext !== "function") {
    return false
  }
  canvas = target
  ctx = canvas.getContext("2d")
  if (!ctx) {
    return false
  }
  resize()
  window.addEventListener("resize", resize)
  if (!running) {
    running = true
    window.requestAnimationFrame(frame)
  }
  return true
}

export const setSynthwaveState = (next) => {
  try {
    if (!next || typeof next !== "object") {
      return
    }
    Object.assign(state, next)
  } catch (error) {
    /* ignore */
  }
}
