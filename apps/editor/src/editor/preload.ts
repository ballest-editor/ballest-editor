/**
 * Warms drei's useGLTF cache (the one loader cache every ItemObject reads from), so a mesh
 * is fetched and parsed once and shared by every instance.
 *
 * - Hovering a palette entry preloads its meshes immediately, so the click is instant.
 * - After the catalog loads, every palette piece is preloaded in the background, a couple
 *   per idle callback, so it never competes with interaction.
 */
import { useGLTF } from "@react-three/drei"
import { type Catalog, type CatalogIndex, type CatalogPiece, visibleExtras } from "../domain/Catalog"
import { glbUrl } from "./visuals"

/** Every glb a placed piece will render: its main mesh and its visible extra meshes. */
export const glbUrlsForPiece = (piece: CatalogPiece, index: CatalogIndex): ReadonlyArray<string> => {
  const urls = new Set<string>()
  const main = piece.meshAssetPath === null ? undefined : index.meshes.get(piece.meshAssetPath)
  const mainUrl = glbUrl(main?.glb ?? piece.glb)
  if (mainUrl !== undefined) urls.add(mainUrl)
  for (const extra of visibleExtras(piece)) {
    const url = glbUrl(index.meshes.get(extra.meshAssetPath ?? "")?.glb ?? extra.glb)
    if (url !== undefined) urls.add(url)
  }
  return [...urls]
}

type Preload = (url: string) => void

const requested = new Set<string>()

/** Starts loading `url` into the shared cache once; later calls are no-ops. */
export const preloadGlb = (url: string, preload: Preload = (u) => useGLTF.preload(u)): void => {
  if (requested.has(url)) return
  requested.add(url)
  preload(url)
}

export const preloadPiece = (piece: CatalogPiece, index: CatalogIndex, preload?: Preload): void => {
  for (const url of glbUrlsForPiece(piece, index)) preloadGlb(url, preload)
}

type IdleScheduler = (run: () => void) => void

const defaultIdle: IdleScheduler = (run) =>
  typeof requestIdleCallback === "function"
    ? void requestIdleCallback(run, { timeout: 2000 })
    : void setTimeout(run, 50)

/** Preloads all palette pieces' meshes, `perTick` urls per idle callback. Returns a cancel function. */
export const warmCatalog = (
  catalog: Catalog,
  index: CatalogIndex,
  options: { readonly perTick?: number; readonly idle?: IdleScheduler; readonly preload?: Preload } = {}
): () => void => {
  const queue = catalog.pieces
    .filter((piece) => piece.inPalette !== false)
    .flatMap((piece) => glbUrlsForPiece(piece, index))
  const perTick = options.perTick ?? 2
  const idle = options.idle ?? defaultIdle
  let cancelled = false
  const tick = () => {
    if (cancelled) return
    for (let i = 0; i < perTick; i++) {
      const url = queue.shift()
      if (url === undefined) break
      preloadGlb(url, options.preload)
    }
    if (queue.length > 0) idle(tick)
  }
  idle(tick)
  return () => {
    cancelled = true
  }
}
