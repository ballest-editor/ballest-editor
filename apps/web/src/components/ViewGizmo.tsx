import { cn } from "@workspace/ui/lib/utils"
import { PROJECTION_ACTIONS } from "../domain/Keybinds"
import { type GizmoEnd, gizmoEnds, sameGizmoEnds } from "../domain/viewGizmo"
import { isOrthoView, type ViewProjection, viewProjectionLabels } from "../domain/viewLayout"
import { sceneAxisColors } from "../editor/axisColors"
import type { PaneCamera } from "../editor/paneCameras"
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
      side="top"
      render={
        <button
          type="button"
          aria-label={`${label} view`}
          disabled={disabled}
          className={cn(
            "pointer-events-auto absolute flex items-center justify-center rounded-full border-[1.5px] text-caption transition-[filter] hover:brightness-125",
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
 * Which way the game's axes run across a pane, turning with its camera: an end snaps the pane to that view and the centre
 * goes back to perspective (docs/DESKTOP.md § View panes). The ends are all that takes the pointer, in a card that doesn't.
 */
export function ViewGizmo({ slot, projection, disabled }: {
  readonly slot: number
  readonly projection: ViewProjection
  readonly disabled: boolean
}) {
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  const setActivePane = useEditor((s) => s.setActivePane)
  const setPaneProjection = useEditor((s) => s.setPaneProjection)
  const ends = usePaneReading(slot, endsOf, sameGizmoEnds)
  const colors = sceneAxisColors(dark)
  const pick = (view: ViewProjection) => {
    setActivePane(slot)
    setPaneProjection(slot, view)
  }
  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }} data-view-gizmo>
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
        side="top"
        render={
          <button
            type="button"
            aria-label="Perspective view"
            disabled={disabled || !isOrthoView(projection)}
            className="group pointer-events-auto absolute flex items-center justify-center rounded-full"
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
