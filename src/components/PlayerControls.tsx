import { colorMode, followPlayhead, heatmapWidth, pixelsPerFrame, zoomX } from "./playerState"


const MIN_ZOOM_X = 0.1
const MAX_ZOOM_X = 2.0


export function PlayerControls() {
  return (
    <div class="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
      <div class="flex items-center gap-3">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Zoom
        </span>
        <input
          type="range"
          min={MIN_ZOOM_X}
          max={MAX_ZOOM_X}
          step={0.1}
          value={zoomX.value}
          onInput={(event) => {
            zoomX.value = parseFloat((event.target as HTMLInputElement).value)
          }}
        />
        <span class="text-xs font-semibold text-slate-500">
          {zoomX.value.toFixed(1)}x
        </span>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Color
        </span>
        <select
          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
          value={colorMode.value}
          onChange={(event) => {
            colorMode.value = (event.target as HTMLSelectElement)
              .value as typeof colorMode.value
          }}
        >
          <option value="root">Root</option>
          <option value="bass">Bass</option>
          <option value="type">Chord type</option>
        </select>
      </div>

      <label class="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-slate-300 text-slate-900"
          checked={followPlayhead.value}
          onChange={(event) => {
            followPlayhead.value = event.currentTarget.checked
          }}
        />
        Keep playhead centered
      </label>

      <div class="ml-auto text-xs text-slate-400">
        {heatmapWidth.value}px · {pixelsPerFrame.value}px/frame
      </div>
    </div>
  )
}
