export type WindowSpec = "hann" | "ones"

export function hannWindow(length: number, fftbins = true): Float32Array {
  const out = new Float32Array(length)
  if (length <= 1) {
    if (length === 1) out[0] = 1
    return out
  }
  if (fftbins) {
    const denom = length
    for (let i = 0; i < length; i += 1) {
      out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
    }
  } else {
    const denom = length - 1
    for (let i = 0; i < length; i += 1) {
      out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
    }
  }
  return out
}

export function getWindow(window: WindowSpec, length: number, fftbins = true): Float32Array {
  if (window === "ones") {
    return new Float32Array(length).fill(1)
  }
  if (window === "hann") {
    return hannWindow(length, fftbins)
  }
  throw new Error(`Unsupported window ${window}`)
}

export function floatWindow(window: WindowSpec, length: number): Float32Array {
  const nMin = Math.floor(length)
  const nMax = Math.ceil(length)
  let win = getWindow(window, nMin, true)
  if (win.length < nMax) {
    const padded = new Float32Array(nMax)
    padded.set(win, 0)
    win = padded
  }
  for (let i = nMin; i < win.length; i += 1) {
    win[i] = 0
  }
  return win
}

export function windowBandwidth(window: WindowSpec, n = 1000): number {
  const win = getWindow(window, n, true)
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < win.length; i += 1) {
    sum += win[i]
    sumSq += win[i] * win[i]
  }
  return (n * sumSq) / (sum * sum + 1e-12)
}
