import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import * as fs from "node:fs"
import * as path from "node:path"
import { type Connect, defineConfig, type Plugin } from "vite"

const repoRoot = path.resolve(import.meta.dirname, "../..")
/** The extractor's small committed files (catalog, materials, keybinds, thumbs, ...). */
const rawAssets = path.join(repoRoot, "assets")
/** tools/compress's meshopt meshes and AVIF textures; gitignored, so often absent. */
const webAssets = path.join(repoRoot, "web-assets")
/** The raw meshes and textures are gitignored and never served: the compressed ones are. */
const rawOnly = new Set(["pieces", "textures"])

const types: Record<string, string> = {
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".avif": "image/avif"
}

/**
 * Serves `/assets/*` from `assets/` (except its raw `pieces/` and `textures/`) and from `web-assets/`, straight
 * from disk, in `vite dev` and `vite preview`; unknown paths fall through to Vite (whose own chunks also live
 * under /assets/). `vite build` copies the same files into `dist/` so deployments serve them too.
 *
 * Meshes and textures come from `web-assets/`: `pnpm assets` (turbo's `//#assets`, which `dev` and `build`
 * depend on) compresses them there or, without the game, downloads the published asset pack.
 */
const repoAssets = (): Plugin => {
  const roots = [rawAssets, webAssets]
  const servable = (root: string, rel: string) => !(root === rawAssets && rawOnly.has(rel.split(path.sep)[0] ?? ""))
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0] ?? ""
    if (!url.startsWith("/assets/")) {
      next()
      return
    }
    const rel = decodeURIComponent(url.slice("/assets/".length))
    const file = roots
      .map((root) => ({ root, f: path.join(root, rel) }))
      .find(({ f, root }) =>
        f.startsWith(root + path.sep) && servable(root, rel) && fs.statSync(f, { throwIfNoEntry: false })?.isFile()
      )?.f
    if (file === undefined) {
      next()
      return
    }
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream")
    res.setHeader("Content-Length", fs.statSync(file).size)
    res.setHeader("Cache-Control", "no-cache")
    fs.createReadStream(file).pipe(res)
  }
  return {
    name: "ballest:repo-assets",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
    generateBundle() {
      for (const root of roots) {
        if (!fs.existsSync(root)) continue
        for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile()) continue
          const file = path.join(entry.parentPath, entry.name)
          const rel = path.relative(root, file)
          if (!servable(root, rel)) continue
          this.emitFile({
            type: "asset",
            fileName: path.posix.join("assets", ...rel.split(path.sep)),
            source: fs.readFileSync(file)
          })
        }
      }
    }
  }
}

export default defineConfig(() => {
  if (!fs.existsSync(path.join(webAssets, "pieces"))) {
    console.warn("[ballest] no web-assets/: meshes and textures will 404 (run `pnpm assets`)")
  }
  return {
    server: { port: 3000 },
    preview: { port: 3000 },
    resolve: { tsconfigPaths: true },
    plugins: [repoAssets(), tailwindcss(), tanstackRouter({ target: "react", autoCodeSplitting: true }), viteReact()]
  }
})
