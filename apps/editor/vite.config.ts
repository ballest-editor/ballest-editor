import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import * as fs from "node:fs"
import * as path from "node:path"
import { type Connect, defineConfig, type Plugin } from "vite"

/**
 * Serves the repo-level `assets/` directory (two levels up from apps/editor) (catalog.json + pieces/**.glb from
 * tools/extract) at /assets/* in `vite dev` and `vite preview`, straight from disk; unknown paths fall through to
 * Vite (whose own build chunks also live under /assets/).
 * `vite build` copies the committed part (JSON + thumbs) into the client output so deployments serve it too.
 * The extracted meshes and textures are left out: they are gitignored, so a deploy built from git never has them.
 */
const unbundledAssets = new Set(["pieces", "textures"])

const repoAssets = (dir: string): Plugin => {
  const root = path.resolve(dir)
  const types: Record<string, string> = {
    ".json": "application/json",
    ".glb": "model/gltf-binary",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0] ?? ""
    if (!url.startsWith("/assets/")) {
      next()
      return
    }
    const file = path.join(root, decodeURIComponent(url.slice("/assets/".length)))
    if (!file.startsWith(root + path.sep)) {
      next()
      return
    }
    fs.stat(file, (error, stat) => {
      if (error !== null || !stat.isFile()) {
        next()
        return
      }
      res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream")
      res.setHeader("Content-Length", stat.size)
      res.setHeader("Cache-Control", "no-cache")
      fs.createReadStream(file).pipe(res)
    })
  }
  return {
    name: "ballest:repo-assets",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
    generateBundle(this) {
      if (this.environment.name !== "client") return
      for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
        const file = path.join(entry.parentPath, entry.name)
        const relative = path.relative(root, file)
        if (!entry.isFile() || unbundledAssets.has(relative.split(path.sep)[0] ?? "")) continue
        this.emitFile({
          type: "asset",
          fileName: path.posix.join("assets", ...relative.split(path.sep)),
          source: fs.readFileSync(file)
        })
      }
    }
  }
}

export default defineConfig(({ command }) => ({
  server: { port: 3000 },
  preview: { port: 3000 },
  resolve: { tsconfigPaths: true },
  // Build only: bundle every server dependency. Otherwise the SSR build inlines CJS deps it treats as framework
  // packages (e.g. base-ui's use-sync-external-store shim) but leaves their `require("react")` to runtime, and the
  // Vercel function ships no node_modules to satisfy it. Dev must keep deps external: its module runner can't
  // evaluate inlined CJS like react/index.js.
  ...(command === "build" ? { ssr: { noExternal: true } } : {}),
  plugins: [
    repoAssets(path.resolve(import.meta.dirname, "../../assets")),
    tailwindcss(),
    tanstackStart(),
    nitro(),
    viteReact()
  ]
}))
