import { useSignalEffect } from "@preact/signals"
import { useEffect, useRef } from "preact/hooks"
import type { CqtHeatmapRenderer } from "./drawCqtHeatmap"
import { heatmapData, pixelsPerFrame, scrollX, TRACK_HEIGHT_PX, viewportWidth } from "./playerState"


const MAX_CACHED_CHUNKS = 24
const IDLE_RENDER_TIMEOUT_MS = 100


interface HeatmapOverlayState {
  renderer: CqtHeatmapRenderer
  root: HTMLDivElement
  chunkHosts: Map<number, HTMLDivElement>
  canvases: Map<number, HTMLCanvasElement>
  pendingRenders: Map<number, number>
}


function requestIdle(callback: () => void) {
  if (typeof requestIdleCallback === "function") {
    return requestIdleCallback(callback, { timeout: IDLE_RENDER_TIMEOUT_MS })
  }
  return window.setTimeout(callback, 0)
}


function cancelIdle(handle: number) {
  if (typeof cancelIdleCallback === "function") {
    cancelIdleCallback(handle)
    return
  }
  window.clearTimeout(handle)
}


function createOverlayState(root: HTMLDivElement, renderer: CqtHeatmapRenderer): HeatmapOverlayState {
  return {
    renderer,
    root,
    chunkHosts: new Map(),
    canvases: new Map(),
    pendingRenders: new Map(),
  }
}


function clearOverlayState(state: HeatmapOverlayState) {
  for (const handle of state.pendingRenders.values()) {
    cancelIdle(handle)
  }
  state.pendingRenders.clear()

  for (const host of state.chunkHosts.values()) {
    host.remove()
  }
  state.chunkHosts.clear()

  for (const canvas of state.canvases.values()) {
    canvas.width = 0
    canvas.height = 0
  }
  state.canvases.clear()
}


function getCanvas(state: HeatmapOverlayState, index: number) {
  const existing = state.canvases.get(index)
  if (existing) {
    state.canvases.delete(index)
    state.canvases.set(index, existing)
    return existing
  }

  const canvas = document.createElement("canvas")
  state.canvases.set(index, canvas)
  return canvas
}


function scheduleChunkRender(state: HeatmapOverlayState, index: number) {
  const canvas = state.canvases.get(index)
  if (!canvas || canvas.dataset.rendered === "1" || state.pendingRenders.has(index)) {
    return
  }

  const handle = requestIdle(() => {
    state.pendingRenders.delete(index)
    if (!canvas.isConnected || canvas.dataset.rendered === "1") {
      return
    }

    state.renderer.renderChunk(index, canvas)
    canvas.dataset.rendered = "1"
  })

  state.pendingRenders.set(index, handle)
}


function getChunkFrameRange(state: HeatmapOverlayState, index: number) {
  const startFrame = index * state.renderer.chunkFrameCount
  const frameCount = Math.max(
    0,
    Math.min(state.renderer.chunkFrameCount, state.renderer.frameCount - startFrame),
  )
  return { startFrame, frameCount }
}


function ensureChunkHost(state: HeatmapOverlayState, index: number, pixelsPerFrameValue: number) {
  let host = state.chunkHosts.get(index)
  if (!host) {
    host = document.createElement("div")
    host.className = "absolute top-0 pointer-events-none"
    host.style.overflow = "hidden"
    host.style.contentVisibility = "auto"
    host.style.contain = "layout paint style"

    const canvas = getCanvas(state, index)
    canvas.style.display = "block"
    canvas.style.imageRendering = "pixelated"
    canvas.style.width = "100%"
    canvas.style.height = "100%"
    host.appendChild(canvas)

    state.chunkHosts.set(index, host)
    state.root.appendChild(host)
    scheduleChunkRender(state, index)
  }

  const { startFrame, frameCount } = getChunkFrameRange(state, index)
  const displayWidth = frameCount * pixelsPerFrameValue
  host.style.left = `${startFrame * pixelsPerFrameValue}px`
  host.style.width = `${displayWidth}px`
  host.style.height = `${TRACK_HEIGHT_PX}px`
  host.style.setProperty(
    "contain-intrinsic-size",
    `auto ${displayWidth}px ${TRACK_HEIGHT_PX}px`,
  )
}


function evictCachedChunks(state: HeatmapOverlayState) {
  if (state.canvases.size <= MAX_CACHED_CHUNKS) {
    return
  }

  for (const [index, canvas] of [...state.canvases]) {
    if (state.canvases.size <= MAX_CACHED_CHUNKS) {
      break
    }
    if (state.chunkHosts.has(index)) {
      continue
    }

    const handle = state.pendingRenders.get(index)
    if (handle !== undefined) {
      cancelIdle(handle)
      state.pendingRenders.delete(index)
    }
    state.canvases.delete(index)
    canvas.width = 0
    canvas.height = 0
  }
}


function syncOverlay(state: HeatmapOverlayState) {
  const { renderer } = state
  const pixelsPerFrameValue = pixelsPerFrame.value
  const chunkDisplayWidth = renderer.chunkFrameCount * pixelsPerFrameValue
  if (chunkDisplayWidth <= 0) {
    return
  }

  const totalDisplayWidth = renderer.frameCount * pixelsPerFrameValue
  const viewport = viewportWidth.value || Math.min(totalDisplayWidth, chunkDisplayWidth)
  const scroll = Math.min(Math.max(0, scrollX.value), totalDisplayWidth)
  const overscan = Math.max(viewport, chunkDisplayWidth)
  const startX = Math.max(0, scroll - overscan)
  const endX = Math.min(totalDisplayWidth, scroll + viewport + overscan)
  const firstChunk = Math.max(0, Math.floor(startX / chunkDisplayWidth))
  const lastChunk = Math.min(
    renderer.chunkCount - 1,
    Math.floor(Math.max(startX, endX - 1) / chunkDisplayWidth),
  )

  const desiredChunks = new Set<number>()
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    desiredChunks.add(index)
    ensureChunkHost(state, index, pixelsPerFrameValue)
  }

  for (const [index, host] of state.chunkHosts) {
    if (!desiredChunks.has(index)) {
      host.remove()
      state.chunkHosts.delete(index)
    }
  }

  evictCachedChunks(state)
}


export function PlayerHeatmapOverlay() {
  const ref = useRef<HTMLDivElement>(null)
  const stateRef = useRef<HeatmapOverlayState | null>(null)

  useEffect(() => {
    return () => {
      if (stateRef.current) {
        clearOverlayState(stateRef.current)
        stateRef.current = null
      }
    }
  }, [])

  useSignalEffect(() => {
    const root = ref.current
    const renderer = heatmapData.value
    const pixelsPerFrameValue = pixelsPerFrame.value

    if (!root || !renderer || pixelsPerFrameValue <= 0) {
      if (stateRef.current) {
        clearOverlayState(stateRef.current)
        stateRef.current = null
      }
      return
    }

    if (!stateRef.current || stateRef.current.renderer !== renderer) {
      if (stateRef.current) {
        clearOverlayState(stateRef.current)
      }
      stateRef.current = createOverlayState(root, renderer)
    }

    syncOverlay(stateRef.current)
  })

  return <div ref={ref} class="absolute inset-0 pointer-events-none" />
}
