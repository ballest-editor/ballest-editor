import { cn } from "@workspace/ui/lib/utils"
import { createElement, type ReactNode, useEffect, useRef, useState } from "react"
import type { CatalogPiece } from "../domain/Catalog"
import { assetUrl } from "../editor/assetUrl"
import { useEditor } from "../editor/store"
import { thumbnailFor } from "../editor/thumbnails"
import { lightGlyphOf } from "./outlineGlyphs"

/**
 * The tile under a thumbnail and its placeholder: a step off the panel in both themes, stronger than `--muted`, so a
 * white piece reads in light and a near-black one in dark. Alpha, so it stays neutral on whatever panel it sits on.
 */
export const THUMBNAIL_TILE = "bg-foreground/14"

/** True from the first time the element comes into view, so a long list only renders what gets looked at. */
export const useSeen = () => {
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

interface ThumbnailProps {
  readonly piece: CatalogPiece
  readonly className: string
  readonly placeholder: ReactNode
  /** How much of the frame the piece fills (`sizeScalesOf`), for a list that sets one shape's sizes side by side. */
  readonly fill?: number
  /** A light's glyph, where the tile is bigger than a row's. */
  readonly glyphClassName?: string
}

/**
 * A piece rendered here from its meshes on a transparent background (see editor/thumbnails.ts), with `placeholder` until
 * the image has loaded. A piece that doesn't render shows the in-game render when the catalog has one; without one it
 * keeps `placeholder`. The waiting image is transparent and out of the flow, not `display: none`, which never fires its
 * load.
 */
function RenderedThumbnail({ piece, className, placeholder, fill }: ThumbnailProps) {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const { ref, seen } = useSeen()
  const [rendered, setRendered] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const shipped = piece.thumbnail == null ? undefined : assetUrl(piece.thumbnail)
  useEffect(() => {
    if (!seen || index === null || table === null) return
    let cancelled = false
    void thumbnailFor(piece, index, table, fill).then((url) => {
      if (!cancelled) setRendered(url ?? shipped)
    })
    return () => {
      cancelled = true
    }
  }, [piece, shipped, seen, index, table, fill])
  const showing = rendered !== undefined && rendered === loaded
  return (
    <span ref={ref} className="relative flex shrink-0">
      {!showing && placeholder}
      {rendered !== undefined && (
        <img
          src={rendered}
          alt=""
          draggable={false} // a drag from a row is the row's, not the picture's
          className={cn(className, !showing && "absolute inset-0 opacity-0")}
          onLoad={() => setLoaded(rendered)}
        />
      )}
    </span>
  )
}

/**
 * A piece's picture in the tile `className` draws. A light has no body worth one, its meshes being stand-ins, so the tile
 * holds its glyph instead.
 */
export function PieceThumbnail(props: ThumbnailProps) {
  const glyph = lightGlyphOf(props.piece)
  return glyph === undefined
    ? <RenderedThumbnail {...props} />
    : (
      <span className={cn("grid place-items-center text-fg-secondary", props.className)}>
        {createElement(glyph, { className: props.glyphClassName ?? "size-4" })}
      </span>
    )
}
