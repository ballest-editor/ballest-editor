import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBoxAlignBottom,
  IconBoxAlignLeft,
  IconBoxAlignRight,
  IconBoxAlignTop,
  IconChevronDown,
  IconFocus2,
  IconLayoutColumns,
  IconLayoutGrid,
  IconLayoutRows,
  IconPerspective,
  IconSquare,
  IconSquareDot,
  IconSquareX,
  IconX
} from "@tabler/icons-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "@workspace/ui/components/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { type ComponentProps, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { type KeybindAction, PROJECTION_ACTIONS } from "../domain/Keybinds"
import {
  cornerPaneOf,
  maximisedSlotOf,
  paneClose,
  paneCloseColumn,
  paneCloseRow,
  type PaneRect,
  paneRectAt,
  paneShares,
  type PaneSlot,
  paneSplitDown,
  paneSplitRight,
  paneSwap,
  shownKindOf,
  type ViewLayoutKind,
  viewLayoutKinds,
  viewLayoutLabelsOf,
  type ViewProjection,
  viewProjectionLabels,
  viewProjections
} from "../domain/viewLayout"
import { updateSettings } from "../editor/actions"
import { changePanes } from "../editor/paneCameras"
import { useEditor } from "../editor/store"
import { InstanceBanner } from "./InstanceBanner"
import { ChordText } from "./KeyChip"
import { SizeToggle } from "./SizeToggle"
import { SnapLabel } from "./SnapStatus"
import { CONTROL_WORD, GROUP, noFocus, SEGMENT, SURFACE } from "./viewControlStyle"
import { ViewGizmo } from "./ViewGizmo"
import { ViewTip } from "./ViewTip"

const LAYOUT_ICONS = {
  single: IconSquare,
  columns: IconLayoutColumns,
  rows: IconLayoutRows,
  quad: IconLayoutGrid
} as const

/** The box's edge a view looks at; front and back are the drawing convention, a dot coming at you and a cross going away. */
const VIEW_ICONS = {
  perspective: IconPerspective,
  top: IconBoxAlignTop,
  bottom: IconBoxAlignBottom,
  front: IconSquareDot,
  back: IconSquareX,
  left: IconBoxAlignLeft,
  right: IconBoxAlignRight
} as const

const percent = (share: number) => `${share * 100}%`

const paneBox = ({ x, y, width, height }: PaneRect) => ({
  left: percent(x),
  top: percent(y),
  width: percent(width),
  height: percent(height)
})

/** A menu in a group, with its value's icon on the button: what a pane looks along, and how the view divides. */
function ViewPicker<V extends string>({
  value,
  options,
  labels,
  icons,
  onPick,
  tip,
  action,
  word,
  wordClass,
  strong,
  disabled,
  root,
  trigger,
  footer
}: {
  readonly value: V
  readonly options: ReadonlyArray<V>
  readonly labels: Readonly<Record<V, string>>
  readonly icons: Readonly<Record<V, typeof IconSquare>>
  readonly onPick: (value: V) => void
  readonly tip: string
  readonly action?: KeybindAction
  /** What the button says beside its icon. */
  readonly word: ReactNode
  /** When the word gives way to the icon alone. */
  readonly wordClass?: string | undefined
  /** Whether the word stands out, or stays quiet like the icon. */
  readonly strong: boolean
  readonly disabled: boolean
  /** For a picker that opens its menu itself. */
  readonly root?: ComponentProps<typeof DropdownMenu>
  readonly trigger?: ComponentProps<typeof DropdownMenuTrigger>
  /** What the menu holds under its list. */
  readonly footer?: ReactNode
}) {
  const Icon: typeof IconSquare = icons[value]
  const title = `${tip}: ${labels[value]}`
  return (
    <DropdownMenu {...root}>
      <ViewTip
        label={title}
        action={action}
        render={
          <DropdownMenuTrigger
            {...trigger}
            disabled={disabled}
            render={<button type="button" aria-label={title} className={SEGMENT} {...noFocus} />}
          />
        }
      >
        <Icon className="size-4" />
        <span className={cn(strong && "text-foreground", wordClass)}>{word}</span>
        <IconChevronDown className={cn("size-3", wordClass)} />
      </ViewTip>
      <DropdownMenuContent className="w-max min-w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={onPick}>
          {options.map((option) => {
            const OptionIcon: typeof IconSquare = icons[option]
            return (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                <OptionIcon className="size-4" />
                {labels[option]}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * What a right click on a pane's label offers. The layouts are all there is (`PaneChange`), so it's only what they allow.
 * A maximised pane has one way to go.
 */
function PaneMenuItems({ slot, kind }: { readonly slot: PaneSlot; readonly kind: ViewLayoutKind }) {
  const maximised = useEditor((s) => maximisedSlotOf(s.viewLayout) !== undefined)
  const togglePaneMaximised = useEditor((s) => s.togglePaneMaximised)
  const right = paneSplitRight(kind)
  const down = paneSplitDown(kind)
  if (maximised) {
    return (
      <ContextMenuItem onClick={() => togglePaneMaximised(slot)}>
        <IconArrowsMinimize />
        Restore panes
      </ContextMenuItem>
    )
  }
  return (
    <>
      {kind !== "single" && (
        <ContextMenuItem onClick={() => togglePaneMaximised(slot)}>
          <IconArrowsMaximize />
          Maximise pane
        </ContextMenuItem>
      )}
      {right !== undefined && (
        <ContextMenuItem onClick={() => changePanes(right)}>
          <IconLayoutColumns />
          Split right
        </ContextMenuItem>
      )}
      {down !== undefined && (
        <ContextMenuItem onClick={() => changePanes(down)}>
          <IconLayoutRows />
          Split down
        </ContextMenuItem>
      )}
      {(kind === "columns" || kind === "rows") && (
        <ContextMenuItem onClick={() => changePanes(paneClose(slot))}>
          <IconX />
          Close pane
        </ContextMenuItem>
      )}
      {kind === "quad" && (
        <>
          <ContextMenuItem onClick={() => changePanes(paneCloseRow(slot))}>
            <IconX />
            Close row
          </ContextMenuItem>
          <ContextMenuItem onClick={() => changePanes(paneCloseColumn(slot))}>
            <IconX />
            Close column
          </ContextMenuItem>
        </>
      )}
    </>
  )
}

/**
 * When a pane's card gives way to the pane around it, the word first and then the axes; it never moves out of the way.
 * The view controls take more of the pane in its corner: they have gone to icons and stacked, and the axes at their
 * largest can't sit beside the second pill, or the label's word beside the first. The label stays, so the pane keeps its
 * name and its list of views.
 */
const LABEL_WORD = "@max-[10rem]:hidden"
const CORNER_LABEL_WORD = "@max-[16rem]:hidden"
const AXES_ROOM = "[@container_(height<10rem)]:hidden @max-[7.5rem]:hidden"
const CORNER_AXES_ROOM = "[@container_(height<10rem)]:hidden @max-[20rem]:hidden"
/** Where the isolation's chip goes in the corner's pane: beside the card while the controls leave room, else under it. */
const CORNER_CHIP_BESIDE = "@max-[42rem]:hidden"
const CORNER_CHIP_UNDER = "hidden @max-[42rem]:flex"

/** The foot of a pane's menu: how big the axes are, the same setting as Settings › Camera, for every pane. */
function AxesSizeRow() {
  const size = useEditor((s) => s.settings.camera.axesSize)
  return (
    <>
      <DropdownMenuSeparator />
      <div className="flex h-8 items-center justify-between gap-4 px-2">
        Axes size
        <SizeToggle
          label="Axes size"
          value={size}
          onChange={(axesSize) => void updateSettings("camera", { axesSize })}
        />
      </div>
    </>
  )
}

/** A maximised pane's way back, beside its card: a click, or the key it names (`useActionKeys`). */
function RestoreChip({ slot, disabled }: { readonly slot: PaneSlot; readonly disabled: boolean }) {
  const binding = useEditor((s) => s.keybinds.deselect[0])
  const togglePaneMaximised = useEditor((s) => s.togglePaneMaximised)
  return (
    <div className={GROUP}>
      <ViewTip
        label="Restore panes"
        render={
          <button
            type="button"
            aria-label="Restore panes"
            disabled={disabled}
            className={SEGMENT}
            onClick={() => togglePaneMaximised(slot)}
            {...noFocus}
          />
        }
      >
        <IconArrowsMinimize className="size-4" />
        <span className="text-caption @max-[60rem]/viewport:hidden">
          {binding === undefined ? "Restore" : (
            <>
              {binding === "Escape" ? "Esc" : <ChordText binding={binding} />} to restore
            </>
          )}
        </span>
      </ViewTip>
    </div>
  )
}

/**
 * The isolation's way out, beside every pane's card, as every pane of the tab is isolated (Blender marks each quad view
 * "(Local)"): a click, or the key it names. A pane in the corner with too little room beside its card for the view
 * controls has it under the card's label instead (`CORNER_CHIP_BESIDE`, `CORNER_CHIP_UNDER`).
 */
function IsolationChip({ disabled, className }: { readonly disabled: boolean; readonly className?: string }) {
  const binding = useEditor((s) => s.keybinds.isolateSelection[0])
  const count = useEditor((s) => s.isolation === null ? 0 : s.doc.ids.length - s.isolation.outside.size)
  const label = `End isolation: ${count} ${count === 1 ? "item is" : "items are"} isolated`
  return (
    <div className={cn(GROUP, className)}>
      <ViewTip
        label={label}
        render={
          <button
            type="button"
            aria-label="End isolation"
            disabled={disabled}
            className={SEGMENT}
            onClick={() => useEditor.getState().toggleIsolation()}
            {...noFocus}
          />
        }
      >
        <IconFocus2 className="size-4" />
        <span className="text-caption @max-[60rem]/viewport:hidden">
          {binding === undefined ? "Isolated" : (
            <>
              Isolated · <ChordText binding={binding} /> to end
            </>
          )}
        </span>
      </ViewTip>
    </div>
  )
}

/** How far a press on a pane's label moves before it's a drag and not a click. */
const DRAG_START_PX = 4

/** What a pane's label does to the pane that's being dragged. */
interface PaneDragHandlers {
  readonly dragging: boolean
  readonly onMove: (slot: PaneSlot, e: PointerEvent) => void
  readonly onDrop: () => void
  readonly onCancel: () => void
}

/**
 * A pane's card, in its top left: what it looks along, by name on a pill and by axes on a disc under it, each the shape
 * of what it holds, so a long name leaves no empty card. The name is the label: a click opens the list of views, a drag
 * swaps the pane with the one it's dropped on, a double click maximises it. A right click on either splits or closes the
 * pane. The menu opens on the click, not the press, or every drag would start with it. It isn't modal, so a double
 * click's second press reaches the label: the two clicks open and close it.
 */
function PaneCard({ pane, projection, disabled, active, inCorner, drag }: {
  readonly pane: PaneRect
  readonly projection: ViewProjection
  readonly disabled: boolean
  readonly active: boolean
  /** Whether the view controls sit in this pane's top right. */
  readonly inCorner: boolean
  readonly drag: PaneDragHandlers
}) {
  const kind = useEditor((s) => shownKindOf(s.viewLayout))
  const maximised = useEditor((s) => maximisedSlotOf(s.viewLayout) !== undefined)
  const isolated = useEditor((s) => s.isolation !== null)
  const setPaneProjection = useEditor((s) => s.setPaneProjection)
  const togglePaneMaximised = useEditor((s) => s.togglePaneMaximised)
  const [open, setOpen] = useState(false)
  const press = useRef<{ readonly x: number; readonly y: number } | null>(null)
  const moved = useRef(false)
  const { dragging, onCancel } = drag
  useEffect(() => {
    if (!dragging) return
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      press.current = null
      onCancel()
    }
    window.addEventListener("keydown", cancel, { capture: true })
    return () => window.removeEventListener("keydown", cancel, { capture: true })
  }, [dragging, onCancel])
  const trigger: ComponentProps<typeof DropdownMenuTrigger> = {
    style: dragging ? { cursor: "grabbing" } : {},
    onMouseDown: (e) => e.preventBaseUIHandler(),
    onPointerDown: (e) => {
      moved.current = false
      press.current = null
      if (e.button !== 0 || kind === "single") return
      press.current = { x: e.clientX, y: e.clientY }
      // From the press: a quick drag is off the label before its first move.
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => {
      if (press.current === null) return
      if (!moved.current) {
        if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) < DRAG_START_PX) return
        moved.current = true
        setOpen(false)
      }
      drag.onMove(pane.slot, e)
    },
    onPointerUp: () => {
      if (press.current !== null && moved.current) drag.onDrop()
      press.current = null
    },
    onPointerCancel: () => {
      press.current = null
      onCancel()
    },
    onClick: () => {
      if (!moved.current) setOpen(!open)
    },
    onDoubleClick: () => {
      setOpen(false)
      togglePaneMaximised(pane.slot)
    }
  }
  return (
    <ContextMenu disabled={disabled}>
      <ContextMenuTrigger className={cn("flex items-start gap-2", dragging && "opacity-50")}>
        <div className="flex flex-col items-start gap-1" data-pane-card>
          <div className={GROUP}>
            <ViewPicker
              value={projection}
              options={viewProjections}
              labels={viewProjectionLabels}
              icons={VIEW_ICONS}
              onPick={(next) => setPaneProjection(pane.slot, next)}
              tip="Pane view"
              action={PROJECTION_ACTIONS[projection]}
              word={
                <>
                  {viewProjectionLabels[projection]}
                  {maximised && <span className="@max-[60rem]/viewport:hidden">{" · Maximised"}</span>}
                </>
              }
              wordClass={inCorner ? CORNER_LABEL_WORD : LABEL_WORD}
              strong={active}
              disabled={disabled}
              root={{ open, onOpenChange: setOpen, modal: false }}
              trigger={trigger}
              footer={<AxesSizeRow />}
            />
          </div>
          {isolated && inCorner && <IsolationChip disabled={disabled} className={CORNER_CHIP_UNDER} />}
          <div className={cn("rounded-full p-1", SURFACE, inCorner ? CORNER_AXES_ROOM : AXES_ROOM)}>
            <ViewGizmo slot={pane.slot} projection={projection} disabled={disabled} />
          </div>
        </div>
        {maximised && <RestoreChip slot={pane.slot} disabled={disabled} />}
        {isolated && <IsolationChip disabled={disabled} {...(inCorner && { className: CORNER_CHIP_BESIDE })} />}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <PaneMenuItems slot={pane.slot} kind={kind} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A drag divider between panes: a line that brightens under the pointer. A double click puts it back in the middle. */
function PaneDivider({ axis, at }: { readonly axis: "x" | "y"; readonly at: number }) {
  const setPaneSplit = useEditor((s) => s.setPaneSplit)
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement?.getBoundingClientRect()
    if (box === undefined || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    setPaneSplit({ [axis]: axis === "x" ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height })
  }
  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      className={cn(
        "group pointer-events-auto absolute flex items-center justify-center",
        axis === "x"
          ? "inset-y-0 w-2 -translate-x-1/2 cursor-col-resize"
          : "inset-x-0 h-2 -translate-y-1/2 cursor-row-resize"
      )}
      style={{ [axis === "x" ? "left" : "top"]: percent(at) }}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={onPointerMove}
      onDoubleClick={() => setPaneSplit({ [axis]: 0.5 })}
    >
      <div
        className={cn(
          "bg-foreground/40 transition-colors group-hover:bg-foreground group-active:bg-foreground",
          axis === "x" ? "h-full w-px" : "h-px w-full"
        )}
      />
    </div>
  )
}

/** A pane's label on its way to another pane: the pane under it, and where it is in the viewport (px). */
interface PaneDrag {
  readonly from: PaneSlot
  readonly over: PaneSlot
  readonly x: number
  readonly y: number
}

/** The label under the pointer while it's dragged, so it reads as the pane that's moving. */
function DraggedLabel(
  { x, y, projection }: { readonly x: number; readonly y: number; readonly projection: ViewProjection }
) {
  const Icon: typeof IconSquare = VIEW_ICONS[projection]
  return (
    <div
      className={cn(GROUP, "pointer-events-none absolute -translate-1/2 gap-1.5 px-2.5 text-foreground shadow-md")}
      style={{ left: x, top: y }}
    >
      <Icon className="size-4" />
      {viewProjectionLabels[projection]}
    </div>
  )
}

/**
 * What's drawn over the one canvas for its panes (docs/DESKTOP.md § View panes). All click-through but the panes' cards
 * and dividers: the canvas takes the pointer and sorts it by pane. `children`, the view controls, go in a box the size of
 * the top right pane, which is the width they have to share with its card, and under the cards, which stay in reach.
 */
export function ViewPanes({ disabled, children }: { readonly disabled: boolean; readonly children: ReactNode }) {
  const layout = useEditor((s) => s.viewLayout)
  const activePane = useEditor((s) => s.activePane)
  const panes = paneShares(layout)
  const corner = cornerPaneOf(panes)
  const shownKind = shownKindOf(layout)
  const overlay = useRef<HTMLDivElement>(null)
  const [paneDrag, setPaneDrag] = useState<PaneDrag | null>(null)
  const cancelPaneDrag = useCallback(() => setPaneDrag(null), [])
  const dragHandlers = (slot: PaneSlot): PaneDragHandlers => ({
    dragging: paneDrag?.from === slot,
    onMove: (from, e) => {
      const box = overlay.current?.getBoundingClientRect()
      if (box === undefined) return
      const x = e.clientX - box.left
      const y = e.clientY - box.top
      setPaneDrag({ from, over: paneRectAt(panes, x / box.width, y / box.height).slot, x, y })
    },
    onDrop: () => {
      if (paneDrag !== null && paneDrag.over !== paneDrag.from) {
        changePanes(paneSwap(layout.kind, paneDrag.from, paneDrag.over))
      }
      setPaneDrag(null)
    },
    onCancel: cancelPaneDrag
  })
  return (
    <div ref={overlay} className="pointer-events-none absolute inset-0 @container/viewport">
      <div className="absolute @container/corner" style={paneBox(corner)}>{children}</div>
      {panes.map((pane) => {
        const { slot } = pane
        const projection = layout.projections[slot]
        const active = slot === activePane
        return (
          <div key={slot} className="absolute [container-type:size]" style={paneBox(pane)}>
            {panes.length > 1 && active && (
              <div className="absolute inset-0 ring-2 ring-ring ring-inset" data-active-pane />
            )}
            {paneDrag?.over === slot && paneDrag.from !== slot && (
              <div className="absolute inset-0 bg-primary/12 ring-2 ring-ring ring-inset" data-pane-drop />
            )}
            <div className="absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
              <PaneCard
                pane={pane}
                projection={projection}
                disabled={disabled}
                active={active}
                inCorner={slot === corner.slot}
                drag={dragHandlers(slot)}
              />
              {pane === panes[0] && <InstanceBanner />}
            </div>
            {active && <SnapLabel />}
          </div>
        )
      })}
      {(shownKind === "columns" || shownKind === "quad") && <PaneDivider axis="x" at={layout.splitX} />}
      {(shownKind === "rows" || shownKind === "quad") && <PaneDivider axis="y" at={layout.splitY} />}
      {paneDrag !== null && (
        <DraggedLabel x={paneDrag.x} y={paneDrag.y} projection={layout.projections[paneDrag.from]} />
      )}
    </div>
  )
}

/** Picks how the view divides into panes. While a pane is maximised it says which layout that pane goes back to. */
export function ViewLayoutControl({ disabled }: { readonly disabled: boolean }) {
  const layout = useEditor((s) => s.viewLayout)
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  const labels = viewLayoutLabelsOf(layout)
  const maximised = maximisedSlotOf(layout) !== undefined
  return (
    <ViewPicker
      value={layout.kind}
      options={viewLayoutKinds}
      labels={labels}
      icons={LAYOUT_ICONS}
      onPick={setViewLayoutKind}
      tip="Panes"
      word={maximised ? labels[layout.kind] : "Panes"}
      wordClass={maximised ? "@max-[50rem]/corner:hidden" : CONTROL_WORD}
      strong
      disabled={disabled}
    />
  )
}
