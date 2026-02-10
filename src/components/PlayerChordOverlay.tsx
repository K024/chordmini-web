import clsx from "clsx"
import { computed } from "@preact/signals"
import { rawChords } from "./appState"
import { getChordColorClass } from "./chordColors"
import { colorMode, pixelsPerSecond } from "./playerState"
import { estimateKey, getKeyMarkers } from "../key-estimation/estimate-key"


const estimatedChordsAndKeyMarkers = computed(() => {
  if (rawChords.value.length === 0) {
    return {
      chords: [],
      keyMarkers: [],
    }
  }
  const chords = estimateKey(rawChords.value)
  const keyMarkers = getKeyMarkers(chords)
  return {
    chords,
    keyMarkers,
  }
})


export function PlayerChordOverlay() {
  const pps = pixelsPerSecond.value
  if (!pps) return null

  const { chords, keyMarkers } = estimatedChordsAndKeyMarkers.value

  return (
    <div class="absolute inset-0 pointer-events-none">
      {chords.map((segment, index) => {
        const left = (segment.start * pps)
        const segWidth = Math.max(20, ((segment.end - segment.start) * pps))
        return (
          <div
            key={`${segment.label}-${index}`}
            className={clsx(
              "absolute top-6 rounded-xl border-2 px-2 py-1 text-[11px] font-semibold shadow-sm overflow-hidden",
              getChordColorClass(
                segment.label,
                colorMode.value
              ),
            )}
            style={{
              left,
              width: segWidth,
              maxWidth: Math.max(segWidth, 40),
            }}
          >
            <span class="truncate drop-shadow">{segment.label.replace(":", " : ")}</span>
          </div>
        )
      })}
      {keyMarkers.map((marker, index) => {
        const left = (marker.start * pps)
        return (
          <div
            key={`${marker.key}-${index}`}
            class={clsx(
              "absolute top-14 border-2 px-2 py-1 text-[11px] font-semibold shadow-sm overflow-hidden",
              "bg-gray-500/60 text-gray-100 border-gray-300/70"
            )}
            style={{
              left,
            }}
          >
            <span class="truncate drop-shadow">{marker.key}</span>
          </div>
        )
      })}
    </div>
  )
}
