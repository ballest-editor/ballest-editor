import { IconBox, IconChevronRight, IconFolder, IconFolderOpen } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { memo, useLayoutEffect, useRef } from "react"
import type { OutlineRow } from "../domain/outline"
import { useEditor } from "../editor/store"
import { Ordinal } from "./Ordinal"
import { PieceThumbnail } from "./PieceThumbnail"

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
      className="h-5 min-w-0 flex-1 rounded-sm px-1 py-0 text-xs md:text-xs"
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
        <Badge key={tag} variant="secondary" className="h-4 max-w-16 px-1 text-[0.6rem]">
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {tags.length > shown.length && (
        <span className="text-[0.6rem] text-muted-foreground">+{tags.length - shown.length}</span>
      )}
    </span>
  )
}

const pieceGlyph = <IconBox className="size-4 shrink-0 text-muted-foreground" />

/** An item's icon: its piece's, as the Pieces panel shows it, else a generic one. */
function ItemIcon({ actorClass }: { readonly actorClass: string }) {
  const piece = useEditor((s) => s.catalogIndex?.pieceByClass.get(actorClass))
  if (piece === undefined) return pieceGlyph
  return <PieceThumbnail piece={piece} className="size-4 shrink-0 rounded-xs object-fill" placeholder={pieceGlyph} />
}

export const OutlineRowView = memo(function OutlineRowView({
  row,
  rowIndex,
  selected,
  partial,
  entered,
  dimmed,
  dragged,
  dropInto,
  filtering,
  renaming,
  onRenamed
}: {
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
  const setGroupCollapsed = useEditor((s) => s.setGroupCollapsed)
  const isGroup = row.kind === "group"
  const FolderIcon = row.collapsed ? IconFolder : IconFolderOpen
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      {...(isGroup && { "aria-expanded": !row.collapsed })}
      data-row-index={rowIndex}
      className={cn(
        "absolute inset-x-0 flex items-center gap-1 pr-2 text-xs hover:bg-muted/60",
        selected && "bg-primary/20 hover:bg-primary/25",
        partial && !selected && "bg-primary/5",
        entered && "shadow-[inset_2px_0_0_var(--primary)]",
        dimmed && "opacity-50",
        dragged && "opacity-40",
        dropInto && "bg-primary/30 ring-1 ring-primary ring-inset"
      )}
      style={{
        top: rowIndex * OUTLINE_ROW_HEIGHT,
        height: OUTLINE_ROW_HEIGHT,
        paddingLeft: 4 + row.depth * OUTLINE_INDENT
      }}
    >
      {isGroup
        ? (
          <button
            type="button"
            aria-label={row.collapsed ? `Expand ${row.name}` : `Collapse ${row.name}`}
            disabled={filtering}
            className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={(e) => {
              e.stopPropagation()
              setGroupCollapsed(row.id, !row.collapsed)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <IconChevronRight className={cn("size-3 transition-transform", !row.collapsed && "rotate-90")} />
          </button>
        )
        : <span className="size-4 shrink-0" />}
      {isGroup
        ? <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        : <ItemIcon actorClass={row.actorClass} />}
      {renaming
        ? <RenameField name={row.name} onDone={(value) => onRenamed(row, value)} />
        : (
          <>
            <span
              className={cn("min-w-0 truncate", isGroup && "font-medium")}
              {...(row.className !== "" && { title: row.className })}
            >
              {row.name}
            </span>
            <Ordinal value={row.ordinal} />
            <span className="flex-1" />
            {row.tags.length > 0 && <TagChips tags={row.tags} />}
            {isGroup && (
              <span
                className="shrink-0 text-[0.65rem] text-muted-foreground tabular-nums"
                title={`${row.itemCount} items`}
              >
                {row.childCount}
              </span>
            )}
          </>
        )}
    </div>
  )
})
