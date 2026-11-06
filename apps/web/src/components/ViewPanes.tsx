import { IconChevronDown, IconLayoutColumns, IconLayoutGrid, IconLayoutRows, IconSquare } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { type PointerEvent, useSyncExternalStore } from "react"
import { axisOf, formatPaneScale, ORTHO_AXES } from "../domain/orthoView"
import {
  isOrthoView,
  type OrthoView,
  paneShares,
  type ViewLayoutKind,
  viewLayoutKinds,
  viewLayoutLabels,
  type ViewProjection,
  viewProjectionLabels,
  viewProjections
} from "../domain/viewLayout"
import { AXIS_COLORS } from "../editor/axisColors"
import { onPaneScaleChange, paneCameraAt } from "../editor/paneCameras"
import { sceneStrokeClass } from "../editor/sceneColors"
import { useEditor } from "../editor/store"
import { FROSTED, GROUP, noFocus, POPUP_OFFSET } from "./viewControlStyle"

const LAYOUT_ICONS = {
  single: IconSquare,
  columns: IconLayoutColumns,
  rows: IconLayoutRows,
  quad: IconLayoutGrid
} as const

const percent = (share: number) => `${share * 100}%`

/**
 * The pane's name and scale, which opens the list of views. A pane under the view controls puts its label beneath them
 * when it's too narrow for both (`underControls`), by its own width: the pane is a container.
 */
function PaneHeader({ slot, projection, disabled, underControls }: {
  readonly slot: number
  readonly projection: ViewProjection
  readonly disabled: boolean
  readonly underControls: boolean
}) {
  const units = useEditor((s) => s.settings.general.units)
  const setPaneProjection = useEditor((s) => s.setPaneProjection)
  // The zoom isn't React state: it changes with every wheel notch.
  const scale = useSyncExternalStore(onPaneScaleChange, () => paneCameraAt(slot).cmPerPixel)
  const name = viewProjectionLabels[projection]
  const label = isOrthoView(projection) ? `${name} · ${formatPaneScale(scale, units)}` : name
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={`Pane view: ${label}`}
            className={cn(
              "pointer-events-auto absolute top-3 left-3 flex h-7 items-center gap-1 rounded-full pr-1.5 pl-2.5 text-xs font-medium tabular-nums outline-none transition-colors hover:bg-background/80 aria-expanded:bg-background/80 disabled:opacity-50",
              FROSTED,
              underControls && "@max-[28rem]:top-15"
            )}
            {...noFocus}
          />
        }
      >
        {label}
        <IconChevronDown className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        <DropdownMenuRadioGroup
          value={projection}
          onValueChange={(next: ViewProjection) => setPaneProjection(slot, next)}
        >
          {viewProjections.map((view) => (
            <DropdownMenuRadioItem key={view} value={view}>{viewProjectionLabels[view]}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ARROW = 34
const ORIGIN = 10
const SIZE = ORIGIN + ARROW + 14

/** One axis of `PaneAxes`: a line out from the corner, named with its sign ("-Y" when it runs that way). */
function AxisArrow({ direction, across }: { readonly direction: ReturnType<typeof axisOf>; readonly across: boolean }) {
  const color = AXIS_COLORS[direction.axis]
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
        fontSize={11}
        fontWeight={700}
        // a halo in the scene's colour, so the name reads over the grid and the map in either theme
        className={sceneStrokeClass}
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {name}
      </text>
    </>
  )
}

/** Which way the game's axes run across an orthographic pane, in their colours. */
function PaneAxes({ view }: { readonly view: OrthoView }) {
  const { right, up } = ORTHO_AXES[view]
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute bottom-14 left-0.5"
      width={SIZE + 8}
      height={SIZE}
      viewBox={`0 0 ${SIZE + 8} ${SIZE}`}
    >
      <AxisArrow direction={axisOf(right)} across />
      <AxisArrow direction={axisOf(up)} across={false} />
    </svg>
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
          "bg-border transition-colors group-hover:bg-primary group-active:bg-primary",
          axis === "x" ? "h-full w-px" : "h-px w-full"
        )}
      />
    </div>
  )
}

/**
 * What's drawn over the one canvas for its panes (docs/DESKTOP.md § View panes). A pane's top right stays free for the
 * view cube (#79). All click-through but the labels and dividers: the canvas takes the pointer and sorts it by pane.
 */
export function ViewPanes({ disabled }: { readonly disabled: boolean }) {
  const layout = useEditor((s) => s.viewLayout)
  const activePane = useEditor((s) => s.activePane)
  const panes = paneShares(layout)
  return (
    <div className="pointer-events-none absolute inset-0">
      {panes.map(({ slot, x, y, width, height }) => {
        const projection = layout.projections[slot]
        const box = { left: percent(x), top: percent(y), width: percent(width), height: percent(height) }
        return (
          <div key={slot} className="absolute @container" style={box}>
            {panes.length > 1 && slot === activePane && (
              <div className="absolute inset-0 ring-1 ring-primary ring-inset" data-active-pane />
            )}
            <PaneHeader
              slot={slot}
              projection={projection}
              disabled={disabled}
              underControls={slot === 1 && layout.kind !== "rows"}
            />
            {isOrthoView(projection) && <PaneAxes view={projection} />}
          </div>
        )
      })}
      {(layout.kind === "columns" || layout.kind === "quad") && <PaneDivider axis="x" at={layout.splitX} />}
      {(layout.kind === "rows" || layout.kind === "quad") && <PaneDivider axis="y" at={layout.splitY} />}
    </div>
  )
}

/** Picks how the view divides into panes. */
export function ViewLayoutControl({ disabled }: { readonly disabled: boolean }) {
  const kind = useEditor((s) => s.viewLayout.kind)
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  const Icon = LAYOUT_ICONS[kind]
  return (
    <div className={GROUP}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <button
              type="button"
              aria-label={`View panes: ${viewLayoutLabels[kind]}`}
              title="View panes"
              className="flex size-8 items-center justify-center rounded-full outline-none transition-colors hover:bg-muted aria-expanded:bg-muted disabled:opacity-50"
              {...noFocus}
            />
          }
        >
          <Icon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" sideOffset={POPUP_OFFSET.button} align="end" className="w-40">
          <DropdownMenuRadioGroup value={kind} onValueChange={(next: ViewLayoutKind) => setViewLayoutKind(next)}>
            {viewLayoutKinds.map((layout) => {
              const LayoutIcon = LAYOUT_ICONS[layout]
              return (
                <DropdownMenuRadioItem key={layout} value={layout}>
                  <LayoutIcon className="size-4" />
                  {viewLayoutLabels[layout]}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
