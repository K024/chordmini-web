import { noteToHz } from "./wavelet"


export const CQT_SAMPLE_RATE = 22_050
export const CQT_BINS = 288
export const CQT_BINS_PER_OCTAVE = 36
export const CQT_FMIN = noteToHz("F#0")
export const CQT_HOP_LENGTH = 512
