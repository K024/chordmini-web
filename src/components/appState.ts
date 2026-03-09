import { signal } from "@preact/signals"
import {
  decodeAudio,
  preprocess,
  decodeChords,
  inferChordModels,
  type PreprocessResult,
  type BeatEvent,
  type ChordSegment,
  type ProbList,
  preprocessBeatFeatures,
  inferBeatModels,
  decodeBeatEvents,
  sampleRates,
} from "../chordmini"
// import { estimateKey, getKeyMarkers, type EstimatedChordSegment, type KeyMarker } from "../key-estimation/estimate-key"
import { downloadFile } from "../utils"


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
const inferredProbList = signal<ProbList | null>(null)
export const rawChords = signal<ChordSegment[]>([])
export const beatEvents = signal<BeatEvent[]>([])


// TODO: remove this
export const modelBeatActivations = signal<[number, number][]>([])


let processing = false

export async function handleFile(file: File) {
  if (processing) return
  processing = true

  let stage: "preprocessing" | "inferring" | "decoding" = "preprocessing"

  errorStep.value = null
  error.value = null
  rawChords.value = []
  beatEvents.value = []
  modelBeatActivations.value = []
  // estimatedChords.value = []
  // estimatedKeyMarkers.value = []
  cqt.value = null
  status.value = stage
  duration.value = 0
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
    audioUrl.value = null
  }

  try {
    statusMessage.value = "Running hybrid CQT..."
    const decodedAudio = await decodeAudio(file, sampleRates.chord, message => {
      statusMessage.value = message
    })
    fileInfo.value = { name: file.name, duration: decodedAudio.duration }

    const preprocessed = await preprocess(decodedAudio, message => {
      statusMessage.value = message
    })

    const decodedAudioForBeat = await decodeAudio(file, sampleRates.beat, message => {
      statusMessage.value = message
    })
    const beatFeatures = await preprocessBeatFeatures(decodedAudioForBeat, message => {
      statusMessage.value = message
    })
    cqt.value = preprocessed

    duration.value = preprocessed.duration
    audioUrl.value = URL.createObjectURL(file)

    stage = "inferring"
    status.value = stage
    statusMessage.value = "Loading models and running inference..."
    const beatActivations = await inferBeatModels(beatFeatures, message => {
      statusMessage.value = message
    })
    modelBeatActivations.value = beatActivations
    beatEvents.value = await decodeBeatEvents(beatActivations, true, message => {
      statusMessage.value = message
    })

    const probList = await inferChordModels(preprocessed, message => {
      statusMessage.value = message
    })
    inferredProbList.value = probList

    stage = "decoding"
    status.value = stage
    statusMessage.value = "Decoding chords..."
    rawChords.value = await decodeChords(probList, preprocessed)
    // estimatedChords.value = estimateKey(rawChords.value)
    // estimatedKeyMarkers.value = getKeyMarkers(estimatedChords.value)

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


Object.assign(window, {
  downloadRawCqtData: () => {
    if (!cqt.value) {
      console.warn("No CQT data to download")
      return
    }
    const blob = new Blob([
      cqt.value.data.buffer as ArrayBuffer // in the shape of [bins, frames]
    ], { type: "application/octet-stream" })
    downloadFile(blob, "raw-cqt.f32.bin")
    const metaData = {
      bins: cqt.value.bins,
      frames: cqt.value.frames,
      sr: cqt.value.sr,
      hopLength: cqt.value.hopLength,
      min: cqt.value.min,
      max: cqt.value.max,
    }
    const json = JSON.stringify(metaData, null, 2)
    const blob2 = new Blob([json], { type: "application/json" })
    downloadFile(blob2, "raw-cqt.meta.json")
  },
  downloadProbListJson: () => {
    if (!inferredProbList.value) {
      console.warn("No probability list to download")
      return
    }
    const json = JSON.stringify(inferredProbList.value, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    downloadFile(blob, "prob-list.json")
  },
  downloadRawChordsJson: () => {
    if (!rawChords.value) {
      console.warn("No chords to download")
      return
    }
    const json = JSON.stringify(rawChords.value, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    downloadFile(blob, "raw-chords.json")
  },
  // downloadEstimatedChordsJson: () => {
  //   if (!estimatedChords.value) {
  //     console.warn("No chords to download")
  //     return
  //   }
  //   const json = JSON.stringify(estimatedChords.value, null, 2)
  //   const blob = new Blob([json], { type: "application/json" })
  //   downloadFile(blob, "estimated-chords.json")
  // },
  downloadBeatEventsJson: () => {
    if (!beatEvents.value) {
      console.warn("No beat events to download")
      return
    }
    const json = JSON.stringify(beatEvents.value, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    downloadFile(blob, "beat-events.json")
  },
})
