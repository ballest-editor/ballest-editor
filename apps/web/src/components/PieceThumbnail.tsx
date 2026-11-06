import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { CatalogPiece } from "../domain/Catalog"
import { assetUrl } from "../editor/assetUrl"
import { useEditor } from "../editor/store"
import { keepsShippedThumbnail, thumbnailFor } from "../editor/thumbnails"

/** True from the first time the element comes into view, so a long list only renders what gets looked at. */
const useSeen = () => {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (element === null || seen) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])
  return { ref, seen }
}

/**
 * A piece's picture, rendered here from its meshes on a transparent background (see editor/thumbnails.ts), with
 * `placeholder` until the image has loaded. A light, or a piece that doesn't render, shows the in-game render when the
 * catalog has one; without one it keeps `placeholder`. The waiting image is transparent and out of the flow, not
 * `display: none`, which never fires its load.
 */
export function PieceThumbnail({ piece, className, placeholder }: {
  readonly piece: CatalogPiece
  readonly className: string
  readonly placeholder: ReactNode
}) {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const { ref, seen } = useSeen()
  const [rendered, setRendered] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const shipped = piece.thumbnail == null ? undefined : assetUrl(piece.thumbnail)
  const keepShipped = keepsShippedThumbnail(piece)
  useEffect(() => {
    if (keepShipped || !seen || index === null || table === null) return
    let cancelled = false
    void thumbnailFor(piece, index, table).then((url) => {
      if (!cancelled) setRendered(url ?? shipped)
    })
    return () => {
      cancelled = true
    }
  }, [piece, shipped, keepShipped, seen, index, table])
  const src = keepShipped ? shipped : rendered
  const showing = src !== undefined && src === loaded
  return (
    <span ref={ref} className="relative flex shrink-0">
      {!showing && placeholder}
      {src !== undefined && (
        <img
          src={src}
          alt=""
          className={cn(className, !showing && "absolute inset-0 opacity-0")}
          onLoad={() => setLoaded(src)}
        />
      )}
    </span>
  )
}
