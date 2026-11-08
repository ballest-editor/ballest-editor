import { IconFoldDown, IconFoldUp } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@workspace/ui/components/context-menu"
import { Input } from "@workspace/ui/components/input"
import { Popover, PopoverContent } from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import {
  activeNodeOf,
  enteredScopeOf,
  exactSelectedGroup,
  groupPathOf,
  groupSelectionStates,
  nodeKeys,
  selectionNodeIds
} from "../domain/groupSelection"
import { isBound, type KeybindAction, mouseChordOf } from "../domain/Keybinds"
import {
  type DropTarget,
  dropTargetAt,
  indexOnceLeft,
  itemClasses,
  type OutlineRow,
  outlineRows,
  rowKeys,
  rowRange,
  scrollToShow,
  visibleRange
} from "../domain/outline"
import { findNode, groupNames, numberedNameText } from "../domain/structure"
import { detachInstance, updateInstance } from "../editor/actions"
import { actionCommands, type CommandAction } from "../editor/commands"
import { elementOf } from "../editor/keyTargets"
import { nextSelection, nodeNamesOf, noTabOpen, useCanGroup, useEditor } from "../editor/store"
import { EnteredGroupBreadcrumb } from "./EnteredGroupStatus"
import { MenuKey } from "./KeyChip"
import { OUTLINE_INDENT, OUTLINE_ROW_HEIGHT, OutlineRowView } from "./OutlineRow"
import { SavePrefabItem } from "./SavePrefabItem"
import { TagInput } from "./TagInput"

const OVERSCAN = 10
/** How far the pointer goes on a row before a press is a drag. */
const DRAG_SLOP_PX = 4
/** Within this of the list's top or bottom a drag scrolls the list, this far per frame. */
const AUTOSCROLL_EDGE_PX = 28
const AUTOSCROLL_STEP_PX = 10

/** A drag under way: the nodes on the move (in tree order) and where they would land. */
interface Drag {
  readonly ids: ReadonlyArray<string>
  readonly set: ReadonlySet<string>
  readonly target: DropTarget | undefined
  /** The row `target` is drawn on, or the row count below the last one. */
  readonly rowIndex: number
}

const isSubset = (keys: ReadonlyArray<string>, of: ReadonlyArray<string>) => {
  const all = new Set(of)
  return keys.every((key) => all.has(key))
}

const rowOf = (rows: ReadonlyArray<OutlineRow>, target: EventTarget): OutlineRow | undefined => {
  const index = elementOf(target)?.closest<HTMLElement>("[data-row-index]")?.dataset["rowIndex"]
  return index === undefined ? undefined : rows[Number(index)]
}

/** Where a drop would land: a line between rows; "into" lights the group's row instead. */
function DropLine({ drag }: { readonly drag: Drag }) {
  const { target, rowIndex } = drag
  if (target === undefined || target.position === "into") return null
  const row = rowIndex + (target.position === "after" ? 1 : 0)
  return (
    <div
      data-drop-line
      className="pointer-events-none absolute right-1 h-0.5 -translate-y-px rounded-full bg-primary"
      style={{ top: row * OUTLINE_ROW_HEIGHT, left: 4 + target.depth * OUTLINE_INDENT }}
    />
  )
}

function MenuCommand({ action, disabled = false, children }: {
  readonly action: CommandAction & KeybindAction
  readonly disabled?: boolean
  readonly children: ReactNode
}) {
  const binding = useEditor((s) => s.keybinds[action][0])
  return (
    <ContextMenuItem disabled={disabled} onClick={() => actionCommands[action]()}>
      {children}
      {binding !== undefined && <MenuKey binding={binding} />}
    </ContextMenuItem>
  )
}

function TagsPopover({ target, onClose }: {
  readonly target: { readonly id: string; readonly name: string; readonly anchor: DOMRect } | null
  readonly onClose: () => void
}) {
  const setTags = useEditor((s) => s.setTags)
  const input = useRef<HTMLInputElement>(null)
  const tags = useEditor((s) => {
    if (target === null) return undefined
    const { structure } = s.doc
    const node = findNode(structure.tree, target.id)?.node
    return node?.kind === "group" ? node.tags : structure.items.get(target.id)?.tags
  })
  return (
    <Popover open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target !== null && (
        <PopoverContent
          side="right"
          align="start"
          className="w-56 gap-2"
          initialFocus={input}
          anchor={{ getBoundingClientRect: () => target.anchor }}
        >
          <div className="truncate text-body-strong">Tags of {target.name}</div>
          <TagInput inputRef={input} tags={tags ?? []} onChange={(next) => setTags(target.id, next)} />
        </PopoverContent>
      )}
    </Popover>
  )
}

/** Folds every group, or opens them all once they're folded. Only there when the map has groups. */
function CollapseAllButton({ groupIds, disabled }: {
  readonly groupIds: ReadonlyArray<string>
  readonly disabled: boolean
}) {
  const allCollapsed = useEditor((s) => groupIds.every((id) => s.collapsedGroups.has(id)))
  if (groupIds.length === 0) return null
  const label = allCollapsed ? "Expand all groups" : "Collapse all groups"
  const toggleAll = () => {
    const { expandGroups, setGroupCollapsed } = useEditor.getState()
    if (allCollapsed) expandGroups(groupIds)
    else for (const id of groupIds) setGroupCollapsed(id, true)
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-fg-secondary"
            aria-label={label}
            disabled={disabled}
            onClick={toggleAll}
          />
        }
      >
        {allCollapsed ? <IconFoldDown /> : <IconFoldUp />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The map's tree, a self-contained panel: it fills what it is mounted in and scrolls by itself, drawing only the rows in
 * view (docs/DESKTOP.md § Outline). Selection is the store's, so it stays in step with the viewport both ways.
 */
export function Outline() {
  const doc = useEditor((s) => s.doc)
  const { map, ids, structure } = doc
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const selectedIds = useEditor((s) => s.selectedIds)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const collapsedGroups = useEditor((s) => s.collapsedGroups)
  const { tree } = structure

  const [query, setQuery] = useState("")
  const filtering = query.trim().length > 0
  const noTab = useEditor(noTabOpen)
  const names = useMemo(() => nodeNamesOf({ doc, catalogIndex }), [doc, catalogIndex])
  const classes = useMemo(() => itemClasses(map, ids), [map, ids])
  const rows = useMemo(
    () => outlineRows(structure, names, classes, collapsedGroups, query),
    [structure, names, classes, collapsedGroups, query]
  )
  const groupIds = useMemo(() => [...groupNames(tree).keys()], [tree])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const groupStates = useMemo(() => groupSelectionStates(tree, selected), [tree, selected])
  const enteredScope = useMemo(() => enteredScopeOf(tree, enteredGroupId), [tree, enteredGroupId])
  const enteredRange = useMemo(() => {
    const start = rows.findIndex((row) => row.id === enteredGroupId)
    if (start < 0) return undefined
    const depth = rows[start]?.depth ?? 0
    const after = rows.findIndex((row, i) => i > start && row.depth <= depth)
    return { start, end: after < 0 ? rows.length : after }
  }, [rows, enteredGroupId])

  const scroller = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(0)
  useEffect(() => {
    const el = scroller.current
    if (el === null) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const observer = new ResizeObserver(() => setViewHeight(el.clientHeight))
    observer.observe(el)
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener("scroll", onScroll)
    }
  }, [])
  const { start, end } = visibleRange(scrollTop, viewHeight, OUTLINE_ROW_HEIGHT, rows.length, OVERSCAN)

  // Clicks here have already shown what they select, so only a change from elsewhere moves the list. It moves once per
  // change and only as far as it takes, so it never pulls against the user's own scrolling.
  const shownSelection = useRef(selectedIds)
  const pendingReveal = useRef<string | null>(null)
  const selectHere = (next: ReadonlyArray<string>) => {
    useEditor.getState().select(next)
    shownSelection.current = useEditor.getState().selectedIds
  }
  useEffect(() => {
    if (selectedIds !== shownSelection.current) {
      shownSelection.current = selectedIds
      const node = activeNodeOf(tree, selectedIds)
      pendingReveal.current = node?.id ?? null
      if (node !== undefined) useEditor.getState().expandGroups(node.parents)
    }
    const el = scroller.current
    const id = pendingReveal.current
    if (el === null || id === null || viewHeight === 0) return
    const index = rows.findIndex((row) => row.id === id)
    if (index < 0) return
    pendingReveal.current = null
    el.scrollTop = scrollToShow(index, el.scrollTop, viewHeight, OUTLINE_ROW_HEIGHT)
  }, [selectedIds, tree, rows, viewHeight])

  // Where a Shift range starts: the last row clicked without Shift.
  const anchor = useRef<string | null>(null)
  const selectRow = (row: OutlineRow, e: MouseEvent) => {
    const s = useEditor.getState()
    const { tree: current } = s.doc.structure
    const chord = mouseChordOf(e)
    if (isBound(s.keybinds, "addToSelection", chord)) {
      const from = anchor.current ?? activeNodeOf(current, s.selectedIds)?.id ?? null
      selectHere(rowKeys(current, rowRange(rows, from, row.id)))
      return
    }
    anchor.current = row.id
    const mode = isBound(s.keybinds, "toggleSelection", chord) ? "toggle" : "replace"
    selectHere(nextSelection(s.selectedIds, nodeKeys(current, row.id), mode))
    const { enteredGroupId: entered } = s
    if (mode === "replace" && entered !== null && !groupPathOf(current, row.id).includes(entered)) {
      s.enterGroup(null)
    }
  }

  const [renaming, setRenaming] = useState<string | null>(null)
  const onRenamed = useCallback((row: OutlineRow, value: string | null) => {
    setRenaming(null)
    list.current?.focus({ preventScroll: true })
    if (value === null || value.trim() === row.name) return
    const { renameItem, renameGroup } = useEditor.getState()
    if (row.kind === "group") renameGroup(row.id, value)
    else renameItem(row.id, value)
  }, [setRenaming])

  // A press on a row becomes a drag once the pointer has moved; until then a release is a click.
  const press = useRef<{ readonly x: number; readonly y: number; readonly row: OutlineRow } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragged = useRef(false)
  const pointerY = useRef(0)

  /** The drag `current` with its target at the pointer. */
  const aimed = useCallback((current: Drag): Drag => {
    const el = scroller.current
    if (el === null) return current
    const y = Math.max(0, pointerY.current - el.getBoundingClientRect().top + el.scrollTop) / OUTLINE_ROW_HEIGHT
    const rowIndex = Math.min(Math.floor(y), rows.length)
    const { structure: live } = useEditor.getState().doc
    return { ...current, rowIndex, target: dropTargetAt(rows, live.tree.length, rowIndex, y % 1, current.set) }
  }, [rows])

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    let frame = requestAnimationFrame(function tick() {
      const el = scroller.current
      if (el !== null) {
        const { top, bottom } = el.getBoundingClientRect()
        const step = pointerY.current < top + AUTOSCROLL_EDGE_PX
          ? -AUTOSCROLL_STEP_PX
          : pointerY.current > bottom - AUTOSCROLL_EDGE_PX
          ? AUTOSCROLL_STEP_PX
          : 0
        if (step !== 0) {
          el.scrollTop += step
          setDrag((current) => current === null ? null : aimed(current))
        }
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [dragging, aimed])

  const startDrag = (e: PointerEvent<HTMLDivElement>, row: OutlineRow) => {
    const s = useEditor.getState()
    const { tree: current } = s.doc.structure
    const pressedKeys = nodeKeys(current, row.id)
    // a row outside the selection drags alone, and becomes the selection
    const held = isSubset(pressedKeys, s.selectedIds)
    if (!held) selectHere(pressedKeys)
    const nodeIds = selectionNodeIds(current, held ? s.selectedIds : pressedKeys, s.enteredGroupId)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragged.current = true
    setDrag(aimed({ ids: nodeIds, set: new Set(nodeIds), target: undefined, rowIndex: 0 }))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragged.current = false
    const row = e.button === 0 ? rowOf(rows, e.target) : undefined
    press.current = row === undefined ? null : { x: e.clientX, y: e.clientY, row }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    pointerY.current = e.clientY
    if (drag !== null) {
      setDrag(aimed(drag))
      return
    }
    const pressed = press.current
    if (pressed === null || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) <= DRAG_SLOP_PX) return
    press.current = null
    startDrag(e, pressed.row)
  }

  const onPointerUp = () => {
    press.current = null
    const target = drag?.target
    if (drag !== null && target !== undefined) {
      const s = useEditor.getState()
      s.moveNodes(drag.ids, target.parentId, indexOnceLeft(s.doc.structure, target, drag.set))
      if (target.parentId !== null) s.expandGroups([target.parentId])
    }
    setDrag(null)
  }

  // The row the context menu was opened on, and what it opened from it.
  const [menuRow, setMenuRow] = useState<OutlineRow | null>(null)
  const [tagsTarget, setTagsTarget] = useState<Parameters<typeof TagsPopover>[0]["target"]>(null)
  const { canGroup, canUngroup } = useCanGroup()
  const hasSelection = selectedIds.length > 0
  const instance = useMemo(
    () => exactSelectedGroup(tree, selectedIds, enteredGroupId),
    [tree, selectedIds, enteredGroupId]
  )
  const link = instance?.prefab
  // The group "Select all in group" means: the row's own, or the one the row is in.
  const menuGroupId = menuRow === null ? null : menuRow.kind === "group" ? menuRow.id : menuRow.parentId
  const enterRow = (id: string) => {
    const s = useEditor.getState()
    s.expandGroups([...groupPathOf(s.doc.structure.tree, id), id])
    selectHere([])
    s.enterGroup(id)
  }
  const selectAllIn = (id: string) => {
    const s = useEditor.getState()
    const { tree: current } = s.doc.structure
    selectHere(nodeKeys(current, id))
    const { enteredGroupId: entered } = s
    if (entered !== null && entered !== id && !groupPathOf(current, id).includes(entered)) s.enterGroup(null)
  }
  // Rename's field takes the focus, so the closing menu mustn't hand it back.
  const keepFocus = useRef(false)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <Input
          aria-label="Filter the outline"
          placeholder="Filter"
          className="flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("")
          }}
        />
        <CollapseAllButton groupIds={groupIds} disabled={filtering} />
      </div>
      <EnteredGroupBreadcrumb />
      <ContextMenu>
        <ContextMenuTrigger
          render={<ScrollArea className="min-h-0 flex-1" viewportRef={scroller} />}
          onContextMenuCapture={(e: MouseEvent) => {
            const row = rowOf(rows, e.target) ?? null
            keepFocus.current = false
            setMenuRow(row)
            if (row === null) return
            const s = useEditor.getState()
            const keys = nodeKeys(s.doc.structure.tree, row.id)
            if (!isSubset(keys, s.selectedIds)) selectHere(keys)
          }}
        >
          <div
            ref={list}
            role="tree"
            aria-label="Outline"
            tabIndex={0}
            className={cn("relative min-h-full focus-ring-inset", dragging && "cursor-grabbing")}
            style={{ height: rows.length * OUTLINE_ROW_HEIGHT }}
            onClick={(e) => {
              if (dragged.current) return
              const row = rowOf(rows, e.target)
              if (row === undefined) selectHere([])
              else selectRow(row, e)
            }}
            onDoubleClick={(e) => {
              const row = rowOf(rows, e.target)
              if (row !== undefined) setRenaming(row.id)
            }}
            onKeyDown={(e) => {
              if (e.key !== "F2") return
              const node = activeNodeOf(useEditor.getState().doc.structure.tree, useEditor.getState().selectedIds)
              if (node !== undefined) setRenaming(node.id)
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              press.current = null
              setDrag(null)
            }}
          >
            {rows.slice(start, end).map((row, i) => {
              const rowIndex = start + i
              const state = groupStates.get(row.id)
              return (
                <OutlineRowView
                  key={row.id}
                  row={row}
                  rowIndex={rowIndex}
                  selected={row.kind === "item"
                    ? selected.has(row.id)
                    : state === "all" && !enteredScope.includes(row.id)}
                  partial={state === "some"}
                  entered={row.id === enteredGroupId}
                  dimmed={enteredRange !== undefined && (rowIndex < enteredRange.start || rowIndex >= enteredRange.end)}
                  dragged={drag?.set.has(row.id) === true}
                  dropInto={drag?.target?.position === "into" && drag.target.rowId === row.id}
                  filtering={filtering}
                  renaming={renaming === row.id}
                  onRenamed={onRenamed}
                />
              )
            })}
            {drag !== null && <DropLine drag={drag} />}
            {rows.length === 0 && (
              <div className="p-3 text-body text-fg-tertiary">
                {filtering
                  ? "Nothing matches the filter."
                  : noTab
                  ? "No map open."
                  : "Nothing placed yet. Click a piece in Pieces to add it to the map."}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-max min-w-44"
          finalFocus={(closeType) => {
            if (keepFocus.current) return false
            // from the keyboard the focus shows, and on the tree it would ring the whole panel
            const index = rows.findIndex((row) => row.id === menuRow?.id)
            const row = list.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
            return closeType === "keyboard" && row != null ? row : true
          }}
        >
          <MenuCommand action="groupSelection" disabled={!canGroup}>Group</MenuCommand>
          <MenuCommand action="ungroupSelection" disabled={!canUngroup}>Ungroup</MenuCommand>
          {menuRow?.kind === "group" && !menuRow.instance
            ? (
              menuRow.chain
                ? (
                  <>
                    <ContextMenuItem onClick={() => useEditor.getState().setChain(menuRow.id, false)}>
                      Unchain
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={menuRow.childCount < 2}
                      onClick={() => useEditor.getState().reverseChain(menuRow.id)}
                    >
                      Reverse chain
                    </ContextMenuItem>
                  </>
                )
                : (
                  <ContextMenuItem onClick={() => useEditor.getState().setChain(menuRow.id, true)}>
                    Convert to chain
                  </ContextMenuItem>
                )
            )
            : <MenuCommand action="chainSelection" disabled={!canGroup}>Group as chain</MenuCommand>}
          <SavePrefabItem item={ContextMenuItem} />
          {instance !== undefined && link !== undefined && (
            <>
              <ContextMenuItem onClick={() => void updateInstance(instance.id, link)}>
                Update from prefab
              </ContextMenuItem>
              <ContextMenuItem onClick={() => detachInstance(instance.id)}>Detach from prefab</ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={menuRow?.kind !== "group" || menuRow.id === enteredGroupId}
            onClick={() => {
              if (menuRow !== null) enterRow(menuRow.id)
            }}
          >
            Enter group
          </ContextMenuItem>
          <ContextMenuItem
            disabled={menuGroupId === null}
            onClick={() => {
              if (menuGroupId !== null) selectAllIn(menuGroupId)
            }}
          >
            Select all in group
          </ContextMenuItem>
          <ContextMenuItem
            disabled={menuRow === null}
            onClick={() => {
              if (menuRow === null) return
              keepFocus.current = true
              setRenaming(menuRow.id)
            }}
          >
            Rename
            <MenuKey binding="F2" />
          </ContextMenuItem>
          <MenuCommand action="duplicateSelection" disabled={!hasSelection}>Duplicate</MenuCommand>
          <MenuCommand action="deleteSelection" disabled={!hasSelection}>Delete</MenuCommand>
          <ContextMenuSeparator />
          <MenuCommand action="focusSelection" disabled={!hasSelection}>Focus</MenuCommand>
          <ContextMenuItem
            disabled={menuRow === null}
            onClick={() => {
              if (menuRow === null) return
              const el = list.current?.querySelector(`[data-row-index="${rows.indexOf(menuRow)}"]`)
              if (el == null) return
              keepFocus.current = true
              setTagsTarget({ id: menuRow.id, name: numberedNameText(menuRow), anchor: el.getBoundingClientRect() })
            }}
          >
            Edit tags
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <TagsPopover target={tagsTarget} onClose={() => setTagsTarget(null)} />
    </div>
  )
}
