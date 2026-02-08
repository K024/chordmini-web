import { useEffect } from "preact/hooks"
import { setupServiceWorkerNotifications } from "./service-worker"
import { DropZonePanel } from "./components/DropZonePanel"
import { ResultPanel } from "./components/ResultPanel"
import { ProgressPanel } from "./components/ProgressPanel"
import { ToastViewport } from "./service-worker/Toast"


export function App() {
  useEffect(() => {
    setupServiceWorkerNotifications()
  }, [])

  return (
    <div class="min-h-screen bg-slate-100 text-slate-800">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header class="flex flex-col gap-2">
          <p class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            ChordMini Web
          </p>
          <h1 class="text-3xl font-semibold text-slate-900">
            Drop a music file to start chord analysis
          </h1>
          <p class="max-w-2xl text-base text-slate-600">
            Analysis is performed entirely in the browser using a hybrid CQT + ONNX inference pipeline.
            All computation is localized and no data is sent to the server. Offline mode is also supported.
          </p>
        </header>

        <section class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <DropZonePanel />
          <ProgressPanel />
        </section>

        <ResultPanel />

        <footer class="text-sm text-slate-500 flex justify-between items-center">
          <div>
            Built with ♪
            {` `}
            <a href="https://github.com/K024/chordmini-web" class="text-slate-900" target="_blank">GitHub Repository</a>
          </div>
          <div>
            Special thanks to
            {` `}
            <a href="https://github.com/ptnghia-j/ChordMiniApp" class="text-slate-900" target="_blank">
              ChordMiniApp
            </a>
            {` `}and{` `}
            <a href="https://github.com/music-x-lab" class="text-slate-900" target="_blank  ">
              Music X Lab
            </a>
            {` `}
            for all the help and inspiration.
          </div>
        </footer>
      </div>
      <ToastViewport />
    </div>
  )
}
