import { ort } from "./ort"
import type { ProbList, ProbMatrix } from "../decoding/xhmm_decoder"


const allModelsSource = import.meta.glob("../assets/*.onnx", {
  eager: true,
  import: "default",
  query: "?url",
})

export const allModels = Object.values(allModelsSource) as string[]


export async function getModelSession(url: string) {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const session = await ort.InferenceSession.create(
    arrayBuffer,
    {
      executionProviders: [
        // "webgpu", // not numerically stable now
        "wasm",
      ],
    }
  )
  return session
}



/** shape: [frames, bins(288)] */
export const inputName = "cqt"

/** shape: [frames, probabilities] */
export const outputNames = ["triad", "bass", "seventh", "ninth", "eleventh", "thirteenth"] as const


export async function inferSession(session: ort.InferenceSession, cqt: ort.Tensor) {
  const output = await session.run({
    [inputName]: cqt,
  })
  return output
}


export async function inferAllSessions(sessions: ort.InferenceSession[], cqt: ort.Tensor) {
  const results: ort.InferenceSession.ReturnType[] = []
  for (const session of sessions) {
    const result = await inferSession(session, cqt)
    results.push(result)
  }
  if (results.length === 1) {
    return toProbList(results[0])
  }

  const averaged = averageInferResults(results)
  return toProbList(averaged)
}


export function averageInferResults(results: ort.InferenceSession.ReturnType[]) {
  const names = Object.keys(results[0])
  const result = {} as Record<string, ort.Tensor>
  for (const name of names) {
    const tensors = results.map((results) => results[name]) as ort.TypedTensor<"float32">[]
    result[name] = averageTensors(tensors)
  }
  return result
}


export function averageTensors(tensors: ort.TypedTensor<"float32">[]) {
  const size = tensors.length
  const shape = tensors[0].dims
  const data = new Float32Array(shape.reduceRight((acc, dim) => acc * dim, 1))
  for (let i = 0; i < data.length; i++) {
    let sum = 0
    for (let j = 0; j < size; j++) {
      sum += tensors[j].data[i]
    }
    data[i] = sum / size
  }
  return new ort.Tensor("float32", data, shape)
}


export function tensorTo2dArray(tensor: ort.Tensor): ProbMatrix {
  const shape = tensor.dims
  if (shape.length !== 2) {
    throw new Error(`Expected 2D tensor, got ${shape.length}D`)
  }
  const data = tensor.data as Float32Array<ArrayBuffer>
  const rows = shape[0]
  const cols = shape[1]
  const result = new Array(rows)
  for (let i = 0; i < rows; i++) {
    const row = result[i] = new Array(cols)
    for (let j = 0; j < cols; j++) {
      row[j] = data[i * cols + j]
    }
  }
  return result
}

export function toProbList(output: ort.InferenceSession.ReturnType): ProbList {
  return outputNames.map((name) => tensorTo2dArray(output[name])) as ProbList
}
