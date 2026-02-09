import { computed, effect, signal } from "@preact/signals"
import type { ChordColorMode } from "./chordColors"
import { cqt, duration } from "./appState"
import { drawCqtHeatmap } from "./drawCqtHeatmap"


const BASE_PIXELS_PER_FRAME = 3
export const TRACK_HEIGHT_PX = 220


export const currentTime = signal<number>(0)

export const optimisticScroll = signal({
  lastReportTime: 0,
  playbackRate: 0,
})

export const zoomX = signal(1)
export const followPlayhead = signal(true)
export const colorMode = signal<ChordColorMode>("root")
export const isDragging = signal(false)

export const scrollSeconds = signal(0)
export const playheadSeconds = signal(0) // use another signal which considers optimistic scroll
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
  const clamped = Math.min(total, Math.max(0, playheadSeconds.value))
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
  let frameId = requestAnimationFrame(animationFrame)
  function animationFrame() {
    frameId = requestAnimationFrame(animationFrame)
    // no tracking effects here
    const seconds = currentTime.peek()
    const optimistic = optimisticScroll.peek()
    const delta = (performance.now() - optimistic.lastReportTime) * optimistic.playbackRate / 1000
    playheadSeconds.value = Math.min(totalSeconds.peek(), Math.max(0, seconds + delta))

    if (followPlayhead.peek() && !isDragging.peek()) {
      scrollSeconds.value = playheadSeconds.peek()
    }
  }
  return () => cancelAnimationFrame(frameId)
})


let audioElement: HTMLAudioElement | null = null

export function setupAudioElement(element: HTMLAudioElement) {
  audioElement = element
  currentTime.value = element.currentTime
  const handleTime = () => {
    currentTime.value = element.currentTime
    optimisticScroll.value = {
      lastReportTime: performance.now(),
      playbackRate: element.paused ? 0 : element.playbackRate,
    }
  }
  const handleMeta = () => {
    if (Number.isFinite(element.duration)) {
      duration.value = element.duration
    }
  }

  const handlePlay = () => {
    currentTime.value = element.currentTime
    optimisticScroll.value = {
      lastReportTime: performance.now(),
      playbackRate: element.playbackRate,
    }
  }

  const handlePause = () => {
    currentTime.value = element.currentTime
    optimisticScroll.value = {
      lastReportTime: performance.now(),
      playbackRate: 0,
    }
  }

  element.addEventListener("timeupdate", handleTime)
  element.addEventListener("loadedmetadata", handleMeta)
  element.addEventListener("play", handlePlay)
  element.addEventListener("pause", handlePause)


  console.log("setupAudioElement", element)
  return () => {
    console.log("teardownAudioElement", element)

    audioElement = null
    element.removeEventListener("timeupdate", handleTime)
    element.removeEventListener("loadedmetadata", handleMeta)
    element.removeEventListener("play", handlePlay)
    element.removeEventListener("pause", handlePause)
  }
}

export function trySeekToSeconds(seconds: number) {
  if (!audioElement) return
  audioElement.currentTime = seconds
  currentTime.value = seconds
}
