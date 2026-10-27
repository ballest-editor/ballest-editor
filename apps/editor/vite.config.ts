import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
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

/** Base URL of the published web-assets/ on Vercel Blob (tools/compress/upload.mjs writes it). */
const blobBase = (): string | undefined => {
  const file = path.join(repoRoot, "web-assets.json")
  if (!fs.existsSync(file)) return undefined
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
  if (typeof parsed !== "object" || parsed === null || !("base" in parsed)) return undefined
  return typeof parsed.base === "string" ? parsed.base : undefined
}

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
 * under /assets/). `vite build` copies the same files into the client output so deployments serve them too.
 *
 * Meshes and textures come from `web-assets/` when it is on disk. When it isn't (Vercel, CI, a fresh clone)
 * the client is built with `VITE_ASSETS_BASE` pointing at the published copy on Vercel Blob instead; see
 * `src/editor/assetUrl.ts`.
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
    generateBundle(this) {
      if (this.environment.name !== "client") return
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

export default defineConfig(({ command }) => {
  const local = fs.existsSync(path.join(webAssets, "pieces"))
  const base = local ? undefined : blobBase()
  if (!local && base === undefined) {
    console.warn("[ballest] no web-assets/ and no web-assets.json: meshes and textures will 404 (run `pnpm assets`)")
  }
  return {
    server: { port: 3000 },
    preview: { port: 3000 },
    resolve: { tsconfigPaths: true },
    define: { "import.meta.env.VITE_ASSETS_BASE": JSON.stringify(base ?? "") },
    // Build only: bundle every server dependency. Otherwise the SSR build inlines CJS deps it treats as framework
    // packages (e.g. base-ui's use-sync-external-store shim) but leaves their `require("react")` to runtime, and the
    // Vercel function ships no node_modules to satisfy it. Dev must keep deps external: its module runner can't
    // evaluate inlined CJS like react/index.js. Bundling only the offenders plus react doesn't work either: Nitro
    // traces react-router as a separate library with its own React, and SSR fails with hooks reading `null`.
    ...(command === "build" ? { ssr: { noExternal: true } } : {}),
    plugins: [repoAssets(), tailwindcss(), tanstackStart(), nitro(), viteReact()]
  }
})
