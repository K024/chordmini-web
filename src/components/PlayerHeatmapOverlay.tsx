import { useRef } from "preact/hooks"
import { heatmapData, heatmapWidth, TRACK_HEIGHT_PX } from "./playerState"
import { useSignalEffect } from "@preact/signals"


export function PlayerHeatmapOverlay() {

  const ref = useRef<HTMLDivElement>(null)

  useSignalEffect(() => {
    const el = ref.current
    if (!el) return
    const data = heatmapData.value
    if (!data) return
    data.canvas.className = "absolute inset-0 pointer-events-none object-fill"
    data.canvas.style.imageRendering = "pixelated"
    data.canvas.style.height = `${TRACK_HEIGHT_PX}px`
    data.canvas.style.width = `${heatmapWidth.peek()}px`
    const unsubscribe = heatmapWidth.subscribe(w => {
      data.canvas.style.width = `${w}px`
    })

    el.appendChild(data.canvas)
    return () => {
      el.removeChild(data.canvas)
      unsubscribe()
    }
  })

  return (
    <div ref={ref} class="absolute inset-0 pointer-events-none"></div>
  )
}
