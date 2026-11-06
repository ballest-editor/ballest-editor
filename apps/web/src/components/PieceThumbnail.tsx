import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect, useState } from "react"
import type { CatalogPiece } from "../domain/Catalog"
import { useEditor } from "../editor/store"
import { thumbnailFor } from "../editor/thumbnails"

/**
 * The in-game render when the catalog has one; otherwise one rendered here from the piece's meshes (see
 * editor/thumbnails.ts), with `placeholder` until the image has loaded, or for good when there's nothing to draw or it
 * fails. The waiting image is transparent and out of the flow, not `display: none`, which a lazy image never loads from.
 */
export function PieceThumbnail({ piece, className, placeholder }: {
  readonly piece: CatalogPiece
  readonly className: string
  readonly placeholder: ReactNode
}) {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const [rendered, setRendered] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
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
  const showing = src !== undefined && src === loaded
  return (
    <span className="relative flex shrink-0">
      {!showing && placeholder}
      {src !== undefined && (
        <img
          src={src}
          alt=""
          className={cn(className, !showing && "absolute inset-0 opacity-0")}
          loading="lazy"
          onLoad={() => setLoaded(src)}
        />
      )}
    </span>
  )
}
