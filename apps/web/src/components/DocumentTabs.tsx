import { IconBoxMultiple, IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type DragEvent, type MouseEvent, useEffect, useRef, useState } from "react"
import { LINK_STATE_LABELS, type LinkedMap, linkStateOf } from "../domain/linkState"
import { prefabTierLabel } from "../domain/prefab"
import type { ViewLayoutKind } from "../domain/viewLayout"
import {
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  nameProjectMap,
  revealProject,
  startNewMap
} from "../editor/actions"
import { useEditor, useTabSummary } from "../editor/store"
import { StripButton } from "./dock/StripButton"

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

/** What a tab's tooltip says of it: unsaved edits first, then how its project map stands against the export, if it has one. */
export const tabStatusOf = (unsaved: boolean, map: LinkedMap | undefined): string => {
  if (unsaved) return "Unsaved"
  return map === undefined ? "Saved" : LINK_STATE_LABELS[linkStateOf(map)]
}

/**
 * The map tabs in the centre group's strip (docs/DESKTOP.md § Document tabs). A tab's dot marks unsaved edits and gives
 * way to the × while the tab is hovered. The + after the last tab stays in view while the tabs scroll. Not `group-hover`:
 * that is off under `(hover: none)`, which a window with a mouse can report, and the × would never show.
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
      className="flex h-8 shrink-0 items-stretch bg-card text-body shadow-[inset_0_-1px_var(--border)]"
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
      <div className="flex shrink-0 items-center px-1">
        <StripButton label="New map" onClick={() => void startNewMap()}>
          <IconPlus />
        </StripButton>
      </div>
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
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  const { label, unsaved, fileName, prefabTier } = useTabSummary(id)
  const map = useEditor((s) => s.projectMaps.find((candidate) => candidate.fileName === fileName))
  const [hinted, setHinted] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active])

  /** A map's view is its tab's, so the split goes to the tab the menu is for. */
  const split = (kind: ViewLayoutKind) => {
    activateTab(id)
    setViewLayoutKind(kind)
  }
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    setHinted(false)
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
        "group relative flex h-full max-w-56 shrink-0 cursor-grab items-center gap-1 pr-1 pl-2 transition-[opacity,background-color,color] duration-150 ease-out active:cursor-grabbing",
        active
          ? "bg-background text-foreground shadow-[inset_0_-2px_var(--primary)]"
          : "text-fg-secondary hover:bg-accent hover:text-foreground",
        "has-[button:focus-visible]:shadow-[inset_0_0_0_2px_var(--ring)]",
        drag?.id === id && "opacity-40",
        // where a dragged tab would land
        drag?.at === index &&
          "before:absolute before:inset-y-0 before:-left-px before:z-10 before:w-0.5 before:bg-primary",
        last && drag?.at === index + 1 &&
          "after:absolute after:inset-y-0 after:-right-px after:z-10 after:w-0.5 after:bg-primary"
      )}
      {...closesOnMiddleClick(() => void closeTab(id))}
      onContextMenu={onContextMenu}
      onDragStart={(e) => {
        setHinted(false)
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", label)
        onDrag({ id, at: index })
      }}
      onDragOver={onDragOverTab}
    >
      {/* Only under the pointer, and not over the tab's menu: focus coming back from one is no reason to show it. */}
      <Tooltip
        open={hinted}
        onOpenChange={(open, { reason }) => setHinted(open && reason === "trigger-hover" && !menuOpen)}
      >
        <TooltipTrigger
          render={
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="flex h-full min-w-0 cursor-[inherit] items-center outline-none"
              onClick={() => activateTab(id)}
            />
          }
        >
          {prefabTier !== null && <IconBoxMultiple className="mr-1 size-4 shrink-0 text-fg-tertiary" />}
          <span className="truncate">{label}</span>
          {prefabTier !== null && (
            <span className="ml-1 shrink-0 rounded-full bg-muted px-1.5 text-caption text-fg-secondary">
              {prefabTierLabel(prefabTier, projects)}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">{label} · {tabStatusOf(unsaved, map)}</TooltipContent>
      </Tooltip>
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        {unsaved && (
          <span
            className="size-1.5 rounded-full bg-dirty group-has-[button:focus-visible]:invisible [.group:hover_&]:invisible"
            aria-label="unsaved"
          />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Close ${label}`}
          className={cn(
            "absolute inset-0 opacity-0 focus-visible:opacity-100 [.group:hover_&]:opacity-100",
            active && !unsaved && "opacity-100"
          )}
          onClick={() => void closeTab(id)}
        >
          <IconX />
        </Button>
      </span>
      <DropdownMenu onOpenChange={setMenuOpen}>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => split("columns")}>Split right</DropdownMenuItem>
          <DropdownMenuItem onClick={() => split("rows")}>Split down</DropdownMenuItem>
          {projects && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={fileName === null}
                onClick={() => fileName !== null && void nameProjectMap(fileName, "rename")}
              >
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={fileName === null}
                onClick={() => fileName !== null && void nameProjectMap(fileName, "duplicate")}
              >
                Duplicate…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={fileName === null} onClick={() => void revealProject()}>
                Reveal
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
