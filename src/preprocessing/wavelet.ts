import { fftInPlace } from "./fft"
import { floatWindow, windowBandwidth } from "./window"
import { l1Normalize, nextPow2, padCenterComplex, quantile } from "./utils"


const flatMap: Record<string, string> = {
  C: "B",
  D: "C#",
  E: "D#",
  F: "E",
  G: "F#",
  A: "G#",
  B: "A#",
}

const pitchClass = "C C# D D# E F F# G G# A A# B".split(" ")

export function noteToHz(note: string): number {
  const noteRegex = /^([A-G])([b#]?)(-?\d+)$/
  const match = noteRegex.exec(note)
  if (!match) throw new Error(`Invalid note ${note}`)
  const [, pitch, accidental, octaveStr] = match
  let name = pitch
  if (accidental === "b") {
    name = flatMap[pitch]
  } else if (accidental === "#") {
    name = `${pitch}#`
  }
  const octave = parseInt(octaveStr, 10)
  const midi = pitchClass.indexOf(name) + (octave + 1) * 12
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function cqtFrequencies(nBins: number, fmin: number, binsPerOctave: number): number[] {
  return Array.from({ length: nBins }, (_, k) => fmin * Math.pow(2, k / binsPerOctave))
}

export function etRelativeBandwidth(binsPerOctave: number): number[] {
  const r = Math.pow(2, 1 / binsPerOctave)
  return [(r * r - 1) / (r * r + 1)]
}

export function relativeBandwidth(freqs: number[]): number[] {
  if (freqs.length <= 1) {
    throw new Error("2 or more frequencies are required to compute bandwidths")
  }
  const logf = freqs.map((f) => Math.log2(f))
  const bpo = new Array(freqs.length).fill(0)
  bpo[0] = 1 / (logf[1] - logf[0])
  bpo[bpo.length - 1] = 1 / (logf[logf.length - 1] - logf[logf.length - 2])
  for (let i = 1; i < bpo.length - 1; i += 1) {
    bpo[i] = 2 / (logf[i + 1] - logf[i - 1])
  }
  return bpo.map((val) => {
    const num = Math.pow(2, 2 / val) - 1
    const den = Math.pow(2, 2 / val) + 1
    return num / den
  })
}

export function waveletLengths(
  freqs: number[],
  sr: number,
  window: "hann",
  filterScale: number,
  gamma: number | null,
  alpha?: number[] | number
): { lengths: number[]; fCutoff: number } {
  if (filterScale <= 0) throw new Error("filter_scale must be positive")
  if (gamma !== null && gamma < 0) throw new Error("gamma must be non-negative")
  if (freqs.some((f) => f <= 0)) throw new Error("frequencies must be positive")
  for (let i = 1; i < freqs.length; i += 1) {
    if (freqs[i - 1] > freqs[i]) throw new Error("frequencies must be ascending")
  }
  let alphaVec: number[]
  if (alpha === undefined) {
    alphaVec = relativeBandwidth(freqs)
  } else if (Array.isArray(alpha)) {
    alphaVec = alpha.slice()
  } else {
    alphaVec = new Array(freqs.length).fill(alpha)
  }
  const gammaVec =
    gamma === null
      ? alphaVec.map((a) => (a * 24.7) / 0.108)
      : new Array(freqs.length).fill(gamma)
  const Q = alphaVec.map((a) => filterScale / a)
  const wbw = windowBandwidth(window)
  const fCutoff = Math.max(
    ...freqs.map((f, i) => f * (1 + 0.5 * wbw / Q[i]) + 0.5 * gammaVec[i])
  )
  const lengths = freqs.map((f, i) => (Q[i] * sr) / (f + gammaVec[i] / alphaVec[i]))
  return { lengths, fCutoff }
}

export function wavelet(
  freqs: number[],
  sr: number,
  window: "hann",
  filterScale: number,
  padFft: boolean,
  norm: number,
  gamma: number,
  alpha?: number[] | number
): { filters: { re: Float32Array; im: Float32Array }[]; lengths: number[]; nFft: number } {
  const { lengths } = waveletLengths(freqs, sr, window, filterScale, gamma, alpha)
  const filters: { re: Float32Array; im: Float32Array }[] = []
  for (let i = 0; i < freqs.length; i += 1) {
    const ilen = lengths[i]
    const start = Math.floor(-ilen / 2)
    const stop = Math.floor(ilen / 2)
    const len = Math.max(0, stop - start)
    const re = new Float32Array(len)
    const im = new Float32Array(len)
    const win = floatWindow(window, len)
    const omega = (2 * Math.PI * freqs[i]) / sr
    for (let n = 0; n < len; n += 1) {
      const phase = omega * (start + n)
      re[n] = win[n] * Math.cos(phase)
      im[n] = win[n] * Math.sin(phase)
    }
    if (norm !== 0) {
      l1Normalize(re, im)
    }
    filters.push({ re, im })
  }
  let maxLen = Math.max(...lengths.map((l) => Math.ceil(l)))
  const nFft = padFft ? nextPow2(Math.ceil(maxLen)) : Math.ceil(maxLen)
  const padded = filters.map((filt) => padCenterComplex(filt.re, filt.im, nFft))
  return { filters: padded, lengths, nFft }
}

export function vqtFilterFFT(
  freqs: number[],
  sr: number,
  filterScale: number,
  norm: number,
  sparsity: number,
  window: "hann",
  gamma: number,
  alpha?: number[] | number,
  hopLength?: number
): {
  fftBasis: { re: Float32Array; im: Float32Array }[]
  nFft: number
  lengths: number[]
} {
  const { filters, lengths, nFft: baseN } = wavelet(
    freqs,
    sr,
    window,
    filterScale,
    true,
    norm,
    gamma,
    alpha
  )
  let nFft = baseN
  if (hopLength !== undefined) {
    const hopPow = nextPow2(hopLength)
    const minN = Math.max(nFft, hopPow * 2)
    nFft = minN
  }
  const nFreq = Math.floor(nFft / 2) + 1
  const fftBasis: { re: Float32Array; im: Float32Array }[] = []
  for (let i = 0; i < filters.length; i += 1) {
    const re = new Float32Array(nFft)
    const im = new Float32Array(nFft)
    re.set(filters[i].re)
    im.set(filters[i].im)
    const scale = lengths[i] / nFft
    for (let k = 0; k < nFft; k += 1) {
      re[k] *= scale
      im[k] *= scale
    }
    fftInPlace(re, im)
    const outRe = new Float32Array(nFreq)
    const outIm = new Float32Array(nFreq)
    for (let k = 0; k < nFreq; k += 1) {
      outRe[k] = re[k]
      outIm[k] = im[k]
    }
    fftBasis.push({ re: outRe, im: outIm })
  }
  if (sparsity > 0) {
    sparsifyRows(fftBasis, sparsity)
  }
  return { fftBasis, nFft, lengths }
}

export function sparsifyRows(
  basis: { re: Float32Array; im: Float32Array }[],
  sparsity: number
) {
  if (sparsity <= 0) return
  for (const row of basis) {
    const mags = new Float32Array(row.re.length)
    let norm = 0
    for (let i = 0; i < row.re.length; i += 1) {
      const mag = Math.hypot(row.re[i], row.im[i])
      mags[i] = mag
      norm += mag
    }
    if (norm === 0) continue
    const sorted = Array.from(mags).sort((a, b) => a - b)
    let cumulative = 0
    let threshold = sorted[sorted.length - 1]
    for (let i = 0; i < sorted.length; i += 1) {
      cumulative += sorted[i] / norm
      if (cumulative >= sparsity) {
        threshold = sorted[i]
        break
      }
    }
    for (let i = 0; i < row.re.length; i += 1) {
      if (mags[i] < threshold) {
        row.re[i] = 0
        row.im[i] = 0
      }
    }
  }
}
