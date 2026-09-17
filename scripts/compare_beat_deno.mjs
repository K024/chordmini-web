import * as ort from "npm:onnxruntime-web@1.30.0/wasm"
import { extractBeatFeatures, maybeScaleIntegerLikeSignal } from "../src/beat/features.ts"

const ROOT = new URL("../", import.meta.url)
const MODEL_PATH = new URL("src/assets/beat_preprocess.onnx", ROOT)
const SAMPLE_RATE = 44_100
const EXPECTED_FEATURES = 314

const sampleCount = Number(Deno.args[0] ?? SAMPLE_RATE * 10)
const relativeTolerance = Number(Deno.args[1] ?? 1e-4)

const signal = new Float32Array(sampleCount)
for (let index = 0; index < signal.length; index += 1) {
  const time = index / SAMPLE_RATE
  const envelope = 0.7 + 0.3 * Math.sin(2 * Math.PI * 2 * time)
  signal[index] = envelope * (
    0.55 * Math.sin(2 * Math.PI * 220 * time) +
    0.25 * Math.sin(2 * Math.PI * 440 * time) +
    0.08 * Math.sin(2 * Math.PI * 880 * time)
  )
}

const jsFeatures = extractBeatFeatures(signal)

ort.env.wasm.numThreads = 1
ort.env.logLevel = "error"

const model = Deno.readFileSync(MODEL_PATH)
const session = await ort.InferenceSession.create(model, {
  executionProviders: ["wasm"],
})
const onnxSignal = maybeScaleIntegerLikeSignal(signal)
const output = await session.run({
  audio: new ort.Tensor("float32", onnxSignal, [1, onnxSignal.length, 1]),
})
const onnxData = output.features.data
const [onnxFrames, onnxFeatures] = output.features.dims

if (onnxFeatures !== EXPECTED_FEATURES || jsFeatures.features !== EXPECTED_FEATURES) {
  throw new Error(
    `Feature mismatch: JS=${jsFeatures.features}, ONNX=${onnxFeatures}`,
  )
}
if (onnxFrames !== jsFeatures.frames) {
  throw new Error(`Frame mismatch: JS=${jsFeatures.frames}, ONNX=${onnxFrames}`)
}

let maxAbsoluteError = 0
let maxRelativeError = 0
let meanAbsoluteError = 0
let squaredError = 0
let squaredExpected = 0
let maxExpected = 0
const featureStats = Array.from({ length: EXPECTED_FEATURES }, () => ({
  maxAbsoluteError: 0,
  meanAbsoluteError: 0,
}))
for (let frame = 0; frame < jsFeatures.frames; frame += 1) {
  for (let feature = 0; feature < EXPECTED_FEATURES; feature += 1) {
    const offset = frame * EXPECTED_FEATURES + feature
    const expected = jsFeatures.data[offset]
    const actual = onnxData[offset]
    const absoluteError = Math.abs(actual - expected)
    const relativeError = absoluteError / Math.max(Math.abs(expected), 1e-6)
    maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError)
    maxRelativeError = Math.max(maxRelativeError, relativeError)
    meanAbsoluteError += absoluteError
    squaredError += absoluteError * absoluteError
    squaredExpected += expected * expected
    maxExpected = Math.max(maxExpected, Math.abs(expected))
    featureStats[feature].maxAbsoluteError = Math.max(
      featureStats[feature].maxAbsoluteError,
      absoluteError,
    )
    featureStats[feature].meanAbsoluteError += absoluteError
  }
}
meanAbsoluteError /= jsFeatures.frames * EXPECTED_FEATURES
const relativeRmse = Math.sqrt(squaredError / Math.max(squaredExpected, 1e-12))
for (const stats of featureStats) {
  stats.meanAbsoluteError /= jsFeatures.frames
}
const worstFeatures = featureStats
  .map((stats, feature) => ({ feature, ...stats }))
  .sort((left, right) => right.meanAbsoluteError - left.meanAbsoluteError)
  .slice(0, 10)

const result = {
  sampleCount,
  frames: jsFeatures.frames,
  features: EXPECTED_FEATURES,
  maxAbsoluteError,
  maxRelativeError,
  meanAbsoluteError,
  relativeRmse,
  maxExpected,
  relativeTolerance,
  worstFeatures,
}
console.log(JSON.stringify(result, null, 2))

if (relativeRmse > relativeTolerance) {
  throw new Error(
    `Beat preprocessing mismatch: relative RMSE ${relativeRmse} > ${relativeTolerance}`,
  )
}
