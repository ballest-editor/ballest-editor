import { IconBoxMultiple, IconPlus, IconX } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { type DragEvent, type MouseEvent, useEffect, useRef, useState } from "react"
import {
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  nameProjectMap,
  revealProject,
  startNewMap
} from "../editor/actions"
import { useEditor, useTabSummary } from "../editor/store"

/** A tab being dragged along the strip, and the gap it would land in. */
type TabDrag = { readonly id: string; readonly at: number } | null

/** What makes a tab of either strip close on a middle click. */
export const closesOnMiddleClick = (close: () => void) => ({
  onAuxClick: (e: MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    close()
  },
  // a middle press would otherwise start autoscroll
  onMouseDown: (e: MouseEvent) => e.button === 1 && e.preventDefault()
})

/**
 * The map tabs in the centre group's strip (docs/DESKTOP.md § Document tabs). A tab's dot marks unsaved edits and gives
 * way to the × while the tab is hovered. The + after the last tab stays in view while the tabs scroll.
 */
export function DocumentTabs() {
  const tabIds = useEditor((s) => s.tabIds)
  const moveTab = useEditor((s) => s.moveTab)
  const [drag, setDrag] = useState<TabDrag>(null)

  const drop = () => {
    if (drag !== null) moveTab(drag.id, drag.at > tabIds.indexOf(drag.id) ? drag.at - 1 : drag.at)
    setDrag(null)
  }

  return (
    <div
      className="flex h-8 shrink-0 items-stretch bg-card text-xs shadow-[inset_0_-1px_var(--border)]"
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
      <div
        role="tablist"
        aria-label="Documents"
        className="flex min-w-0 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {tabIds.map((id, index) => <DocumentTab key={id} id={id} index={index} drag={drag} onDrag={setDrag} />)}
      </div>
      <button
        type="button"
        aria-label="New map"
        title="New map"
        className="flex w-8 shrink-0 items-center justify-center text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]"
        onClick={() => void startNewMap()}
      >
        <IconPlus className="size-3.5" />
      </button>
    </div>
  )
}

function DocumentTab({ id, index, drag, onDrag }: {
  readonly id: string
  readonly index: number
  readonly drag: TabDrag
  readonly onDrag: (drag: TabDrag) => void
}) {
  const active = useEditor((s) => s.tabId === id)
  const projects = useEditor((s) => s.capabilities.projects)
  const several = useEditor((s) => s.tabIds.length > 1)
  const last = useEditor((s) => s.tabIds.at(-1) === id)
  const activateTab = useEditor((s) => s.activateTab)
  const { label, unsaved, path, fileName, prefabTier } = useTabSummary(id)
  const ref = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active])

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    menuButton.current?.click()
  }
  const onDragOverTab = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    const at = e.clientX < box.left + box.width / 2 ? index : index + 1
    if (drag !== null && drag.at !== at) onDrag({ ...drag, at })
  }

  return (
    <div
      ref={ref}
      draggable
      className={cn(
        "group relative flex h-full max-w-56 shrink-0 items-center gap-1 border-r pr-1 pl-2 transition-opacity",
        active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        "has-[button:focus-visible]:shadow-[inset_0_0_0_2px_var(--ring)]",
        drag?.id === id && "opacity-40",
        // where a dragged tab would land
        drag?.at === index &&
          "before:absolute before:inset-y-0 before:-left-px before:z-10 before:w-0.5 before:bg-primary",
        last && drag?.at === index + 1 &&
          "after:absolute after:inset-y-0 after:-right-px after:z-10 after:w-0.5 after:bg-primary"
      )}
      title={path ?? "Not saved yet"}
      {...closesOnMiddleClick(() => void closeTab(id))}
      onContextMenu={onContextMenu}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", label)
        onDrag({ id, at: index })
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
        {prefabTier !== null && <IconBoxMultiple className="mr-1 size-3 shrink-0 text-muted-foreground" />}
        <span className="truncate">{label}</span>
        {prefabTier !== null && (
          <span className="ml-1 shrink-0 text-[0.6rem] text-muted-foreground">{projects ? prefabTier : "session"}</span>
        )}
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
