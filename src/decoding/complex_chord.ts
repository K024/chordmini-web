// license see ./xhmm_decoder.ts

export const NUM_TO_ABS_SCALE = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
]

export const TriadTypes = {
  x: -2,
  none: 0,
  maj: 1,
  min: 2,
  sus4: 3,
  sus2: 4,
  dim: 5,
  aug: 6,
  power: 7,
  one: 8,
} as const

export const SeventhTypes = {
  unknown: -2,
  not_care: -1,
  none: 0,
  add_7: 1,
  add_b7: 2,
  add_bb7: 3,
} as const

export const NinthTypes = {
  unknown: -2,
  not_care: -1,
  none: 0,
  add_9: 1,
  add_s9: 2,
  add_b9: 3,
} as const

export const EleventhTypes = {
  unknown: -2,
  not_care: -1,
  none: 0,
  add_11: 1,
  add_s11: 2,
} as const

export const ThirteenthTypes = {
  unknown: -2,
  not_care: -1,
  none: 0,
  add_13: 1,
  add_b13: 2,
  add_bb13: 3,
} as const

export function getScaleAndSuffix(name: string): { root: number; suffix: string } {
  const scale = "C*D*EF*G*A*B"
  let result = scale.indexOf(name[0])
  let prefixLength = 1
  if (name.length > 1) {
    if (name[1] === "b") {
      result -= 1
      if (result < 0) result += 12
      prefixLength = 2
    } else if (name[1] === "#") {
      result += 1
      if (result >= 12) result -= 12
      prefixLength = 2
    }
  }
  return { root: result, suffix: name.slice(prefixLength) }
}

export function scaleNameToValue(name: string): number {
  const scale = "1*2*34*5*6*78*9"
  let result = scale.indexOf(name[name.length - 1])
  let flats = 0
  let sharps = 0
  for (const ch of name) {
    if (ch === "b") flats += 1
    if (ch === "#") sharps += 1
  }
  result = (result - flats + sharps + 12) % 12
  return result
}

const BASIC_TYPES = [".", "maj", "min", "sus4", "sus2", "dim", "aug", "5", "1"]
const EXTENDED_TYPES: Record<string, number[]> = {
  maj6: [TriadTypes.maj, 0, 0, 0, ThirteenthTypes.add_13],
  min6: [TriadTypes.min, 0, 0, 0, ThirteenthTypes.add_13],
  "7": [TriadTypes.maj, SeventhTypes.add_b7, 0, 0, 0],
  maj7: [TriadTypes.maj, SeventhTypes.add_7, 0, 0, 0],
  min7: [TriadTypes.min, SeventhTypes.add_b7, 0, 0, 0],
  minmaj7: [TriadTypes.min, SeventhTypes.add_7, 0, 0, 0],
  dim7: [TriadTypes.dim, SeventhTypes.add_bb7, 0, 0, 0],
  hdim7: [TriadTypes.dim, SeventhTypes.add_b7, 0, 0, 0],
  "9": [TriadTypes.maj, SeventhTypes.add_b7, NinthTypes.add_9, 0, 0],
  maj9: [TriadTypes.maj, SeventhTypes.add_7, NinthTypes.add_9, 0, 0],
  min9: [TriadTypes.min, SeventhTypes.add_b7, NinthTypes.add_9, 0, 0],
  "11": [TriadTypes.maj, SeventhTypes.add_b7, NinthTypes.add_9, EleventhTypes.add_11, 0],
  min11: [TriadTypes.min, SeventhTypes.add_b7, NinthTypes.add_9, EleventhTypes.add_11, 0],
  "13": [TriadTypes.maj, SeventhTypes.add_b7, NinthTypes.add_9, EleventhTypes.add_11, ThirteenthTypes.add_13],
  maj13: [TriadTypes.maj, SeventhTypes.add_7, NinthTypes.add_9, EleventhTypes.add_11, ThirteenthTypes.add_13],
  min13: [TriadTypes.min, SeventhTypes.add_b7, NinthTypes.add_9, EleventhTypes.add_11, ThirteenthTypes.add_13],
  "": [TriadTypes.one, 0, 0, 0, 0],
  N: [TriadTypes.none, -2, -2, -2, -2],
  X: [-2, -2, -2, -2, -2],
}

const ADD_NOTES: Record<string, [number, number]> = {
  "7": [7, SeventhTypes.add_7],
  b7: [7, SeventhTypes.add_b7],
  bb7: [7, SeventhTypes.add_bb7],
  "2": [9, NinthTypes.add_9],
  "9": [9, NinthTypes.add_9],
  "#9": [9, NinthTypes.add_s9],
  b9: [9, NinthTypes.add_b9],
  "4": [11, EleventhTypes.add_11],
  "11": [11, EleventhTypes.add_11],
  "#11": [11, EleventhTypes.add_s11],
  "13": [13, ThirteenthTypes.add_13],
  b13: [13, ThirteenthTypes.add_b13],
  "6": [6, ThirteenthTypes.add_13],
  b6: [6, ThirteenthTypes.add_b13],
  bb6: [6, ThirteenthTypes.add_bb13],
  "#4": [5, TriadTypes.x],
  b5: [5, TriadTypes.x],
  "5": [5, TriadTypes.x],
  "#5": [5, TriadTypes.x],
  b3: [3, TriadTypes.x],
  b2: [3, TriadTypes.x],
  "3": [3, TriadTypes.x],
}

function parseChordType(name: string): number[] {
  if (BASIC_TYPES.includes(name)) {
    return [
      BASIC_TYPES.indexOf(name),
      SeventhTypes.none,
      NinthTypes.none,
      EleventhTypes.none,
      ThirteenthTypes.none,
    ]
  }
  if (name in EXTENDED_TYPES) {
    return EXTENDED_TYPES[name].slice()
  }
  throw new Error(`Unknown chord type ${name}`)
}

function decodeSuffix(suffix: string): number[] {
  let chordTypeStr = suffix
  let addNotes: string[] = []
  let omitNotes: string[] = []
  if (suffix.includes("(")) {
    if (!suffix.endsWith(")")) {
      throw new Error(`Invalid suffix ${suffix}`)
    }
    const bracketPos = suffix.indexOf("(")
    chordTypeStr = suffix.slice(0, bracketPos)
    const addOmitNotes = suffix.slice(bracketPos + 1, -1).split(",")
    omitNotes = addOmitNotes.filter((n) => n.startsWith("*")).map((n) => n.slice(1))
    addNotes = addOmitNotes.filter((n) => !n.startsWith("*"))
  }

  const result = parseChordType(chordTypeStr)
  if (omitNotes.length > 0) {
    const validOmitTypes = ["1", "b3", "3", "b5", "5", "b7", "7"]
    const omitFound = validOmitTypes.map(() => false)
    for (const omitNote of omitNotes) {
      const idx = validOmitTypes.indexOf(omitNote)
      if (idx < 0) throw new Error(`Invalid omit type ${omitNote} in ${suffix}`)
      omitFound[idx] = true
    }
    if (result[0] === TriadTypes.maj && omitFound[2]) {
      result[0] = TriadTypes.power
      omitFound[2] = false
    } else if (result[0] === TriadTypes.min && omitFound[1]) {
      result[0] = TriadTypes.power
      omitFound[1] = false
    }
    if (result[0] === TriadTypes.power && omitFound[4]) {
      result[0] = TriadTypes.one
      omitFound[4] = false
    }
    if (omitFound.slice(0, 5).some(Boolean)) {
      result[0] = TriadTypes.x
    }
    if (result[1] === SeventhTypes.add_b7 && omitFound[5]) {
      result[1] = SeventhTypes.none
      omitFound[5] = false
    } else if (result[1] === SeventhTypes.add_7 && omitFound[6]) {
      result[1] = SeventhTypes.none
      omitFound[6] = false
    }
    if (omitFound[5] || omitFound[6]) {
      result[1] = SeventhTypes.unknown
    }
  }

  for (const note of addNotes) {
    if (note === "1") continue
    if (note === "5" && result[0] === TriadTypes.one) {
      result[0] = TriadTypes.power
      continue
    }
    if (!(note in ADD_NOTES)) {
      throw new Error(`Unknown decoration ${note} @ ${suffix}`)
    }
    const [decClass, decType] = ADD_NOTES[note]
    const decIndex = [-1, -1, -1, 0, -1, 0, 4, 1, -1, 2, -1, 3, -1, 4][decClass]
    if (result[decIndex] > 0 || result[decIndex] === -2) {
      result[decIndex] = -2
    }
    result[decIndex] = decType
  }
  return result
}

export class Chord {
  root: number
  bass: number
  triad: number
  seventh: number
  ninth: number
  eleventh: number
  thirteenth: number

  constructor(name: string) {
    if (name.includes(":")) {
      const { root, suffix } = getScaleAndSuffix(name)
      if (!suffix.startsWith(":")) throw new Error(`Invalid chord suffix ${suffix}`)
      let chordSuffix = suffix.slice(1)
      this.root = root
      this.bass = root
      if (chordSuffix.includes("/")) {
        const slashPos = chordSuffix.indexOf("/")
        const bassStr = chordSuffix.slice(slashPos + 1)
        this.bass = (scaleNameToValue(bassStr) + this.root) % 12
        chordSuffix = chordSuffix.slice(0, slashPos)
      }
      [this.triad, this.seventh, this.ninth, this.eleventh, this.thirteenth] =
        decodeSuffix(chordSuffix)
    } else if (name === "N") {
      this.root = -1
      this.bass = -1
        ;[this.triad, this.seventh, this.ninth, this.eleventh, this.thirteenth] = decodeSuffix("N")
    } else if (name === "X") {
      this.root = -2
      this.bass = -2
        ;[this.triad, this.seventh, this.ninth, this.eleventh, this.thirteenth] = decodeSuffix("X")
    } else {
      throw new Error(`Unknown chord name ${name}`)
    }
  }

  toArray(): number[] {
    const triad = this.triad <= 0 ? this.triad : (this.triad - 1) * 12 + 1 + this.root
    return [triad, this.bass, this.seventh, this.ninth, this.eleventh, this.thirteenth]
  }
}

export function shiftComplexChordArray(array: number[], shift: number): number[] {
  const newArray = array.slice()
  if (newArray[0] > 0) {
    const base = Math.floor((newArray[0] - 1) / 12)
    const root = ((newArray[0] - 1 + shift) % 12 + 12) % 12
    newArray[0] = base * 12 + root + 1
  }
  if (newArray[1] >= 0) {
    newArray[1] = ((newArray[1] + shift) % 12 + 12) % 12
  }
  return newArray
}
