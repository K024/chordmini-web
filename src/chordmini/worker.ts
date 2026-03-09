import { expose, transfer, } from "comlink"
import { lazy, type ProgressReporter } from "../utils"
import { XHMMDecoder, type ProbList } from "../decoding/xhmm_decoder"
import { preprocess, type PreprocessResult } from "./preprocess"
import { inferChordModels } from "./infer"
import type { DecodedAudio } from "./decode"
import { preprocessBeatFeatures, inferBeatModels, decodeBeatEvents, type BeatEvent, type Activation, type BeatFeatures } from "../beat"


export interface ChordSegment {
  start: number
  end: number
  label: string
}


const getDecoder = lazy(() => XHMMDecoder.fromVocab("submission"))


const api = {
  preprocess: async (decoded: DecodedAudio, progress?: ProgressReporter): Promise<PreprocessResult> => {
    const result = await preprocess(decoded, progress)
    return transfer(
      result,
      [result.data.buffer]
    )
  },
  inferChordModels: async (cqt: Pick<PreprocessResult, "frames" | "bins" | "data">, progress?: ProgressReporter): Promise<ProbList> => {
    const result = await inferChordModels(cqt, progress)
    return result
  },
  decodeChords: async (probList: ProbList, cqt: Pick<PreprocessResult, "sr" | "hopLength">): Promise<ChordSegment[]> => {
    const decoder = getDecoder()
    const chords = decoder.decodeToChordlab(probList, cqt.sr, cqt.hopLength, false)
    return chords.map<ChordSegment>(([start, end, label]) => ({ start, end, label }))
  },

  preprocessBeatFeatures: async (decoded: DecodedAudio, progress?: ProgressReporter): Promise<BeatFeatures> => {
    const result = await preprocessBeatFeatures(decoded, progress)
    return transfer(
      result,
      [result.data.buffer]
    )
  },
  inferBeatModels: async (features: BeatFeatures, progress?: ProgressReporter): Promise<Activation[]> => {
    const result = await inferBeatModels(features, progress)
    return result
  },
  decodeBeatEvents: async (activations: Activation[], multiStep: boolean, progress?: ProgressReporter): Promise<BeatEvent[]> => {
    const result = decodeBeatEvents(activations, multiStep, progress)
    return result
  },
}


console.log("SharedArrayBuffer:", typeof SharedArrayBuffer)

expose(api)

export type WorkerApi = typeof api
