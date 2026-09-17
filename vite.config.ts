import { defineConfig } from "vite"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { serviceWorkerPlugin } from "./src/service-worker/vite/serviceWorker.ts"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    preact(),
    tailwindcss(),
    serviceWorkerPlugin({
      // Ignore onnx and wasm files from being precached
      ignoreFileRegex: /\.(onnx|wasm)$/,
    }),
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  },
  build: {
    minify: "oxc",
    rolldownOptions: {
      output: {
        comments: {
          legal: true,
        },
      },
    },
  },
})
