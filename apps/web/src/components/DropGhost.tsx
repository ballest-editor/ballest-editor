import { IconBox } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import type { CatalogPiece } from "../domain/Catalog"
import { draggedPiece, isPieceDrag } from "../editor/pieceDrag"
import { PieceThumbnail } from "./PieceThumbnail"

interface Ghost {
  readonly piece: CatalogPiece
  readonly x: number
  readonly y: number
  /** Whether a release here would place the piece. */
  readonly overViewport: boolean
}

const overViewport = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-viewport]") !== null

/**
 * The thumbnail of a piece being dragged, centred on the pointer, as that's where the piece's centre lands. Faint where a
 * release would do nothing. In the page and not the browser's drag image, which can't change as it goes.
 */
export function DropGhost({ fillOf }: { readonly fillOf: (piece: CatalogPiece) => number }) {
  const [ghost, setGhost] = useState<Ghost | null>(null)
  useEffect(() => {
    const listening = new AbortController()
    const options = { capture: true, signal: listening.signal }
    const hide = () => setGhost(null)
    window.addEventListener("dragover", (e) => {
      const piece = e.dataTransfer !== null && isPieceDrag(e.dataTransfer) ? draggedPiece() : undefined
      setGhost(piece === undefined ? null : { piece, x: e.clientX, y: e.clientY, overViewport: overViewport(e.target) })
    }, options)
    window.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null) hide()
    }, options)
    window.addEventListener("drop", hide, options)
    window.addEventListener("dragend", hide, options)
    return () => listening.abort()
  }, [])
  if (ghost === null) return null
  return createPortal(
    <div
      data-drop-ghost
      className={cn(
        "glass pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-control shadow-md transition-opacity",
        !ghost.overViewport && "opacity-50"
      )}
      style={{ left: ghost.x, top: ghost.y }}
    >
      <PieceThumbnail
        piece={ghost.piece}
        fill={fillOf(ghost.piece)}
        className="size-16 rounded-control object-contain"
        placeholder={
          <span className="grid size-16 place-items-center text-fg-tertiary">
            <IconBox className="size-6" />
          </span>
        }
      />
    </div>,
    document.body
  )
}
