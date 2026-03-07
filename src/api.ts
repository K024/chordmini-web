import { windowEndpoint, expose } from "comlink"
import { preprocess, inferChordModels, decodeChords } from "./chordmini"


const version = "0.0.1"

interface RecognizeChordsArgs {
  audio: File
  onLogProgress?: (message: string, stepProgress?: number) => void
  
}
async function recognizeChords(args: RecognizeChordsArgs) {
  const { audio, onLogProgress } = args
  const processed = await preprocess(audio, onLogProgress)
  const inferred = await inferChordModels(processed, onLogProgress)
  const decoded = await decodeChords(inferred, processed)
  return decoded
}

export function exposeWindowApi() {
  if (typeof window === "undefined") {
    throw new Error("window is not defined")
  }

  const api = {
    recognizeChords,
    version: () => version,
  }

  expose(api, windowEndpoint(window))
}
