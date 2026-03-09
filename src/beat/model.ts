/**
@license

All the madmom_downbeats_*.onnx models are exported from madmom.models.DOWNBEATS_BLSTM

Creative Commons Attribution-NonCommercial-ShareAlike 4.0

The short version of this license:

You are free to:

  Share: copy and redistribute the material in any medium or format
  Adapt: remix, transform, and build upon the material

Under the following terms:

  Attribution:   You must give appropriate credit, provide a link to the
                 license, and indicate if changes were made.
  NonCommercial: You must not use the material for commercial purposes.
  ShareAlike:    If you remix, transform, or build upon the material, you must
                 distribute your contributions under the same license as the
                 original.

All legal details can be found here:
http://creativecommons.org/licenses/by-nc-sa/4.0/legalcode
*/

import { ort } from "../onnx/ort"
import type { Activation } from "./decode_dbn"


const allModelsSource = import.meta.glob("../assets/madmom_downbeats_*.onnx", {
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


/** shape: [frames, spectrum + diffs (314)] */
export const inputName = "features"

/** shape: [frames, softmax activations (2)] */
export const outputNames = ["activations"] as const


export async function inferSession(session: ort.InferenceSession, features: ort.TypedTensor<"float32">) {
  const output = await session.run({
    [inputName]: features,
  })
  return output[outputNames[0]] as ort.TypedTensor<"float32">
}



export function toActivations(output: ort.TypedTensor<"float32">): Activation[] {
  const shape = output.dims
  if (shape.length !== 2) {
    throw new Error(`Expected 2D tensor, got ${shape.length}D`)
  }
  const data = output.data as Float32Array<ArrayBuffer>
  const rows = shape[0]
  const cols = shape[1]
  if (cols !== 2) {
    throw new Error(`Expected 2 columns, got ${cols}`)
  }
  const result = new Array<Activation>(rows)
  for (let i = 0; i < rows; i++) {
    result[i] = [data[i * cols], data[i * cols + 1]]
  }
  return result
}

export { averageTensors } from "../onnx/model"
