export function nextPow2(value: number): number {
  return 1 << Math.ceil(Math.log2(Math.max(1, value)))
}

export function padConstant(input: Float32Array, pad: number): Float32Array {
  const out = new Float32Array(input.length + pad * 2)
  out.set(input, pad)
  return out
}

export function padCenter(input: Float32Array, size: number): Float32Array {
  if (size < input.length) {
    throw new Error("padCenter size must be >= input length")
  }
  const out = new Float32Array(size)
  const start = Math.floor((size - input.length) / 2)
  out.set(input, start)
  return out
}

export function padCenterComplex(
  re: Float32Array,
  im: Float32Array,
  size: number
): { re: Float32Array; im: Float32Array } {
  return { re: padCenter(re, size), im: padCenter(im, size) }
}

export function l1Normalize(re: Float32Array, im: Float32Array) {
  let sum = 0
  for (let i = 0; i < re.length; i += 1) {
    sum += Math.hypot(re[i], im[i])
  }
  if (sum === 0) return
  const inv = 1 / sum
  for (let i = 0; i < re.length; i += 1) {
    re[i] *= inv
    im[i] *= inv
  }
}

export function magnitude(re: Float32Array, im: Float32Array): Float32Array {
  const out = new Float32Array(re.length)
  for (let i = 0; i < re.length; i += 1) {
    out[i] = Math.hypot(re[i], im[i])
  }
  return out
}

export function quantile(values: Float32Array, q: number): number {
  if (q <= 0) return -Infinity
  if (q >= 1) return Infinity
  const sorted = Array.from(values).sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  const t = pos - lo
  return sorted[lo] * (1 - t) + sorted[hi] * t
}

export function range(start: number, stop: number): Float32Array {
  const length = Math.max(0, Math.ceil(stop - start))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    out[i] = start + i
  }
  return out
}
