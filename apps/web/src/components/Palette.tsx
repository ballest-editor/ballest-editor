import {
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconLayoutGrid,
  IconLayoutList,
  IconSearch,
  IconX
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type MouseEvent, type ReactNode, useMemo, useState } from "react"
import { type CatalogPiece, paletteSections, pieceIdOf, unavailableReasonOf, verificationOf } from "../domain/Catalog"
import { placementTransform } from "../domain/factory"
import { pieceDisplayName, pieceLabelOf, type PieceSize, pieceTitleOf } from "../domain/pieceName"
import { pieceFootprint } from "../domain/placement"
import type { Settings } from "../domain/Settings"
import { updateSettings } from "../editor/actions"
import { preloadPiece } from "../editor/preload"
import { sceneRegistry } from "../editor/sceneRegistry"
import { useEditor } from "../editor/store"
import { focusViewport } from "../editor/Viewport"
import { PaletteSkeleton } from "./EditorSkeleton"
import { PieceThumbnail } from "./PieceThumbnail"

type PiecesView = Settings["panels"]["piecesView"]

const UNVERIFIED_NOTE =
  "Not yet confirmed to load in the in-game editor. A rejected item makes the game discard the whole map."

/**
 * A click's feedback, in CSS alone: an overlay appears on press and fades after release, whatever the row's hover state
 * is doing. It sits on `::after` so hovering a row stays quick while the fade is slow.
 */
const PLACED_FLASH =
  "relative overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:bg-primary/40 after:opacity-0 after:transition-opacity after:duration-500 active:after:opacity-100 active:after:duration-0"

/** A size's colour, so sizes scan down a grid: the tag's fill and the thumbnail's outline. */
const SIZE_TINTS: Readonly<Record<PieceSize, { readonly tag: string; readonly outline: string }>> = {
  S: { tag: "bg-size-s", outline: "ring-size-s" },
  M: { tag: "bg-size-m", outline: "ring-size-m" },
  L: { tag: "bg-size-l", outline: "ring-size-l" }
}

const matches = (piece: CatalogPiece, terms: ReadonlyArray<string>) => {
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
        "flex size-4 shrink-0 items-center justify-center rounded-control text-caption",
        disabled ? "bg-muted text-fg-disabled" : cn(SIZE_TINTS[size].tag, "text-background"),
        className
      )}
    >
      {size}
    </span>
  )
}

/** An icon button in the panel's header. A disabled button takes no pointer events, so the tooltip is on a wrapper. */
function HeaderButton({ label, pressed, disabled, onClick, children }: {
  readonly label: string
  readonly pressed?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <Button
          variant={pressed === true ? "secondary" : "ghost"}
          size="icon-sm"
          className="text-fg-secondary"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function PieceButton({ piece, category, view, onPlace, onHover, unavailable, unverified }: {
  readonly piece: CatalogPiece
  /** The section it is listed under. */
  readonly category: string
  readonly view: PiecesView
  readonly onPlace: (e: MouseEvent<HTMLButtonElement>) => void
  readonly onHover: () => void
  /** Set for pieces that can't be placed; shown disabled, with this in the tooltip. */
  readonly unavailable?: string | undefined
  /** Hidden piece nobody has loaded in-game yet: placeable, but flagged. */
  readonly unverified?: boolean
}) {
  const { name, size } = pieceDisplayName(piece)
  const grid = view === "grid"
  const thumbnailSize = grid ? "size-16" : "size-6"
  const placeholder = <span className={cn("shrink-0 rounded-control bg-muted", thumbnailSize)} />
  const thumbnail = unavailable === undefined
    ? (
      <PieceThumbnail
        piece={piece}
        className={cn("shrink-0 rounded-control bg-muted object-contain", thumbnailSize)}
        placeholder={placeholder}
      />
    )
    : placeholder
  const note = unavailable ?? (unverified === true ? UNVERIFIED_NOTE : undefined)
  const disabled = unavailable !== undefined
  return (
    <Tooltip>
      {/* A disabled button takes no pointer events, so the tooltip is on a wrapper. */}
      <TooltipTrigger render={<span className={cn("block", unavailable !== undefined && "cursor-not-allowed")} />}>
        <Button
          variant="ghost"
          disabled={disabled}
          className={cn(
            PLACED_FLASH,
            grid ? "flex h-auto w-full flex-col gap-1 p-1" : "flex h-8 w-full justify-start gap-2 px-1 text-left"
          )}
          onClick={onPlace}
          onPointerEnter={onHover}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") e.preventDefault()
          }}
        >
          {grid
            ? (
              <>
                <span
                  className={cn(
                    "relative flex rounded-control",
                    size !== undefined && !disabled && cn("ring-1", SIZE_TINTS[size].outline)
                  )}
                >
                  {thumbnail}
                  {size !== undefined && (
                    <SizeTag size={size} disabled={disabled} className="absolute top-0.5 right-0.5" />
                  )}
                  {unverified === true && <span className="absolute top-1 left-1 size-2 rounded-full bg-amber-500" />}
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
                {unverified === true && (
                  <span className="shrink-0 rounded-control border border-amber-500/40 bg-amber-500/15 px-1 text-caption text-amber-700 dark:text-amber-300">
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
  )
}

export function Palette() {
  const catalog = useEditor((s) => s.catalog)
  const booting = useEditor((s) => s.booting)
  const placePiece = useEditor((s) => s.placePiece)
  const view = useEditor((s) => s.settings.panels.piecesView)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>({})
  const [allCollapsed, setAllCollapsed] = useState(false)

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
    placePiece(piece, placementTransform(piece, sceneRegistry.placementPoint(pieceFootprint(piece))))
    e.currentTarget.blur()
    focusViewport()
  }

  // Collapse all / Expand all, like an editor's file explorer: one click folds every group, the next opens them.
  const toggleAll = () => {
    const next = !allCollapsed
    setAllCollapsed(next)
    setOpen(Object.fromEntries(sections.map((section) => [section.name, !next])))
  }

  return (
    <aside className="flex h-full min-w-0 flex-col bg-card">
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
              <HeaderButton label="Clear search" onClick={() => setQuery("")}>
                <IconX />
              </HeaderButton>
            </span>
          )}
        </div>
        <HeaderButton
          label="List view"
          pressed={view === "list"}
          onClick={() => void updateSettings("panels", { piecesView: "list" })}
        >
          <IconLayoutList />
        </HeaderButton>
        <HeaderButton
          label="Grid view"
          pressed={view === "grid"}
          onClick={() => void updateSettings("panels", { piecesView: "grid" })}
        >
          <IconLayoutGrid />
        </HeaderButton>
        <HeaderButton
          label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
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
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 px-2 pb-2">
            {sections.map((section) => {
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
                          className="group flex h-8 w-full items-center gap-1.5 rounded-control px-1.5 text-caption uppercase tracking-wider text-fg-secondary hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:outline-none"
                          onMouseDown={(e) => e.preventDefault()}
                        />
                      }
                    >
                      <IconChevronRight className="size-3.5 transition-transform duration-200 group-data-[panel-open]:rotate-90" />
                      <span className="truncate">{section.name}</span>
                      <span className="ml-auto text-fg-tertiary tabular-nums">{section.pieces.length}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">Not in the in-game browser</TooltipContent>
                  </Tooltip>
                  <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                    <ul
                      className={view === "grid"
                        ? "grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1 pb-1"
                        : "flex flex-col gap-0.5 pb-1"}
                    >
                      {section.pieces.map((piece) => {
                        const unavailable = unavailableReason(piece)
                        return (
                          <li key={pieceIdOf(piece)}>
                            <PieceButton
                              piece={piece}
                              category={section.name}
                              view={view}
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
              <div className="px-1.5 py-2 text-body text-fg-tertiary">No pieces match the search.</div>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  )
}
