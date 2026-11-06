import { IconBoxMultiple, IconChevronRight, IconFolder, IconFolderOpen } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { createElement, memo, useLayoutEffect, useRef } from "react"
import type { OutlineRow } from "../domain/outline"
import { useEditor } from "../editor/store"
import { Ordinal } from "./Ordinal"
import { itemGlyphOf } from "./outlineGlyphs"

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
      className="h-5 min-w-0 flex-1 rounded-control px-1 py-0 text-body md:text-body"
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
        <Badge key={tag} variant="secondary" className="h-4 max-w-16 px-1 text-caption">
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {tags.length > shown.length && (
        <span className="text-caption text-fg-tertiary">+{tags.length - shown.length}</span>
      )}
    </span>
  )
}

/** Every row's glyph, group or item, is one of these. */
const GLYPH_CLASS = "mr-1 size-4 shrink-0 text-fg-secondary"

/** An item's glyph, by what it is. */
function ItemIcon({ actorClass }: { readonly actorClass: string }) {
  const category = useEditor((s) => s.catalogIndex?.pieceByClass.get(actorClass)?.category)
  return createElement(itemGlyphOf(actorClass, category), { className: GLYPH_CLASS })
}

/** What a row's name says when the pointer rests on it: an item's class, a group's item count. */
const nameTooltip = (row: OutlineRow): string =>
  row.kind === "item" ? row.className : `${row.itemCount} ${row.itemCount === 1 ? "item" : "items"}`

export const OutlineRowView = memo(function OutlineRowView(props: {
  readonly row: OutlineRow
  readonly rowIndex: number
  readonly selected: boolean
  /** A group with some of its items selected. */
  readonly partial: boolean
  /** The entered group's own row. */
  readonly entered: boolean
  /** Outside the entered group. */
  readonly dimmed: boolean
  readonly dragged: boolean
  readonly dropInto: boolean
  readonly filtering: boolean
  readonly renaming: boolean
  readonly onRenamed: (row: OutlineRow, value: string | null) => void
}) {
  const { row, rowIndex, selected, partial, entered, dimmed, dragged, dropInto, filtering, renaming, onRenamed } = props
  const setGroupCollapsed = useEditor((s) => s.setGroupCollapsed)
  const isGroup = row.kind === "group"
  const FolderIcon = row.instance ? IconBoxMultiple : row.collapsed ? IconFolder : IconFolderOpen
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      {...(isGroup && { "aria-expanded": !row.collapsed })}
      data-row-index={rowIndex}
      className={cn(
        "absolute inset-x-0 flex items-center pr-2 text-body hover:bg-muted/60",
        selected && "bg-primary/20 hover:bg-primary/25",
        partial && !selected && "bg-primary/5",
        entered && "shadow-[inset_2px_0_0_var(--primary)]",
        dimmed && "text-fg-disabled **:text-fg-disabled",
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
      {isGroup ? <FolderIcon className={GLYPH_CLASS} /> : <ItemIcon actorClass={row.actorClass} />}
      {renaming
        ? <RenameField name={row.name} onDone={(value) => onRenamed(row, value)} />
        : (
          <>
            <span className={cn("mr-1 min-w-0 truncate", selected && "text-body-strong")} title={nameTooltip(row)}>
              {row.name}
            </span>
            <Ordinal value={row.ordinal} />
            <span className="flex-1" />
            {row.tags.length > 0 && <TagChips tags={row.tags} />}
          </>
        )}
    </div>
  )
})
