import cqtModelUrl from "../assets/cqt_preprocess.onnx?url"
import { CQT_BINS, CQT_HOP_LENGTH, CQT_SAMPLE_RATE } from "../preprocessing/cqtConfig"
import { createCqtOnnxInput } from "../preprocessing/cqtPlan"
import { lazyPromise, type ProgressReporter } from "../utils"
import { ort } from "./ort"


export interface CqtOnnxResult {
  data: Float32Array
  bins: number
  frames: number
  min: number
  max: number
}


const getSession = lazyPromise(async () => {
  const response = await fetch(cqtModelUrl)
  if (!response.ok) {
    throw new Error(`Failed to load CQT preprocessing model: ${response.status}`)
  }
  const model = await response.arrayBuffer()
  return ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
  })
})


export async function runCqtOnnx(
  samples: Float32Array,
  sr: number,
  progress?: ProgressReporter,
): Promise<CqtOnnxResult> {
  if (sr !== CQT_SAMPLE_RATE) {
    throw new Error(`CQT ONNX preprocessing requires ${CQT_SAMPLE_RATE} Hz`)
  }

  progress?.("Loading CQT ONNX model...")
  const session = await getSession()
  const input = createCqtOnnxInput(samples, sr)
  const feeds: Record<string, ort.Tensor> = {
    [input.pseudo.inputName]: new ort.Tensor(
      "float32",
      input.pseudo.samples,
      [1, input.pseudo.samples.length, 1],
    ),
  }
  for (const branch of input.full) {
    feeds[branch.inputName] = new ort.Tensor(
      "float32",
      branch.samples,
      [1, branch.samples.length, 1],
    )
  }

  progress?.("Running hybrid CQT (ONNX WASM)...")
  const output = await session.run(feeds)
  const tensor = output.cqt
  if (!tensor || tensor.dims.length !== 2) {
    throw new Error("Unexpected CQT ONNX output")
  }

  const frames = tensor.dims[0]
  const bins = tensor.dims[1]
  if (bins !== CQT_BINS) {
    throw new Error(`Unexpected CQT bin count: ${bins}`)
  }

  const data = tensor.data as Float32Array
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index]
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }

  return {
    data,
    bins,
    frames,
    min,
    max,
  }
}


export const cqtOnnxConfig = {
  sampleRate: CQT_SAMPLE_RATE,
  hopLength: CQT_HOP_LENGTH,
  bins: CQT_BINS,
}
