import { fftInPlace } from "../preprocessing/fft"

export type MadmomDownbeatFeatureConfig = {
  sampleRate: number
  fps: number
  fmin: number
  fmax: number
  fref: number
  normFilters: boolean
  frameSizes: [number, number, number]
  numBands: [number, number, number]
  diffRatio: number
  integerInputMaxRange: number
  autoScaleIntegerLikeInput: boolean
}

export const DEFAULT_CONFIG: MadmomDownbeatFeatureConfig = {
  sampleRate: 44100,
  fps: 100,
  fmin: 30,
  fmax: 17000,
  fref: 440,
  normFilters: true,
  frameSizes: [1024, 2048, 4096],
  numBands: [3, 6, 12],
  diffRatio: 0.5,
  integerInputMaxRange: 32767,
  autoScaleIntegerLikeInput: true,
}

export interface BeatFeatures {
  data: Float32Array
  frames: number
  features: number
  frameSizes: number[]
  sr: number
  hopSize: number
}

export function extractBeatFeatures(
  signal: Float32Array,
  cfg: MadmomDownbeatFeatureConfig = DEFAULT_CONFIG
): BeatFeatures {
  const workingSignal = maybeScaleIntegerLikeSignal(signal, cfg)
  const hopSize = Math.round(cfg.sampleRate / cfg.fps)
  const branches: Float32Array[][] = []
  for (let i = 0; i < cfg.frameSizes.length; i += 1) {
    const frameSize = cfg.frameSizes[i]
    const bands = cfg.numBands[i]
    const frames = frameSignalCentered(workingSignal, frameSize, hopSize)
    const win = hannSymmetric(frameSize)
    const spectrum = stftMagnitude(frames, win)
    const binFreqs = fftBinFrequencies(spectrum[0].length, cfg.sampleRate)
    const filterbank = makeLogFilterbank(binFreqs, bands, cfg)
    const filtered = dot2D(spectrum, filterbank)
    const logSpec = log10Add(filtered, 1)
    const diffFrames = computeDiffFrames(cfg.diffRatio, hopSize, frameSize)
    const diff = positiveTemporalDiff(logSpec, diffFrames)
    branches.push(hstack(logSpec, diff))
  }
  return {
    data: vstack(hstack3(branches[0], branches[1], branches[2])),
    frames: branches[0].length,
    features: branches[0][0].length + branches[1][0].length + branches[2][0].length,
    frameSizes: cfg.frameSizes,
    sr: cfg.sampleRate,
    hopSize: hopSize,
  }
}

function maybeScaleIntegerLikeSignal(
  signal: Float32Array,
  cfg: MadmomDownbeatFeatureConfig
): Float32Array {
  if (!cfg.autoScaleIntegerLikeInput) return signal
  let maxAbs = 0
  for (let i = 0; i < signal.length; i += 1) maxAbs = Math.max(maxAbs, Math.abs(signal[i]))
  if (maxAbs <= 2) return signal
  const inv = 1 / cfg.integerInputMaxRange
  const out = new Float32Array(signal.length)
  for (let i = 0; i < signal.length; i += 1) out[i] = signal[i] * inv
  return out
}

function frameSignalCentered(
  signal: Float32Array,
  frameSize: number,
  hopSize: number
): Float32Array[] {
  const nFrames = Math.ceil(signal.length / hopSize)
  const out: Float32Array[] = new Array(nFrames)
  const half = Math.floor(frameSize / 2)
  for (let i = 0; i < nFrames; i += 1) {
    const ref = i * hopSize
    const start = ref - half
    const frame = new Float32Array(frameSize)
    for (let j = 0; j < frameSize; j += 1) {
      const idx = start + j
      frame[j] = idx >= 0 && idx < signal.length ? signal[idx] : 0
    }
    out[i] = frame
  }
  return out
}

function hannSymmetric(length: number): Float32Array {
  const out = new Float32Array(length)
  if (length <= 1) {
    if (length === 1) out[0] = 1
    return out
  }
  const denom = length - 1
  for (let i = 0; i < length; i += 1) out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
  return out
}

function stftMagnitude(frames: Float32Array[], window: Float32Array): Float32Array[] {
  const frameSize = window.length
  const nBins = frameSize >> 1
  const out: Float32Array[] = new Array(frames.length)
  const re = new Float32Array(frameSize)
  const im = new Float32Array(frameSize)
  for (let t = 0; t < frames.length; t += 1) {
    for (let i = 0; i < frameSize; i += 1) {
      re[i] = frames[t][i] * window[i]
      im[i] = 0
    }
    fftInPlace(re, im)
    const row = new Float32Array(nBins)
    for (let k = 0; k < nBins; k += 1) row[k] = Math.hypot(re[k], im[k])
    out[t] = row
  }
  return out
}

function fftBinFrequencies(numFftBins: number, sr: number): Float32Array {
  const fftSize = numFftBins * 2
  const out = new Float32Array(numFftBins)
  for (let i = 0; i < numFftBins; i += 1) out[i] = (i * sr) / fftSize
  return out
}

function makeLogFilterbank(
  binFreqs: Float32Array,
  bandsPerOctave: number,
  cfg: MadmomDownbeatFeatureConfig
): Float32Array[] {
  const freqs = logFrequencies(bandsPerOctave, cfg.fmin, cfg.fmax, cfg.fref)
  const bins = frequenciesToBins(freqs, binFreqs, true)
  const filters = triangularFilters(bins, cfg.normFilters)
  const nBins = binFreqs.length
  const nBands = filters.length
  const bank: Float32Array[] = Array.from({ length: nBins }, () => new Float32Array(nBands))
  for (let b = 0; b < nBands; b += 1) {
    const filt = filters[b]
    for (let i = 0; i < filt.data.length; i += 1) {
      const row = filt.start + i
      if (row >= 0 && row < nBins) bank[row][b] = Math.max(bank[row][b], filt.data[i])
    }
  }
  return bank
}

function logFrequencies(bpo: number, fmin: number, fmax: number, fref: number): number[] {
  const left = Math.floor(Math.log2(fmin / fref) * bpo)
  const right = Math.ceil(Math.log2(fmax / fref) * bpo)
  const out: number[] = []
  for (let k = left; k < right; k += 1) {
    const f = fref * 2 ** (k / bpo)
    if (f >= fmin && f <= fmax) out.push(f)
  }
  return out
}

function frequenciesToBins(freqs: number[], binFreqs: Float32Array, unique: boolean): number[] {
  const out: number[] = []
  for (const f of freqs) {
    let hi = 0
    while (hi < binFreqs.length && binFreqs[hi] < f) hi += 1
    if (hi <= 0) {
      out.push(0)
      continue
    }
    if (hi >= binFreqs.length) {
      out.push(binFreqs.length - 1)
      continue
    }
    const left = binFreqs[hi - 1]
    const right = binFreqs[hi]
    out.push(f - left < right - f ? hi - 1 : hi)
  }
  if (!unique) return out
  return [...new Set(out)]
}

function triangularFilters(bins: number[], norm: boolean): { data: Float32Array; start: number }[] {
  const out: { data: Float32Array; start: number }[] = []
  if (bins.length < 3) return out
  for (let i = 0; i + 2 < bins.length; i += 1) {
    let start = bins[i]
    let center = bins[i + 1]
    let stop = bins[i + 2]
    if (stop - start < 2) {
      center = start
      stop = start + 1
    }
    const len = stop - start
    if (len <= 0) continue
    const data = new Float32Array(len)
    const c = center - start
    if (c > 0) for (let j = 0; j < c; j += 1) data[j] = j / c
    const downLen = stop - center
    for (let j = 0; j < downLen; j += 1) data[c + j] = 1 - j / downLen
    if (norm) {
      let s = 0
      for (let j = 0; j < data.length; j += 1) s += data[j]
      if (s > 0) {
        const inv = 1 / s
        for (let j = 0; j < data.length; j += 1) data[j] *= inv
      }
    }
    out.push({ data, start })
  }
  return out
}

function dot2D(a: Float32Array[], b: Float32Array[]): Float32Array[] {
  const t = a.length
  const f = a[0]?.length ?? 0
  const bands = b[0]?.length ?? 0
  const out: Float32Array[] = new Array(t)
  for (let i = 0; i < t; i += 1) {
    const row = new Float32Array(bands)
    for (let k = 0; k < f; k += 1) {
      const v = a[i][k]
      if (v === 0) continue
      const bk = b[k]
      for (let j = 0; j < bands; j += 1) row[j] += v * bk[j]
    }
    out[i] = row
  }
  return out
}

function log10Add(x: Float32Array[], add: number): Float32Array[] {
  const out: Float32Array[] = new Array(x.length)
  for (let i = 0; i < x.length; i += 1) {
    const row = new Float32Array(x[i].length)
    for (let j = 0; j < row.length; j += 1) row[j] = Math.log10(x[i][j] + add)
    out[i] = row
  }
  return out
}

function computeDiffFrames(diffRatio: number, hopSize: number, frameSize: number): number {
  const win = hannSymmetric(frameSize)
  let maxVal = 0
  for (let i = 0; i < win.length; i += 1) maxVal = Math.max(maxVal, win[i])
  const threshold = diffRatio * maxVal
  let sample = 0
  while (sample < win.length && !(win[sample] > threshold)) sample += 1
  const diffSamples = win.length / 2 - sample
  return Math.max(1, Math.round(diffSamples / hopSize))
}

function positiveTemporalDiff(spec: Float32Array[], diffFrames: number): Float32Array[] {
  const out: Float32Array[] = new Array(spec.length)
  for (let t = 0; t < spec.length; t += 1) {
    const row = new Float32Array(spec[t].length)
    if (t >= diffFrames) {
      const prev = spec[t - diffFrames]
      for (let f = 0; f < row.length; f += 1) row[f] = Math.max(0, spec[t][f] - prev[f])
    }
    out[t] = row
  }
  return out
}

function hstack(a: Float32Array[], b: Float32Array[]): Float32Array[] {
  const out: Float32Array[] = new Array(a.length)
  for (let i = 0; i < a.length; i += 1) {
    const row = new Float32Array(a[i].length + b[i].length)
    row.set(a[i], 0)
    row.set(b[i], a[i].length)
    out[i] = row
  }
  return out
}

function hstack3(a: Float32Array[], b: Float32Array[], c: Float32Array[]): Float32Array[] {
  const out: Float32Array[] = new Array(a.length)
  for (let i = 0; i < a.length; i += 1) {
    const row = new Float32Array(a[i].length + b[i].length + c[i].length)
    row.set(a[i], 0)
    row.set(b[i], a[i].length)
    row.set(c[i], a[i].length + b[i].length)
    out[i] = row
  }
  return out
}

function vstack(features: Float32Array[]): Float32Array {
  const t = features.length
  const d = t > 0 ? features[0].length : 0
  const flat = new Float32Array(t * d)
  for (let i = 0; i < t; i += 1) flat.set(features[i], i * d)
  return flat
}
