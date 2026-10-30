/**
 * Where a served asset lives. Everything is addressed as a path under the extractor's
 * `assets/` tree (`pieces/...glb`, `textures/...png`, `thumbs/...png`, `catalog.json`) and
 * served by the app itself at `/assets/*`: the small committed files from `assets/`, the
 * meshes and textures from `web-assets/` (`tools/compress`'s meshopt glb and AVIF, either
 * compressed here or downloaded as the published asset pack). The web build copies both into
 * `dist/`; the desktop app serves the same paths through its protocol handler.
 *
 * Textures are always requested as `.avif`: the extractor's `materials.json` names the
 * `.png` it was derived from, and this is the one place that difference is bridged.
 */

export const assetUrl = (path: string): string => `/assets/${path}`

export const textureUrl = (path: string): string =>
  path.startsWith("/") ? path : assetUrl(path.replace(/\.png$/, ".avif"))
