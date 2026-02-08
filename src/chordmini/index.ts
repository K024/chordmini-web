import { proxy, transfer, wrap } from "comlink"
import { lazy } from "../utils"
import type { ChordSegment, WorkerApi } from "./worker"
import type { ProgressReporter } from "../utils"
import { type PreprocessResult } from "./preprocess"
import type { ProbList } from "../decoding/xhmm_decoder"
import { decodeAndResample, TARGET_SAMPLE_RATE } from "./decode"
// import { inferChordModels as _inferChordModels } from "./infer"


export type { PreprocessResult, ProbList, ChordSegment }


const getApi = lazy(() =>
  wrap<WorkerApi>(
    new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    })
  )
)


export async function preprocess(audio: File, progress?: ProgressReporter): Promise<PreprocessResult> {
  const api = getApi()

  progress?.("Decoding audio...")
  const decoded = await decodeAndResample(audio, TARGET_SAMPLE_RATE)

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
