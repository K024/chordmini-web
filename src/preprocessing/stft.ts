import { fftInPlace } from "./fft"
import { getWindow } from "./window"
import { padConstant } from "./utils"

export type ComplexMatrix = { re: Float32Array[]; im: Float32Array[] }

export function stft(
  y: Float32Array,
  nFft: number,
  hopLength: number,
  window: "hann" | "ones",
  center = true
): ComplexMatrix {
  let signal = y
  if (center) {
    const pad = Math.floor(nFft / 2)
    signal = padConstant(signal, pad)
  }
  const win = getWindow(window, nFft, true)
  const nFrames = 1 + Math.floor((signal.length - nFft) / hopLength)
  const nFreq = Math.floor(nFft / 2) + 1
  const outRe: Float32Array[] = new Array(nFreq)
  const outIm: Float32Array[] = new Array(nFreq)
  for (let f = 0; f < nFreq; f += 1) {
    outRe[f] = new Float32Array(nFrames)
    outIm[f] = new Float32Array(nFrames)
  }
  const frameRe = new Float32Array(nFft)
  const frameIm = new Float32Array(nFft)
  for (let t = 0; t < nFrames; t += 1) {
    const offset = t * hopLength
    for (let i = 0; i < nFft; i += 1) {
      frameRe[i] = signal[offset + i] * win[i]
      frameIm[i] = 0
    }
    fftInPlace(frameRe, frameIm)
    for (let f = 0; f < nFreq; f += 1) {
      outRe[f][t] = frameRe[f]
      outIm[f][t] = frameIm[f]
    }
  }
  return { re: outRe, im: outIm }
}
