import type { ChordSegment } from "../chordmini/worker"
import { Chord } from "../decoding/complex_chord"
import {
  keyTransitionLogProb,
  chordTransitionLogProb,
  chordStayingLogProb,
  chordDurationTimeFactor,
} from "./hmm-params"
import { getStandardScaleName, renameChord } from "./renaming"



function argMax(scores: number[]) {
  let maxIdx = 0
  let maxVal = scores[0]
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > maxVal) {
      maxVal = scores[i]
      maxIdx = i
    }
  }
  return maxIdx
}


function decodeHmm(parsedChords: Chord[], chordDuration: number[]) {
  const length = parsedChords.length
  if (length === 0) {
    return []
  }

  // hidden states: 12 major keys, concatenated with 12 minor keys
  const dp = Array.from({ length }, () => Array(24).fill(0))
  const pre = Array.from({ length }, () => Array(24).fill(-1))

  const empty = Array(24).fill(0)

  for (let i = 0; i < length; i += 1) {
    const chord = parsedChords[i]
    const lastChord = i > 0 ? parsedChords[i - 1] : null
    const duration = chordDuration[i]
    const lastKeyLogProbs = i > 0 ? dp[i - 1] : empty
    for (let currentKey = 0; currentKey < 24; currentKey += 1) {

      // transition scores
      const keyTransitions = empty.map((_, key) =>
        lastKeyLogProbs[key] + keyTransitionLogProb(key, currentKey)
      )
      const lastKey = argMax(keyTransitions)

      // emission scores
      const chordTransition = chordTransitionLogProb(currentKey, lastChord, chord)
      const chordStaying = chordStayingLogProb(currentKey, chord)
      const durationFactor = chordDurationTimeFactor(duration)

      // total score
      const score = keyTransitions[lastKey] + (chordTransition + chordStaying) * durationFactor

      dp[i][currentKey] = score
      pre[i][currentKey] = lastKey
    }
  }

  let lastKey = argMax(dp[length - 1])
  const keySequence: number[] = []
  for (let i = length - 1; i >= 0; i -= 1) {
    keySequence.push(lastKey)
    lastKey = pre[i][lastKey]
  }
  keySequence.reverse()


  return keySequence
}



export interface EstimatedChordSegment extends ChordSegment {
  key: string
  originalLabel: string
}


export function estimateKey(chords: ChordSegment[]) {
  const parsedChords = chords.map(({ label }) => new Chord(label))
  const chordDuration = chords.map(({ start, end }) => end - start)

  const keySequence = decodeHmm(parsedChords, chordDuration)

  return chords.map<EstimatedChordSegment>((chord, index) => {
    return {
      ...chord,
      label: renameChord(chord.label, parsedChords[index], keySequence[index]),
      key: getStandardScaleName(keySequence[index]),
      originalLabel: chord.label,
    }
  })
}


export interface KeyMarker {
  start: number
  end: number
  key: string
}


export function getKeyMarkers(chords: EstimatedChordSegment[]): KeyMarker[] {
  let lastKey = "", lastStart = 0
  const markers: KeyMarker[] = []
  for (let i = 0; i < chords.length; i += 1) {
    const chord = chords[i]
    if (chord.key !== lastKey) {
      if (lastKey) {
        markers.push({
          start: lastStart,
          end: chord.start,
          key: lastKey,
        })
      }
      lastKey = chord.key
      lastStart = chord.start
    }
  }
  if (lastKey) {
    markers.push({
      start: lastStart,
      end: chords[chords.length - 1].end,
      key: lastKey,
    })
  }
  return markers
}
