import { proxy, transfer, wrap } from "comlink"
import { lazy } from "../utils"
import type { ChordSegment, WorkerApi } from "./worker"
import type { ProgressReporter } from "../utils"
import { type PreprocessResult } from "./preprocess"
import type { ProbList } from "../decoding/xhmm_decoder"
import { decodeAndResample, type DecodedAudio } from "./decode"
// import { inferChordModels as _inferChordModels } from "./infer"
import { type BeatEvent, type Activation, type BeatFeatures } from "../beat"


export type { PreprocessResult, ProbList, ChordSegment, DecodedAudio }
export type { BeatEvent, Activation, BeatFeatures }


const getApi = lazy(() =>
  wrap<WorkerApi>(
    new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    })
  )
)

export const sampleRates = {
  chord: 22050,
  beat: 44100,
}


export async function decodeAudio(audio: File, sampleRate: number, progress?: ProgressReporter): Promise<DecodedAudio> {
  progress?.("Decoding audio...")

  const result = await decodeAndResample(audio, sampleRate)
  return result
}


// chord model


export async function preprocess(decoded: DecodedAudio, progress?: ProgressReporter): Promise<PreprocessResult> {
  const api = getApi()

  // transfer `decoded.samples.buffer` to the worker
  const result = await api.preprocess(
    transfer(decoded, [decoded.samples.buffer]),
    progress ? proxy(progress) : undefined
  )
  return result
}


export async function inferChordModels(cqt: Pick<PreprocessResult, "frames" | "bins" | "data">, progress?: ProgressReporter): Promise<ProbList> {
  const api = getApi()
  // `cqt.data.buffer` is copied here
  const dataToSend = {
    frames: cqt.frames,
    bins: cqt.bins,
    data: cqt.data,
  }
  const result = await api.inferChordModels(dataToSend, progress ? proxy(progress) : undefined)
  return result

  // return _inferChordModels(cqt, progress)
}


export async function decodeChords(probList: ProbList, cqt: Pick<PreprocessResult, "sr" | "hopLength">): Promise<ChordSegment[]> {
  const api = getApi()
  const dataToSend = {
    sr: cqt.sr,
    hopLength: cqt.hopLength,
  }
  const result = await api.decodeChords(probList, dataToSend)
  return result
}



// beat model

export async function preprocessBeatFeatures(decoded: DecodedAudio, progress?: ProgressReporter): Promise<BeatFeatures> {
  const api = getApi()

  const result = await api.preprocessBeatFeatures(
    transfer(decoded, [decoded.samples.buffer]),
    progress ? proxy(progress) : undefined
  )
  return result
}


export async function inferBeatModels(features: BeatFeatures, progress?: ProgressReporter): Promise<Activation[]> {
  const api = getApi()
  const result = await api.inferBeatModels(features, progress ? proxy(progress) : undefined)
  return result
}


/** only `multiStep = true` is supported */
export async function decodeBeatEvents(activations: Activation[], multiStep: boolean, progress?: ProgressReporter): Promise<BeatEvent[]> {
  const api = getApi()
  const result = await api.decodeBeatEvents(activations, multiStep, progress ? proxy(progress) : undefined)
  return result
}
