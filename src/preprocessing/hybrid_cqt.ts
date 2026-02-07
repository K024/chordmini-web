/**
@license

Modified from librosa.core.hybrid_cqt

ISC License

Copyright (c) 2013--2023, librosa development team.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

import { stft } from "./stft"
import { resamplePolyDown2 } from "./resample"
import {
  cqtFrequencies,
  etRelativeBandwidth,
  noteToHz,
  relativeBandwidth,
  vqtFilterFFT,
  waveletLengths,
} from "./wavelet"

export type HybridCqtParams = {
  sr?: number
  hopLength?: number
  fmin?: number
  nBins?: number
  binsPerOctave?: number
  tuning?: number | null
  filterScale?: number
  norm?: number
  sparsity?: number
  window?: "hann"
  scale?: boolean
  resType?: "polyphase"
}

export function hybridCqt(y: Float32Array, params: HybridCqtParams = {}): number[][] {
  const sr = params.sr ?? 22050
  const hopLength = params.hopLength ?? 512
  let fmin = params.fmin ?? noteToHz("C1")
  const nBins = params.nBins ?? 84
  const binsPerOctave = params.binsPerOctave ?? 12
  const tuning = params.tuning ?? 0.0
  const filterScale = params.filterScale ?? 1
  const norm = params.norm ?? 1
  const sparsity = params.sparsity ?? 0.01
  const window = params.window ?? "hann"
  const scale = params.scale ?? true
  const resType = params.resType ?? "polyphase"

  fmin = fmin * Math.pow(2, tuning / binsPerOctave)
  const freqs = cqtFrequencies(nBins, fmin, binsPerOctave)
  const alpha = nBins === 1 ? etRelativeBandwidth(binsPerOctave) : relativeBandwidth(freqs)
  const { lengths } = waveletLengths(freqs, sr, window, filterScale, 0, alpha)

  const pseudoFilters = lengths.map(
    (len) => Math.pow(2, Math.ceil(Math.log2(len))) < 2 * hopLength
  )
  const nBinsPseudo = pseudoFilters.filter(Boolean).length
  const nBinsFull = nBins - nBinsPseudo

  const cqtResp: number[][][] = []
  if (nBinsPseudo > 0) {
    const fminPseudo = Math.min(...freqs.filter((_, idx) => pseudoFilters[idx]))
    cqtResp.push(
      pseudoCqt(y, {
        sr,
        hopLength,
        fmin: fminPseudo,
        nBins: nBinsPseudo,
        binsPerOctave,
        tuning: 0.0,
        filterScale,
        norm,
        sparsity,
        window,
        scale,
        resType,
      })
    )
  }
  if (nBinsFull > 0) {
    cqtResp.push(
      fullCqt(y, {
        sr,
        hopLength,
        fmin,
        nBins: nBinsFull,
        binsPerOctave,
        tuning: 0.0,
        filterScale,
        norm,
        sparsity,
        window,
        scale,
        resType,
      })
    )
  }
  return trimStack(cqtResp, nBins)
}

export function pseudoCqt(
  y: Float32Array,
  params: Required<Omit<HybridCqtParams, "sparsity">> & { sparsity: number }
): number[][] {
  const sr = params.sr
  const hopLength = params.hopLength
  let fmin = params.fmin
  const nBins = params.nBins
  const binsPerOctave = params.binsPerOctave
  const tuning = params.tuning ?? 0.0
  const filterScale = params.filterScale
  const norm = params.norm
  const sparsity = params.sparsity
  const window = params.window
  const scale = params.scale

  fmin = fmin * Math.pow(2, tuning / binsPerOctave)
  const freqs = cqtFrequencies(nBins, fmin, binsPerOctave)
  const alpha = nBins === 1 ? etRelativeBandwidth(binsPerOctave) : relativeBandwidth(freqs)
  const { lengths } = waveletLengths(freqs, sr, window, filterScale, 0, alpha)

  const { fftBasis, nFft } = vqtFilterFFT(
    freqs,
    sr,
    filterScale,
    norm,
    sparsity,
    window,
    0,
    alpha,
    hopLength
  )

  const D = stft(y, nFft, hopLength, "hann", true)
  const nFreq = D.re.length
  const nFrames = D.re[0].length
  const Dmag: Float32Array[] = new Array(nFreq)
  for (let f = 0; f < nFreq; f += 1) {
    const row = new Float32Array(nFrames)
    for (let t = 0; t < nFrames; t += 1) {
      row[t] = Math.hypot(D.re[f][t], D.im[f][t])
    }
    Dmag[f] = row
  }
  const C = cqtResponseReal(fftBasis.map((b) => absComplexRow(b)), Dmag)

  const scaleFactor = scale ? 1 / Math.sqrt(nFft) : 1
  for (let i = 0; i < C.length; i += 1) {
    const lenScale = scale ? scaleFactor : Math.sqrt(lengths[i] / nFft)
    for (let t = 0; t < C[i].length; t += 1) {
      C[i][t] *= lenScale
    }
  }
  return C
}

export function fullCqt(
  y: Float32Array,
  params: Required<HybridCqtParams>
): number[][] {
  const sr = params.sr
  const hopLength = params.hopLength
  let fmin = params.fmin
  const nBins = params.nBins
  const binsPerOctave = params.binsPerOctave
  const tuning = params.tuning ?? 0.0
  const filterScale = params.filterScale
  const norm = params.norm
  const sparsity = params.sparsity
  const window = params.window
  const scale = params.scale
  const resType = params.resType ?? "polyphase"

  fmin = fmin * Math.pow(2, tuning / binsPerOctave)
  const freqs = cqtFrequencies(nBins, fmin, binsPerOctave)
  return vqtMagnitude(y, {
    sr,
    hopLength,
    freqs,
    binsPerOctave,
    filterScale,
    norm,
    sparsity,
    window,
    scale,
    resType,
  })
}

function absComplexRow(row: { re: Float32Array; im: Float32Array }): Float32Array {
  const out = new Float32Array(row.re.length)
  for (let i = 0; i < row.re.length; i += 1) {
    out[i] = Math.hypot(row.re[i], row.im[i])
  }
  return out
}

function cqtResponseReal(
  basis: Float32Array[],
  Dmag: Float32Array[]
): number[][] {
  const nBins = basis.length
  const nFrames = Dmag[0].length
  const result: number[][] = Array.from({ length: nBins }, () => new Array(nFrames).fill(0))
  for (let k = 0; k < nBins; k += 1) {
    const basisRow = basis[k]
    for (let t = 0; t < nFrames; t += 1) {
      let acc = 0
      for (let f = 0; f < basisRow.length; f += 1) {
        acc += basisRow[f] * Dmag[f][t]
      }
      result[k][t] = acc
    }
  }
  return result
}

function cqtResponseComplex(
  basis: { re: Float32Array; im: Float32Array }[],
  D: { re: Float32Array[]; im: Float32Array[] }
): { re: number; im: number }[][] {
  const nBins = basis.length
  const nFrames = D.re[0].length
  const result: { re: number; im: number }[][] = Array.from({ length: nBins }, () =>
    new Array(nFrames).fill(0).map(() => ({ re: 0, im: 0 }))
  )
  for (let k = 0; k < nBins; k += 1) {
    const basisRe = basis[k].re
    const basisIm = basis[k].im
    for (let t = 0; t < nFrames; t += 1) {
      let accRe = 0
      let accIm = 0
      for (let f = 0; f < basisRe.length; f += 1) {
        const dRe = D.re[f][t]
        const dIm = D.im[f][t]
        accRe += basisRe[f] * dRe - basisIm[f] * dIm
        accIm += basisRe[f] * dIm + basisIm[f] * dRe
      }
      result[k][t] = { re: accRe, im: accIm }
    }
  }
  return result
}

function vqtMagnitude(
  y: Float32Array,
  params: {
    sr: number
    hopLength: number
    freqs: number[]
    binsPerOctave: number
    filterScale: number
    norm: number
    sparsity: number
    window: "hann"
    scale: boolean
    resType: "polyphase"
  }
): number[][] {
  const nBins = params.freqs.length
  const nOctaves = Math.ceil(nBins / params.binsPerOctave)
  const nFilters = Math.min(params.binsPerOctave, nBins)
  const freqs = params.freqs
  const alpha = nBins === 1 ? etRelativeBandwidth(params.binsPerOctave) : relativeBandwidth(freqs)
  const { lengths, fCutoff } = waveletLengths(
    freqs,
    params.sr,
    params.window,
    params.filterScale,
    0,
    alpha
  )
  const nyquist = params.sr / 2
  if (fCutoff > nyquist) {
    throw new Error("Wavelet basis would exceed Nyquist frequency")
  }

  let { y: yDs, sr: srDs, hopLength: hopDs } = earlyDownsample(
    y,
    params.sr,
    params.hopLength,
    nOctaves,
    nyquist,
    fCutoff,
    params.scale,
    params.resType
  )

  const vqtResp: { re: number[][]; im: number[][] }[] = []
  let myY = yDs
  let mySr = srDs
  let myHop = hopDs
  for (let i = 0; i < nOctaves; i += 1) {
    const slStart = i === 0 ? nBins - nFilters : Math.max(0, nBins - nFilters * (i + 1))
    const slEnd = i === 0 ? nBins : nBins - nFilters * i
    const freqsOct = freqs.slice(slStart, slEnd)
    const alphaOct = alpha.slice(slStart, slEnd)
    const { fftBasis, nFft } = vqtFilterFFT(
      freqsOct,
      mySr,
      params.filterScale,
      params.norm,
      params.sparsity,
      params.window,
      0,
      alphaOct
    )
    const scaleFactor = Math.sqrt(params.sr / mySr)
    for (const row of fftBasis) {
      for (let k = 0; k < row.re.length; k += 1) {
        row.re[k] *= scaleFactor
        row.im[k] *= scaleFactor
      }
    }
    const D = stft(myY, nFft, myHop, "ones", true)
    const response = cqtResponseComplex(fftBasis, D)
    vqtResp.push(responseToMatrices(response))

    if (myHop % 2 === 0) {
      myHop = Math.floor(myHop / 2)
      mySr /= 2
      myY = resampleDown2(myY, params.resType)
    }
  }

  const V = trimStackComplex(vqtResp, nBins)
  if (params.scale) {
    const { lengths: lengthsFull } = waveletLengths(
      freqs,
      params.sr,
      params.window,
      params.filterScale,
      0,
      alpha
    )
    for (let k = 0; k < nBins; k += 1) {
      const lenScale = Math.sqrt(lengthsFull[k])
      for (let t = 0; t < V.re[k].length; t += 1) {
        V.re[k][t] /= lenScale
        V.im[k][t] /= lenScale
      }
    }
  }
  const out: number[][] = Array.from({ length: nBins }, () =>
    new Array(V.re[0].length).fill(0)
  )
  for (let k = 0; k < nBins; k += 1) {
    for (let t = 0; t < V.re[0].length; t += 1) {
      out[k][t] = Math.hypot(V.re[k][t], V.im[k][t])
    }
  }
  return out
}

function responseToMatrices(
  resp: { re: number; im: number }[][]
): { re: number[][]; im: number[][] } {
  const nBins = resp.length
  const nFrames = resp[0].length
  const re: number[][] = Array.from({ length: nBins }, () => new Array(nFrames).fill(0))
  const im: number[][] = Array.from({ length: nBins }, () => new Array(nFrames).fill(0))
  for (let k = 0; k < nBins; k += 1) {
    for (let t = 0; t < nFrames; t += 1) {
      re[k][t] = resp[k][t].re
      im[k][t] = resp[k][t].im
    }
  }
  return { re, im }
}

function trimStackComplex(
  stack: { re: number[][]; im: number[][] }[],
  nBins: number
): { re: number[][]; im: number[][] } {
  const maxCol = Math.min(...stack.map((c) => c.re[0].length))
  const outRe: number[][] = Array.from({ length: nBins }, () => new Array(maxCol).fill(0))
  const outIm: number[][] = Array.from({ length: nBins }, () => new Array(maxCol).fill(0))
  let end = nBins
  for (const cqt of stack) {
    const nOct = cqt.re.length
    if (end < nOct) {
      const start = nOct - end
      for (let i = 0; i < end; i += 1) {
        outRe[i] = cqt.re[start + i].slice(0, maxCol)
        outIm[i] = cqt.im[start + i].slice(0, maxCol)
      }
    } else {
      const start = end - nOct
      for (let i = 0; i < nOct; i += 1) {
        outRe[start + i] = cqt.re[i].slice(0, maxCol)
        outIm[start + i] = cqt.im[i].slice(0, maxCol)
      }
    }
    end -= nOct
  }
  return { re: outRe, im: outIm }
}

function earlyDownsample(
  y: Float32Array,
  sr: number,
  hopLength: number,
  nOctaves: number,
  nyquist: number,
  filterCutoff: number,
  scale: boolean,
  resType: "polyphase"
): { y: Float32Array; sr: number; hopLength: number } {
  const downsampleCount = earlyDownsampleCount(nyquist, filterCutoff, hopLength, nOctaves)
  if (downsampleCount <= 0) {
    return { y, sr, hopLength }
  }
  const downsampleFactor = Math.pow(2, downsampleCount)
  let newHop = Math.floor(hopLength / downsampleFactor)
  let newSr = sr / downsampleFactor
  let yOut = y
  for (let i = 0; i < downsampleCount; i += 1) {
    yOut = resampleDown2(yOut, resType)
  }
  if (!scale) {
    const factor = Math.sqrt(downsampleFactor)
    for (let i = 0; i < yOut.length; i += 1) {
      yOut[i] *= factor
    }
  }
  return { y: yOut, sr: newSr, hopLength: newHop }
}

function earlyDownsampleCount(
  nyquist: number,
  filterCutoff: number,
  hopLength: number,
  nOctaves: number
): number {
  const downsampleCount1 = Math.max(0, Math.ceil(Math.log2(nyquist / filterCutoff)) - 2)
  const numTwos = numTwoFactors(hopLength)
  const downsampleCount2 = Math.max(0, numTwos - nOctaves + 1)
  return Math.min(downsampleCount1, downsampleCount2)
}

function numTwoFactors(x: number): number {
  if (x <= 0) return 0
  let num = 0
  let value = Math.floor(x)
  while (value % 2 === 0) {
    num += 1
    value = Math.floor(value / 2)
  }
  return num
}

function resampleDown2(input: Float32Array, resType: "polyphase"): Float32Array {
  if (resType !== "polyphase") {
    throw new Error(`Unsupported resType ${resType}`)
  }
  return resamplePolyDown2(input, true)
}

function trimStack(stack: number[][][], nBins: number): number[][] {
  const maxCol = Math.min(...stack.map((c) => c[0].length))
  const out: number[][] = Array.from({ length: nBins }, () => new Array(maxCol).fill(0))
  let end = nBins
  for (const cqt of stack) {
    const nOct = cqt.length
    if (end < nOct) {
      const start = nOct - end
      for (let i = 0; i < end; i += 1) {
        out[i] = cqt[start + i].slice(0, maxCol)
      }
    } else {
      const start = end - nOct
      for (let i = 0; i < nOct; i += 1) {
        out[start + i] = cqt[i].slice(0, maxCol)
      }
    }
    end -= nOct
  }
  return out
}
