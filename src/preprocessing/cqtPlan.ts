import {
  CQT_BINS,
  CQT_BINS_PER_OCTAVE,
  CQT_FMIN,
  CQT_HOP_LENGTH,
  CQT_SAMPLE_RATE,
} from "./cqtConfig"
import { resamplePolyDown2 } from "./resample"
import {
  cqtFrequencies,
  relativeBandwidth,
  waveletLengths,
} from "./wavelet"


export interface CqtBranch {
  inputName: string
  samples: Float32Array
  hopLength: number
  bins: number
}

export interface CqtOnnxInput {
  pseudo: CqtBranch
  full: CqtBranch[]
}


interface CqtPlan {
  pseudoBins: number
  fullBins: number
  fullOctaves: number
  earlyDownsampleCount: number
}


const planCache = new Map<number, CqtPlan>()


function numTwoFactors(value: number): number {
  let count = 0
  let remaining = Math.floor(value)
  while (remaining > 0 && remaining % 2 === 0) {
    count += 1
    remaining = Math.floor(remaining / 2)
  }
  return count
}


function createPlan(sr: number): CqtPlan {
  const frequencies = cqtFrequencies(
    CQT_BINS,
    CQT_FMIN,
    CQT_BINS_PER_OCTAVE,
  )
  const alpha = relativeBandwidth(frequencies)
  const { lengths } = waveletLengths(
    frequencies,
    sr,
    "hann",
    1,
    0,
    alpha,
  )
  const pseudoFilters = lengths.map(
    (length) => nextPowerOfTwo(length) < 2 * CQT_HOP_LENGTH,
  )
  const pseudoBins = pseudoFilters.filter(Boolean).length
  const fullBins = CQT_BINS - pseudoBins
  const fullFrequencies = cqtFrequencies(
    fullBins,
    CQT_FMIN,
    CQT_BINS_PER_OCTAVE,
  )
  const fullAlpha = relativeBandwidth(fullFrequencies)
  const { fCutoff } = waveletLengths(
    fullFrequencies,
    sr,
    "hann",
    1,
    0,
    fullAlpha,
  )
  const fullOctaves = Math.ceil(fullBins / CQT_BINS_PER_OCTAVE)

  const downsampleByNyquist = Math.max(
    0,
    Math.ceil(Math.log2(sr / 2 / fCutoff)) - 2,
  )
  const downsampleByHop = Math.max(
    0,
    numTwoFactors(CQT_HOP_LENGTH) - fullOctaves + 1,
  )

  return {
    pseudoBins,
    fullBins,
    fullOctaves,
    earlyDownsampleCount: Math.min(downsampleByNyquist, downsampleByHop),
  }
}


function nextPowerOfTwo(value: number): number {
  return 1 << Math.ceil(Math.log2(Math.max(1, value)))
}


export function getCqtPlan(sr: number): CqtPlan {
  let plan = planCache.get(sr)
  if (!plan) {
    plan = createPlan(sr)
    planCache.set(sr, plan)
  }
  return plan
}


export function createCqtOnnxInput(
  samples: Float32Array,
  sr: number,
): CqtOnnxInput {
  if (sr !== CQT_SAMPLE_RATE) {
    throw new Error(`CQT ONNX preprocessing requires ${CQT_SAMPLE_RATE} Hz`)
  }

  const plan = getCqtPlan(sr)
  let fullSamples = samples
  for (let index = 0; index < plan.earlyDownsampleCount; index += 1) {
    fullSamples = resamplePolyDown2(fullSamples)
  }

  let hopLength =
    CQT_HOP_LENGTH / 2 ** plan.earlyDownsampleCount
  const full: CqtBranch[] = []
  for (let index = 0; index < plan.fullOctaves; index += 1) {
    full.push({
      inputName: `full_signal_${index}`,
      samples: fullSamples,
      hopLength,
      bins: Math.min(
        CQT_BINS_PER_OCTAVE,
        plan.fullBins - index * CQT_BINS_PER_OCTAVE,
      ),
    })
    if (index + 1 < plan.fullOctaves && hopLength % 2 === 0) {
      fullSamples = resamplePolyDown2(fullSamples)
      hopLength /= 2
    }
  }

  return {
    pseudo: {
      inputName: "pseudo_signal",
      samples,
      hopLength: CQT_HOP_LENGTH,
      bins: plan.pseudoBins,
    },
    full,
  }
}
