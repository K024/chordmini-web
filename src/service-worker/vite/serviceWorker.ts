import type Rollup from "rollup" // indirect
import type { Plugin, ResolvedConfig } from "vite"
import replace from "@rollup/plugin-replace"
import { glob } from "tinyglobby" // indirect
import { createHash } from "node:crypto"
import path from "node:path"
import fs from "node:fs/promises"

export interface serviceWorkerPluginConfig {
  /** @default "sw.js" */
  output?: string

  /** @default "self.__WB_MANIFEST" */
  injectManifest?: false | string

  ignoreFileRegex?: RegExp
}

function hash(input: string | Buffer | Uint8Array) {
  return createHash("md5").update(input).digest().toString("hex").substring(0, 16)
}

export function serviceWorkerPlugin(swConfig?: serviceWorkerPluginConfig): Plugin {

  const swQuery = "?serviceWorker"
  const swOutput = swConfig?.output ?? "sw.js"
  const swReplace = swConfig?.injectManifest ?? "self.__WB_MANIFEST"
  const ignoreFileRegex = swConfig?.ignoreFileRegex

  let config: ResolvedConfig
  let swFileId = ""

  return {
    name: "vite-plugin-service-worker",
    enforce: "post",

    configResolved(cfg) {
      config = cfg
    },

    load(id) {
      if (id.endsWith(swQuery))
        return ""
    },

    transform(code, id) {
      if (id.endsWith(swQuery)) {
        if (swFileId && id !== swFileId)
          this.error("Cannot not import multiple service workers")

        if (config.command === "build")
          swFileId = id

        return "export {}"
      }
    },

    async generateBundle(opt, bundle) {
      // `generateBundle` will be called multiple times if this hook emits extra code or assets.
      if (!swFileId) return
      const id = swFileId.replace(swQuery, "")
      swFileId = ""

      // collect manifest information
      const manifest: { url: string, revision: string | null }[] = []

      for (const file in bundle) {
        const chunk = bundle[file]
        if (ignoreFileRegex && ignoreFileRegex.test(file))
          continue
        if (chunk.type === "chunk")
          manifest.push({ url: config.base + chunk.fileName, revision: hash(chunk.code) })
        else
          manifest.push({ url: config.base + chunk.fileName, revision: hash(chunk.source) })
      }

      for (const fileName of await glob("*", { cwd: config.publicDir })) {
        const filePath = path.resolve(config.publicDir, fileName)
        manifest.push({ url: config.base + fileName, revision: hash(await fs.readFile(filePath)) })
      }

      // bundle service worker
      const { build: viteBuild } = await import("vite")

      const plugins: any[] = []
      if (swReplace)
        plugins.push(replace({ [swReplace]: JSON.stringify(manifest), preventAssignment: true }))

      let output: Rollup.OutputChunk
      const buildResult = await viteBuild({
        configFile: false,
        root: config.root,
        publicDir: false,
        logLevel: config.logLevel,
        mode: config.mode,
        envDir: config.envDir,
        envPrefix: config.envPrefix,
        define: config.define,
        resolve: config.resolve,
        plugins,
        build: {
          write: false,
          sourcemap: config.build.sourcemap,
          rollupOptions: {
            input: id,
            output: {
              format: "iife",
              entryFileNames: swOutput,
            },
          },
        },
      }) as Rollup.RollupOutput | Rollup.RollupOutput[]

      const rollupOutput = Array.isArray(buildResult) ? buildResult[0] : buildResult
      output = rollupOutput.output[0] as Rollup.OutputChunk

      // starting from rollup 3, no need to add source mapping url to code
      this.emitFile({
        type: "asset",
        fileName: output.fileName,
        source: output.code,
      })

      if (output.map && config.build.sourcemap && config.build.sourcemap !== "inline") {
        this.emitFile({
          type: "asset",
          fileName: output.fileName + ".map",
          source: output.map.toString(),
        })
      }
    },
  }
}
