import { useCallback, useEffect, useRef } from "preact/hooks"
import {
  currentTime,
  followPlayhead,
  heatmapWidth,
  isDragging,
  pixelsPerSecond,
  scrollSeconds,
  scrollX,
  totalSeconds,
  TRACK_HEIGHT_PX,
  viewportWidth,
  trySeekToSeconds,
} from "./playerState"


function useEventCallback<T extends (...args: any[]) => any>(fn: T) {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: Parameters<T>) => ref.current(...args), [])
}


export function PlayerScroller({
  children,
  absoluteChildren,
}: React.PropsWithChildren<{ absoluteChildren?: React.ReactNode }>) {

  const trackRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const dragStartX = useRef(0)
  const dragStartSeconds = useRef(0)
  const dragStartScrollSeconds = useRef(0)
  const dragDistance = useRef(0)
  const scrollbarDragStartX = useRef(0)
  const scrollbarDragDistance = useRef(0)
  const scrollbarDragged = useRef(false)


  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    viewportWidth.value = el.clientWidth
    const observer = new ResizeObserver(() => {
      viewportWidth.value = el.clientWidth
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])


  const secondsFromClientX = useEventCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width || 1)
    const absoluteX = Math.min(
      heatmapWidth.value,
      Math.max(0, scrollX.value + (x - rect.width / 2))
    )
    return totalSeconds.value ? (absoluteX / heatmapWidth.value) * totalSeconds.value : 0
  })

  const handleTrackPointerDown = useEventCallback((event: PointerEvent) => {
    const el = trackRef.current
    if (!el) return
    event.preventDefault()
    el.setPointerCapture(event.pointerId)
    dragStartX.current = event.clientX
    dragStartSeconds.current = currentTime.value
    dragStartScrollSeconds.current = scrollSeconds.value
    dragDistance.current = 0
    isDragging.value = true
  })

  const handleTrackPointerMove = useEventCallback((event: PointerEvent) => {
    if (!isDragging.value) return
    const el = trackRef.current
    if (!el || !el.hasPointerCapture(event.pointerId)) return
    const delta = event.clientX - dragStartX.current
    dragDistance.current = Math.max(dragDistance.current, Math.abs(delta))
    const pps = pixelsPerSecond.value
    if (!pps) return
    const deltaSeconds = delta / pps
    if (followPlayhead.value) {
      scrollSeconds.value = dragStartSeconds.current - deltaSeconds
    } else {
      scrollSeconds.value = dragStartScrollSeconds.current + deltaSeconds
    }
  })

  const handleTrackPointerUp = useEventCallback((event: PointerEvent) => {
    const el = trackRef.current
    if (el && el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId)
    }
    if (isDragging.value && dragDistance.current < 4) {
      trySeekToSeconds(secondsFromClientX(event.clientX))
    }
    isDragging.value = false
  })

  const handleTrackWheel = useEventCallback((event: WheelEvent) => {
    const pps = pixelsPerSecond.value
    if (!pps) return
    event.preventDefault()
    const delta = event.deltaX + event.deltaY
    const deltaSeconds = delta / pps
    if (followPlayhead.value) {
      trySeekToSeconds(currentTime.value + deltaSeconds)
    } else {
      scrollSeconds.value = scrollSeconds.value + deltaSeconds
    }
  })

  const getThumbWidthRatio = useEventCallback(() => {
    if (!heatmapWidth.value || !viewportWidth.value) return 1
    return Math.max(0.05, Math.min(1, viewportWidth.value / heatmapWidth.value))
  })

  const ratioToSeconds = useEventCallback((ratio: number) => {
    if (!totalSeconds.value) return 0
    const widthRatio = getThumbWidthRatio()
    if (widthRatio >= 1) return 0
    const half = widthRatio / 2
    const clampedCenter = Math.min(1 - half, Math.max(half, ratio))
    const normalized = (clampedCenter - half) / (1 - widthRatio)
    return normalized * totalSeconds.value
  })

  const handleScrollbarPointerDown = useEventCallback((event: PointerEvent) => {
    const el = scrollbarRef.current
    if (!el) return
    event.preventDefault()
    el.setPointerCapture(event.pointerId)
    scrollbarDragStartX.current = event.clientX
    scrollbarDragDistance.current = 0
    scrollbarDragged.current = false
    isDragging.value = true
    const rect = el.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    const seconds = ratioToSeconds(ratio)
    scrollSeconds.value = seconds
  })

  const handleScrollbarPointerMove = useEventCallback((event: PointerEvent) => {
    const el = scrollbarRef.current
    if (!el || !el.hasPointerCapture(event.pointerId)) return
    const delta = event.clientX - scrollbarDragStartX.current
    scrollbarDragDistance.current = Math.max(
      scrollbarDragDistance.current,
      Math.abs(delta)
    )
    if (scrollbarDragDistance.current >= 4) {
      scrollbarDragged.current = true
    }
    const rect = el.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    const seconds = ratioToSeconds(ratio)
    scrollSeconds.value = seconds
  })

  const handleScrollbarPointerUp = useEventCallback((event: PointerEvent) => {
    const el = scrollbarRef.current
    if (el && el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId)
    }
    isDragging.value = false
  })

  const handleScrollbarClick = useEventCallback((event: MouseEvent) => {
    if (scrollbarDragged.current) {
      scrollbarDragged.current = false
      return
    }
    const el = scrollbarRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    const seconds = ratioToSeconds(ratio)
    if (followPlayhead.value) {
      trySeekToSeconds(seconds)
    } else {
      scrollSeconds.value = seconds
    }
  })

  const widthRatio = getThumbWidthRatio()
  const widthPercent = widthRatio * 100
  const progress = totalSeconds.value
    ? Math.min(1, Math.max(0, scrollSeconds.value / totalSeconds.value))
    : 0
  const leftPercent = progress * (100 - widthPercent)

  return (
    <div class="space-y-2">
      <div class="relative">
        <div
          ref={trackRef}
          class="relative overflow-hidden"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(148,163,184,0.12) 0 1px, transparent 1px 48px), repeating-linear-gradient(0deg, rgba(148,163,184,0.08) 0 1px, transparent 1px 48px), #f8fafc",
            height: TRACK_HEIGHT_PX,
          }}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerUp}
          onPointerLeave={handleTrackPointerUp}
          onWheel={handleTrackWheel}
        >
          <div
            class="relative left-1/2 shadow-sm"
            style={{
              width: heatmapWidth.value,
              height: TRACK_HEIGHT_PX,
              transform: `translateX(${-scrollX.value}px)`,
            }}
          >
            {children}
          </div>
        </div>
        {absoluteChildren}
      </div>

      <div
        ref={scrollbarRef}
        class="relative h-3 bg-slate-200"
        onClick={handleScrollbarClick}
        onPointerDown={handleScrollbarPointerDown}
        onPointerMove={handleScrollbarPointerMove}
        onPointerUp={handleScrollbarPointerUp}
        onPointerCancel={handleScrollbarPointerUp}
        onPointerLeave={handleScrollbarPointerUp}
      >
        <div
          class="absolute top-0 h-full bg-slate-500"
          style={{
            width: `${widthPercent}%`,
            left: `${leftPercent}%`,
          }}
        />
      </div>
    </div>
  )
}