import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBoxAlignBottom,
  IconBoxAlignLeft,
  IconBoxAlignRight,
  IconBoxAlignTop,
  IconChevronDown,
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
  DropdownMenuSwitchItem,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import {
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import { useShallow } from "zustand/react/shallow"
import { type KeybindAction, PROJECTION_ACTIONS } from "../domain/Keybinds"
import { axisOf, formatPaneScale, ORTHO_AXES } from "../domain/orthoView"
import {
  isOrthoView,
  maximisedSlotOf,
  type OrthoView,
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
  viewLayoutLabels,
  type ViewProjection,
  viewProjectionLabels,
  viewProjections
} from "../domain/viewLayout"
import { sceneAxisColors } from "../editor/axisColors"
import { changePanes, onPaneScaleChange, paneCameraAt } from "../editor/paneCameras"
import { paneDisplayIn, useEditor } from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { GROUP, noFocus, SEGMENT, SURFACE } from "./viewControlStyle"
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
  strong,
  disabled,
  root,
  trigger,
  children
}: {
  readonly value: V
  readonly options: ReadonlyArray<V>
  readonly labels: Readonly<Record<V, string>>
  readonly icons: Readonly<Record<V, typeof IconSquare>>
  readonly onPick: (value: V) => void
  readonly tip: string
  readonly action?: KeybindAction
  /** What the button says beside its icon. */
  readonly word: string
  /** Whether the word stands out, or stays quiet like the icon. */
  readonly strong: boolean
  readonly disabled: boolean
  /** For a picker that opens its menu itself. */
  readonly root?: ComponentProps<typeof DropdownMenu>
  readonly trigger?: ComponentProps<typeof DropdownMenuTrigger>
  /** What the menu holds after the options. */
  readonly children?: ReactNode
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
        <span className={cn(strong && "text-foreground")}>{word}</span>
        <IconChevronDown className="size-3" />
      </ViewTip>
      <DropdownMenuContent className="w-40">
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
        {children}
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
 * Where a pane's label goes when it would meet the view controls in the viewport's top right: beneath them. Only the top
 * row can, and a pane in the right column by its own width (it's a container), one in the left by the viewport's.
 */
const labelClearance = ({ x, y }: PaneRect) =>
  y > 0 ? undefined : x > 0 ? "@max-[38rem]:top-12" : "@max-[38rem]/viewport:top-12"

/** What a pane shows, its own choice over the Display popover's. */
function PaneDisplayItems({ slot }: { readonly slot: PaneSlot }) {
  const { grid, sky } = useEditor(useShallow((s) => paneDisplayIn(s, slot)))
  const setPaneDisplay = useEditor((s) => s.setPaneDisplay)
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSwitchItem checked={grid} onCheckedChange={(on) => setPaneDisplay(slot, "grid", on)}>
        Show grid
      </DropdownMenuSwitchItem>
      <DropdownMenuSwitchItem checked={sky} onCheckedChange={(on) => setPaneDisplay(slot, "sky", on)}>
        Show sky
      </DropdownMenuSwitchItem>
    </>
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
 * The pane's name: a click opens the list of views, a drag swaps the pane with the one it's dropped on, a double click
 * maximises it, and a right click splits or closes it. The menu opens on the click, not the press, or every drag would
 * start with it. It isn't modal, so a double click's second press reaches the label: the two clicks open and close it.
 */
function PaneHeader({ pane, projection, disabled, active, drag }: {
  readonly pane: PaneRect
  readonly projection: ViewProjection
  readonly disabled: boolean
  readonly active: boolean
  readonly drag: PaneDragHandlers
}) {
  const kind = useEditor((s) => shownKindOf(s.viewLayout))
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
      <ContextMenuTrigger
        className={cn(GROUP, "absolute top-3 left-3", labelClearance(pane), dragging && "opacity-50")}
      >
        <ViewPicker
          value={projection}
          options={viewProjections}
          labels={viewProjectionLabels}
          icons={VIEW_ICONS}
          onPick={(next) => setPaneProjection(pane.slot, next)}
          tip="Pane view"
          action={PROJECTION_ACTIONS[projection]}
          word={viewProjectionLabels[projection]}
          strong={active}
          disabled={disabled}
          root={{ open, onOpenChange: setOpen, modal: false }}
          trigger={trigger}
        >
          <PaneDisplayItems slot={pane.slot} />
        </ViewPicker>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <PaneMenuItems slot={pane.slot} kind={kind} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

const ARROW = 30
const ORIGIN = 6
const SIZE = ORIGIN + ARROW + 14

/** One axis of `PaneCorner`: a line out from the corner, named with its sign ("-Y" when it runs that way). */
function AxisArrow({ direction, across, color }: {
  readonly direction: ReturnType<typeof axisOf>
  readonly across: boolean
  readonly color: string
}) {
  const name = `${direction.positive ? "" : "−"}${direction.axis.toUpperCase()}`
  const y = SIZE - ORIGIN
  return (
    <>
      <line
        x1={ORIGIN}
        y1={y}
        x2={across ? ORIGIN + ARROW : ORIGIN}
        y2={across ? y : y - ARROW}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <text
        x={across ? ORIGIN + ARROW + 3 : ORIGIN}
        y={across ? y + 4 : y - ARROW - 4}
        textAnchor={across ? "start" : "middle"}
        fill={color}
        className="text-caption"
      >
        {name}
      </text>
    </>
  )
}

/**
 * The bottom left of an orthographic pane, 8px above the tool bar, which reaches into the right column's pane: which way
 * the game's axes run across it, in their colours, and its zoom. On a chip of its own, so a busy map doesn't swallow them.
 */
function PaneCorner({ slot, view }: { readonly slot: number; readonly view: OrthoView }) {
  const units = useEditor((s) => s.settings.general.units)
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  // The zoom isn't React state: it changes with every wheel notch.
  const scale = useSyncExternalStore(onPaneScaleChange, () => paneCameraAt(slot).cmPerPixel)
  const { right, up } = ORTHO_AXES[view]
  const across = axisOf(right)
  const upward = axisOf(up)
  const colors = sceneAxisColors(dark)
  return (
    <div className={cn("pointer-events-none absolute bottom-14 left-3 rounded-sheet p-1.5", SURFACE)}>
      <svg aria-hidden width={SIZE + 8} height={SIZE} viewBox={`0 0 ${SIZE + 8} ${SIZE}`}>
        <AxisArrow direction={across} across color={colors[across.axis]} />
        <AxisArrow direction={upward} across={false} color={colors[upward.axis]} />
      </svg>
      <div className="px-0.5 text-caption text-fg-tertiary tabular-nums">{formatPaneScale(scale, units)}</div>
    </div>
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
 * What's drawn over the one canvas for its panes (docs/DESKTOP.md § View panes). All click-through but the labels and
 * dividers: the canvas takes the pointer and sorts it by pane.
 */
export function ViewPanes({ disabled }: { readonly disabled: boolean }) {
  const layout = useEditor((s) => s.viewLayout)
  const activePane = useEditor((s) => s.activePane)
  const panes = paneShares(layout)
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
      {panes.map((pane) => {
        const { slot } = pane
        const projection = layout.projections[slot]
        const active = slot === activePane
        return (
          <div key={slot} className="absolute @container" style={paneBox(pane)}>
            {panes.length > 1 && active && (
              <div className="absolute inset-0 ring-2 ring-ring ring-inset" data-active-pane />
            )}
            {paneDrag?.over === slot && paneDrag.from !== slot && (
              <div className="absolute inset-0 bg-primary/12 ring-2 ring-ring ring-inset" data-pane-drop />
            )}
            <PaneHeader
              pane={pane}
              projection={projection}
              disabled={disabled}
              active={active}
              drag={dragHandlers(slot)}
            />
            {isOrthoView(projection) && <PaneCorner slot={slot} view={projection} />}
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

/** Picks how the view divides into panes. */
export function ViewLayoutControl({ disabled }: { readonly disabled: boolean }) {
  const kind = useEditor((s) => shownKindOf(s.viewLayout))
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  return (
    <ViewPicker
      value={kind}
      options={viewLayoutKinds}
      labels={viewLayoutLabels}
      icons={LAYOUT_ICONS}
      onPick={setViewLayoutKind}
      tip="Panes"
      word="Panes"
      strong
      disabled={disabled}
    />
  )
}
