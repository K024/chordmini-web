import beatModelUrl from "../assets/beat_preprocess.onnx?url"
import {
  DEFAULT_CONFIG,
  maybeScaleIntegerLikeSignal,
  type BeatFeatures,
} from "../beat/features"
import { lazyPromise, type ProgressReporter } from "../utils"
import { ort } from "./ort"


const EXPECTED_FEATURES = 314
const EXPECTED_SAMPLE_RATE = DEFAULT_CONFIG.sampleRate
const EXPECTED_HOP_SIZE = Math.round(EXPECTED_SAMPLE_RATE / DEFAULT_CONFIG.fps)


const getSession = lazyPromise(async () => {
  const response = await fetch(beatModelUrl)
  if (!response.ok) {
    throw new Error(`Failed to load beat preprocessing model: ${response.status}`)
  }
  const model = await response.arrayBuffer()
  return ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
  })
})


export async function runBeatOnnx(
  samples: Float32Array,
  sr: number,
  progress?: ProgressReporter,
): Promise<BeatFeatures> {
  if (sr !== EXPECTED_SAMPLE_RATE) {
    throw new Error(`Beat ONNX preprocessing requires ${EXPECTED_SAMPLE_RATE} Hz`)
  }

  progress?.("Loading beat ONNX model...")
  const session = await getSession()
  const signal = maybeScaleIntegerLikeSignal(samples)

  progress?.("Running beat features (ONNX WASM)...")
  const output = await session.run({
    audio: new ort.Tensor("float32", signal, [1, signal.length, 1]),
  })
  const tensor = output.features
  if (!tensor || tensor.dims.length !== 2) {
    throw new Error("Unexpected beat ONNX output")
  }

  const frames = tensor.dims[0]
  const features = tensor.dims[1]
  if (features !== EXPECTED_FEATURES) {
    throw new Error(`Unexpected beat feature count: ${features}`)
  }

  return {
    data: tensor.data as Float32Array,
    frames,
    features,
    frameSizes: [...DEFAULT_CONFIG.frameSizes],
    sr,
    hopSize: EXPECTED_HOP_SIZE,
  }
}


export const beatOnnxConfig = {
  sampleRate: EXPECTED_SAMPLE_RATE,
  hopSize: EXPECTED_HOP_SIZE,
  features: EXPECTED_FEATURES,
}
