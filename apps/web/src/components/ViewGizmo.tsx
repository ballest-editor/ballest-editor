import { cn } from "@workspace/ui/lib/utils"
import { type MouseEvent, type PointerEvent, useRef } from "react"
import { PROJECTION_ACTIONS } from "../domain/Keybinds"
import { gizmoScaleOf } from "../domain/Settings"
import { type GizmoEnd, gizmoEnds, gizmoTurnOf, isGizmoDrag, sameGizmoEnds } from "../domain/viewGizmo"
import { isOrthoView, type ViewProjection, viewProjectionLabels } from "../domain/viewLayout"
import { sceneAxisColors } from "../editor/axisColors"
import { type PaneCamera, paneCameraAt } from "../editor/paneCameras"
import { useEditor } from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { usePaneReading } from "../editor/usePaneReading"
import { noFocus } from "./viewControlStyle"
import { ViewTip } from "./ViewTip"

/** From the gizmo's centre to an end's. */
const RADIUS = 28
const END_SIZE = 20
const CENTRE_SIZE = 16
const SIZE = 2 * RADIUS + END_SIZE

/** Above the ends that face away, under the ends that face the eye. */
const CENTRE_LAYER = 10

const endsOf = (pane: PaneCamera) => gizmoEnds(pane.screenAxes())

const toPixels = ({ x, y }: Pick<GizmoEnd, "x" | "y">) => ({ x: SIZE / 2 + x * RADIUS, y: SIZE / 2 - y * RADIUS })

/** One end of an axis: the positive end filled and named, the negative one a ring with its sign. */
function AxisEnd({ end, color, onPick, disabled }: {
  readonly end: GizmoEnd
  readonly color: string
  readonly onPick: (view: ViewProjection) => void
  readonly disabled: boolean
}) {
  const { axis, positive, view, depth } = end
  const { x, y } = toPixels(end)
  const label = viewProjectionLabels[view]
  return (
    <ViewTip
      label={label}
      action={PROJECTION_ACTIONS[view]}
      side="right"
      render={
        <button
          type="button"
          aria-label={`${label} view`}
          disabled={disabled}
          className={cn(
            "absolute flex items-center justify-center rounded-full border-[1.5px] text-caption transition-[filter] hover:brightness-125",
            positive ? "text-background" : "bg-card"
          )}
          style={{
            left: x - END_SIZE / 2,
            top: y - END_SIZE / 2,
            width: END_SIZE,
            height: END_SIZE,
            zIndex: CENTRE_LAYER + Math.round(depth * (CENTRE_LAYER - 1)) + (depth > 0 ? 1 : 0),
            borderColor: color,
            ...(positive ? { backgroundColor: color } : { color })
          }}
          onClick={() => onPick(view)}
          {...noFocus}
        />
      }
    >
      {positive ? axis.toUpperCase() : `−${axis.toUpperCase()}`}
    </ViewTip>
  )
}

/**
 * A press on the gizmo, wherever on it: a click is left to what's under it, and past a few pixels it's a drag that orbits
 * the pane, out of an orthographic view if that's where it is. What it returns goes on the gizmo.
 */
const useGizmoDrag = (slot: number, projection: ViewProjection, disabled: boolean) => {
  const setActivePane = useEditor((s) => s.setActivePane)
  const setPaneProjection = useEditor((s) => s.setPaneProjection)
  const press = useRef<{ readonly x: number; readonly y: number } | null>(null)
  const dragged = useRef(false)
  const release = () => {
    press.current = null
  }
  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      dragged.current = false
      if (e.button !== 0 || disabled) return
      setActivePane(slot)
      press.current = { x: e.clientX, y: e.clientY }
      // From the press: a quick drag is off the gizmo before its first move. On what's pressed, so its click still lands.
      if (e.target instanceof Element) e.target.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (press.current === null) return
      const dx = e.clientX - press.current.x
      const dy = e.clientY - press.current.y
      if (!dragged.current) {
        if (!isGizmoDrag(dx, dy)) return
        dragged.current = true
        // The end that was pressed can turn out of sight and take a capture with it.
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      press.current = { x: e.clientX, y: e.clientY }
      const { yaw, pitch } = gizmoTurnOf(dx, dy)
      paneCameraAt(slot).orbit(yaw, pitch)
      if (isOrthoView(projection)) setPaneProjection(slot, "perspective")
    },
    onPointerUp: release,
    onPointerCancel: release,
    onClickCapture: (e: MouseEvent) => {
      if (dragged.current) e.stopPropagation()
    },
    onMouseDown: noFocus.onMouseDown
  }
}

/**
 * Which way the game's axes run across a pane, turning with its camera (docs/DESKTOP.md § View panes): a click on an end
 * snaps the pane to that view, a click on the centre goes back to perspective, and a drag anywhere on it orbits the pane.
 * The round gizmo is all that takes the pointer, in a card that doesn't.
 */
export function ViewGizmo({ slot, projection, disabled }: {
  readonly slot: number
  readonly projection: ViewProjection
  readonly disabled: boolean
}) {
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  const setActivePane = useEditor((s) => s.setActivePane)
  const setPaneProjection = useEditor((s) => s.setPaneProjection)
  const drag = useGizmoDrag(slot, projection, disabled)
  const ends = usePaneReading(slot, endsOf, sameGizmoEnds)
  const colors = sceneAxisColors(dark)
  const scale = gizmoScaleOf(useEditor((s) => s.settings.gizmo.size))
  const pick = (view: ViewProjection) => {
    setActivePane(slot)
    setPaneProjection(slot, view)
  }
  return (
    <div
      className={cn(
        "pointer-events-auto relative rounded-full",
        !disabled && "cursor-grab transition-colors hover:bg-hover active:cursor-grabbing active:bg-pressed"
      )}
      // `zoom`, not `scale`: the pane's card has to grow with it.
      style={{ width: SIZE, height: SIZE, zoom: scale }}
      data-view-gizmo
      {...drag}
    >
      <svg aria-hidden className="absolute inset-0" width={SIZE} height={SIZE}>
        {ends.filter((end) => end.positive).map((end) => {
          const { x, y } = toPixels(end)
          return (
            <line
              key={end.axis}
              x1={SIZE / 2}
              y1={SIZE / 2}
              x2={x}
              y2={y}
              stroke={colors[end.axis]}
              strokeWidth={2}
              strokeLinecap="round"
            />
          )
        })}
      </svg>
      {ends.map((end) => (
        <AxisEnd
          key={end.view}
          end={end}
          color={colors[end.axis]}
          onPick={pick}
          disabled={disabled}
        />
      ))}
      <ViewTip
        label={viewProjectionLabels.perspective}
        action={PROJECTION_ACTIONS.perspective}
        side="right"
        render={
          <button
            type="button"
            aria-label="Perspective view"
            disabled={disabled || !isOrthoView(projection)}
            className="group absolute flex items-center justify-center rounded-full disabled:pointer-events-none"
            style={{
              left: (SIZE - CENTRE_SIZE) / 2,
              top: (SIZE - CENTRE_SIZE) / 2,
              width: CENTRE_SIZE,
              height: CENTRE_SIZE,
              zIndex: CENTRE_LAYER
            }}
            onClick={() => pick("perspective")}
            {...noFocus}
          />
        }
      >
        <span className="size-2 rounded-full bg-fg-secondary transition-colors group-hover:bg-foreground group-disabled:bg-fg-disabled" />
      </ViewTip>
    </div>
  )
}
