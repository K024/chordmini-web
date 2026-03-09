import { beatEvents } from "./appState"
import { pixelsPerSecond, showBeatEvents } from "./playerState"


export function PlayerBeatOverlay() {
  if (!showBeatEvents.value) return null
  const pps = pixelsPerSecond.value
  if (!pps) return null

  return (
    <div class="absolute inset-0 pointer-events-none">
      {beatEvents.value.map((beat, index) => {
        const left = beat.time * pps
        return (
          <div
            key={`${beat.time}-${beat.beatInBar}-${index}`}
            class="absolute bottom-2"
            style={{ left, transform: "translateX(-50%)" }}
          >
            {beat.isDownbeat ? (
              <div class="h-0 w-0 border-l-4 border-r-4 border-b-8 border-transparent border-b-orange-500" />
            ) : (
              <div class="h-1.5 w-1.5 rounded-full bg-white/60" />
            )}
          </div>
        )
      })}
    </div>
  )
}
