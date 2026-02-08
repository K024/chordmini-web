import type { PreprocessResult } from "../chordmini"


const BASE_PIXELS_PER_FRAME = 3
const PIXELS_PER_BIN = 3

const DEFAULT_MIN_COLOR = "#2a0a53"
const DEFAULT_MAX_COLOR = "#f3570f"


export interface CqtHeatmapOptions {
  canvas?: HTMLCanvasElement | null
  basePixelsPerFrame?: number
  pixelsPerBin?: number
  /** rgb color string */
  minColor?: string
  /** rgb color string */
  maxColor?: string
}


export function drawCqtHeatmap(cqt: PreprocessResult, options?: CqtHeatmapOptions) {

  const basePixelsPerFrame = options?.basePixelsPerFrame ?? BASE_PIXELS_PER_FRAME
  const pixelsPerBin = options?.pixelsPerBin ?? PIXELS_PER_BIN
  const minColor = parseRgbColor(options?.minColor ?? DEFAULT_MIN_COLOR) || parseRgbColor(DEFAULT_MIN_COLOR)!
  const maxColor = parseRgbColor(options?.maxColor ?? DEFAULT_MAX_COLOR) || parseRgbColor(DEFAULT_MAX_COLOR)!


  const minHsl = rgbToHsl(minColor)
  const maxHsl = rgbToHsl(maxColor)

  const canvas = options?.canvas ?? document.createElement("canvas")

  const width = cqt.frames * basePixelsPerFrame
  const height = cqt.bins * pixelsPerBin
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const image = ctx.createImageData(width, height)
  const range = cqt.max - cqt.min || 1

  for (let bin = 0; bin < cqt.bins; bin += 1) {
    const yBase = (cqt.bins - 1 - bin) * pixelsPerBin
    for (let frame = 0; frame < cqt.frames; frame += 1) {
      const value = cqt.data[bin * cqt.frames + frame]
      const norm = Math.sqrt(Math.min(1, Math.max(0, (value - cqt.min) / range)))
      const hsl = interpolateHsl(minHsl, maxHsl, norm)
      const rgb = hslToRgb(hsl)
      for (let py = 0; py < pixelsPerBin; py += 1) {
        const row = (yBase + py) * width
        for (let px = 0; px < basePixelsPerFrame; px += 1) {
          const idx = (row + frame * basePixelsPerFrame + px) * 4
          image.data[idx] = rgb.r
          image.data[idx + 1] = rgb.g
          image.data[idx + 2] = rgb.b
          image.data[idx + 3] = 255
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0)

  return {
    width,
    height,
    canvas,
    imageData: image,
  }
}



interface Hsl {
  h: number
  s: number
  l: number
}

interface Rgb {
  r: number
  g: number
  b: number
}

function parseRgbColor(color: string): Rgb | null {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(color)
  if (!match) return null
  const r = parseInt(match[1], 16)
  const g = parseInt(match[2], 16)
  const b = parseInt(match[3], 16)
  return { r, g, b }
}

const eps = 1e-6

function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d < eps) {
    return { h: 0, s: 0, l }
  }
  const s = d / (1 - Math.abs(2 * l - 1))
  const hPrime = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d
  const h = ((hPrime * 60) + 360) % 360
  return { h, s, l }
}


function hslToRgb(hsl: Hsl): Rgb {
  const { h, s, l } = hsl
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (h < 60) {
    r1 = c
    g1 = x
  } else if (h < 120) {
    r1 = x
    g1 = c
  } else if (h < 180) {
    g1 = c
    b1 = x
  } else if (h < 240) {
    g1 = x
    b1 = c
  } else if (h < 300) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }
  const r = Math.round((r1 + m) * 255)
  const g = Math.round((g1 + m) * 255)
  const b = Math.round((b1 + m) * 255)
  return { r, g, b }
}


function interpolateHsl(hsl1: Hsl, hsl2: Hsl, t: number): Hsl {
  const h = hsl1.h + (hsl2.h - hsl1.h) * t
  const s = hsl1.s + (hsl2.s - hsl1.s) * t
  const l = hsl1.l + (hsl2.l - hsl1.l) * t
  return { h, s, l }
}
