import * as fs from "node:fs"
import * as path from "node:path"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { type Connect, defineConfig, type Plugin } from "vite"

/**
 * Serves the repo-level `assets/` directory (two levels up from apps/editor) (catalog.json + pieces/**.glb from
 * tools/extract) at /assets/* in `vite dev` and `vite preview`, straight from disk.
 * Nothing is copied into the app or the build output; unknown paths fall through to
 * Vite (whose own build chunks also live under /assets/).
 */
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
    if (!url.startsWith("/assets/")) {  next(); return; }
    const file = path.join(root, decodeURIComponent(url.slice("/assets/".length)))
    if (!file.startsWith(root + path.sep)) {  next(); return; }
    fs.stat(file, (error, stat) => {
      if (error !== null || !stat.isFile()) {  next(); return; }
      res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream")
      res.setHeader("Content-Length", stat.size)
      res.setHeader("Cache-Control", "no-cache")
      fs.createReadStream(file).pipe(res)
    })
  }
  return {
    name: "ballest:repo-assets",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware)
  }
}

export default defineConfig({
  server: { port: 3000 },
  preview: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [repoAssets(path.resolve(import.meta.dirname, "../../assets")), tailwindcss(), tanstackStart(), viteReact()]
})
