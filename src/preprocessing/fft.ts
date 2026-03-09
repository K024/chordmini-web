export type ComplexArray = { re: Float32Array; im: Float32Array }

export function fftReal(input: Float32Array): ComplexArray {
  const n = input.length
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  re.set(input)
  fftInPlace(re, im)
  return { re, im }
}

export function ifftInPlace(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 0; i < n; i += 1) {
    im[i] = -im[i]
  }
  fftInPlace(re, im)
  const inv = 1 / n
  for (let i = 0; i < n; i += 1) {
    re[i] *= inv
    im[i] = -im[i] * inv
  }
}

export function rfft(input: Float32Array): ComplexArray {
  const { re, im } = fftReal(input)
  const half = Math.floor(input.length / 2) + 1
  return { re: re.slice(0, half), im: im.slice(0, half) }
}

export function irfft(reHalf: Float32Array, imHalf: Float32Array, n: number): Float32Array {
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  const halfLen = reHalf.length
  re[0] = reHalf[0]
  im[0] = 0
  const maxK = halfLen - 1
  for (let k = 1; k <= maxK; k += 1) {
    re[k] = reHalf[k]
    im[k] = imHalf[k]
    const mirror = n - k
    if (mirror !== k && mirror < n) {
      re[mirror] = reHalf[k]
      im[mirror] = -imHalf[k]
    }
  }
  ifftInPlace(re, im)
  return re
}

export function fftInPlace(re: Float32Array, im: Float32Array) {
  const n = re.length
  const levels = Math.log2(n)
  if (Math.floor(levels) === levels) {
    fftRadix2InPlace(re, im)
    return
  }
  fftBluesteinInPlace(re, im)
}

function fftRadix2InPlace(re: Float32Array, im: Float32Array) {
  const n = re.length
  const levels = Math.log2(n)

  for (let i = 0; i < n; i += 1) {
    const j = reverseBits(i, levels)
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]]
        ;[im[i], im[j]] = [im[j], im[i]]
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2
    const theta = (-2 * Math.PI) / size
    const wTempRe = Math.cos(theta)
    const wTempIm = Math.sin(theta)
    for (let start = 0; start < n; start += size) {
      let wRe = 1
      let wIm = 0
      for (let j = 0; j < half; j += 1) {
        const even = start + j
        const odd = even + half
        const tRe = wRe * re[odd] - wIm * im[odd]
        const tIm = wRe * im[odd] + wIm * re[odd]
        re[odd] = re[even] - tRe
        im[odd] = im[even] - tIm
        re[even] += tRe
        im[even] += tIm
        const nextRe = wRe * wTempRe - wIm * wTempIm
        wIm = wRe * wTempIm + wIm * wTempRe
        wRe = nextRe
      }
    }
  }
}

function fftBluesteinInPlace(re: Float32Array, im: Float32Array) {
  const n = re.length
  let m = 1
  while (m < n * 2 + 1) m <<= 1

  const are = new Float32Array(m)
  const aim = new Float32Array(m)
  const bre = new Float32Array(m)
  const bim = new Float32Array(m)

  for (let i = 0; i < n; i += 1) {
    const angle = (Math.PI * ((i * i) % (2 * n))) / n
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    are[i] = re[i] * cos + im[i] * sin
    aim[i] = -re[i] * sin + im[i] * cos
    bre[i] = cos
    bim[i] = sin
    if (i !== 0) {
      bre[m - i] = cos
      bim[m - i] = sin
    }
  }

  convolveComplex(are, aim, bre, bim)

  for (let i = 0; i < n; i += 1) {
    const angle = (Math.PI * ((i * i) % (2 * n))) / n
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    re[i] = are[i] * cos + aim[i] * sin
    im[i] = -are[i] * sin + aim[i] * cos
  }
}

function convolveComplex(
  xre: Float32Array,
  xim: Float32Array,
  yre: Float32Array,
  yim: Float32Array
) {
  const n = xre.length
  const xr = xre.slice()
  const xi = xim.slice()
  const yr = yre.slice()
  const yi = yim.slice()

  fftRadix2InPlace(xr, xi)
  fftRadix2InPlace(yr, yi)
  for (let i = 0; i < n; i += 1) {
    const tr = xr[i] * yr[i] - xi[i] * yi[i]
    const ti = xr[i] * yi[i] + xi[i] * yr[i]
    xr[i] = tr
    xi[i] = ti
  }
  ifftInPlace(xr, xi)
  xre.set(xr)
  xim.set(xi)
}

function reverseBits(value: number, bits: number): number {
  let result = 0
  for (let i = 0; i < bits; i += 1) {
    result = (result << 1) | (value & 1)
    value >>= 1
  }
  return result
}
