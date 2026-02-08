
import { DropZonePanel } from "./components/DropZonePanel"
import { ResultPanel } from "./components/ResultPanel"
import { ProgressPanel } from "./components/ProgressPanel"

export function App() {
  return (
    <div class="min-h-screen bg-slate-100 text-slate-800">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header class="flex flex-col gap-2">
          <p class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            ChordMini Analyzer
          </p>
          <h1 class="text-3xl font-semibold text-slate-900">
            Drop a music file to start chord analysis
          </h1>
          <p class="max-w-2xl text-base text-slate-600">
            Preprocessing runs in a worker to keep the UI smooth. Next steps will run model
            inference and HMM decoding.
          </p>
        </header>

        <section class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <DropZonePanel />
          <ProgressPanel />
        </section>

        <ResultPanel />
      </div>
    </div>
  )
}
