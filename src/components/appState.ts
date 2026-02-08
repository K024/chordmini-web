import { signal } from "@preact/signals"
import { preprocess, decodeChords, inferChordModels, type PreprocessResult, type ChordSegment } from "../chordmini"


export type AppStatus =
  | "idle"
  | "preprocessing"
  | "inferring"
  | "decoding"
  | "ready"
  | "error"


export const status = signal<AppStatus>("idle")
export const statusMessage = signal("Drop a file to start analysis.")
export const error = signal<string | null>(null)
export const errorStep = signal<number | null>(null)

export const fileInfo = signal<{ name: string; duration: number } | null>(null)

export const audioUrl = signal<string | null>(null)
export const duration = signal<number>(0)

export const cqt = signal<PreprocessResult | null>(null)
export const chords = signal<ChordSegment[]>([])


let processing = false

export async function handleFile(file: File) {
  if (processing) return
  processing = true

  let stage: "preprocessing" | "inferring" | "decoding" = "preprocessing"

  errorStep.value = null
  error.value = null
  chords.value = []
  cqt.value = null
  status.value = stage
  duration.value = 0

  try {
    statusMessage.value = "Running hybrid CQT..."
    const result = await preprocess(file, message => {
      statusMessage.value = message
    })

    fileInfo.value = { name: file.name, duration: result.duration }
    cqt.value = result

    duration.value = result.duration

    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value)
    }
    audioUrl.value = URL.createObjectURL(file)

    stage = "inferring"
    status.value = stage
    statusMessage.value = "Loading models and running inference..."
    const probList = await inferChordModels(result, message => {
      statusMessage.value = message
    })

    stage = "decoding"
    status.value = stage
    statusMessage.value = "Decoding chords..."
    chords.value = await decodeChords(probList, result)

    status.value = "ready"
    statusMessage.value = "Analysis complete."

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("Chord analysis failed:", err)
    error.value = message
    status.value = "error"
    statusMessage.value = "Analysis failed."
    if (stage === "preprocessing") {
      errorStep.value = 0
    } else if (stage === "inferring") {
      errorStep.value = 1
    } else {
      errorStep.value = 2
    }
  }

  processing = false
}
