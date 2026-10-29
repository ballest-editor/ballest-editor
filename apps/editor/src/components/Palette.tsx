import { IconChevronRight } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { type MouseEvent, useEffect, useMemo, useState } from "react"
import {
  type CatalogPiece,
  paletteSections,
  pieceIdOf,
  pieceLabelOf,
  unavailableReasonOf,
  verificationOf
} from "../domain/Catalog"
import { placementTransform } from "../domain/factory"
import { preloadPiece } from "../editor/preload"
import { sceneRegistry } from "../editor/sceneRegistry"
import { useEditor } from "../editor/store"
import { thumbnailFor } from "../editor/thumbnails"
import { focusViewport } from "../editor/Viewport"
import { PaletteSkeleton } from "./EditorSkeleton"

const matches = (piece: CatalogPiece, terms: ReadonlyArray<string>) => {
  const haystack = `${pieceLabelOf(piece)} ${piece.className} ${piece.meshAssetPath ?? ""} ${piece.category ?? ""}`
    .toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

/**
 * The in-game render when the catalog has one; otherwise one rendered here from the piece's
 * meshes (see editor/thumbnails.ts), with a blank tile while it's in the queue.
 */
function Thumbnail({ piece }: { readonly piece: CatalogPiece }) {
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
  const className = "size-8 shrink-0 rounded-sm bg-muted object-fill"
  return src === undefined
    ? <span className={className} />
    : <img src={src} alt="" className={className} loading="lazy" />
}

function PieceButton({ piece, onPlace, onHover, unavailable, unverified }: {
  readonly piece: CatalogPiece
  readonly onPlace: (e: MouseEvent<HTMLButtonElement>) => void
  readonly onHover: () => void
  /** Set for pieces that can't be placed; shown disabled with this as the tooltip. */
  readonly unavailable?: string | undefined
  /** Hidden piece nobody has loaded in-game yet: placeable, but flagged. */
  readonly unverified?: boolean
}) {
  const button = (
    <Button
      variant="ghost"
      disabled={unavailable !== undefined}
      className="h-auto w-full justify-start gap-2 px-2 py-1 text-left"
      title={unavailable ?? `${piece.className}\n${piece.meshAssetPath ?? "(no main mesh)"}`}
      onClick={onPlace}
      onPointerEnter={onHover}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") e.preventDefault()
      }}
    >
      {unavailable === undefined && <Thumbnail piece={piece} />}
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 truncate text-xs font-medium">
          {pieceLabelOf(piece)}
          {unverified && (
            <span
              className="rounded-sm border border-amber-500/40 bg-amber-500/15 px-1 text-[0.6rem] font-normal text-amber-700 dark:text-amber-300"
              title="Not yet confirmed to load in the in-game editor. A rejected item makes the game discard the whole map."
            >
              unverified
            </span>
          )}
        </span>
        {!piece.thumbnail && piece.displayName && piece.displayName !== piece.className && (
          <span className="truncate text-[0.65rem] text-muted-foreground">{piece.className}</span>
        )}
      </span>
    </Button>
  )
  // Disabled buttons get no pointer events, so the tooltip lives on a wrapper.
  return unavailable === undefined
    ? button
    : <span className="block cursor-not-allowed" title={`${piece.className}: ${unavailable}`}>{button}</span>
}

export function Palette() {
  const catalog = useEditor((s) => s.catalog)
  const booting = useEditor((s) => s.booting)
  const placePiece = useEditor((s) => s.placePiece)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>({})

  const index = useEditor((s) => s.catalogIndex)
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter((t) => t.length > 0), [query])
  const sections = useMemo(
    () =>
      paletteSections(catalog?.catalog.pieces ?? [])
        .map((section) => ({
          ...section,
          pieces: terms.length === 0 ? section.pieces : section.pieces.filter((p) => matches(p, terms))
        }))
        .filter((section) => section.pieces.length > 0),
    [catalog, terms]
  )

  // Placement only on a real pointer click: keyboard activation (Space/Enter on a focused
  // button) produces a click with detail === 0 and is ignored. Focus then moves to the
  // viewport so editor keybinds apply straight away.
  const unavailableReason = (piece: CatalogPiece) =>
    catalog === null || index === null ? undefined : unavailableReasonOf(index, piece, catalog.verified)
  const place = (piece: CatalogPiece, unavailable: string | undefined) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0 || unavailable !== undefined) return
    placePiece(piece, placementTransform(piece, sceneRegistry.placementPoint()))
    e.currentTarget.blur()
    focusViewport()
  }

  return (
    <aside className="flex h-full min-w-0 flex-col gap-2 bg-card p-2">
      <div className="px-1 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">Pieces</div>
      <Input type="search" placeholder="Search pieces…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {catalog === null && !booting && (
        <div className="px-1 text-xs text-muted-foreground">The piece catalog couldn't be loaded.</div>
      )}
      {catalog === null && booting ? <PaletteSkeleton /> : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 pr-2">
            {sections.map((section) => {
              // Searching opens every section with matches; otherwise hidden starts collapsed.
              const isOpen = terms.length > 0 || (open[section.name] ?? !section.hidden)
              return (
                <Collapsible
                  key={section.name}
                  open={isOpen}
                  onOpenChange={(next) => setOpen((o) => ({ ...o, [section.name]: next }))}
                >
                  <CollapsibleTrigger
                    className="group flex w-full items-center gap-1 rounded-sm px-1 py-1 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <IconChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                    <span className="truncate">{section.name}</span>
                    <span className="ml-auto font-normal tabular-nums">{section.pieces.length}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="flex flex-col gap-0.5">
                      {section.pieces.map((piece) => {
                        const unavailable = unavailableReason(piece)
                        return (
                          <li key={pieceIdOf(piece)}>
                            <PieceButton
                              piece={piece}
                              onPlace={place(piece, unavailable)}
                              onHover={() => index !== null && preloadPiece(piece, index)}
                              unavailable={unavailable}
                              unverified={catalog !== null && verificationOf(piece, catalog.verified) === "unverified"}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
            {catalog !== null && sections.length === 0 && (
              <div className="px-1 text-xs text-muted-foreground">No pieces match.</div>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  )
}
