
const chordVocabFiles = import.meta.glob("../assets/*_chord_list.txt", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>


function parseChordVocab(content: string) {
  return content.split(/\r?\n/).map(line => line.trim()).filter(line => line)
}

export const VOCAB_NAMES = ["ismir2017", "submission", "extended", "full"] as const

export type ChordVocabName = typeof VOCAB_NAMES[number]

export const chordVocab = Object.fromEntries(
  VOCAB_NAMES.map(name => [name, parseChordVocab(chordVocabFiles[`../assets/${name}_chord_list.txt`])])
) as Record<typeof VOCAB_NAMES[number], string[]>
