import {
  IconBox,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconLayoutGrid,
  IconLayoutList,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconX
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type MouseEvent, useMemo, useState } from "react"
import {
  type CatalogIndex,
  type CatalogPiece,
  type PalettePiece,
  pieceIdOf,
  unavailableReasonOf,
  verificationOf
} from "../domain/Catalog"
import { termsOf } from "../domain/outline"
import { pieceDisplayName, pieceLabelOf, type PieceSize, pieceTitleOf, sizeScalesOf } from "../domain/pieceName"
import type { Settings } from "../domain/Settings"
import { placeAtCamera, toggleFavouritePiece, updateSettings } from "../editor/actions"
import { endPieceDrag, startPieceDrag } from "../editor/pieceDrag"
import { preloadPiece } from "../editor/preload"
import { useEditor } from "../editor/store"
import { focusViewport } from "../editor/Viewport"
import { CHIP } from "./chipStyle"
import { DropGhost } from "./DropGhost"
import { PaletteSkeleton } from "./EditorSkeleton"
import { HeaderButton } from "./HeaderButton"
import { PieceThumbnail, THUMBNAIL_TILE } from "./PieceThumbnail"
import { EYEBROW } from "./SectionTitle"

type PiecesView = Settings["panels"]["piecesView"]

const UNVERIFIED_NOTE =
  "Not yet confirmed to load in the in-game editor. A rejected item makes the game discard the whole map."

/**
 * A click's feedback, in CSS alone: an overlay appears on press and fades after release, whatever the row's hover state
 * is doing. It sits on `::after` so hovering a row stays quick while the fade is slow.
 */
const PLACED_FLASH =
  "relative overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:bg-primary/40 after:opacity-0 after:transition-opacity after:duration-500 active:after:opacity-100 active:after:duration-0"

/**
 * `value`, as it stood when `held` came on, until it goes off. Recent and Favourites sit above the rows, so a change to
 * them while the pointer is in the panel would move the row under it, and the next click would place another piece: they
 * wait for it to leave, as a browser's tabs keep their widths until the pointer leaves the strip.
 */
function useHeld<A>(value: A, held: boolean): A {
  const [shown, setShown] = useState(value)
  if (!held && shown !== value) setShown(value)
  return held ? shown : value
}

/** A piece in the palette, with what its row shows wherever it is listed. */
interface Listing {
  readonly piece: PalettePiece
  /** The category it belongs to, which Recent and Favourites aren't. */
  readonly category: string
  /** How much of its thumbnail's frame it fills. */
  readonly fill: number
}

const listingsOf = (index: CatalogIndex | null): ReadonlyMap<string, Listing> =>
  new Map((index?.sections ?? []).flatMap(({ name, pieces }) => {
    const scales = sizeScalesOf(pieces)
    return pieces.map((piece) => [pieceIdOf(piece), { piece, category: name, fill: scales.get(piece) ?? 1 }] as const)
  }))

const matches = (piece: PalettePiece, terms: ReadonlyArray<string>) => {
  const haystack = `${pieceLabelOf(piece)} ${piece.displayName ?? ""} ${piece.className} ${piece.meshAssetPath ?? ""} ${
    piece.category ?? ""
  }`
    .toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

function SizeTag({ size, disabled, className }: {
  readonly size: PieceSize
  /** In a disabled row, where it takes the row's grey. */
  readonly disabled: boolean
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center text-caption",
        CHIP,
        disabled && "text-fg-disabled",
        className
      )}
    >
      {size}
    </span>
  )
}

/** The star on a row: shows under the pointer or on keyboard focus, and stays on a favourite. */
function FavouriteStar({ favourite, grid, onToggle }: {
  readonly favourite: boolean
  readonly grid: boolean
  readonly onToggle: () => void
}) {
  const label = favourite ? "Remove from Favourites" : "Add to Favourites"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "absolute transition-opacity",
              // On the tile's corner in a grid, over a picture, so it takes a surface; a row keeps room for it.
              grid ? "top-11 right-[calc(50%-2rem)] rounded-full bg-card" : "top-1 right-1",
              favourite
                ? "text-foreground"
                : "text-fg-secondary opacity-0 group-hover/piece:opacity-100 focus-visible:opacity-100"
            )}
            aria-label={label}
            aria-pressed={favourite}
            onMouseDown={(e) => e.preventDefault()} // leaves focus where it is, for the editor's keys
            onClick={onToggle}
          />
        }
      >
        {favourite ? <IconStarFilled /> : <IconStar />}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function PieceButton(
  { listing: { category, fill, piece }, view, favourite, onPlace, onHover, onToggleFavourite, unavailable, unverified }:
    {
      readonly listing: Listing
      readonly view: PiecesView
      readonly favourite: boolean
      readonly onPlace: (e: MouseEvent<HTMLButtonElement>) => void
      readonly onHover: () => void
      readonly onToggleFavourite: () => void
      /** Set for pieces that can't be placed; shown disabled, with this in the tooltip. */
      readonly unavailable: string | undefined
      /** Hidden piece nobody has loaded in-game yet: placeable, but flagged. */
      readonly unverified: boolean
    }
) {
  const { name, size } = pieceDisplayName(piece)
  const grid = view === "grid"
  const thumbnailSize = grid ? "size-16" : "size-6"
  const disabled = unavailable !== undefined
  const placeholder = (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-control",
        THUMBNAIL_TILE,
        disabled ? "text-fg-disabled" : "text-fg-tertiary",
        thumbnailSize
      )}
    >
      <IconBox className={grid ? "size-6" : "size-4"} />
    </span>
  )
  const thumbnail = !disabled
    ? (
      <PieceThumbnail
        piece={piece}
        fill={fill}
        className={cn("shrink-0 rounded-control object-contain", THUMBNAIL_TILE, thumbnailSize)}
        placeholder={placeholder}
      />
    )
    : placeholder
  const note = unavailable ?? (unverified ? UNVERIFIED_NOTE : undefined)
  return (
    <div className="group/piece relative">
      <Tooltip>
        {/* A disabled button takes no pointer events, so the tooltip is on a wrapper. */}
        <TooltipTrigger render={<span className={cn("block", disabled && "cursor-not-allowed")} />}>
          <Button
            variant="ghost"
            disabled={disabled}
            draggable={!disabled}
            className={cn(
              PLACED_FLASH,
              !disabled && "cursor-grab active:cursor-grabbing",
              grid ? "flex h-auto w-full flex-col gap-1 p-1" : "flex h-8 w-full justify-start gap-2 pr-7 pl-1 text-left"
            )}
            onClick={onPlace}
            onDragStart={(e) => startPieceDrag(e.dataTransfer, piece)}
            onDragEnd={endPieceDrag}
            onPointerEnter={onHover}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") e.preventDefault()
            }}
          >
            {grid
              ? (
                <>
                  <span className="relative flex">
                    {thumbnail}
                    {size !== undefined && (
                      <SizeTag size={size} disabled={disabled} className="absolute top-0.5 right-0.5 bg-card" />
                    )}
                    {unverified && (
                      <span className="absolute top-1 left-1 size-2 rounded-full bg-status-warn-foreground" />
                    )}
                  </span>
                  <span className="line-clamp-3 w-full text-center text-caption leading-3.5 whitespace-normal">
                    {name}
                  </span>
                </>
              )
              : (
                <>
                  {thumbnail}
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {unverified && (
                    <span className="shrink-0 rounded-full bg-status-warn px-1.5 text-caption text-status-warn-foreground">
                      unverified
                    </span>
                  )}
                  {size !== undefined && <SizeTag size={size} disabled={disabled} />}
                </>
              )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex-col items-start gap-0">
          <span className="text-body-strong">{pieceTitleOf(piece)}</span>
          <span className="text-caption">{category}</span>
          {note !== undefined && <span className="mt-1 text-caption">{note}</span>}
          <span className="text-caption text-fg-tertiary">{piece.className}</span>
        </TooltipContent>
      </Tooltip>
      {(!disabled || favourite) && <FavouriteStar favourite={favourite} grid={grid} onToggle={onToggleFavourite} />}
    </div>
  )
}

export function Palette() {
  const catalog = useEditor((s) => s.catalog)
  const booting = useEditor((s) => s.booting)
  const view = useEditor((s) => s.settings.panels.piecesView)
  const favourites = useEditor((s) => s.settings.panels.favouritePieces)
  const [pointerInside, setPointerInside] = useState(false)
  const shownFavourites = useHeld(favourites, pointerInside)
  const shownRecent = useHeld(useEditor((s) => s.settings.panels.recentPieces), pointerInside)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>({})
  const [allCollapsed, setAllCollapsed] = useState(false)

  const index = useEditor((s) => s.catalogIndex)
  const listings = useMemo(() => listingsOf(index), [index])
  const terms = useMemo(() => termsOf(query), [query])
  const sections = useMemo(
    () =>
      (index?.sections ?? [])
        .map((section) => ({
          ...section,
          pieces: terms.length === 0 ? section.pieces : section.pieces.filter((p) => matches(p, terms))
        }))
        .filter((section) => section.pieces.length > 0),
    [index, terms]
  )
  // A search looks through the categories alone, where every match already is.
  const lists = useMemo(() => {
    if (terms.length > 0) return []
    const list = (name: string, ids: ReadonlyArray<string>) => ({
      name,
      hidden: false,
      pieces: ids.flatMap((id) => listings.get(id)?.piece ?? [])
    })
    return [list("Recent", shownRecent), list("Favourites", shownFavourites)].filter(({ pieces }) => pieces.length > 0)
  }, [listings, shownFavourites, shownRecent, terms])
  const shown = [...lists, ...sections]
  // Base UI measures a scroll area when its viewport resizes, not when its content does, so each height of results gets
  // its own: an empty search after the whole list would otherwise keep the list's scrollbar.
  const results = sections.map((section) => `${section.name}:${section.pieces.length}`).join()

  const unavailableReason = (piece: CatalogPiece) =>
    catalog === null || index === null ? undefined : unavailableReasonOf(index, piece, catalog.verified)
  // Only a real pointer click places: keyboard activation (Space or Enter on a focused button) is a click with a `detail`
  // of 0. Focus then moves to the viewport, so the editor's keybinds apply straight away.
  const place = (piece: CatalogPiece, unavailable: string | undefined) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0 || unavailable !== undefined) return
    placeAtCamera(piece)
    e.currentTarget.blur()
    focusViewport()
  }

  const toggleAll = () => {
    const next = !allCollapsed
    setAllCollapsed(next)
    setOpen(Object.fromEntries(shown.map((section) => [section.name, !next])))
  }

  return (
    <aside
      className="flex h-full min-w-0 flex-col bg-card"
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => setPointerInside(false)}
      onDragEnd={() => setPointerInside(false)} // a drag takes the pointer away with no event to say so
    >
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-fg-tertiary" />
          <Input
            type="search"
            aria-label="Search pieces"
            placeholder="Search pieces"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-7 pl-7 [&::-webkit-search-cancel-button]:hidden"
          />
          {query.length > 0 && (
            <span className="absolute top-0.5 right-0.5 inline-flex">
              <HeaderButton label="Clear search" className="shrink-0" onClick={() => setQuery("")}>
                <IconX />
              </HeaderButton>
            </span>
          )}
        </div>
        <HeaderButton
          label="List view"
          className="shrink-0"
          pressed={view === "list"}
          onClick={() => void updateSettings("panels", { piecesView: "list" })}
        >
          <IconLayoutList />
        </HeaderButton>
        <HeaderButton
          label="Grid view"
          className="shrink-0"
          pressed={view === "grid"}
          onClick={() => void updateSettings("panels", { piecesView: "grid" })}
        >
          <IconLayoutGrid />
        </HeaderButton>
        <HeaderButton
          label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
          className="shrink-0"
          disabled={terms.length > 0}
          onClick={toggleAll}
        >
          {allCollapsed ? <IconChevronsDown /> : <IconChevronsUp />}
        </HeaderButton>
      </div>
      {catalog === null && !booting && (
        <div className="px-3 py-2 text-body text-fg-tertiary">The piece catalog couldn't be loaded.</div>
      )}
      {catalog === null && booting ? <PaletteSkeleton /> : (
        <ScrollArea key={results} className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 px-2 pb-2">
            {shown.map((section) => {
              // Searching opens every section with matches; otherwise hidden starts collapsed.
              const isOpen = terms.length > 0 || (open[section.name] ?? !section.hidden)
              return (
                <Collapsible
                  key={section.name}
                  open={isOpen}
                  onOpenChange={(next) => setOpen((o) => ({ ...o, [section.name]: next }))}
                >
                  <Tooltip disabled={!section.hidden}>
                    <TooltipTrigger
                      render={
                        <CollapsibleTrigger
                          className={cn(
                            "group flex h-8 w-full items-center gap-1.5 rounded-control px-1.5 transition-colors focus-ring hover:bg-hover hover:text-foreground active:bg-pressed",
                            EYEBROW
                          )}
                          onMouseDown={(e) => e.preventDefault()}
                        />
                      }
                    >
                      <IconChevronRight className="size-3.5 transition-transform duration-150 group-data-[panel-open]:rotate-90" />
                      <span className="truncate">{section.name}</span>
                      <span className="ml-auto text-fg-tertiary tabular-nums">{section.pieces.length}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">Not in the in-game browser</TooltipContent>
                  </Tooltip>
                  <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                    <ul
                      className={view === "grid"
                        ? "grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1 pb-1"
                        : "flex flex-col gap-0.5 pb-1"}
                    >
                      {section.pieces.map((piece) => {
                        const id = pieceIdOf(piece)
                        const unavailable = unavailableReason(piece)
                        return (
                          <li key={id}>
                            <PieceButton
                              listing={listings.get(id) ?? { piece, category: section.name, fill: 1 }}
                              view={view}
                              favourite={favourites.includes(id)}
                              onPlace={place(piece, unavailable)}
                              onHover={() => index !== null && preloadPiece(piece, index)}
                              onToggleFavourite={() => void toggleFavouritePiece(piece)}
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
              <div className="px-1.5 py-2 text-body text-fg-tertiary">No pieces match the search.</div>
            )}
          </div>
        </ScrollArea>
      )}
      <DropGhost fillOf={(piece) => listings.get(pieceIdOf(piece))?.fill ?? 1} />
    </aside>
  )
}
