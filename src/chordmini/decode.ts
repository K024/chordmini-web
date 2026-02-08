

export const TARGET_SAMPLE_RATE = 22050


function mixChannels(channel0: Float32Array, channel1: Float32Array) {
  const length = Math.min(channel0.length, channel1.length)
  const result = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    result[i] = (channel0[i] + channel1[i]) / 2
  }
  return result
}


// `OfflineAudioContext` is only available in the main thread


export interface DecodedAudio {
  samples: Float32Array
  duration: number
  sr: number
}

export async function decodeAndResample(file: File, targetSr: number): Promise<DecodedAudio> {
  const data = await file.arrayBuffer()
  const ctx = new OfflineAudioContext(2, 1024, targetSr)
  const audioBuffer = await ctx.decodeAudioData(data)

  if (audioBuffer.sampleRate === targetSr) {
    return {
      samples:
        audioBuffer.numberOfChannels > 1
          ? mixChannels(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1))
          : audioBuffer.getChannelData(0),
      sr: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
    }
  }

  const offline = new OfflineAudioContext(audioBuffer.numberOfChannels, Math.ceil(audioBuffer.duration * targetSr), targetSr)
  const source = offline.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offline.destination)
  source.start(0)

  const rendered = await offline.startRendering()
  return {
    samples:
      rendered.numberOfChannels > 1
        ? mixChannels(rendered.getChannelData(0), rendered.getChannelData(1))
        : rendered.getChannelData(0),
    sr: targetSr,
    duration: rendered.duration,
  }
}
