const ROOT_COLORS = [
  "bg-orange-500/60 text-orange-100 border-orange-300/70", // C
  "bg-amber-500/60 text-amber-100 border-amber-300/70", // C#
  "bg-lime-500/60 text-lime-100 border-lime-300/70", // D
  "bg-emerald-500/60 text-emerald-100 border-emerald-300/70", // Eb
  "bg-teal-500/60 text-teal-100 border-teal-300/70", // E
  "bg-cyan-500/60 text-cyan-100 border-cyan-300/70", // F
  "bg-sky-500/60 text-sky-100 border-sky-300/70", // F#
  "bg-blue-500/60 text-blue-100 border-blue-300/70", // G
  "bg-indigo-500/60 text-indigo-100 border-indigo-300/70", // Ab
  "bg-violet-500/60 text-violet-100 border-violet-300/70", // A
  "bg-fuchsia-500/60 text-fuchsia-100 border-fuchsia-300/70", // Bb
  "bg-pink-500/60 text-pink-100 border-pink-300/70", // B
]

const TYPE_COLORS: Record<string, string> = {
  maj: "bg-sky-500/60 text-sky-100 border-sky-300/70",
  min: "bg-violet-500/60 text-violet-100 border-violet-300/70",
  sus4: "bg-amber-500/60 text-amber-100 border-amber-300/70",
  sus2: "bg-amber-500/60 text-amber-100 border-amber-300/70",
  dim: "bg-rose-500/60 text-rose-100 border-rose-300/70",
  aug: "bg-orange-500/60 text-orange-100 border-orange-300/70",
  "5": "bg-slate-500/60 text-slate-100 border-slate-300/70",
  "1": "bg-slate-400/60 text-slate-100 border-slate-300/70",
  maj6: "bg-teal-500/60 text-teal-100 border-teal-300/70",
  min6: "bg-violet-500/60 text-violet-100 border-violet-300/70",
  "7": "bg-sky-500/60 text-sky-100 border-sky-300/70",
  maj7: "bg-teal-500/60 text-teal-100 border-teal-300/70",
  min7: "bg-violet-500/60 text-violet-100 border-violet-300/70",
  minmaj7: "bg-fuchsia-500/60 text-fuchsia-100 border-fuchsia-300/70",
  dim7: "bg-rose-500/60 text-rose-100 border-rose-300/70",
  hdim7: "bg-rose-400/60 text-rose-100 border-rose-300/70",
}

function normalizeLabel(label: string) {
  if (!label || label === "N") return { root: -1, bass: -1, type: "N" }
  const [head, bassPart] = label.split("/")
  const [rootPart, typePart] = head.split(":")
  const root = noteToIndex(rootPart)
  const bass = bassPart ? noteToIndex(bassPart) : root
  const type = typePart && typePart.length ? typePart : "maj"
  return { root, bass, type }
}

function noteToIndex(note: string) {
  const clean = note.replace(":", "")
  const map: Record<string, number> = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
  }
  return map[clean] ?? 0
}

export type ChordColorMode = "root" | "bass" | "type"

function normalizeType(type: string) {
  if (type === "9" || type === "11" || type === "13") return "7"
  if (type === "maj9" || type === "maj11" || type === "maj13") return "maj7"
  if (type === "min9" || type === "min11" || type === "min13") return "min7"
  return type
}

export function getChordColorClass(label: string, mode: ChordColorMode) {
  const info = normalizeLabel(label)
  if (info.type === "N") return "bg-slate-300/60 text-slate-100 border-slate-300/70"
  if (mode === "type") {
    const key = normalizeType(info.type)
    return TYPE_COLORS[key] ?? "bg-slate-400/60 text-slate-100 border-slate-300/70"
  }
  if (mode === "bass") {
    return ROOT_COLORS[(info.bass + 12) % 12]
  }
  return ROOT_COLORS[(info.root + 12) % 12]
}
