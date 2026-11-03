import { IconX } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { type DragEvent, type MouseEvent, useEffect, useRef, useState } from "react"
import { closeOtherTabs, closeTab, closeTabsToRight, nameProjectMap, revealProject } from "../editor/actions"
import { useEditor, useTabSummary } from "../editor/store"

/** A tab being dragged along the strip, and where it would land (an index into the strip's gaps). */
interface Drag {
  readonly id: string
  readonly at: number
}

/**
 * The document tabs over the viewport (docs/PROJECTS.md § Shell): one per open map, in the order they were opened
 * or dragged into. A click makes a tab active; its × (or a middle click) closes it, asking about unsaved edits first;
 * a right-click opens its menu. Closing the last tab leaves a fresh map in its place: there is always a map. The dot
 * marks a map with unsaved edits, or one not saved anywhere yet; it gives way to the × while the tab is hovered.
 */
export function DocumentTabs() {
  const tabIds = useEditor((s) => s.tabIds)
  const moveTab = useEditor((s) => s.moveTab)
  const [drag, setDrag] = useState<Drag | null>(null)

  const drop = () => {
    if (drag !== null) moveTab(drag.id, drag.at > tabIds.indexOf(drag.id) ? drag.at - 1 : drag.at)
    setDrag(null)
  }

  return (
    <div
      role="tablist"
      aria-label="Documents"
      className="flex h-8 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b bg-card text-xs [scrollbar-width:none]"
      onDragOver={(e) => {
        if (drag === null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        // past every tab: the strip's empty end
        if (e.target === e.currentTarget && drag.at !== tabIds.length) setDrag({ ...drag, at: tabIds.length })
      }}
      onDrop={drop}
      onDragEnd={() => setDrag(null)}
    >
      {tabIds.map((id, index) => (
        <DocumentTab
          key={id}
          id={id}
          index={index}
          dragging={drag?.id === id}
          dropBefore={drag !== null && drag.at === index}
          dropAfter={drag !== null && index === tabIds.length - 1 && drag.at === tabIds.length}
          onDragStart={() => setDrag({ id, at: index })}
          onDragOver={(at) => drag !== null && drag.at !== at && setDrag({ ...drag, at })}
        />
      ))}
    </div>
  )
}

function DocumentTab({ id, index, dragging, dropBefore, dropAfter, onDragStart, onDragOver }: {
  readonly id: string
  readonly index: number
  readonly dragging: boolean
  readonly dropBefore: boolean
  readonly dropAfter: boolean
  readonly onDragStart: () => void
  /** The gap the dragged tab would land in, from where the pointer is over this tab. */
  readonly onDragOver: (at: number) => void
}) {
  const active = useEditor((s) => s.tabId === id)
  const projects = useEditor((s) => s.capabilities.projects)
  const several = useEditor((s) => s.tabIds.length > 1)
  const last = useEditor((s) => s.tabIds.at(-1) === id)
  const activateTab = useEditor((s) => s.activateTab)
  const { label, unsaved, path, fileName } = useTabSummary(id)
  const ref = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active])

  const onAuxClick = (e: MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    void closeTab(id)
  }
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    menuButton.current?.click()
  }
  const onDragOverTab = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    onDragOver(e.clientX < box.left + box.width / 2 ? index : index + 1)
  }

  return (
    <div
      ref={ref}
      draggable
      className={cn(
        "group relative flex h-full max-w-56 shrink-0 items-center gap-1 border-r pr-1 pl-2 transition-opacity",
        active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        dragging && "opacity-40",
        // where a dragged tab would land
        dropBefore && "before:absolute before:inset-y-0 before:-left-px before:z-10 before:w-0.5 before:bg-primary",
        dropAfter && "after:absolute after:inset-y-0 after:-right-px after:z-10 after:w-0.5 after:bg-primary"
      )}
      title={path ?? "Not saved yet"}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      // a middle press would otherwise start autoscroll
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", label)
        onDragStart()
      }}
      onDragOver={onDragOverTab}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="flex h-full min-w-0 items-center outline-none"
        onClick={() => activateTab(id)}
      >
        <span className="truncate">{label}</span>
      </button>
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {unsaved && (
          <span
            className="size-1.5 rounded-full bg-foreground/60 group-hover:invisible group-has-[button:focus-visible]:invisible"
            aria-label="unsaved"
          />
        )}
        <button
          type="button"
          aria-label={`Close ${label}`}
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-sm opacity-0 outline-none hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100",
            active && !unsaved && "opacity-100"
          )}
          onClick={() => void closeTab(id)}
        >
          <IconX className="size-3" />
        </button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={menuButton}
          render={<button type="button" className="sr-only" tabIndex={-1} aria-label={`More for ${label}`} />}
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => void closeTab(id)}>Close</DropdownMenuItem>
          <DropdownMenuItem disabled={!several} onClick={() => void closeOtherTabs(id)}>Close others</DropdownMenuItem>
          <DropdownMenuItem disabled={last} onClick={() => void closeTabsToRight(id)}>
            Close to the right
          </DropdownMenuItem>
          {projects && fileName !== null && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void nameProjectMap(fileName, "rename")}>Rename…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void nameProjectMap(fileName, "duplicate")}>Duplicate…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void revealProject()}>Reveal</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
