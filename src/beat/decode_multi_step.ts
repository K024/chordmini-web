/**
@license 
modified from madmom.features.downbeats.DBNBarTrackingProcessor

Source code files usually have .py, .pyx, .pxd, .c or other well known source
code file extensions.

Unless indicated otherwise (either in the file directly or a LICENCE file
inside any directory), all source code files are published under this license:

Copyright (c) 2012-2014 Department of Computational Perception,
Johannes Kepler University, Linz, Austria and Austrian Research Institute for
Artificial Intelligence (OFAI), Vienna, Austria.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

export type Activation = [p_beat: number, p_downbeat: number]

export type BeatFrame = {
  frame: number
  time: number
  strength: number
}

export type MeteredBeatEvent = {
  time: number
  beatInBar: number
  meter: number
  isDownbeat: boolean
}

export type BeatTrackingParams = {
  minBpm: number
  maxBpm: number
  numTempi: number | null
  transitionLambda: number
  observationLambda: number
  threshold: number
  correct: boolean
  useCombinedBeatDownbeat: boolean
}

export type BarTrackingParams = {
  beatsPerBar: number[]
  observationWeight: number
  meterChangeProb: number
}

export type Postprocess2Options = {
  beat?: Partial<BeatTrackingParams>
  bar?: Partial<BarTrackingParams>
  filterRadiusFrames?: number
}

type BeatStateSpace = {
  numStates: number
  statePositions: Float32Array
  stateIntervals: Int32Array
  firstStates: Int32Array
  lastStates: Int32Array
}

type SparseTransitions = {
  incomingOffsets: Int32Array
  incomingPrev: Int32Array
  incomingLogProb: Float32Array
}

const EPS = 1e-38

const DEFAULT_BEAT: BeatTrackingParams = {
  minBpm: 55,
  maxBpm: 215,
  numTempi: null,
  transitionLambda: 100,
  observationLambda: 4, // default: 16, updated for current blstm models
  threshold: 0.1,
  correct: true,
  useCombinedBeatDownbeat: true,
}

const DEFAULT_BAR: BarTrackingParams = {
  beatsPerBar: [3, 4, 5, 6],
  observationWeight: 100,
  meterChangeProb: 1e-7,
}

export function decodeOfflineEventsMultiStep(
  activations: Activation[],
  fps = 100,
  options: Postprocess2Options = {}
): MeteredBeatEvent[] {
  const beats = extractBeatsFromActivations(activations, fps, options.beat)
  if (beats.length === 0) return []
  const syncedDownbeat = filterDownbeatActivationsAtBeats(
    activations,
    beats,
    options.filterRadiusFrames ?? 1
  )
  return decodeBarPositionsFromBeats(beats, syncedDownbeat, options.bar)
}

export function extractBeatsFromActivations(
  activations2d: Activation[],
  fps = 100,
  params?: Partial<BeatTrackingParams>
): BeatFrame[] {
  if (activations2d.length === 0) return []
  const cfg: BeatTrackingParams = { ...DEFAULT_BEAT, ...params }
  const beatActivations = new Float32Array(activations2d.length)
  for (let i = 0; i < activations2d.length; i += 1) {
    const beat = activations2d[i][0]
    const downbeat = activations2d[i][1]
    beatActivations[i] = cfg.useCombinedBeatDownbeat ? Math.min(1, beat + downbeat) : beat
  }

  const { cropped, first } = thresholdActivations1D(beatActivations, cfg.threshold)
  if (cropped.length === 0) return []

  const minInterval = (60 * fps) / cfg.maxBpm
  const maxInterval = (60 * fps) / cfg.minBpm
  const state = buildBeatStateSpace(minInterval, maxInterval, cfg.numTempi)
  const pointers = buildBeatObservationPointers(state, cfg.observationLambda)
  const transitions = buildBeatTransitions(state, cfg.transitionLambda)

  const { path } = viterbiDecode(
    state.numStates,
    transitions,
    cropped,
    (s, obs) => emissionBeatLog(pointers[s], obs, cfg.observationLambda)
  )
  if (path.length === 0) return []

  const beatFramesCropped = cfg.correct
    ? correctedBeatFrames1D(cropped, pointers, path)
    : beatFramesFromStateMinima(state.statePositions, pointers, path)

  const beats: BeatFrame[] = []
  for (const localFrame of beatFramesCropped) {
    const frame = localFrame + first
    beats.push({
      frame,
      time: frame / fps,
      strength: beatActivations[frame],
    })
  }
  return beats
}

export function filterDownbeatActivationsAtBeats(
  activations2d: Activation[],
  beats: BeatFrame[],
  radiusFrames = 1
): Float32Array {
  const out = new Float32Array(beats.length)
  if (activations2d.length === 0 || beats.length === 0) return out
  const radius = Math.max(0, Math.floor(radiusFrames))
  const maxFrame = activations2d.length - 1
  for (let i = 0; i < beats.length; i += 1) {
    const center = beats[i].frame
    const left = Math.max(0, center - radius)
    const right = Math.min(maxFrame, center + radius)
    let best = 0
    for (let t = left; t <= right; t += 1) {
      const v = activations2d[t][1]
      if (v > best) best = v
    }
    out[i] = best
  }
  return out
}

export function decodeBarPositionsFromBeats(
  beats: BeatFrame[],
  downbeatActivations: Float32Array,
  params?: Partial<BarTrackingParams>
): MeteredBeatEvent[] {
  if (beats.length === 0) return []
  const cfg: BarTrackingParams = { ...DEFAULT_BAR, ...params }
  if (cfg.beatsPerBar.length === 0) return []

  const observations = downbeatActivations.slice(0, Math.max(0, beats.length - 1))
  if (observations.length === 0) {
    const meter = cfg.beatsPerBar[0]
    return beats.map((b, idx) => {
      const beatInBar = (idx % meter) + 1
      return { time: b.time, beatInBar, meter, isDownbeat: beatInBar === 1 }
    })
  }

  const model = buildBarTrackingModel(cfg.beatsPerBar, cfg.meterChangeProb, cfg.observationWeight)
  const { path } = viterbiDecode(
    model.numStates,
    model.transitions,
    observations,
    (s, obs) => emissionBeatLog(model.pointers[s], obs, cfg.observationWeight)
  )
  if (path.length === 0) return []

  const beatNumbers = new Int32Array(path.length + 1)
  const meters = new Int32Array(path.length + 1)
  for (let i = 0; i < path.length; i += 1) {
    const s = path[i]
    const meter = cfg.beatsPerBar[model.statePatterns[s]]
    beatNumbers[i] = Math.floor(model.statePositions[s]) + 1
    meters[i] = meter
  }
  const lastState = path[path.length - 1]
  const lastMeter = cfg.beatsPerBar[model.statePatterns[lastState]]
  beatNumbers[path.length] = (beatNumbers[path.length - 1] % lastMeter) + 1
  meters[path.length] = lastMeter

  const out: MeteredBeatEvent[] = []
  for (let i = 0; i < beats.length; i += 1) {
    const beatInBar = beatNumbers[i]
    const meter = meters[i]
    out.push({
      time: beats[i].time,
      beatInBar,
      meter,
      isDownbeat: beatInBar === 1,
    })
  }
  return out
}

export function extractTimeSignatures(events: MeteredBeatEvent[]): number[] {
  const out: number[] = []
  for (const ev of events) {
    if (out.length === 0 || out[out.length - 1] !== ev.meter) out.push(ev.meter)
  }
  return out
}

function thresholdActivations1D(
  activations: Float32Array,
  threshold: number
): { cropped: Float32Array; first: number } {
  if (threshold <= 0) return { cropped: activations, first: 0 }
  let first = -1
  let last = -1
  for (let i = 0; i < activations.length; i += 1) {
    if (activations[i] >= threshold) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) return { cropped: new Float32Array(0), first: 0 }
  return { cropped: activations.slice(first, last + 1), first }
}

function buildIntervals(minInterval: number, maxInterval: number, numIntervals: number | null): number[] {
  let intervals: number[] = []
  const lo = Math.round(minInterval)
  const hi = Math.round(maxInterval)
  for (let i = lo; i <= hi; i += 1) intervals.push(i)
  if (numIntervals !== null && numIntervals > 0 && numIntervals < intervals.length) {
    let n = numIntervals
    while (intervals.length < numIntervals) {
      const arr: number[] = []
      for (let i = 0; i < n; i += 1) {
        const t = n === 1 ? 0 : i / (n - 1)
        const x = 2 ** (Math.log2(minInterval) * (1 - t) + Math.log2(maxInterval) * t)
        arr.push(Math.round(x))
      }
      intervals = [...new Set(arr)].sort((a, b) => a - b)
      n += 1
    }
  }
  return intervals
}

function buildBeatStateSpace(
  minInterval: number,
  maxInterval: number,
  numIntervals: number | null
): BeatStateSpace {
  const intervals = buildIntervals(minInterval, maxInterval, numIntervals)
  const numStates = intervals.reduce((a, b) => a + b, 0)
  const statePositions = new Float32Array(numStates)
  const stateIntervals = new Int32Array(numStates)
  const firstStates = new Int32Array(intervals.length)
  const lastStates = new Int32Array(intervals.length)

  let offset = 0
  for (let i = 0; i < intervals.length; i += 1) {
    const interval = intervals[i]
    firstStates[i] = offset
    for (let k = 0; k < interval; k += 1) {
      statePositions[offset + k] = k / interval
      stateIntervals[offset + k] = interval
    }
    lastStates[i] = offset + interval - 1
    offset += interval
  }
  return { numStates, statePositions, stateIntervals, firstStates, lastStates }
}

function buildBeatObservationPointers(state: BeatStateSpace, observationLambda: number): Uint8Array {
  const pointers = new Uint8Array(state.numStates)
  const border = 1 / observationLambda
  for (let s = 0; s < state.numStates; s += 1) {
    if (state.statePositions[s] < border) pointers[s] = 1
  }
  return pointers
}

function buildBeatTransitions(state: BeatStateSpace, transitionLambda: number): SparseTransitions {
  const to: number[] = []
  const from: number[] = []
  const probs: number[] = []

  const isFirst = new Uint8Array(state.numStates)
  for (let i = 0; i < state.firstStates.length; i += 1) isFirst[state.firstStates[i]] = 1
  for (let s = 0; s < state.numStates; s += 1) {
    if (!isFirst[s]) {
      to.push(s)
      from.push(s - 1)
      probs.push(1)
    }
  }

  const fromInt = Array.from(state.lastStates, (s) => state.stateIntervals[s])
  const toInt = Array.from(state.firstStates, (s) => state.stateIntervals[s])
  const p = exponentialTransition(fromInt, toInt, transitionLambda)
  for (let i = 0; i < state.lastStates.length; i += 1) {
    for (let j = 0; j < state.firstStates.length; j += 1) {
      const val = p[i][j]
      if (val > 0) {
        to.push(state.firstStates[j])
        from.push(state.lastStates[i])
        probs.push(val)
      }
    }
  }

  return buildIncomingSparse(state.numStates, to, from, probs)
}

function exponentialTransition(fromInt: number[], toInt: number[], lambda: number | null): number[][] {
  const out: number[][] = Array.from({ length: fromInt.length }, () => new Array(toInt.length).fill(0))
  if (lambda === null) {
    for (let i = 0; i < fromInt.length; i += 1) {
      for (let j = 0; j < toInt.length; j += 1) out[i][j] = fromInt[i] === toInt[j] ? 1 : 0
    }
    return out
  }
  for (let i = 0; i < fromInt.length; i += 1) {
    let sum = 0
    for (let j = 0; j < toInt.length; j += 1) {
      const ratio = toInt[j] / fromInt[i]
      const p = Math.exp(-lambda * Math.abs(ratio - 1))
      out[i][j] = p
      sum += p
    }
    if (sum > 0) {
      for (let j = 0; j < toInt.length; j += 1) out[i][j] /= sum
    }
  }
  return out
}

function buildIncomingSparse(
  numStates: number,
  to: number[],
  from: number[],
  probs: number[]
): SparseTransitions {
  const counts = new Int32Array(numStates)
  for (let i = 0; i < to.length; i += 1) counts[to[i]] += 1

  const incomingOffsets = new Int32Array(numStates + 1)
  for (let s = 0; s < numStates; s += 1) incomingOffsets[s + 1] = incomingOffsets[s] + counts[s]

  const incomingPrev = new Int32Array(to.length)
  const incomingLogProb = new Float32Array(to.length)
  const cursor = incomingOffsets.slice(0, numStates)
  for (let i = 0; i < to.length; i += 1) {
    const s = to[i]
    const idx = cursor[s]
    cursor[s] += 1
    incomingPrev[idx] = from[i]
    incomingLogProb[idx] = Math.log(Math.max(probs[i], EPS))
  }
  return { incomingOffsets, incomingPrev, incomingLogProb }
}

function viterbiDecode(
  numStates: number,
  transitions: SparseTransitions,
  observations: ArrayLike<number>,
  emissionLog: (state: number, observation: number) => number
): { path: Int32Array; score: number } {
  const T = observations.length
  if (T === 0 || numStates === 0) return { path: new Int32Array(0), score: Number.NEGATIVE_INFINITY }

  const back = new Int32Array(T * numStates)
  let prev = new Float64Array(numStates)
  let next = new Float64Array(numStates)

  for (let s = 0; s < numStates; s += 1) prev[s] = emissionLog(s, observations[0])

  for (let t = 1; t < T; t += 1) {
    const obs = observations[t]
    for (let s = 0; s < numStates; s += 1) {
      let best = Number.NEGATIVE_INFINITY
      let bestPrev = 0
      const a = transitions.incomingOffsets[s]
      const b = transitions.incomingOffsets[s + 1]
      for (let k = a; k < b; k += 1) {
        const p = transitions.incomingPrev[k]
        const score = prev[p] + transitions.incomingLogProb[k]
        if (score > best) {
          best = score
          bestPrev = p
        }
      }
      next[s] = best + emissionLog(s, obs)
      back[t * numStates + s] = bestPrev
    }
    const tmp = prev
    prev = next
    next = tmp
  }

  let last = 0
  let bestScore = Number.NEGATIVE_INFINITY
  for (let s = 0; s < numStates; s += 1) {
    if (prev[s] > bestScore) {
      bestScore = prev[s]
      last = s
    }
  }

  const path = new Int32Array(T)
  path[T - 1] = last
  for (let t = T - 1; t >= 1; t -= 1) path[t - 1] = back[t * numStates + path[t]]
  return { path, score: bestScore }
}

function emissionBeatLog(pointer: number, observation: number, observationLambda: number): number {
  const obs = Math.max(0, Math.min(1, observation))
  if (pointer === 1) return Math.log(Math.max(obs, EPS))
  const val = (1 - obs) / (observationLambda - 1)
  return Math.log(Math.max(val, EPS))
}

function correctedBeatFrames1D(
  activations: Float32Array,
  pointers: Uint8Array,
  path: Int32Array
): number[] {
  const beatRange = new Uint8Array(path.length)
  let any = false
  for (let i = 0; i < path.length; i += 1) {
    beatRange[i] = pointers[path[i]] >= 1 ? 1 : 0
    any = any || beatRange[i] === 1
  }
  if (!any) return []

  const idx: number[] = []
  for (let i = 1; i < beatRange.length; i += 1) {
    if (beatRange[i] !== beatRange[i - 1]) idx.push(i)
  }
  if (beatRange[0]) idx.unshift(0)
  if (beatRange[beatRange.length - 1]) idx.push(beatRange.length)

  const beats: number[] = []
  for (let i = 0; i + 1 < idx.length; i += 2) {
    const left = idx[i]
    const right = idx[i + 1]
    let best = left
    let bestVal = Number.NEGATIVE_INFINITY
    for (let t = left; t < right; t += 1) {
      const v = activations[t]
      if (v > bestVal) {
        bestVal = v
        best = t
      }
    }
    beats.push(best)
  }
  return beats
}

function beatFramesFromStateMinima(statePositions: Float32Array, pointers: Uint8Array, path: Int32Array): number[] {
  const pos = new Float32Array(path.length)
  for (let i = 0; i < path.length; i += 1) pos[i] = statePositions[path[i]]
  const minima = localMinimaWrap(pos)
  return minima.filter((idx) => pointers[path[idx]] === 1)
}

function localMinimaWrap(values: Float32Array): number[] {
  const out: number[] = []
  if (values.length < 3) return out
  for (let i = 0; i < values.length; i += 1) {
    const prev = values[(i - 1 + values.length) % values.length]
    const cur = values[i]
    const next = values[(i + 1) % values.length]
    if (cur < prev && cur < next) out.push(i)
  }
  return out
}

type BarModel = {
  numStates: number
  statePositions: Float32Array
  statePatterns: Int32Array
  pointers: Uint8Array
  transitions: SparseTransitions
}

function buildBarTrackingModel(
  beatsPerBar: number[],
  meterChangeProb: number,
  observationWeight: number
): BarModel {
  const meters = beatsPerBar.slice()
  const numPatterns = meters.length
  const numStates = meters.reduce((a, b) => a + b, 0)
  const statePositions = new Float32Array(numStates)
  const statePatterns = new Int32Array(numStates)
  const firstStates = new Int32Array(numPatterns)
  const lastStates = new Int32Array(numPatterns)

  let offset = 0
  for (let p = 0; p < numPatterns; p += 1) {
    const meter = meters[p]
    firstStates[p] = offset
    for (let b = 0; b < meter; b += 1) {
      const s = offset + b
      statePositions[s] = b
      statePatterns[s] = p
    }
    lastStates[p] = offset + meter - 1
    offset += meter
  }

  const to: number[] = []
  const from: number[] = []
  const probs: number[] = []

  for (let p = 0; p < numPatterns; p += 1) {
    const meter = meters[p]
    const first = firstStates[p]
    for (let b = 0; b < meter - 1; b += 1) {
      to.push(first + b + 1)
      from.push(first + b)
      probs.push(1)
    }
  }

  const changeProb = Math.max(0, Math.min(1, meterChangeProb))
  for (let p = 0; p < numPatterns; p += 1) {
    const fromState = lastStates[p]
    if (numPatterns === 1) {
      to.push(firstStates[p])
      from.push(fromState)
      probs.push(1)
      continue
    }
    const stayProb = 1 - changeProb
    to.push(firstStates[p])
    from.push(fromState)
    probs.push(stayProb)
    const otherProb = changeProb / (numPatterns - 1)
    for (let q = 0; q < numPatterns; q += 1) {
      if (q === p) continue
      to.push(firstStates[q])
      from.push(fromState)
      probs.push(otherProb)
    }
  }

  const transitions = buildIncomingSparse(numStates, to, from, probs)
  const pointers = new Uint8Array(numStates)
  const border = 1 / observationWeight
  for (let s = 0; s < numStates; s += 1) {
    if (statePositions[s] < border) pointers[s] = 1
  }
  return { numStates, statePositions, statePatterns, pointers, transitions }
}
