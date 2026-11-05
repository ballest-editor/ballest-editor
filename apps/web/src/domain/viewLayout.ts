/**
 * The panes of a map tab's view (docs/DESKTOP.md § View panes): how the viewport is divided, where the dividers sit and
 * what each pane looks along. Kept per map in MapPrefs. No renderer here: `editor/paneCameras.ts` holds the cameras.
 */
import { Schema } from "effect"

export const orthoViews = ["top", "bottom", "front", "back", "left", "right"] as const
export type OrthoView = (typeof orthoViews)[number]

export const viewProjections = ["perspective", ...orthoViews] as const

export const viewLayoutKinds = ["single", "columns", "rows", "quad"] as const
export type ViewLayoutKind = (typeof viewLayoutKinds)[number]

/** No divider goes closer to the viewport's edge than this share of it, so a pane can't be dragged away. */
const MIN_SPLIT = 0.1

export const clampSplit = (fraction: number): number => Math.min(1 - MIN_SPLIT, Math.max(MIN_SPLIT, fraction))

const Split = Schema.Finite.check(Schema.isBetween({ minimum: MIN_SPLIT, maximum: 1 - MIN_SPLIT }))
const Projection = Schema.Literals(viewProjections)

export const ViewLayout = Schema.Struct({
  kind: Schema.Literals(viewLayoutKinds),
  /** Where the vertical divider sits, as a share of the width (`columns`, `quad`). */
  splitX: Split,
  /** Where the horizontal divider sits, as a share of the height (`rows`, `quad`). */
  splitY: Split,
  /** What each slot looks along. A slot keeps its view while a smaller layout hides it. */
  projections: Schema.Tuple([Projection, Projection, Projection, Projection])
})
export type ViewLayout = typeof ViewLayout.Type

export const defaultViewLayout: ViewLayout = {
  kind: "single",
  splitX: 0.5,
  splitY: 0.5,
  projections: ["perspective", "top", "front", "right"]
}

export const isDefaultViewLayout = (layout: ViewLayout): boolean =>
  layout.kind === defaultViewLayout.kind &&
  layout.splitX === defaultViewLayout.splitX &&
  layout.splitY === defaultViewLayout.splitY &&
  layout.projections.every((projection, slot) => projection === defaultViewLayout.projections[slot])

/** The slots a layout shows: the first `n`, in reading order. */
export const paneCountOf = (kind: ViewLayoutKind): number => kind === "single" ? 1 : kind === "quad" ? 4 : 2

/** One pane on the canvas, in CSS pixels from its top left. */
export interface PaneRect {
  readonly slot: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The panes of `layout` on a canvas of this size, in slot order; the dividers land on whole pixels. */
export const paneRects = (layout: ViewLayout, width: number, height: number): ReadonlyArray<PaneRect> => {
  const x = Math.round(width * layout.splitX)
  const y = Math.round(height * layout.splitY)
  switch (layout.kind) {
    case "single":
      return [{ slot: 0, x: 0, y: 0, width, height }]
    case "columns":
      return [
        { slot: 0, x: 0, y: 0, width: x, height },
        { slot: 1, x, y: 0, width: width - x, height }
      ]
    case "rows":
      return [
        { slot: 0, x: 0, y: 0, width, height: y },
        { slot: 1, x: 0, y, width, height: height - y }
      ]
    case "quad":
      return [
        { slot: 0, x: 0, y: 0, width: x, height: y },
        { slot: 1, x, y: 0, width: width - x, height: y },
        { slot: 2, x: 0, y, width: x, height: height - y },
        { slot: 3, x, y, width: width - x, height: height - y }
      ]
  }
}

/** The pane under a point on the canvas; one just past the edge (a captured drag) counts as the nearest. */
export const paneRectAt = (rects: ReadonlyArray<PaneRect>, x: number, y: number): PaneRect => {
  const inside = rects.find((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
  if (inside !== undefined) return inside
  const distance = (r: PaneRect) =>
    Math.hypot(Math.max(r.x - x, 0, x - r.x - r.width), Math.max(r.y - y, 0, y - r.y - r.height))
  return rects.reduce((nearest, r) => distance(r) < distance(nearest) ? r : nearest)
}

/** How often, at most, a pane other than the active one is drawn: they take turns, one at a time. */
export const IDLE_PANE_INTERVAL_MS = 80

/** When the idle panes last had a turn, and whose turn is next. */
export interface PaneTurns {
  readonly lastDrawnAt: number
  readonly next: number
}

export const firstPaneTurns: PaneTurns = { lastDrawnAt: -Infinity, next: 0 }

/**
 * Which slots to draw this frame. A map can cost a whole frame to draw once, so four panes can't all be drawn every
 * frame: the active pane is, and the others keep their pixels and take turns. `everyPane` is for when those pixels are
 * gone or in the wrong place (a resize, a moved divider, another tab).
 */
export const panesToDraw = (
  slots: ReadonlyArray<number>,
  active: number,
  now: number,
  turns: PaneTurns,
  everyPane: boolean
): { readonly slots: ReadonlyArray<number>; readonly turns: PaneTurns } => {
  if (everyPane) return { slots, turns: { ...turns, lastDrawnAt: now } }
  const idle = slots.filter((slot) => slot !== active)
  const turn = idle[turns.next % Math.max(idle.length, 1)]
  if (turn === undefined || now - turns.lastDrawnAt < IDLE_PANE_INTERVAL_MS) return { slots: [active], turns }
  return { slots: [active, turn], turns: { lastDrawnAt: now, next: (turns.next + 1) % idle.length } }
}
