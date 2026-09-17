import { hybridCqt } from "../preprocessing/hybrid_cqt"
import {
  CQT_BINS,
  CQT_BINS_PER_OCTAVE,
  CQT_FMIN,
  CQT_HOP_LENGTH,
} from "../preprocessing/cqtConfig"
import { runCqtOnnx } from "../onnx/cqtPreprocess"
import type { ProgressReporter } from "../utils"


export { CQT_BINS, CQT_BINS_PER_OCTAVE, CQT_FMIN }
export const HOP_LENGTH = CQT_HOP_LENGTH


export interface PreprocessResult {
  duration: number
  bins: number
  frames: number
  sr: number
  hopLength: number
  min: number
  max: number
  data: Float32Array
}


/** [bins, frames] => [frames, bins] as required by the ONNX model */
export function flattenCqt(cqt: number[][]) {
  const bins = cqt.length
  const frames = cqt[0]?.length ?? 0
  const data = new Float32Array(bins * frames)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let bin = 0; bin < bins; bin += 1) {
    const row = cqt[bin]
    for (let frame = 0; frame < frames; frame += 1) {
      const value = row[frame]
      data[frame * bins + bin] = value
      if (value < min) min = value
      if (value > max) max = value
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }

  return { bins, frames, data, min, max }
}


export async function preprocess(decoded: { samples: Float32Array; sr: number; duration: number }, progress?: ProgressReporter): Promise<PreprocessResult> {

  const sr = decoded.sr
  const hopLength = HOP_LENGTH

  if (import.meta.env.VITE_CQT_PREPROCESS !== "js") {
    try {
      const onnx = await runCqtOnnx(decoded.samples, sr, progress)
      return {
        ...onnx,
        sr,
        hopLength,
        duration: decoded.duration,
      }
    } catch (error) {
      console.warn("CQT ONNX preprocessing failed; falling back to JS.", error)
    }
  }

  progress?.("Running hybrid CQT...")
  const cqt = hybridCqt(decoded.samples, {
    sr,
    hopLength,
    fmin: CQT_FMIN,
    nBins: CQT_BINS,
    binsPerOctave: CQT_BINS_PER_OCTAVE,
    tuning: null,
  })

  const flat = flattenCqt(cqt)

  return {
    ...flat,
    sr,
    hopLength,
    duration: decoded.duration,
  }
}
