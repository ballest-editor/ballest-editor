import { type ReactNode, useEffect, useState } from "react"
import type { CatalogPiece } from "../domain/Catalog"
import { useEditor } from "../editor/store"
import { thumbnailFor } from "../editor/thumbnails"

/**
 * The in-game render when the catalog has one; otherwise one rendered here from the piece's meshes (see
 * editor/thumbnails.ts), with `placeholder` while it's in the queue or when there's nothing to draw.
 */
export function PieceThumbnail({ piece, className, placeholder }: {
  readonly piece: CatalogPiece
  readonly className: string
  readonly placeholder: ReactNode
}) {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const [rendered, setRendered] = useState<string | undefined>(undefined)
  const shipped = piece.thumbnail ?? undefined
  useEffect(() => {
    if (shipped !== undefined || index === null || table === null) return
    let cancelled = false
    void thumbnailFor(piece, index, table).then((url) => {
      if (!cancelled) setRendered(url)
    })
    return () => {
      cancelled = true
    }
  }, [piece, shipped, index, table])
  const src = shipped !== undefined ? `/assets/${shipped}` : rendered
  return src === undefined ? placeholder : <img src={src} alt="" className={className} loading="lazy" />
}
