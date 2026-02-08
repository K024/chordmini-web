import clsx from "clsx"
import { chords } from "./appState"
import { getChordColorClass } from "./chordColors"
import { colorMode, pixelsPerSecond } from "./playerState"


export function PlayerChordOverlay() {
  const pps = pixelsPerSecond.value
  if (!pps) return null

  return (
    <div class="absolute inset-0 pointer-events-none">
      {chords.value.map((segment, index) => {
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
    </div>
  )
}
