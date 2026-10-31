import { Resvg } from "@resvg/resvg-js"
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { defineConfig, type EnvironmentOptions, type Plugin } from "vite"
import { verifyPreloadBundle } from "./scripts/verifyPreloadBundle"

const outDir = path.join(import.meta.dirname, "dist-electron")

/**
 * Main and preload are separate environments so neither shares chunks with the other: a sandboxed preload can't
 * `require` anything but `electron`. Both bundle every dependency into one CommonJS file in `dist-electron/`.
 */
const cjsEnvironment = (entry: string): EnvironmentOptions => ({
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

/** Fails the preload build if the bundle couldn't run sandboxed or doesn't expose the whole DesktopBridge. */
const checkPreload = (): Plugin => ({
  name: "ballest:check-preload",
  applyToEnvironment: (environment) => environment.name === "preload",
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type === "chunk" && chunk.isEntry) verifyPreloadBundle(chunk.code)
    }
  }
})

/** The window's icon (`DesktopEnvironment.iconPath`), rendered from the same SVG as the installers' icons. */
const windowIcon = (): Plugin => ({
  name: "ballest:window-icon",
  applyToEnvironment: (environment) => environment.name === "main",
  generateBundle() {
    const file = path.join(import.meta.dirname, "resources/icon.svg")
    this.addWatchFile(file)
    const svg = fs.readFileSync(file, "utf8")
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 256 } }).render().asPng()
    this.emitFile({ type: "asset", fileName: "icon.png", source: png })
  }
})

const entries = { main: "src/main.ts", preload: "src/preload.ts" }

/**
 * `vite build --watch` (`pnpm dev:desktop`) runs Electron alongside itself, like tsdown's `onSuccess`, once both
 * bundles are on disk: `builder.build` returns as soon as a watcher is set up, before anything is written. The runner
 * restarts Electron when the bundles change and exits when this process does (its IPC channel closes). If it gives up
 * (no dev server), so does the watch build, and turbo stops the session.
 */
const devElectron = (): Plugin => {
  const written = new Set<string>()
  let started = false
  return {
    name: "ballest:dev-electron",
    // One instance for both environments, so it sees each one's first write.
    sharedDuringBuild: true,
    writeBundle() {
      if (!this.meta.watchMode || started) return
      written.add(this.environment.name)
      if (written.size < Object.keys(entries).length) return
      started = true
      const child = spawn(process.execPath, [path.join(import.meta.dirname, "scripts/dev-electron.ts")], {
        stdio: ["inherit", "inherit", "inherit", "ipc"]
      })
      child.on("exit", (code) => {
        if (code !== 0) process.exit(code ?? 1)
      })
    }
  }
}

export default defineConfig({
  plugins: [checkPreload(), windowIcon(), devElectron()],
  environments: { main: cjsEnvironment(entries.main), preload: cjsEnvironment(entries.preload) },
  builder: {
    // Both environments write into one directory, so it is emptied once here instead of by each build.
    buildApp: async (builder) => {
      fs.rmSync(outDir, { recursive: true, force: true })
      const environments = Object.values(builder.environments).filter(({ name }) => name !== "client")
      await Promise.all(environments.map((environment) => builder.build(environment)))
    }
  }
})
