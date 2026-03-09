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

export type BeatEvent = { time: number; beatInBar: number; isDownbeat: boolean }

export type Activation = [p_beat: number, p_downbeat: number]

export function decodeOfflineEvents(
  activations: Activation[],
  fps = 100
): BeatEvent[] {
  const decoded = decodeDbnLike(activations, fps)
  const events: BeatEvent[] = []
  for (const row of decoded) {
    const beatInBar = Math.round(row[1])
    events.push({ time: row[0], beatInBar, isDownbeat: beatInBar === 1 })
  }
  return events
}

type DbnParams = {
  beatsPerBar: number[]
  minBpm: number
  maxBpm: number
  numTempi: number
  transitionLambda: number
  observationLambda: number
  threshold: number
  correct: boolean
}

const DEFAULT_DBN: DbnParams = {
  beatsPerBar: [3, 4],
  minBpm: 55,
  maxBpm: 215,
  numTempi: 60,
  transitionLambda: 100,
  observationLambda: 16,
  threshold: 0.0,
  correct: true,
}

type BarStateSpace = {
  numStates: number
  statePositions: Float32Array
  stateIntervals: Int32Array
  firstStates: Int32Array[]
  lastStates: Int32Array[]
}

type DbnModel = {
  st: BarStateSpace
  pointers: Uint8Array
  incomingOffsets: Int32Array
  incomingPrev: Int32Array
  incomingLogProb: Float32Array
}

function decodeDbnLike(activations: Activation[], fps: number): number[][] {
  if (activations.length === 0) return []
  const { cropped, first } = thresholdActivations2D(activations, DEFAULT_DBN.threshold)
  if (cropped.length === 0) return []

  let bestPath: Int32Array | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  let bestModel: DbnModel | null = null

  for (const beats of DEFAULT_DBN.beatsPerBar) {
    const minInterval = (60 * fps) / DEFAULT_DBN.maxBpm
    const maxInterval = (60 * fps) / DEFAULT_DBN.minBpm
    const model = buildDbnModel(
      beats,
      minInterval,
      maxInterval,
      DEFAULT_DBN.numTempi,
      DEFAULT_DBN.transitionLambda,
      DEFAULT_DBN.observationLambda
    )
    const { path, score } = viterbiPath(model, cropped)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
      bestModel = model
    }
  }

  if (!bestPath || !bestModel) return []
  const beatNumbers = new Int32Array(bestPath.length)
  for (let i = 0; i < bestPath.length; i += 1) {
    beatNumbers[i] = Math.floor(bestModel.st.statePositions[bestPath[i]]) + 1
  }

  const beats =
    DEFAULT_DBN.correct
      ? correctedBeatFrames(cropped, bestModel.pointers, bestPath)
      : beatChangeFrames(beatNumbers)
  const out: number[][] = []
  for (const b of beats) {
    out.push([(b + first) / fps, beatNumbers[b]])
  }
  return out
}

function thresholdActivations2D(
  activations: Activation[],
  threshold: number
): { cropped: Activation[]; first: number } {
  if (threshold <= 0) return { cropped: activations, first: 0 }
  let first = -1
  let last = -1
  for (let i = 0; i < activations.length; i += 1) {
    if (activations[i][0] >= threshold || activations[i][1] >= threshold) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) return { cropped: [], first: 0 }
  return { cropped: activations.slice(first, last + 1), first }
}

function buildDbnModel(
  numBeats: number,
  minInterval: number,
  maxInterval: number,
  numTempi: number,
  transitionLambda: number,
  observationLambda: number
): DbnModel {
  const st = buildBarStateSpace(numBeats, minInterval, maxInterval, numTempi)
  const pointers = new Uint8Array(st.numStates)
  const border = 1 / observationLambda
  for (let s = 0; s < st.numStates; s += 1) {
    let p = 0
    if (st.statePositions[s] % 1 < border) p = 1
    if (st.statePositions[s] < border) p = 2
    pointers[s] = p
  }

  const to: number[] = []
  const from: number[] = []
  const probs: number[] = []

  const isFirst = new Uint8Array(st.numStates)
  for (const arr of st.firstStates) for (const x of arr) isFirst[x] = 1
  for (let s = 0; s < st.numStates; s += 1) {
    if (!isFirst[s]) {
      to.push(s)
      from.push(s - 1)
      probs.push(1)
    }
  }

  for (let beat = 0; beat < numBeats; beat += 1) {
    const toStates = st.firstStates[beat]
    const fromStates = st.lastStates[(beat - 1 + numBeats) % numBeats]
    const fromInt = Array.from(fromStates, (s) => st.stateIntervals[s])
    const toInt = Array.from(toStates, (s) => st.stateIntervals[s])
    const p = exponentialTransition(fromInt, toInt, transitionLambda)
    for (let i = 0; i < fromStates.length; i += 1) {
      for (let j = 0; j < toStates.length; j += 1) {
        const val = p[i][j]
        if (val > 0) {
          to.push(toStates[j])
          from.push(fromStates[i])
          probs.push(val)
        }
      }
    }
  }

  const incoming = buildIncomingSparse(st.numStates, to, from, probs)
  return { st, pointers, ...incoming }
}

function buildBarStateSpace(
  numBeats: number,
  minInterval: number,
  maxInterval: number,
  numTempi: number
): BarStateSpace {
  const intervals = buildIntervals(minInterval, maxInterval, numTempi)
  const sumIntervals = intervals.reduce((a, b) => a + b, 0)
  const numStates = sumIntervals * numBeats
  const statePositions = new Float32Array(numStates)
  const stateIntervals = new Int32Array(numStates)
  const firstStates: Int32Array[] = []
  const lastStates: Int32Array[] = []
  let offset = 0
  for (let beat = 0; beat < numBeats; beat += 1) {
    const first = new Int32Array(intervals.length)
    const last = new Int32Array(intervals.length)
    for (let i = 0; i < intervals.length; i += 1) {
      const intv = intervals[i]
      first[i] = offset
      for (let k = 0; k < intv; k += 1) {
        statePositions[offset + k] = beat + k / intv
        stateIntervals[offset + k] = intv
      }
      last[i] = offset + intv - 1
      offset += intv
    }
    firstStates.push(first)
    lastStates.push(last)
  }
  return { numStates, statePositions, stateIntervals, firstStates, lastStates }
}

function buildIntervals(minInterval: number, maxInterval: number, numTempi: number): number[] {
  let intervals: number[] = []
  const lo = Math.round(minInterval)
  const hi = Math.round(maxInterval)
  for (let i = lo; i <= hi; i += 1) intervals.push(i)
  if (numTempi > 0 && numTempi < intervals.length) {
    let n = numTempi
    while (intervals.length < numTempi) {
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

function exponentialTransition(fromInt: number[], toInt: number[], lambda: number): number[][] {
  const out: number[][] = Array.from({ length: fromInt.length }, () => new Array(toInt.length).fill(0))
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
): { incomingOffsets: Int32Array; incomingPrev: Int32Array; incomingLogProb: Float32Array } {
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
    incomingLogProb[idx] = Math.log(Math.max(probs[i], 1e-38))
  }
  return { incomingOffsets, incomingPrev, incomingLogProb }
}

function viterbiPath(model: DbnModel, observations: Activation[]): { path: Int32Array; score: number } {
  const T = observations.length
  const S = model.st.numStates
  const back = new Int32Array(T * S)
  let prev = new Float64Array(S)
  let next = new Float64Array(S)
  for (let s = 0; s < S; s += 1) prev[s] = emissionLog(model.pointers[s], observations[0], DEFAULT_DBN.observationLambda)
  for (let t = 1; t < T; t += 1) {
    const obs = observations[t]
    for (let s = 0; s < S; s += 1) {
      let best = Number.NEGATIVE_INFINITY
      let bestPrev = 0
      const a = model.incomingOffsets[s]
      const b = model.incomingOffsets[s + 1]
      for (let k = a; k < b; k += 1) {
        const p = model.incomingPrev[k]
        const score = prev[p] + model.incomingLogProb[k]
        if (score > best) {
          best = score
          bestPrev = p
        }
      }
      next[s] = best + emissionLog(model.pointers[s], obs, DEFAULT_DBN.observationLambda)
      back[t * S + s] = bestPrev
    }
    const tmp = prev
    prev = next
    next = tmp
  }
  let last = 0
  let bestScore = Number.NEGATIVE_INFINITY
  for (let s = 0; s < S; s += 1) {
    if (prev[s] > bestScore) {
      bestScore = prev[s]
      last = s
    }
  }
  const path = new Int32Array(T)
  path[T - 1] = last
  for (let t = T - 1; t >= 1; t -= 1) {
    path[t - 1] = back[t * S + path[t]]
  }
  return { path, score: bestScore }
}

function emissionLog(pointer: number, obs: Activation, observationLambda: number): number {
  const beat = obs[0]
  const down = obs[1]
  if (pointer === 1) return Math.log(Math.max(beat, 1e-38))
  if (pointer === 2) return Math.log(Math.max(down, 1e-38))
  const val = (1 - (beat + down)) / (observationLambda - 1)
  return Math.log(Math.max(val, 1e-38))
}

function correctedBeatFrames(
  activations: Activation[],
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
      // match np.argmax on flattened [frames,2]: compares col0 then col1
      const v0 = activations[t][0]
      if (v0 > bestVal) {
        bestVal = v0
        best = t
      }
      const v1 = activations[t][1]
      if (v1 > bestVal) {
        bestVal = v1
        best = t
      }
    }
    beats.push(best)
  }
  return beats
}

function beatChangeFrames(beatNumbers: Int32Array): number[] {
  const beats: number[] = []
  for (let i = 1; i < beatNumbers.length; i += 1) {
    if (beatNumbers[i] !== beatNumbers[i - 1]) beats.push(i)
  }
  return beats
}
