import { formatTime } from "./formatTime"
import { currentTime, playheadX, scrollX, viewportWidth } from "./playerState"


export function PlayerPlayhead() {

  const translateX = playheadX.value - scrollX.value
  const hide = Math.abs(translateX) > viewportWidth.value / 2

  return (
    <div class="absolute inset-0 pointer-events-none">
      <div
        class="pointer-events-auto absolute inset-y-0 left-1/2"
        style={{
          transform: `translateX(${hide ? 0 : translateX}px)`,
          display: hide ? "none" : "block",
        }}
      >
        <div class="h-full w-[2px] rounded-full bg-slate-300/80 shadow-[0_0_10px_rgba(15,23,42,0.35)]" />
        <div class="absolute left-px top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-sm" />
        <div class="absolute left-px bottom-0 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-sm" />
        <div class="absolute left-px bottom-3 min-w-12 text-center rounded-full -translate-x-1/2 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-600 shadow">
          {formatTime(currentTime.value)}
        </div>
      </div>
    </div>
  )
}
