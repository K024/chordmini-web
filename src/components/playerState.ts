import { computed, effect, signal } from "@preact/signals"
import type { ChordColorMode } from "./chordColors"
import { cqt, duration } from "./appState"
import { drawCqtHeatmap } from "./drawCqtHeatmap"


const BASE_PIXELS_PER_FRAME = 3
export const TRACK_HEIGHT_PX = 220


export const currentTime = signal<number>(0)

export const zoomX = signal(1)
export const followPlayhead = signal(true)
export const colorMode = signal<ChordColorMode>("root")
export const isDragging = signal(false)

export const scrollSeconds = signal(0)
export const viewportWidth = signal(0)



export const pixelsPerFrame = computed(() =>
  Math.max(1, Math.round(BASE_PIXELS_PER_FRAME * zoomX.value))
)
export const heatmapWidth = computed(() =>
  cqt.value ? cqt.value.frames * pixelsPerFrame.value : 0
)
export const totalSeconds = computed(() => {
  if (!cqt.value) return duration.value
  return (cqt.value.frames * cqt.value.hopLength) / cqt.value.sr
})
export const pixelsPerSecond = computed(() => {
  const width = heatmapWidth.value
  if (!width) return 0
  return width / totalSeconds.value
})



export const scrollX = computed(() => {
  const total = totalSeconds.value
  const width = heatmapWidth.value
  if (!total || !width) return 0
  const clamped = Math.min(total, Math.max(0, scrollSeconds.value))
  return (clamped / total) * width
})

export const playheadX = computed(() => {
  const total = totalSeconds.value
  const width = heatmapWidth.value
  if (!total || !width) return 0
  const clamped = Math.min(total, Math.max(0, currentTime.value))
  return (clamped / total) * width
})


export const heatmapData = signal<ReturnType<typeof drawCqtHeatmap> | null>(null)

effect(() => {
  const cqtData = cqt.value
  if (!cqtData) {
    heatmapData.value = null
    return
  }
  const callback = requestIdleCallback(() => {
    heatmapData.value = drawCqtHeatmap(cqtData)
    console.log("heatmapData", heatmapData.value)
  })
  return () => cancelIdleCallback(callback)
})


effect(() => {
  if (followPlayhead.value && !isDragging.value) {
    // track effect
    const seconds = currentTime.value
    const callback = requestAnimationFrame(() => {
      scrollSeconds.value = seconds
    })
    return () => cancelAnimationFrame(callback)
  }
})


let audioElement: HTMLAudioElement | null = null

export function setupAudioElement(element: HTMLAudioElement) {
  audioElement = element
  currentTime.value = element.currentTime
  const handleTime = () => {
    currentTime.value = element.currentTime
  }
  const handleMeta = () => {
    if (Number.isFinite(element.duration)) {
      duration.value = element.duration
    }
  }

  element.addEventListener("timeupdate", handleTime)
  element.addEventListener("loadedmetadata", handleMeta)

  console.log("setupAudioElement", element)
  return () => {
    console.log("teardownAudioElement", element)

    audioElement = null
    element.removeEventListener("timeupdate", handleTime)
    element.removeEventListener("loadedmetadata", handleMeta)
  }
}

export function trySeekToSeconds(seconds: number) {
  if (!audioElement) return
  audioElement.currentTime = seconds
  currentTime.value = seconds
}
