import * as fs from "node:fs"
import * as path from "node:path"
import { defineConfig, type EnvironmentOptions } from "vite"

const outDir = path.join(import.meta.dirname, "dist-electron")

/**
 * Main and preload are separate environments so neither shares chunks with the other: a sandboxed preload can't
 * `require` anything but `electron`. Both bundle every dependency into one CommonJS file in `dist-electron/`.
 */
const bundle = (entry: string): EnvironmentOptions => ({
  consumer: "server",
  resolve: { noExternal: true, external: ["electron"] },
  build: {
    outDir,
    emptyOutDir: false,
    target: "node22",
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      input: entry,
      external: ["electron"],
      output: { format: "cjs", entryFileNames: "[name].cjs", codeSplitting: false }
    }
  }
})

export default defineConfig({
  environments: {
    main: bundle("src/main.ts"),
    preload: bundle("src/preload.ts")
  },
  builder: {
    // Both environments write into one directory, so it is emptied once here instead of by each build.
    buildApp: async (builder) => {
      fs.rmSync(outDir, { recursive: true, force: true })
      const environments = Object.values(builder.environments).filter(({ name }) => name !== "client")
      await Promise.all(environments.map((environment) => builder.build(environment)))
    }
  }
})
