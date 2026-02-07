const PI = Math.PI

function besselI0(x: number): number {
  let sum = 1
  let term = 1
  const y = (x * x) / 4
  for (let k = 1; k < 30; k += 1) {
    term *= y / (k * k)
    sum += term
  }
  return sum
}

function kaiserWindow(length: number, beta: number): Float32Array {
  const out = new Float32Array(length)
  const denom = besselI0(beta)
  const M = length - 1
  for (let n = 0; n < length; n += 1) {
    const r = (2 * n) / M - 1
    const val = besselI0(beta * Math.sqrt(1 - r * r)) / denom
    out[n] = val
  }
  return out
}

function firwin(numTaps: number, cutoff: number, beta: number): Float32Array {
  const out = new Float32Array(numTaps)
  const win = kaiserWindow(numTaps, beta)
  const M = numTaps - 1
  const center = M / 2
  for (let n = 0; n < numTaps; n += 1) {
    const m = n - center
    let h = 0
    if (Math.abs(m) < 1e-12) {
      h = cutoff
    } else {
      h = Math.sin(PI * cutoff * m) / (PI * m)
    }
    out[n] = h * win[n]
  }
  let sum = 0
  for (let i = 0; i < out.length; i += 1) {
    sum += out[i]
  }
  if (sum !== 0) {
    const inv = 1 / sum
    for (let i = 0; i < out.length; i += 1) {
      out[i] *= inv
    }
  }
  return out
}

function outputLen(hLen: number, nIn: number, up: number, down: number): number {
  return Math.floor((nIn * up + hLen + down - 2) / down)
}

export function resamplePolyDown2(
  input: Float32Array,
  scale = true
): Float32Array {
  const up = 1
  const down = 2
  const nIn = input.length
  const maxRate = Math.max(up, down)
  const cutoff = 1 / maxRate
  const halfLen = 10 * maxRate
  const h = firwin(2 * halfLen + 1, cutoff, 5.0)
  let nPrePad = down - (halfLen % down)
  if (nPrePad === down) nPrePad = down
  let nPostPad = 0
  const nOut = Math.ceil((nIn * up) / down)
  const nPreRemove = Math.floor((halfLen + nPrePad) / down)
  while (outputLen(h.length + nPrePad + nPostPad, nIn, up, down) < nOut + nPreRemove) {
    nPostPad += 1
  }
  const hPadded = new Float32Array(h.length + nPrePad + nPostPad)
  hPadded.set(h, nPrePad)
  const out = new Float32Array(nOut)
  for (let k = 0; k < nOut; k += 1) {
    const idx = (nPreRemove + k) * down
    let acc = 0
    for (let i = 0; i < hPadded.length; i += 1) {
      const xIdx = idx - i
      if (xIdx >= 0 && xIdx < nIn) {
        acc += hPadded[i] * input[xIdx]
      }
    }
    out[k] = acc
  }
  if (scale) {
    const ratio = up / down
    const factor = 1 / Math.sqrt(ratio)
    for (let i = 0; i < out.length; i += 1) {
      out[i] *= factor
    }
  }
  return out
}
