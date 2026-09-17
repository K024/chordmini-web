import type { PreprocessResult } from "../chordmini"


const BASE_PIXELS_PER_FRAME = 1
const PIXELS_PER_BIN = 1
const MAX_CHUNK_PIXEL_WIDTH = 2048

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


export interface CqtHeatmapChunk {
  index: number
  startFrame: number
  frameCount: number
  width: number
  height: number
  canvas: HTMLCanvasElement
}


export interface CqtHeatmapRenderer {
  width: number
  height: number
  frameCount: number
  bins: number
  basePixelsPerFrame: number
  pixelsPerBin: number
  chunkFrameCount: number
  chunkCount: number
  renderChunk: (index: number, canvas?: HTMLCanvasElement | null) => CqtHeatmapChunk
}


export function createCqtHeatmapRenderer(cqt: PreprocessResult, options?: CqtHeatmapOptions): CqtHeatmapRenderer {

  const basePixelsPerFrame = Math.max(1, options?.basePixelsPerFrame ?? BASE_PIXELS_PER_FRAME)
  const pixelsPerBin = Math.max(1, options?.pixelsPerBin ?? PIXELS_PER_BIN)
  const minColor = parseRgbColor(options?.minColor ?? DEFAULT_MIN_COLOR) || parseRgbColor(DEFAULT_MIN_COLOR)!
  const maxColor = parseRgbColor(options?.maxColor ?? DEFAULT_MAX_COLOR) || parseRgbColor(DEFAULT_MAX_COLOR)!


  const minHsl = rgbToHsl(minColor)
  const maxHsl = rgbToHsl(maxColor)

  const width = Math.max(0, cqt.frames * basePixelsPerFrame)
  const height = cqt.bins * pixelsPerBin
  const chunkFrameCount = Math.max(1, Math.floor(MAX_CHUNK_PIXEL_WIDTH / basePixelsPerFrame))
  const chunkCount = Math.max(1, Math.ceil(cqt.frames / chunkFrameCount))
  const range = cqt.max - cqt.min || 1

  const renderChunk = (index: number, canvas?: HTMLCanvasElement | null) => {
    const chunkIndex = Math.min(chunkCount - 1, Math.max(0, Math.floor(index)))
    const startFrame = chunkIndex * chunkFrameCount
    const frameCount = Math.max(0, Math.min(chunkFrameCount, cqt.frames - startFrame))
    const chunkWidth = Math.max(1, frameCount * basePixelsPerFrame)
    const target = canvas ?? (chunkIndex === 0 ? options?.canvas : undefined) ?? document.createElement("canvas")
    target.width = chunkWidth
    target.height = Math.max(1, height)

    const ctx = target.getContext("2d")
    if (!ctx) {
      throw new Error("Failed to get canvas context")
    }

    const image = ctx.createImageData(chunkWidth, Math.max(1, height))

    for (let frame = 0; frame < frameCount; frame += 1) {
      const sourceFrame = startFrame + frame
      for (let bin = 0; bin < cqt.bins; bin += 1) {
        const yBase = (cqt.bins - 1 - bin) * pixelsPerBin
        const value = cqt.data[sourceFrame * cqt.bins + bin]
        const norm = Math.sqrt(Math.min(1, Math.max(0, (value - cqt.min) / range)))
        const hsl = interpolateHsl(minHsl, maxHsl, norm)
        const rgb = hslToRgb(hsl)
        for (let py = 0; py < pixelsPerBin; py += 1) {
          const row = (yBase + py) * chunkWidth
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
      index: chunkIndex,
      startFrame,
      frameCount,
      width: chunkWidth,
      height: Math.max(1, height),
      canvas: target,
    }
  }

  return {
    width,
    height,
    frameCount: cqt.frames,
    bins: cqt.bins,
    basePixelsPerFrame,
    pixelsPerBin,
    chunkFrameCount,
    chunkCount,
    renderChunk,
  }
}


export async function drawCqtHeatmap(cqt: PreprocessResult, options?: CqtHeatmapOptions) {
  const renderer = createCqtHeatmapRenderer(cqt, options)
  const chunks: CqtHeatmapChunk[] = []
  const waitIdle = createIdleAwaiter()

  for (let index = 0; index < renderer.chunkCount; index += 1) {
    chunks.push(renderer.renderChunk(index))
    if (index > 0 && index % 8 === 0) {
      await waitIdle()
    }
  }

  return {
    ...renderer,
    chunks,
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


function createIdleAwaiter(maxTimeSegment = 50) {
  let lastTime = performance.now()

  function checkAndWait() {
    const now = performance.now()
    const delta = now - lastTime
    if (delta < maxTimeSegment) {
      return new Promise(resolve => requestIdleCallback(resolve))
    }
    lastTime = now
    return Promise.resolve()
  }

  return checkAndWait
}
