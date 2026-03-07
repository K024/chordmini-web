import { expose } from "comlink"
import { preprocess, inferChordModels, decodeChords, type ChordSegment } from "./chordmini"
import { hasUpdate } from "./service-worker/register"
import type { ProgressReporter } from "./utils"


const version = "0.0.1"

interface RecognizeChordsArgs {
  audio: File
}

interface ChordMiniApi {
  recognizeChords: (
    args: RecognizeChordsArgs,
    onLogProgress?: (message: string, stepProgress?: number) => void
  ) => Promise<ChordSegment[]>
  forceUpdate: () => void
  version: () => string
}


async function recognizeChords(args: RecognizeChordsArgs, onLogProgress?: ProgressReporter) {
  const { audio } = args
  const processed = await preprocess(audio, onLogProgress)
  const inferred = await inferChordModels(processed, onLogProgress)
  const decoded = await decodeChords(inferred, processed)
  return decoded
}

interface ChordMiniComlinkApiMessage {
  type: "chordmini-api"
  port: MessagePort
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
