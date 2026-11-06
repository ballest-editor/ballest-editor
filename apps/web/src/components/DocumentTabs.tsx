import { IconBoxMultiple, IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from "@workspace/ui/components/context-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type DragEvent, useEffect, useRef, useState } from "react"
import type { KeybindAction } from "../domain/Keybinds"
import { LINK_STATE_LABELS, type LinkedMap, linkStateOf } from "../domain/linkState"
import { prefabTierLabel } from "../domain/prefab"
import type { ViewLayoutKind } from "../domain/viewLayout"
import {
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  nameProjectMap,
  openProjectMapAt,
  revealProject,
  startNewMap
} from "../editor/actions"
import { droppedMap, isMapDrag } from "../editor/mapDrag"
import { useEditor, useTabSummary } from "../editor/store"
import { StripButton } from "./dock/StripButton"
import { KeyChip } from "./KeyChip"
import { onMiddleClick } from "./middleClick"

/**
 * How far along the strip a tab's tooltip opens: past the tab's ×, and on the last tab past the + too. Along it, not
 * under it: the pane's picker starts 12px below the strip, so a tooltip there lands on it wherever it's aligned.
 */
const TIP_PAST_CLOSE = 36
const TIP_PAST_NEW_MAP = 68

/** A tab being dragged along the strip (`id`; null for a map's row over it), and the gap it would land in. */
type TabDrag = { readonly id: string | null; readonly at: number } | null

/**
 * What a tab's tooltip says of it: unsaved edits first, then a blank tab, which has nothing to save, then how its
 * project map stands against the export, if it has one.
 */
export const tabStatusOf = (unsaved: boolean, map: LinkedMap | undefined, blank = false): string => {
  if (unsaved) return "Unsaved"
  if (blank) return "New map"
  return map === undefined ? "Saved" : LINK_STATE_LABELS[linkStateOf(map)]
}

/**
 * The map tabs in the centre group's strip (docs/DESKTOP.md § Document tabs). A tab's dot marks unsaved edits and gives
 * way to the × while the tab is hovered. The + after the last tab stays in view while the tabs scroll. Not `group-hover`:
 * that is off under `(hover: none)`, which a window with a mouse can report, and the × would never show. A map's row
 * dropped on the strip opens the map there.
 */
export function DocumentTabs() {
  const tabIds = useEditor((s) => s.tabIds)
  const moveTab = useEditor((s) => s.moveTab)
  const [drag, setDrag] = useState<TabDrag>(null)

  const drop = (e: DragEvent) => {
    if (drag !== null && drag.id !== null) {
      moveTab(drag.id, drag.at > tabIds.indexOf(drag.id) ? drag.at - 1 : drag.at)
    }
    const map = droppedMap(e.dataTransfer)
    if (map !== undefined) void openProjectMapAt(map, drag?.at ?? tabIds.length)
    setDrag(null)
  }

  return (
    <div
      className="flex h-8 shrink-0 items-stretch bg-background text-body"
      onDragOver={(e) => {
        const over = drag ?? (isMapDrag(e.dataTransfer) ? { id: null, at: tabIds.length } : null)
        if (over === null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = over.id === null ? "copy" : "move"
        // past every tab: the strip's empty end
        const at = e.target === e.currentTarget ? tabIds.length : over.at
        if (drag === null || at !== drag.at) setDrag({ ...over, at })
      }}
      // a map's row has no dragend here to end on, so it goes when it leaves; a tab keeps its place along the strip
      onDragLeave={(e) => {
        if (drag?.id === null && !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
          setDrag(null)
        }
      }}
      onDrop={drop}
      onDragEnd={() => setDrag(null)}
    >
      <div
        role="tablist"
        aria-label="Documents"
        className="dock-tabs relative flex min-w-0 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
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

/** A menu row's key. The keys act on the active tab, so another tab's menu leaves them out. */
function TabShortcut({ action, active }: { readonly action: KeybindAction; readonly active: boolean }) {
  const binding = useEditor((s) => s.keybinds[action][0])
  return !active || binding === undefined ? null : (
    <ContextMenuShortcut className="pl-6">
      <KeyChip binding={binding} />
    </ContextMenuShortcut>
  )
}

function DocumentTab({ id, index, drag, onDrag }: {
  readonly id: string
  readonly index: number
  readonly drag: TabDrag
  readonly onDrag: (drag: NonNullable<TabDrag>) => void
}) {
  const active = useEditor((s) => s.tabId === id)
  const projects = useEditor((s) => s.capabilities.projects)
  const several = useEditor((s) => s.tabIds.length > 1)
  const last = useEditor((s) => s.tabIds.at(-1) === id)
  const activateTab = useEditor((s) => s.activateTab)
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  const { label, unsaved, blank, fileName, prefabTier } = useTabSummary(id)
  const map = useEditor((s) => s.projectMaps.find((candidate) => candidate.fileName === fileName))
  const [hinted, setHinted] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active])

  /** A map's view is its tab's, so the split goes to the tab the menu is for. */
  const split = (kind: ViewLayoutKind) => {
    activateTab(id)
    setViewLayoutKind(kind)
  }
  const onDragOverTab = (e: DragEvent<HTMLDivElement>) => {
    if (drag === null && !isMapDrag(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    const at = e.clientX < box.left + box.width / 2 ? index : index + 1
    if (drag?.at !== at) onDrag({ id: drag?.id ?? null, at })
  }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        setMenuOpen(open)
        if (open) setHinted(false)
      }}
    >
      <ContextMenuTrigger
        ref={ref}
        draggable
        className={cn(
          "group relative flex h-full max-w-56 shrink-0 cursor-grab items-center gap-1 rounded-t-control pr-1 pl-2 transition-[background-color,color,opacity] focus-ring-row-inset active:cursor-grabbing",
          active
            ? "dock-active-tab bg-card text-foreground"
            : "text-fg-secondary hover:bg-hover hover:text-accent-foreground active:bg-pressed",
          drag?.id === id && "opacity-40",
          // where a dragged tab would land
          drag?.at === index &&
            "before:absolute before:inset-y-0 before:-left-px before:z-10 before:w-0.5 before:bg-primary",
          last && drag?.at === index + 1 &&
            "after:absolute after:inset-y-0 after:-right-px after:z-10 after:w-0.5 after:bg-primary"
        )}
        {...onMiddleClick(() => void closeTab(id))}
        onDragStart={(e) => {
          setHinted(false)
          e.dataTransfer.effectAllowed = "move"
          e.dataTransfer.setData("text/plain", label)
          onDrag({ id, at: index })
        }}
        onDragOver={onDragOverTab}
      >
        {/* Only under the pointer, and not over the tab's menu: focus coming back from one is no reason to show it. */}
        {/* Not hoverable: it lies over the next tabs, and the pointer has to reach them. */}
        <Tooltip
          disableHoverablePopup
          open={hinted}
          onOpenChange={(open, { reason }) => setHinted(open && reason === "trigger-hover" && !menuOpen)}
        >
          <TooltipTrigger
            render={
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="flex h-full min-w-0 cursor-[inherit] items-center focus-visible:outline-none"
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
          <TooltipContent side="right" sideOffset={last ? TIP_PAST_NEW_MAP : TIP_PAST_CLOSE}>
            {label} · {tabStatusOf(unsaved, map, blank)}
          </TooltipContent>
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
      </ContextMenuTrigger>
      {/* Focus goes back to the page, as after a click on the tab: on the tab, Escape would light up its ring. */}
      <ContextMenuContent finalFocus={false}>
        <ContextMenuItem onClick={() => void closeTab(id)}>
          Close
          <TabShortcut action="closeTab" active={active} />
        </ContextMenuItem>
        <ContextMenuItem disabled={!several} onClick={() => void closeOtherTabs(id)}>Close others</ContextMenuItem>
        <ContextMenuItem disabled={last} onClick={() => void closeTabsToRight(id)}>Close to the right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => split("columns")}>Split right</ContextMenuItem>
        <ContextMenuItem onClick={() => split("rows")}>Split down</ContextMenuItem>
        {projects && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={fileName === null}
              onClick={() => fileName !== null && void nameProjectMap(fileName, "rename")}
            >
              Rename…
            </ContextMenuItem>
            <ContextMenuItem
              disabled={fileName === null}
              onClick={() => fileName !== null && void nameProjectMap(fileName, "duplicate")}
            >
              Duplicate…
              <TabShortcut action="saveMapAs" active={active} />
            </ContextMenuItem>
            <ContextMenuItem disabled={fileName === null} onClick={() => void revealProject()}>
              Reveal
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
