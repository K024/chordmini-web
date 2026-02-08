import { audioUrl, cqt, duration } from "./appState"
import { formatTime } from "./formatTime"
import { currentTime, setupAudioElement } from "./playerState"
import { Player } from "./Player"
import { useEffect, useRef } from "preact/hooks"


function ResultInfo() {
  return (
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-slate-900">
          Analysis Results
        </h2>
        <p class="text-sm text-slate-500">
          Hybrid CQT heat map with chord markers.
        </p>
      </div>
      {cqt.value ? (
        <div class="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
          {cqt.value.bins} bins · {cqt.value.frames} frames · hop {cqt.value.hopLength}
        </div>
      ) : null}
    </div>
  )
}


function AudioElement({ url }: { url: string }) {

  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audioEl = audioRef.current
    if (!audioEl) return
    const unsubscribe = setupAudioElement(audioEl)
    return () => unsubscribe()
  }, [])

  return (
    <div class="mt-5 flex flex-wrap items-center gap-4">
      <audio
        ref={audioRef}
        class="w-full max-w-lg"
        controls
        src={url}
      />
      <div class="text-xs font-semibold text-slate-500 min-w-20 text-center">
        {formatTime(currentTime.value)} / {formatTime(duration.value)}
      </div>
      <div class="text-xs text-slate-400">
        Click or mouse scroll on the heat map to seek.
      </div>
    </div>
  )
}


function Audio() {
  if (!audioUrl.value) return null
  return (
    <AudioElement url={audioUrl.value} />
  )
}


export function ResultPanel() {
  return (
    <section class="rounded-2xl bg-white p-6 shadow-sm">
      <ResultInfo />
      <Player />
      <Audio />
    </section>
  )
}
