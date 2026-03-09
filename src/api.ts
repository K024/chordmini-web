import { expose } from "comlink"
import { preprocess, inferChordModels, decodeChords, type ChordSegment, decodeAudio, sampleRates, type BeatEvent, preprocessBeatFeatures, inferBeatModels, decodeBeatEvents } from "./chordmini"
import { hasUpdate } from "./service-worker/register"
import type { ProgressReporter } from "./utils"



// api messages

const version = "0.0.1"

interface ChordMiniComlinkApiMessage {
  type: "chordmini-api"
  port: MessagePort
}


// api definitions

interface RecognizeChordsArgs {
  audio: File
}

interface RecognizeBeatsArgs {
  audio: File
}

interface ChordMiniApi {
  recognizeChords: (
    args: RecognizeChordsArgs,
    onLogProgress?: (message: string, stepProgress?: number) => void
  ) => Promise<ChordSegment[]>
  recognizeBeats: (
    args: RecognizeBeatsArgs,
    onLogProgress?: ProgressReporter
  ) => Promise<BeatEvent[]>
  forceUpdate: () => void
  version: () => string
}



// functionalities

async function recognizeChords(args: RecognizeChordsArgs, onLogProgress?: ProgressReporter) {
  const { audio } = args
  const decodedAudio = await decodeAudio(audio, sampleRates.chord, onLogProgress)
  const processed = await preprocess(decodedAudio, onLogProgress)
  const inferred = await inferChordModels(processed, onLogProgress)
  const decoded = await decodeChords(inferred, processed)
  return decoded
}

async function recognizeBeats(args: RecognizeBeatsArgs, onLogProgress?: ProgressReporter) {
  const { audio } = args
  const decodedAudio = await decodeAudio(audio, sampleRates.beat, onLogProgress)
  const features = await preprocessBeatFeatures(decodedAudio, onLogProgress)
  const activations = await inferBeatModels(features, onLogProgress)
  const events = await decodeBeatEvents(activations, true, onLogProgress)
  return events
}


/**
 * Usage:
 * ```ts
    import { wrap } from "comlink"

    const channel = new MessageChannel();
    const api = wrap<RecognitionApi>(channel.port1);

    iframe.contentWindow.postMessage({
      type: "chordmini-api",
      port: channel.port2,
    }, "*", [channel.port2]);

    // wait for the api to be exposed
    await new Promise(resolve => {
      channel.port1.addEventListener("message", (event) => {
        resolve(event.data)
      }, { once: true })
      channel.port1.start()
    })
    await api.version()
 * ```
 */
export function exposeParentWindowApi() {
  window.addEventListener("message", (event) => {
    const data: ChordMiniComlinkApiMessage = event.data
    if ("type" in data && data.type === "chordmini-api") {
      const port: MessagePort = data.port
      const api: ChordMiniApi = {
        recognizeChords,
        recognizeBeats,
        forceUpdate: () => hasUpdate.value && hasUpdate.value(),
        version: () => version,
      }
      port.postMessage({
        type: "chordmini-api",
        data: {
          version,
        },
      })
      expose(api, port)
      console.log("Exposed ChordMini API to incoming message port")
    }
  })
}
