import {
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
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { type PointerEvent, type ReactNode, useSyncExternalStore } from "react"
import type { KeybindAction } from "../domain/Keybinds"
import { axisOf, formatPaneScale, ORTHO_AXES } from "../domain/orthoView"
import {
  isOrthoView,
  type OrthoView,
  paneClose,
  paneCloseColumn,
  paneCloseRow,
  type PaneRect,
  paneShares,
  paneSplitDown,
  paneSplitRight,
  type ViewLayoutKind,
  viewLayoutKinds,
  viewLayoutLabels,
  type ViewProjection,
  viewProjectionLabels,
  viewProjections
} from "../domain/viewLayout"
import { sceneAxisColors } from "../editor/axisColors"
import { changePanes, onPaneScaleChange, paneCameraAt } from "../editor/paneCameras"
import { useEditor } from "../editor/store"
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
function ViewPicker<V extends string>({ value, options, labels, icons, onPick, tip, action, name, disabled }: {
  readonly value: V
  readonly options: ReadonlyArray<V>
  readonly labels: Readonly<Record<V, string>>
  readonly icons: Readonly<Record<V, typeof IconSquare>>
  readonly onPick: (value: V) => void
  readonly tip: string
  readonly action?: KeybindAction
  /** The value's name beside its icon, where there's room, and how much it says. */
  readonly name?: "strong" | "quiet"
  readonly disabled: boolean
}) {
  const Icon: typeof IconSquare = icons[value]
  return (
    <DropdownMenu>
      <ViewTip
        label={tip}
        action={action}
        render={
          <DropdownMenuTrigger
            disabled={disabled}
            render={<button type="button" aria-label={`${tip}: ${labels[value]}`} className={SEGMENT} {...noFocus} />}
          />
        }
      >
        <Icon className="size-4" />
        {name !== undefined && <span className={cn(name === "strong" && "text-foreground")}>{labels[value]}</span>}
        <IconChevronDown className="size-3" />
      </ViewTip>
      <DropdownMenuContent className="w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={onPick}>
          {options.map((option) => {
            const OptionIcon: typeof IconSquare = icons[option]
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <OptionIcon className="size-4" />
                {labels[option]}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What a right click on a pane's label offers. The layouts are all there is (`PaneChange`), so it's only what they allow. */
function PaneMenuItems({ slot, kind }: { readonly slot: number; readonly kind: ViewLayoutKind }) {
  const right = paneSplitRight(kind)
  const down = paneSplitDown(kind)
  return (
    <>
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
 * The pane's name, which opens the list of views; a right click splits or closes the pane. The active pane has the view
 * controls, and puts its label beneath them when it's too narrow for both, by its own width: the pane is a container.
 */
function PaneHeader({ slot, projection, disabled, active }: {
  readonly slot: number
  readonly projection: ViewProjection
  readonly disabled: boolean
  readonly active: boolean
}) {
  const kind = useEditor((s) => s.viewLayout.kind)
  const setPaneProjection = useEditor((s) => s.setPaneProjection)
  return (
    <ContextMenu disabled={disabled}>
      <ContextMenuTrigger
        className={cn(GROUP, "absolute top-3 left-3", active && "@max-[34rem]:top-12")}
      >
        <ViewPicker
          value={projection}
          options={viewProjections}
          labels={viewProjectionLabels}
          icons={VIEW_ICONS}
          onPick={(next) => setPaneProjection(slot, next)}
          tip="Pane view"
          action="toggleOrthographic"
          name={active ? "strong" : "quiet"}
          disabled={disabled}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <PaneMenuItems slot={slot} kind={kind} />
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
 * The bottom left of an orthographic pane, clear of the tool bar: which way the game's axes run across it, in their
 * colours, and its zoom. On a chip of its own, so a busy map doesn't swallow them.
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
    <div className={cn("pointer-events-none absolute bottom-12 left-3 rounded-control p-1", SURFACE)}>
      <svg aria-hidden width={SIZE + 8} height={SIZE} viewBox={`0 0 ${SIZE + 8} ${SIZE}`}>
        <AxisArrow direction={across} across color={colors[across.axis]} />
        <AxisArrow direction={upward} across={false} color={colors[upward.axis]} />
      </svg>
      <div className="px-0.5 text-caption text-fg-tertiary tabular-nums">{formatPaneScale(scale, units)}</div>
    </div>
  )
}

/** A drag divider between panes. A double click puts it back in the middle. */
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
          "bg-foreground/20 transition-colors group-hover:bg-primary group-active:bg-primary",
          axis === "x" ? "h-full w-px group-hover:w-0.5" : "h-px w-full group-hover:h-0.5"
        )}
      />
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
  return (
    <div className="pointer-events-none absolute inset-0">
      {panes.map((pane) => {
        const { slot } = pane
        const projection = layout.projections[slot]
        const active = slot === activePane
        return (
          <div key={slot} className="absolute @container" style={paneBox(pane)}>
            {panes.length > 1 && active && (
              <div className="absolute inset-0 ring-1 ring-primary ring-inset dark:ring-blue-400" data-active-pane />
            )}
            <PaneHeader slot={slot} projection={projection} disabled={disabled} active={active} />
            {isOrthoView(projection) && <PaneCorner slot={slot} view={projection} />}
          </div>
        )
      })}
      {(layout.kind === "columns" || layout.kind === "quad") && <PaneDivider axis="x" at={layout.splitX} />}
      {(layout.kind === "rows" || layout.kind === "quad") && <PaneDivider axis="y" at={layout.splitY} />}
    </div>
  )
}

/** Holds `children` in the active pane's top right: they act on what's being done there, so they go where it's done. */
export function ActivePaneBox({ children }: { readonly children: ReactNode }) {
  const layout = useEditor((s) => s.viewLayout)
  const activePane = useEditor((s) => s.activePane)
  const pane = paneShares(layout).find(({ slot }) => slot === activePane)
  return (
    <div className="pointer-events-none absolute" style={pane === undefined ? undefined : paneBox(pane)}>
      <div className="absolute top-3 right-3 flex w-max gap-2">{children}</div>
    </div>
  )
}

/** Picks how the view divides into panes. */
export function ViewLayoutControl({ disabled }: { readonly disabled: boolean }) {
  const kind = useEditor((s) => s.viewLayout.kind)
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  return (
    <div className={GROUP}>
      <ViewPicker
        value={kind}
        options={viewLayoutKinds}
        labels={viewLayoutLabels}
        icons={LAYOUT_ICONS}
        onPick={setViewLayoutKind}
        tip="Panes"
        disabled={disabled}
      />
    </div>
  )
}
