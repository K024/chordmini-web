/**
@license

modified from https://github.com/music-x-lab/ISMIR2019-Large-Vocabulary-Chord-Recognition

MIT License

Copyright (c) 2023 Music X Lab

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { chordVocab, type ChordVocabName } from "./chord_vocab";
import { Chord, NUM_TO_ABS_SCALE, shiftComplexChordArray } from "./complex_chord"

export type ProbMatrix = number[][]
export type ProbList = [ProbMatrix, ProbMatrix, ProbMatrix, ProbMatrix, ProbMatrix, ProbMatrix]

type KnownChord = { array: number[]; name: string }

const EPS = 1e-12

export class XHMMDecoder {
  diffTransPenalty: number
  beatTransPenalty: [number, number, number]
  useBass: boolean
  use7: boolean
  useExtended: boolean
  chordNames: string[]
  knownChordArray: KnownChord[]
  knownTriadBass: number[][]

  static fromVocab(
    vocabName: ChordVocabName,
    diffTransPenalty = 10.0,
    beatTransPenalty: [number, number, number] = [5.0, 15.0, 30.0],
    useBass = true,
    use7 = true,
    useExtended = true
  ) {
    return new XHMMDecoder(
      chordVocab[vocabName],
      diffTransPenalty,
      beatTransPenalty,
      useBass,
      use7,
      useExtended
    )
  }

  constructor(
    chordNames: string[],
    diffTransPenalty = 10.0,
    beatTransPenalty: [number, number, number] = [5.0, 15.0, 30.0],
    useBass = true,
    use7 = true,
    useExtended = true
  ) {
    this.diffTransPenalty = diffTransPenalty
    this.beatTransPenalty = beatTransPenalty
    this.useBass = useBass
    this.use7 = use7
    this.useExtended = useExtended
    this.chordNames = ["N", ...chordNames]
    const { knownChordArray, knownTriadBass } = this.initKnownChordNames(chordNames)
    this.knownChordArray = knownChordArray
    this.knownTriadBass = knownTriadBass
  }

  private initKnownChordNames(chordNames: string[]) {
    const knownChordPool = new Map<string, string>()
    const knownTriadBassSet = new Set<string>()
    for (const chordName of chordNames) {
      if (chordName.includes("/") && !this.useBass) continue
      if (chordName.includes(":")) {
        const tokens = chordName.split(":")
        if (tokens[0] !== "C") continue
        const chord = new Chord(chordName)
        const array = chord.toArray()
        if (array.includes(-2)) continue
        for (let shift = 0; shift < 12; shift += 1) {
          const shiftName = `${NUM_TO_ABS_SCALE[shift]}:${tokens[1]}`
          const shiftArray = shiftComplexChordArray(array, shift)
          const key = shiftArray.join(",")
          if (!knownChordPool.has(key)) {
            knownChordPool.set(key, shiftName)
          }
          const triadBassKey = `${shiftArray[0]},${shiftArray[1]}`
          knownTriadBassSet.add(triadBassKey)
        }
      }
    }
    const knownChordArray: KnownChord[] = [{ array: [0, -1, -1, -1, -1, -1], name: "N" }]
    for (const [key, name] of knownChordPool.entries()) {
      knownChordArray.push({ array: key.split(",").map((v) => parseInt(v, 10)), name })
    }
    const knownTriadBass: number[][] = [[0, -1]]
    for (const key of knownTriadBassSet.values()) {
      knownTriadBass.push(key.split(",").map((v) => parseInt(v, 10)))
    }
    return { knownChordArray, knownTriadBass }
  }

  private safeLog(value: number): number {
    return Math.log(Math.max(value, EPS))
  }

  getChordTagObs(probList: ProbList, triadRestriction?: number[][]) {
    const [probTriad, probBass, prob7, prob9, prob11, prob13] = probList
    const suffixProbs = [prob7, prob9, prob11, prob13]
    const nFrame = probTriad.length

    const probTriadBiased = probTriad.map((frame) => {
      const biased = frame.slice()
      biased[0] *= 0.5
      return biased
    })

    const resultNames: string[] = []
    const resultArray: number[][] = []
    for (const { array, name } of this.knownChordArray) {
      let inRange = true
      for (let i = 0; i < 6; i += 1) {
        const prob = probList[i]
        if (prob && array[i] >= prob[0].length) {
          inRange = false
          break
        }
      }
      if (inRange) {
        resultNames.push(name)
        resultArray.push(array.slice())
      }
    }

    const resultArrayAdj = resultArray.map((row) => {
      const next = row.slice()
      next[1] += 1
      return next
    })

    const resultLogProb: number[][] = Array.from({ length: nFrame }, () =>
      new Array(resultArrayAdj.length).fill(0)
    )

    for (let t = 0; t < nFrame; t += 1) {
      for (let c = 0; c < resultArrayAdj.length; c += 1) {
        const arr = resultArrayAdj[c]
        let logProb = this.safeLog(probTriadBiased[t][arr[0]])
        if (this.useBass && arr[1] >= 0) {
          logProb += this.safeLog(probBass[t][arr[1]])
        }
        for (let i = 0; i < 4; i += 1) {
          if ((i === 0 && this.use7) || (i > 0 && this.useExtended)) {
            const suffixIndex = arr[i + 2]
            if (suffixIndex >= 0) {
              const root = (arr[0] - 1) % 12
              const suffixProb = suffixProbs[i]
              if (!suffixProb) continue
              if (Array.isArray(suffixProb[t][0])) {
                const perRoot = suffixProb[t] as unknown as number[][]
                logProb += this.safeLog(perRoot[(root + 12) % 12][suffixIndex])
              } else {
                logProb += this.safeLog(suffixProb[t][suffixIndex])
              }
            }
          }
        }
        resultLogProb[t][c] = logProb
      }
    }

    if (triadRestriction) {
      for (let t = 0; t < nFrame; t += 1) {
        for (let c = 0; c < resultArrayAdj.length; c += 1) {
          const arr = resultArrayAdj[c]
          if (arr[0] !== triadRestriction[t][0] || arr[1] !== triadRestriction[t][1]) {
            resultLogProb[t][c] = -Infinity
          }
        }
      }
    }

    return { resultNames, resultLogProb }
  }

  getTriadBassObs(probList: ProbList) {
    const [probTriad, probBass] = probList
    const nFrame = probTriad.length
    const resultArray: number[][] = []
    for (const array of this.knownTriadBass) {
      let inRange = true
      for (let i = 0; i < 2; i += 1) {
        if (array[i] >= probList[i][0].length) {
          inRange = false
          break
        }
      }
      if (inRange) resultArray.push(array.slice())
    }
    const resultArrayAdj = resultArray.map((row) => {
      const next = row.slice()
      next[1] += 1
      return next
    })
    const resultLogProb: number[][] = Array.from({ length: nFrame }, () =>
      new Array(resultArrayAdj.length).fill(0)
    )
    for (let t = 0; t < nFrame; t += 1) {
      for (let c = 0; c < resultArrayAdj.length; c += 1) {
        const arr = resultArrayAdj[c]
        let logProb = this.safeLog(probTriad[t][arr[0]])
        if (arr[1] >= 0) {
          logProb += this.safeLog(probBass[t][arr[1]])
        }
        resultLogProb[t][c] = logProb
      }
    }
    return { resultArray: resultArrayAdj, resultLogProb }
  }

  decode(probList: ProbList, beatArr: Int8Array, triadRestriction?: number[][]) {
    const { resultNames, resultLogProb } = this.getChordTagObs(probList, triadRestriction)
    const nFrame = resultLogProb.length
    const nChord = resultLogProb[0].length

    const dp: number[][] = Array.from({ length: nFrame }, () => new Array(nChord).fill(0))
    const pre: number[][] = Array.from({ length: nFrame }, () => new Array(nChord).fill(-1))
    const dpMaxAt = new Array(nFrame).fill(0)

    for (let c = 1; c < nChord; c += 1) {
      dp[0][c] = -Infinity
    }
    for (let c = 0; c < nChord; c += 1) {
      dp[0][c] += resultLogProb[0][c]
    }
    dpMaxAt[0] = argmax(dp[0])

    for (let t = 1; t < nFrame; t += 1) {
      const sameTrans = dp[t - 1]
      if (beatArr[t]) {
        const beat = beatArr[t]
        const penalty =
          beat === 1 ? this.diffTransPenalty : this.beatTransPenalty[beat - 2]
        const diffTrans = dp[t - 1][dpMaxAt[t - 1]] - penalty
        for (let c = 0; c < nChord; c += 1) {
          const useSame = sameTrans[c] > diffTrans
          dp[t][c] = (useSame ? sameTrans[c] : diffTrans) + resultLogProb[t][c]
          pre[t][c] = useSame ? c : dpMaxAt[t - 1]
        }
      } else {
        for (let c = 0; c < nChord; c += 1) {
          dp[t][c] = sameTrans[c] + resultLogProb[t][c]
          pre[t][c] = c
        }
      }
      dpMaxAt[t] = argmax(dp[t])
    }

    const decodeIds = new Array(nFrame).fill(0)
    decodeIds[nFrame - 1] = dpMaxAt[nFrame - 1]
    for (let t = nFrame - 2; t >= 0; t -= 1) {
      decodeIds[t] = pre[t + 1][decodeIds[t + 1]]
    }
    return decodeIds.map((id) => resultNames[id])
  }

  triadDecode(probList: ProbList, beatArr: Int8Array) {
    const { resultArray, resultLogProb } = this.getTriadBassObs(probList)
    const nFrame = resultLogProb.length
    const nChord = resultLogProb[0].length

    const dp: number[][] = Array.from({ length: nFrame }, () => new Array(nChord).fill(0))
    const pre: number[][] = Array.from({ length: nFrame }, () => new Array(nChord).fill(-1))
    const dpMaxAt = new Array(nFrame).fill(0)

    for (let c = 1; c < nChord; c += 1) {
      dp[0][c] = -Infinity
    }
    for (let c = 0; c < nChord; c += 1) {
      dp[0][c] += resultLogProb[0][c]
    }
    dpMaxAt[0] = argmax(dp[0])

    for (let t = 1; t < nFrame; t += 1) {
      const sameTrans = dp[t - 1]
      if (beatArr[t] > 0) {
        const beat = beatArr[t]
        const penalty =
          beat === 1 ? this.diffTransPenalty : this.beatTransPenalty[beat - 2]
        const diffTrans = dp[t - 1][dpMaxAt[t - 1]] - penalty
        for (let c = 0; c < nChord; c += 1) {
          const useSame = sameTrans[c] > diffTrans
          dp[t][c] = (useSame ? sameTrans[c] : diffTrans) + resultLogProb[t][c]
          pre[t][c] = useSame ? c : dpMaxAt[t - 1]
        }
      } else {
        for (let c = 0; c < nChord; c += 1) {
          dp[t][c] = sameTrans[c] + resultLogProb[t][c]
          pre[t][c] = c
        }
      }
      dpMaxAt[t] = argmax(dp[t])
    }

    const decodeIds = new Array(nFrame).fill(0)
    decodeIds[nFrame - 1] = dpMaxAt[nFrame - 1]
    for (let t = nFrame - 2; t >= 0; t -= 1) {
      decodeIds[t] = pre[t + 1][decodeIds[t + 1]]
    }
    return decodeIds.map((id) => resultArray[id])
  }

  layerDecode(probList: ProbList, beatArr: Int8Array) {
    const triadRestriction = this.triadDecode(probList, beatArr)
    return this.decode(probList, beatArr, triadRestriction)
  }

  decodeToChordlab(
    probList: ProbList,
    sr: number,
    hopLength: number,
    useLayerDecode = false,
    beatArr?: Int8Array
  ) {
    const nFrame = probList[0].length
    const beatArray =
      beatArr ?? new Int8Array(Array.from({ length: nFrame }, () => 1))
    const deltaTime = hopLength / sr
    const decodeTags = useLayerDecode
      ? this.layerDecode(probList, beatArray)
      : this.decode(probList, beatArray)

    const allN = decodeTags.every((tag) => tag === "N")
    if (allN) {
      return [[0.0, nFrame * deltaTime, "N"]] as [number, number, string][]
    }

    const result: [number, number, string][] = []
    let lastFrame = 0
    for (let i = 0; i < nFrame; i += 1) {
      if (i + 1 === nFrame || decodeTags[i + 1] !== decodeTags[i]) {
        result.push([lastFrame * deltaTime, (i + 1) * deltaTime, decodeTags[i]])
        lastFrame = i + 1
      }
    }
    return result
  }
}

function argmax(values: number[]): number {
  let maxIdx = 0
  let maxVal = values[0]
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > maxVal) {
      maxVal = values[i]
      maxIdx = i
    }
  }
  return maxIdx
}
