import { ort } from "../onnx/ort"
import { lazyPromise, type ProgressReporter } from "../utils"
import type { BeatFeatures } from "./features"
import { allModels, averageTensors, getModelSession, inferSession, toActivations } from "./model"



const getSessions = lazyPromise(async () => {
  const sessions: ort.InferenceSession[] = []
  for (const model of allModels) {
    const session = await getModelSession(model)
    sessions.push(session)
  }
  return sessions
})



export async function inferBeatModels(features: BeatFeatures, progress?: ProgressReporter) {
  const tensor = new ort.Tensor("float32", features.data, [features.frames, features.features])

  const sessions = await getSessions()

  const outputs: ort.TypedTensor<"float32">[] = []

  for (const [index, session] of sessions.entries()) {
    const percent = (index / sessions.length) * 100
    progress?.(`Running beat model ${index + 1}/${sessions.length}`, percent)
    const result = await inferSession(session, tensor)
    outputs.push(result)
  }

  progress?.("Averaging beat model results...", 100)

  const averaged = outputs.length === 1
    ? outputs[0]
    : averageTensors(outputs)

  return toActivations(averaged)
}
