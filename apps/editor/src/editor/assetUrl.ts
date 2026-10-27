/**
 * Where a served asset lives. Everything is addressed as a path under the extractor's
 * `assets/` tree (`pieces/...glb`, `textures/...png`, `thumbs/...png`, `catalog.json`).
 *
 * - The small committed files are served by the app itself at `/assets/*`.
 * - Meshes and textures are big and gitignored. `tools/compress` writes them (meshopt glb,
 *   AVIF) to `web-assets/`; when that directory is on disk the app serves it at `/assets/*`
 *   too. Otherwise the build points at the published copy on Vercel Blob, whose base URL
 *   `vite.config.ts` reads from `web-assets.json` into `VITE_ASSETS_BASE`.
 *
 * Textures are always requested as `.avif`: the extractor's `materials.json` names the
 * `.png` it was derived from, and this is the one place that difference is bridged.
 */

const base = import.meta.env.VITE_ASSETS_BASE
const compressed = /^(pieces|textures)\//

export const assetUrl = (path: string): string =>
  base !== undefined && base.length > 0 && compressed.test(path) ? `${base}/${path}` : `/assets/${path}`

export const textureUrl = (path: string): string =>
  path.startsWith("/") ? path : assetUrl(path.replace(/\.png$/, ".avif"))
