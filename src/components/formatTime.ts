export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--"
  const clamped = Math.max(0, seconds)
  const mins = Math.floor(clamped / 60)
  const secs = Math.floor(clamped % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}
