import { ort } from "../onnx/ort"
import { allModels, averageInferResults, getModelSession, inferSession, toProbList } from "../onnx/model"
import type { PreprocessResult } from "./preprocess"
import { lazyPromise, type ProgressReporter } from "../utils"


export function createCqtTensor(cqt: Pick<PreprocessResult, "frames" | "bins" | "data">) {
  const frames = cqt.frames
  const bins = cqt.bins
  const data = new Float32Array(frames * bins)
  for (let bin = 0; bin < bins; bin += 1) {
    const rowStart = bin * frames
    for (let frame = 0; frame < frames; frame += 1) {
      data[frame * bins + bin] = cqt.data[rowStart + frame]
    }
  }
  return new ort.Tensor("float32", data, [frames, bins])
}


const getSessions = lazyPromise(async () => {
  const sessions: ort.InferenceSession[] = []
  for (const model of allModels) {
    const session = await getModelSession(model)
    sessions.push(session)
  }
  return sessions
})


export async function inferChordModels(cqt: Pick<PreprocessResult, "frames" | "bins" | "data">, progress?: ProgressReporter) {
  const tensor = createCqtTensor(cqt)
  progress?.("Loading model sessions...")
  const sessions = await getSessions()

  const outputs: ort.InferenceSession.ReturnType[] = []

  for (const [index, session] of sessions.entries()) {
    const percent = ((index + 1) / sessions.length) * 100
    progress?.(`Running model ${index + 1}/${sessions.length}`, percent)
    const result = await inferSession(session, tensor)
    outputs.push(result)
  }

  const averaged = outputs.length === 1
    ? outputs[0]
    : averageInferResults(outputs)

  return toProbList(averaged)
}
