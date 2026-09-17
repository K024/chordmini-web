import * as ort from "npm:onnxruntime-web@1.30.0/wasm"
import { hybridCqt } from "../src/preprocessing/hybrid_cqt.ts"
import { createCqtOnnxInput } from "../src/preprocessing/cqtPlan.ts"

const ROOT = new URL("../", import.meta.url)
const MODEL_PATH = new URL("src/assets/cqt_preprocess.onnx", ROOT)
const SAMPLE_RATE = 22_050
const HOP_LENGTH = 512
const N_BINS = 288
const BINS_PER_OCTAVE = 36
const FMIN = 23.12465141947715

const sampleCount = Number(Deno.args[0] ?? SAMPLE_RATE * 10)
const relativeTolerance = Number(Deno.args[1] ?? 1e-4)

const signal = new Float32Array(sampleCount)
for (let index = 0; index < signal.length; index += 1) {
  const time = index / SAMPLE_RATE
  signal[index] =
    0.55 * Math.sin(2 * Math.PI * 220 * time) +
    0.25 * Math.sin(2 * Math.PI * 440 * time) +
    0.08 * Math.sin(2 * Math.PI * 880 * time)
}

const jsCqt = hybridCqt(signal, {
  sr: SAMPLE_RATE,
  hopLength: HOP_LENGTH,
  fmin: FMIN,
  nBins: N_BINS,
  binsPerOctave: BINS_PER_OCTAVE,
  tuning: null,
})

ort.env.wasm.numThreads = 1
ort.env.logLevel = "error"

const model = Deno.readFileSync(MODEL_PATH)
const session = await ort.InferenceSession.create(model, {
  executionProviders: ["wasm"],
})
const onnxInput = createCqtOnnxInput(signal, SAMPLE_RATE)
const feeds = {
  [onnxInput.pseudo.inputName]: new ort.Tensor(
    "float32",
    onnxInput.pseudo.samples,
    [1, onnxInput.pseudo.samples.length, 1],
  ),
}
for (const branch of onnxInput.full) {
  feeds[branch.inputName] = new ort.Tensor(
    "float32",
    branch.samples,
    [1, branch.samples.length, 1],
  )
}
const output = await session.run(feeds)
const onnxData = output.cqt.data
const [onnxFrames, onnxBins] = output.cqt.dims
const jsFrames = jsCqt[0]?.length ?? 0

if (onnxBins !== N_BINS || jsCqt.length !== N_BINS) {
  throw new Error(`Bin mismatch: JS=${jsCqt.length}, ONNX=${onnxBins}`)
}
if (onnxFrames !== jsFrames) {
  throw new Error(`Frame mismatch: JS=${jsFrames}, ONNX=${onnxFrames}`)
}

let maxAbsoluteError = 0
let maxRelativeError = 0
let meanAbsoluteError = 0
let squaredError = 0
let squaredExpected = 0
let maxExpected = 0
const binStats = Array.from({ length: N_BINS }, () => ({
  maxAbsoluteError: 0,
  meanAbsoluteError: 0,
}))
for (let frame = 0; frame < jsFrames; frame += 1) {
  for (let bin = 0; bin < N_BINS; bin += 1) {
    const expected = jsCqt[bin][frame]
    const actual = onnxData[frame * N_BINS + bin]
    const absoluteError = Math.abs(actual - expected)
    const relativeError = absoluteError / Math.max(Math.abs(expected), 1e-6)
    maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError)
    maxRelativeError = Math.max(maxRelativeError, relativeError)
    meanAbsoluteError += absoluteError
    squaredError += absoluteError * absoluteError
    squaredExpected += expected * expected
    maxExpected = Math.max(maxExpected, Math.abs(expected))
    binStats[bin].maxAbsoluteError = Math.max(
      binStats[bin].maxAbsoluteError,
      absoluteError,
    )
    binStats[bin].meanAbsoluteError += absoluteError
  }
}
meanAbsoluteError /= jsFrames * N_BINS
const relativeRmse = Math.sqrt(squaredError / Math.max(squaredExpected, 1e-12))
for (const stats of binStats) {
  stats.meanAbsoluteError /= jsFrames
}
const worstBins = binStats
  .map((stats, bin) => ({ bin, ...stats }))
  .sort((left, right) => right.meanAbsoluteError - left.meanAbsoluteError)
  .slice(0, 10)

const result = {
  sampleCount,
  frames: jsFrames,
  bins: N_BINS,
  maxAbsoluteError,
  maxRelativeError,
  meanAbsoluteError,
  relativeRmse,
  maxExpected,
  relativeTolerance,
  worstBins,
}
console.log(JSON.stringify(result, null, 2))

if (relativeRmse > relativeTolerance) {
  throw new Error(
    `CQT mismatch: relative RMSE ${relativeRmse} > ${relativeTolerance}`,
  )
}
