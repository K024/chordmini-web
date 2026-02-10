import { TriadTypes, type Chord } from "../decoding/complex_chord"


/*
Raw key transition correlation matrix from the paper.

See https://ismir2006.ismir.net/PAPERS/ISMIR0691_Paper.pdf
*/

const rawKeyTransitionCorrelation = {
  maj: {
    maj: [1.000, 0.500, 0.040, 0.105, 0.185, 0.591, 0.683, 0.591, 0.185, 0.105, 0.040, 0.500],
    min: [0.511, 0.298, 0.237, 0.654, 0.536, 0.215, 0.369, 0.241, 0.508, 0.651, 0.402, 0.158],
  },
  min: {
    maj: [0.511, 0.158, 0.402, 0.651, 0.508, 0.241, 0.369, 0.215, 0.536, 0.654, 0.237, 0.298],
    min: [1.000, 0.394, 0.160, 0.055, 0.003, 0.339, 0.673, 0.339, 0.003, 0.055, 0.160, 0.394],
  },
}



const NINF = -1000 // small enough to be ignored
const NTRANS = 1.00 // non diatonic chord transitions score

/*
Raw chord transition ratings from the paper.

The score is between 1 and 7
*/
const rawChordTransitionRatings = [
  [NTRANS, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00], // N
  [NTRANS, NINF, 5.10, 4.78, 5.91, 5.94, 5.26, 4.57], // I
  [NTRANS, 5.69, NINF, 4.00, 4.76, 6.10, 4.97, 5.41], // ii
  [NTRANS, 5.38, 4.47, NINF, 4.63, 5.03, 4.60, 4.47], // iii
  [NTRANS, 5.94, 5.00, 4.22, NINF, 6.00, 4.35, 4.79], // IV
  [NTRANS, 6.19, 4.79, 4.47, 5.51, NINF, 5.19, 4.85], // V
  [NTRANS, 5.04, 5.44, 4.72, 5.07, 5.56, NINF, 4.50], // vi
  [NTRANS, 5.85, 4.16, 4.16, 4.53, 5.16, 4.19, NINF], // vii
]



/*
Raw chord staying ratings from the paper.

The score is between 1 and 7
*/

const rawChordStayingRatings = {
  maj: {
    maj: [6.66, 4.71, 4.60, 4.31, 4.64, 5.59, 4.36, 5.33, 5.01, 4.64, 4.73, 4.67],
    min: [3.75, 2.59, 3.12, 2.18, 2.76, 3.19, 2.13, 2.68, 2.61, 3.62, 2.56, 2.76],
    dim: [3.27, 2.70, 2.59, 2.79, 2.64, 2.54, 3.25, 2.58, 2.36, 3.35, 2.38, 2.64],
  },
  min: {
    maj: [5.30, 4.11, 3.83, 4.14, 3.99, 4.41, 3.92, 4.38, 4.45, 3.69, 4.22, 3.85],
    min: [5.90, 3.08, 3.25, 3.50, 3.33, 4.60, 2.98, 3.48, 3.53, 3.78, 3.13, 3.14],
    dim: [3.93, 2.84, 3.43, 3.42, 3.51, 3.41, 3.91, 3.16, 3.17, 4.10, 3.10, 3.18],
  },
}



/*
Normalize log probabilities.
*/

function normalizeLogProb(scores: number[], temperature: number, scale: number = 1) {
  const maxScore = Math.max(...scores)
  const expScores = scores.map(score => Math.exp((score - maxScore) / temperature))
  const sumExpScores = expScores.reduce((a, b) => a + b, 0)
  return expScores.map(score => Math.log(score / sumExpScores) * scale)
}




// only allows transition when significantly different from the previous key
const transitionTemperature = 0.06
const transitionProbFactor = 4

const normalizedKeyTransitionLogProbs = {
  maj: normalizeLogProb([
    ...rawKeyTransitionCorrelation.maj.maj,
    ...rawKeyTransitionCorrelation.maj.min,
  ], transitionTemperature, transitionProbFactor),
  min: normalizeLogProb([
    ...rawKeyTransitionCorrelation.min.maj,
    ...rawKeyTransitionCorrelation.min.min,
  ], transitionTemperature, transitionProbFactor),
}

// console.log(normalizedKeyTransitionLogProbs)



/**
 * C major => 0, C# major => 1, ...
 * C minor => 12, C# minor => 13, ...
 */
export function keyTransitionLogProb(keyFrom: number, keyTo: number) {
  const isMajorFrom = keyFrom < 12
  const isMajorTo = keyTo < 12
  const deltaKey = (keyTo - keyFrom + 24) % 12
  if (isMajorFrom && isMajorTo) { // from major to major
    return normalizedKeyTransitionLogProbs.maj[deltaKey] * transitionProbFactor
  }
  else if (isMajorFrom) { // from major to minor
    return normalizedKeyTransitionLogProbs.maj[deltaKey + 12] * transitionProbFactor
  }
  else if (isMajorTo) { // from minor to major
    return normalizedKeyTransitionLogProbs.min[deltaKey] * transitionProbFactor
  }
  else { // from minor to minor
    return normalizedKeyTransitionLogProbs.min[deltaKey + 12] * transitionProbFactor
  }
}


const chordTransitionTemperature = 0.3
const chordTransitionProbFactor = 1.8

const normalizedChordTransitionLogProbs = rawChordTransitionRatings.map(
  row => normalizeLogProb(row, chordTransitionTemperature, chordTransitionProbFactor)
)

// console.log(normalizedChordTransitionLogProbs)


export const majorTonality = [
  1, // I
  0,
  2, // ii
  0,
  3, // iii
  4, // IV
  0,
  5, // V
  0,
  6, // vi
  0,
  7, // vii
]

export const minorTonality = [
  1, // i
  0,
  2, // ii(dim)
  3, // bIII
  0,
  4, // iv
  0,
  5, // v or V
  6, // bVI
  0,
  7, // bVII
  0,
]

export function chordRootTonality(key: number, chord: Chord) {
  const isMajor = key < 12
  const deltaKey = (chord.root - key + 24) % 12
  return isMajor ? majorTonality[deltaKey] : minorTonality[deltaKey]
}


/**
 * C major => 0, C# major => 1, ...
 * C minor => 12, C# minor => 13, ...
 */
export function chordTransitionLogProb(key: number, chordFrom: Chord | null, chordTo: Chord) {
  if (!chordFrom || chordFrom.root < 0 || chordTo.root < 0)
    return 0

  const tonalityFrom = chordRootTonality(key, chordFrom)
  const tonalityTo = chordRootTonality(key, chordTo)
  if (tonalityFrom === tonalityTo) {
    if (tonalityFrom === 0) {
      // non diatonic chord transition, less probability
      return normalizedChordTransitionLogProbs[0][0] * 2
    }
    // the chords have the same root, no transition occurred
    return 0
  }

  return normalizedChordTransitionLogProbs[tonalityFrom][tonalityTo]
}


const chordStayingTemperature = 0.3
const chordStayingProbFactor = 1

const normalizedChordStayingLogProbs = {
  maj: normalizeLogProb([
    ...rawChordStayingRatings.maj.maj,
    ...rawChordStayingRatings.maj.min,
    ...rawChordStayingRatings.maj.dim,
  ], chordStayingTemperature, chordStayingProbFactor),
  min: normalizeLogProb([
    ...rawChordStayingRatings.min.maj,
    ...rawChordStayingRatings.min.min,
    ...rawChordStayingRatings.min.dim,
  ], chordStayingTemperature, chordStayingProbFactor),
}

// console.log(normalizedChordStayingLogProbs)


function chordTypeOffset(chord: Chord) {
  switch (chord.triad) {
    case TriadTypes.min:
    case TriadTypes.aug:
      return 12 // minor
    case TriadTypes.dim:
      return 24 // dim
    default:
      return 0 // major
  }
}


/**
 * C major => 0, C# major => 1, ...
 * C minor => 12, C# minor => 13, ...
 */
export function chordStayingLogProb(key: number, chord: Chord) {
  if (chord.root < 0)
    return 0

  const isMajor = key < 12
  const stayingLogProbs = isMajor
    ? normalizedChordStayingLogProbs.maj
    : normalizedChordStayingLogProbs.min

  const typeOffset = chordTypeOffset(chord)
  const deltaIndex = (chord.root - key + 24) % 12

  return stayingLogProbs[deltaIndex + typeOffset]
}


const secondsPerBeat = 0.1

export function chordDurationTimeFactor(durationSeconds: number) {
  return Math.max(durationSeconds - secondsPerBeat, secondsPerBeat)
}
