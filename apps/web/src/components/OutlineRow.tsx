import {
  IconBoxMultiple,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconFolderOpen,
  IconLink,
  IconLock,
  IconLockOpen
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { createElement, memo, useLayoutEffect, useRef, useState } from "react"
import type { CatalogPiece } from "../domain/Catalog"
import type { OutlineRow } from "../domain/outline"
import { type FlagState, type ItemFlag, toggledFlag } from "../domain/visibility"
import { useEditor } from "../editor/store"
import { Ordinal } from "./Ordinal"
import { type Glyph, hasOwnGlyph, itemGlyphOf } from "./outlineGlyphs"
import { PieceThumbnail, THUMBNAIL_TILE } from "./PieceThumbnail"

export const OUTLINE_ROW_HEIGHT = 24
export const OUTLINE_INDENT = 12

/** The name field of a row being renamed: Enter commits, Escape cancels, leaving it commits. */
function RenameField({ name, onDone }: {
  readonly name: string
  readonly onDone: (value: string | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  // the field goes when it finishes, and its blur must not finish it a second time
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <Input
      ref={ref}
      defaultValue={name}
      aria-label="Name"
      className="h-5 flex-1 px-1 py-0"
      onBlur={(e) => finish(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") finish(e.currentTarget.value)
        if (e.key === "Escape") finish(null)
      }}
    />
  )
}

/** The tag chips that fit a row; the rest are a count. */
function TagChips({ tags }: { readonly tags: ReadonlyArray<string> }) {
  const shown = tags.slice(0, 2)
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={tags.join(", ")}>
      {shown.map((tag) => (
        <Badge key={tag} className="h-4 max-w-16 px-1">
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {tags.length > shown.length && (
        <span className="text-caption text-fg-tertiary">+{tags.length - shown.length}</span>
      )}
    </span>
  )
}

/** Where every row's glyph, group or item, sits. */
const GLYPH_SLOT = "mr-1 size-4 shrink-0"
const GLYPH_COLOUR = "text-fg-secondary"

/**
 * A piece's thumbnail, laid over its glyph until it has loaded, and the glyph for good if it never does. The glyph then
 * goes rather than sitting behind it: thumbnails are see-through. An image's load reaches this span through React's tree,
 * though the DOM's event doesn't bubble.
 */
function PieceIcon({ piece, glyph }: { readonly piece: CatalogPiece; readonly glyph: Glyph }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <span className={cn("relative", GLYPH_SLOT)} onLoad={() => setLoaded(true)}>
      {!loaded && createElement(glyph, { className: cn("size-4", GLYPH_COLOUR) })}
      <PieceThumbnail
        piece={piece}
        className={cn("absolute top-0 left-0 size-4 rounded-control object-cover", loaded && THUMBNAIL_TILE)}
        placeholder={null}
      />
    </span>
  )
}

/** An item's picture. The player start, the goal, lights and anything the catalog doesn't know have only a glyph. */
export function ItemIcon({ actorClass }: { readonly actorClass: string }) {
  const piece = useEditor((s) => s.catalogIndex?.pieceByClass.get(actorClass))
  const glyph = itemGlyphOf(actorClass, piece)
  return piece === undefined || hasOwnGlyph(actorClass, piece)
    ? createElement(glyph, { className: cn(GLYPH_SLOT, GLYPH_COLOUR) })
    : <PieceIcon key={actorClass} piece={piece} glyph={glyph} />
}

const FLAG_ICONS = {
  hidden: { on: IconEyeOff, off: IconEye, set: "Hide", clear: "Show" },
  locked: { on: IconLock, off: IconLockOpen, set: "Lock", clear: "Unlock" }
} as const

/**
 * A row's eye or padlock: shown while any of the row's items is hidden or locked (faint when only some are, as Unity's
 * mixed state), and under the pointer otherwise. A press hides or locks all of them, or clears the flag when all have
 * it, as one undo step, and leaves the selection to the row's own click.
 */
function FlagToggle({ row, keysOf, flag, state }: {
  readonly row: OutlineRow
  readonly keysOf: (id: string) => ReadonlyArray<string>
  readonly flag: ItemFlag
  readonly state: FlagState
}) {
  const { clear, off: Off, on: On, set } = FLAG_ICONS[flag]
  const label = `${state === "all" ? clear : set} ${row.name}`
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={state === "all"}
      title={label}
      className={cn(
        "shrink-0 transition-opacity",
        state === "none"
          ? "text-fg-tertiary opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          : state === "some"
          ? "text-fg-tertiary"
          : "text-fg-secondary"
      )}
      onMouseDown={(e) => e.preventDefault()} // leaves focus where it is, for the editor's keys
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        const s = useEditor.getState()
        const items = keysOf(row.id)
        s.setItemFlag(items, flag, toggledFlag(s.doc.structure, items, flag))
      }}
    >
      {state === "none" ? <Off /> : <On />}
    </Button>
  )
}

/** What a row's name says when the pointer rests on it: an item's class, a group's item count. */
const nameTooltip = (row: OutlineRow): string =>
  row.kind === "item"
    ? row.className
    : `${row.itemCount} ${row.itemCount === 1 ? "item" : "items"}${row.chain ? `, a chain of ${row.childCount}` : ""}`

export const OutlineRowView = memo(function OutlineRowView(props: {
  readonly row: OutlineRow
  readonly rowIndex: number
  readonly selected: boolean
  /** A group with some of its items selected. */
  readonly partial: boolean
  /** The entered group's own row. */
  readonly entered: boolean
  /** Outside the entered group, or left out by the tab's isolation. */
  readonly dimmed: boolean
  /** How much of the row's items is hidden, and locked. */
  readonly hidden: FlagState
  readonly locked: FlagState
  /** What a member of a prefab instance overrides of its definition, as `overrideSummary` says it. */
  readonly overrides?: string | undefined
  /** A row's items, for its toggles: read when pressed, so a row doesn't redraw for them. */
  readonly keysOf: (id: string) => ReadonlyArray<string>
  readonly dragged: boolean
  readonly dropInto: boolean
  readonly filtering: boolean
  readonly renaming: boolean
  readonly onRenamed: (row: OutlineRow, value: string | null) => void
}) {
  const { row, rowIndex, selected, partial, entered, dimmed, dragged, dropInto, filtering, renaming, onRenamed } = props
  const { hidden, keysOf, locked, overrides } = props
  const setGroupCollapsed = useEditor((s) => s.setGroupCollapsed)
  const isGroup = row.kind === "group"
  const FolderIcon = row.instance ? IconBoxMultiple : row.chain ? IconLink : row.collapsed ? IconFolder : IconFolderOpen
  return (
    <div
      role="treeitem"
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-selected={selected}
      {...(isGroup && { "aria-expanded": !row.collapsed })}
      data-row-index={rowIndex}
      className={cn(
        "group/row absolute inset-x-0 flex items-center pr-1 text-body transition-colors focus-ring-inset hover:bg-hover active:bg-pressed",
        selected && "bg-selected hover:lift-selected active:press-selected",
        partial && !selected && "bg-primary/5",
        entered && "shadow-[inset_2px_0_0_var(--primary)]",
        dimmed && "text-fg-disabled **:text-fg-disabled [&_img]:opacity-50",
        dragged && "opacity-40",
        dropInto && "bg-primary/30 ring-1 ring-primary ring-inset"
      )}
      style={{
        top: rowIndex * OUTLINE_ROW_HEIGHT,
        height: OUTLINE_ROW_HEIGHT,
        paddingLeft: row.depth * OUTLINE_INDENT
      }}
    >
      {isGroup
        ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={row.collapsed ? `Expand ${row.name}` : `Collapse ${row.name}`}
            disabled={filtering}
            className="text-fg-secondary"
            onClick={(e) => {
              e.stopPropagation()
              setGroupCollapsed(row.id, !row.collapsed)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <IconChevronRight className={cn("transition-transform", !row.collapsed && "rotate-90")} />
          </Button>
        )
        : <span className="size-6 shrink-0" />}
      {row.link !== undefined && (
        <span
          className="mr-1 w-4 shrink-0 text-right text-caption tabular-nums text-fg-tertiary"
          title={`Link ${row.link}`}
        >
          {row.link}
        </span>
      )}
      {isGroup ? <FolderIcon className={cn(GLYPH_SLOT, GLYPH_COLOUR)} /> : <ItemIcon actorClass={row.actorClass} />}
      {renaming
        ? <RenameField name={row.name} onDone={(value) => onRenamed(row, value)} />
        : (
          <>
            <span
              className={cn(
                "mr-1 min-w-0 truncate",
                selected && "text-body-strong",
                hidden === "all" && "text-fg-tertiary italic"
              )}
              title={nameTooltip(row)}
            >
              {row.name}
            </span>
            <Ordinal value={row.ordinal} />
            {overrides !== undefined && (
              <span
                role="img"
                aria-label={`Overrides its prefab's ${overrides}`}
                title={`Overrides its prefab's ${overrides}`}
                className="ml-0.5 size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
            <span className="flex-1" />
            {row.tags.length > 0 && <TagChips tags={row.tags} />}
            <FlagToggle row={row} keysOf={keysOf} flag="locked" state={locked} />
            <FlagToggle row={row} keysOf={keysOf} flag="hidden" state={hidden} />
          </>
        )}
    </div>
  )
})
