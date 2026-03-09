import { useSignalEffect } from "@preact/signals"
import { useRef } from "preact/hooks"
import { cqt, modelBeatActivations } from "./appState"
import { TRACK_HEIGHT_PX, heatmapWidth } from "./playerState"

type Activation = [p_beat: number, p_downbeat: number]

interface DrawBeatActivationsOptions {
  canvas?: HTMLCanvasElement | null
  width: number
  height: number
  durationSeconds: number
  beatFps: number
  beatColor?: string
  downbeatColor?: string
}

const modelBeatActivationFps = 100
const BASE_PIXELS_PER_ACTIVATION = 1

export function drawBeatActivations(
  activations: Activation[],
  options: DrawBeatActivationsOptions
) {
  const canvas = options.canvas ?? document.createElement("canvas")
  const width = Math.max(1, Math.floor(options.width))
  const height = Math.max(1, Math.floor(options.height))
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    throw new Error("Failed to get canvas context")
  }

  ctx.clearRect(0, 0, width, height)
  if (!activations.length) {
    return { canvas, width, height }
  }

  const beatColor = options.beatColor ?? "rgba(56, 189, 248, 0.9)"
  const downbeatColor = options.downbeatColor ?? "rgba(249, 115, 22, 0.95)"
  const durationSeconds = Math.max(options.durationSeconds, Number.EPSILON)
  const beatFps = options.beatFps > 0 ? options.beatFps : 0
  const fallbackFrameDuration = durationSeconds / Math.max(1, activations.length - 1)

  const getX = (index: number) => {
    const time = beatFps > 0 ? index / beatFps : index * fallbackFrameDuration
    const normalized = Math.min(1, Math.max(0, time / durationSeconds))
    return normalized * (width - 1)
  }

  const drawChannel = (channelIndex: 0 | 1, color: string, lineWidth: number) => {
    if (activations.length < 2) return
    ctx.beginPath()
    for (let i = 0; i < activations.length; i += 1) {
      const x = getX(i)
      const prob = Math.min(1, Math.max(0, activations[i][channelIndex]))
      const y = (1 - prob) * (height - 1)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }

  drawChannel(0, beatColor, 1.5)
  drawChannel(1, downbeatColor, 1.25)

  return { canvas, width, height }
}

export function PlayerBeatActivationsOverlay() {
  const ref = useRef<HTMLDivElement>(null)

  useSignalEffect(() => {
    const host = ref.current
    if (!host) return

    const activations = modelBeatActivations.value
    const cqtData = cqt.value
    if (!cqtData || activations.length === 0) return

    const durationSeconds = (cqtData.frames * cqtData.hopLength) / cqtData.sr
    const beatFps = modelBeatActivationFps
    const baseWidth = activations.length * BASE_PIXELS_PER_ACTIVATION

    const canvas = document.createElement("canvas")
    canvas.className = "absolute inset-0 pointer-events-none object-fill"
    canvas.style.height = `${TRACK_HEIGHT_PX}px`
    canvas.style.width = `${heatmapWidth.peek()}px`
    host.appendChild(canvas)

    drawBeatActivations(activations, {
      canvas,
      width: baseWidth,
      height: TRACK_HEIGHT_PX,
      durationSeconds,
      beatFps,
    })
    const unsubscribe = heatmapWidth.subscribe(width => {
      canvas.style.width = `${width}px`
    })

    return () => {
      unsubscribe()
      host.removeChild(canvas)
    }
  })

  return (
    <div ref={ref} class="absolute inset-0 pointer-events-none" />
  )
}
