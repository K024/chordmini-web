import clsx from "clsx"
import { signal } from "@preact/signals"
import {
  fileInfo,
  handleFile,
} from "./appState"


const dragActive = signal(false)

function handleDrop(event: DragEvent) {
  event.preventDefault()
  dragActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    void handleFile(file)
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  dragActive.value = true
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  dragActive.value = false
}


const inputEl = signal<HTMLInputElement | null>(null)

function setInputEl(el: HTMLInputElement | null) {
  inputEl.value = el
}

function handleInputChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    void handleFile(file)
  }
}

function openFileDialog() {
  inputEl.value?.click()
}


export function DropZonePanel() {
  return (
    <div
      class={clsx(
        "group relative flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-white px-6 py-8 text-center shadow-sm transition",
        dragActive.value ? "border-slate-600 bg-slate-50" : "border-slate-200",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md shadow-slate-300/70">
        <span class="text-2xl">
          ♪
        </span>
      </div>
      <div class="space-y-2">
        <p class="text-lg font-semibold text-slate-900">
          Drop audio here or choose a file
        </p>
        <p class="text-sm text-slate-500">
          Supports mp3, wav, flac, m4a.
        </p>
      </div>
      <div class="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          class="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-slate-300/80 transition hover:-translate-y-0.5 hover:bg-slate-800"
          onClick={openFileDialog}
        >
          Select file
        </button>
        {fileInfo.value ? (
          <span class="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-600">
            {fileInfo.value.name} · {fileInfo.value.duration.toFixed(1)}s
          </span>
        ) : null}
      </div>
      <input
        ref={setInputEl}
        type="file"
        accept="audio/*"
        class="hidden"
        onChange={handleInputChange}
      />
    </div>
  )
}
