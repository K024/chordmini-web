import type { DecodedAudio } from "../chordmini/decode"
import type { ProgressReporter } from "../utils"
import { extractBeatFeatures, type BeatFeatures } from "./features"
import { runBeatOnnx } from "../onnx/beatPreprocess"
// import { decodeOfflineEvents, type BeatEvent } from "./decode_dbn"
import { decodeOfflineEventsMultiStep, type Activation, type MeteredBeatEvent as BeatEvent } from "./decode_multi_step"


export type { BeatFeatures, Activation, BeatEvent }


export async function preprocessBeatFeatures(decoded: DecodedAudio, progress?: ProgressReporter): Promise<BeatFeatures> {
  progress?.("Extracting beat features...")

  if (import.meta.env.VITE_BEAT_PREPROCESS !== "js") {
    try {
      return await runBeatOnnx(decoded.samples, decoded.sr, progress)
    } catch (error) {
      console.warn("Beat ONNX preprocessing failed; falling back to JS.", error)
    }
  }

  const features = extractBeatFeatures(decoded.samples)
  return features
}

export { inferBeatModels } from "./infer"


export async function decodeBeatEvents(activations: Activation[], multiStep: boolean, progress?: ProgressReporter): Promise<BeatEvent[]> {
  progress?.("Decoding beat events...")
  if (multiStep) {
    const events = decodeOfflineEventsMultiStep(activations)
    return events
  }
  // avoid to use: costs too much memory, may fail to allocate
  throw new Error("Not implemented: use multi-step decoding instead")
  // const events = decodeOfflineEvents(activations)
  // return events
}
