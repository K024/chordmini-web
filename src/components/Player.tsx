import { cqt } from "./appState"
import { PlayerChordOverlay } from "./PlayerChordOverlay"
import { PlayerControls } from "./PlayerControls"
import { PlayerHeatmapOverlay } from "./PlayerHeatmapOverlay"
import { PlayerPlayhead } from "./PlayerPlayhead"
import { PlayerScroller } from "./PlayerScroller"


export function Player() {
  return (
    <div class="mt-6 bg-slate-50/70">
      {cqt.value ? (
        <div class="space-y-4">
          <PlayerControls />
          <PlayerScroller
            absoluteChildren={<PlayerPlayhead />}
          >
            <PlayerHeatmapOverlay />
            <PlayerChordOverlay />
          </PlayerScroller>
        </div>
      ) : (
        <div class="flex h-[260px] items-center justify-center text-sm text-slate-500">
          Upload a file to render the CQT heat map.
        </div>
      )}
    </div>
  )
}
