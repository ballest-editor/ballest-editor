/**
 * The panes of a map tab's view (docs/DESKTOP.md § View panes): how the viewport is divided, where the dividers sit and
 * what each pane looks along. Kept per map in MapPrefs. No renderer here: `editor/paneCameras.ts` holds the cameras.
 */
import { Schema } from "effect"

export const orthoViews = ["top", "bottom", "front", "back", "left", "right"] as const
export type OrthoView = (typeof orthoViews)[number]

export const viewProjections = ["perspective", ...orthoViews] as const
export type ViewProjection = (typeof viewProjections)[number]

export const isOrthoView = (projection: ViewProjection): projection is OrthoView => projection !== "perspective"

export const viewProjectionLabels: Readonly<Record<ViewProjection, string>> = {
  perspective: "Perspective",
  top: "Top",
  bottom: "Bottom",
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right"
}

export const viewLayoutKinds = ["single", "columns", "rows", "quad"] as const
export type ViewLayoutKind = (typeof viewLayoutKinds)[number]

export const viewLayoutLabels: Readonly<Record<ViewLayoutKind, string>> = {
  single: "One pane",
  columns: "Side by side",
  rows: "Stacked",
  quad: "Four panes"
}

/** No divider goes closer to the viewport's edge than this share of it, so a pane can't be dragged away. */
const MIN_SPLIT = 0.1

export const clampSplit = (fraction: number): number => Math.min(1 - MIN_SPLIT, Math.max(MIN_SPLIT, fraction))

const Split = Schema.Finite.check(Schema.isBetween({ minimum: MIN_SPLIT, maximum: 1 - MIN_SPLIT }))
const Projection = Schema.Literals(viewProjections)

/** What a pane shows whatever the Display popover says; a key left out follows it (`paneDisplayOf`). */
const PaneOverride = Schema.Struct({
  grid: Schema.optionalKey(Schema.Boolean),
  sky: Schema.optionalKey(Schema.Boolean)
})
type PaneOverride = typeof PaneOverride.Type

export const ViewLayout = Schema.Struct({
  kind: Schema.Literals(viewLayoutKinds),
  /** Where the vertical divider sits, as a share of the width (`columns`, `quad`). */
  splitX: Split,
  /** Where the horizontal divider sits, as a share of the height (`rows`, `quad`). */
  splitY: Split,
  /** What each slot looks along. A slot keeps its view while a smaller layout hides it. */
  projections: Schema.Tuple([Projection, Projection, Projection, Projection]),
  /** Each slot's overrides; absent: none has any. A slot keeps them while a smaller layout hides it. */
  overrides: Schema.optionalKey(Schema.Tuple([PaneOverride, PaneOverride, PaneOverride, PaneOverride])),
  /** The slot filling the viewport for now, with `kind` and the dividers kept to go back to; absent: none. */
  maximised: Schema.optionalKey(Schema.Literals([0, 1, 2, 3]))
})
export type ViewLayout = typeof ViewLayout.Type

export const defaultViewLayout: ViewLayout = {
  kind: "single",
  splitX: 0.5,
  splitY: 0.5,
  projections: ["perspective", "top", "front", "right"]
}

const sameViewLayout = Schema.toEquivalence(ViewLayout)
export const isDefaultViewLayout = (layout: ViewLayout): boolean => sameViewLayout(layout, defaultViewLayout)

/** The slots a layout shows: the first `n`, in reading order. */
export const paneCountOf = (kind: ViewLayoutKind): number => kind === "single" ? 1 : kind === "quad" ? 4 : 2

/** The slot `layout` has maximised, if it's one the layout has. */
export const maximisedSlotOf = ({ kind, maximised }: ViewLayout): PaneSlot | undefined =>
  maximised !== undefined && maximised < paneCountOf(kind) ? maximised : undefined

/** How the viewport looks divided right now: a maximised pane is one pane, whatever the layout goes back to. */
export const shownKindOf = (layout: ViewLayout): ViewLayoutKind =>
  maximisedSlotOf(layout) === undefined ? layout.kind : "single"

/** `layout` showing all its panes again. */
export const withoutMaximised = ({ maximised: _maximised, ...layout }: ViewLayout): ViewLayout => layout

/** Maximises `slot`, or goes back to the layout if a pane is maximised. One pane has nothing to fill. */
export const withMaximisedToggled = (layout: ViewLayout, slot: PaneSlot): ViewLayout => {
  if (maximisedSlotOf(layout) !== undefined) return withoutMaximised(layout)
  return paneCountOf(layout.kind) > 1 ? { ...layout, maximised: slot } : layout
}

/** One pane on the canvas, in CSS pixels from its top left. */
export interface PaneRect {
  readonly slot: 0 | 1 | 2 | 3
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type PaneSlot = PaneRect["slot"]
type Panes = ReadonlyArray<PaneRect>

/** The panes of a `kind` of layout over this area, in slot order, with the dividers at `x` and `y`. */
const panesOf = (kind: ViewLayoutKind, width: number, height: number, x: number, y: number): Panes => {
  switch (kind) {
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

/** The panes `layout` shows over this area, with the dividers at `x` and `y`: a maximised pane has all of it. */
const shownPanes = (layout: ViewLayout, width: number, height: number, x: number, y: number): Panes => {
  const slot = maximisedSlotOf(layout)
  return slot === undefined ? panesOf(layout.kind, width, height, x, y) : [{ slot, x: 0, y: 0, width, height }]
}

/** The panes of `layout` on a canvas of this size; the dividers land on whole pixels. */
export const paneRects = (layout: ViewLayout, width: number, height: number): Panes =>
  shownPanes(layout, width, height, Math.round(width * layout.splitX), Math.round(height * layout.splitY))

/** The panes of `layout` as shares of the viewport, for what's laid out over the canvas. */
export const paneShares = (layout: ViewLayout): Panes => shownPanes(layout, 1, 1, layout.splitX, layout.splitY)

/** The pane under a point on the canvas; one just past the edge (a captured drag) counts as the nearest. */
export const paneRectAt = (rects: Panes, x: number, y: number): PaneRect => {
  const inside = rects.find((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
  if (inside !== undefined) return inside
  const distance = (r: PaneRect) =>
    Math.hypot(Math.max(r.x - x, 0, x - r.x - r.width), Math.max(r.y - y, 0, y - r.y - r.height))
  return rects.reduce((nearest, r) => distance(r) < distance(nearest) ? r : nearest)
}

/**
 * A change to the panes that keeps what's left where it is on screen: the layout to show, and for each slot, the slot
 * whose view and camera it takes. There are only the four layouts, so splitting one of two panes splits its neighbour
 * too, and closing one of four closes its row or column.
 */
export interface PaneChange {
  readonly kind: ViewLayoutKind
  readonly order: readonly [PaneSlot, PaneSlot, PaneSlot, PaneSlot]
}

const SAME_SLOTS: PaneChange["order"] = [0, 1, 2, 3]

/** What "Split right" leads to from `kind`, if anything does. */
export const paneSplitRight = (kind: ViewLayoutKind): PaneChange | undefined => {
  switch (kind) {
    case "single":
      return { kind: "columns", order: SAME_SLOTS }
    case "rows": // the lower pane is slot 1 stacked, slot 2 of four
      return { kind: "quad", order: [0, 2, 1, 3] }
    case "columns":
    case "quad":
      return undefined
  }
}

/** What "Split down" leads to from `kind`, if anything does. */
export const paneSplitDown = (kind: ViewLayoutKind): PaneChange | undefined => {
  switch (kind) {
    case "single":
      return { kind: "rows", order: SAME_SLOTS }
    case "columns":
      return { kind: "quad", order: SAME_SLOTS }
    case "rows":
    case "quad":
      return undefined
  }
}

/** Closes one of two panes: the other fills the viewport. */
export const paneClose = (slot: number): PaneChange => ({
  kind: "single",
  order: slot === 0 ? [1, 0, 2, 3] : SAME_SLOTS
})

/** Closes the row of four panes that `slot` is in: the other row lies side by side. */
export const paneCloseRow = (slot: number): PaneChange => ({
  kind: "columns",
  order: slot < 2 ? [2, 3, 0, 1] : SAME_SLOTS
})

/** Closes the column of four panes that `slot` is in: the other column lies stacked. */
export const paneCloseColumn = (slot: number): PaneChange => ({
  kind: "rows",
  order: slot % 2 === 0 ? [1, 3, 0, 2] : [0, 2, 1, 3]
})

/** Swaps two panes where they stand: each takes the other's place, view and camera. */
export const paneSwap = (kind: ViewLayoutKind, a: PaneSlot, b: PaneSlot): PaneChange => {
  const other = (slot: PaneSlot) => slot === a ? b : slot === b ? a : slot
  return { kind, order: [other(0), other(1), other(2), other(3)] }
}

/** `layout` after `change`, with all its panes showing. */
export const withPaneChange = (layout: ViewLayout, { kind, order: [a, b, c, d] }: PaneChange): ViewLayout => {
  const { projections, overrides } = layout
  return {
    ...withoutMaximised(layout),
    kind,
    projections: [projections[a], projections[b], projections[c], projections[d]],
    ...(overrides !== undefined && { overrides: [overrides[a], overrides[b], overrides[c], overrides[d]] })
  }
}

/** What the Display popover sets for every pane. */
export interface PaneDisplay {
  readonly grid: boolean
  readonly sky: boolean
}

/** What a pane shows unasked: the Display popover's choice, but no sky in an orthographic pane, whose grid wants the plain background. */
const paneDefaults = (layout: ViewLayout, slot: PaneSlot, display: PaneDisplay): PaneDisplay => ({
  grid: display.grid,
  sky: display.sky && !isOrthoView(layout.projections[slot])
})

/** What the pane in `slot` shows, given the Display popover's `display`: its override wins. */
export const paneDisplayOf = (layout: ViewLayout, slot: PaneSlot, display: PaneDisplay): PaneDisplay => ({
  ...paneDefaults(layout, slot, display),
  ...layout.overrides?.[slot]
})

/**
 * Sets what the pane in `slot` shows. Setting it to what the pane would show anyway drops the override, so the pane
 * follows the Display popover again, and a layout with no overrides left says nothing about them.
 */
export const withPaneDisplay = (
  layout: ViewLayout,
  slot: PaneSlot,
  display: PaneDisplay,
  part: keyof PaneDisplay,
  on: boolean
): ViewLayout => {
  const { overrides, ...rest } = layout
  const set = (own: PaneOverride): PaneOverride => {
    const { [part]: _previous, ...others } = own
    return on === paneDefaults(layout, slot, display)[part] ? others : { ...others, [part]: on }
  }
  const [a, b, c, d] = overrides ?? [{}, {}, {}, {}]
  const at = (i: PaneSlot, own: PaneOverride) => i === slot ? set(own) : own
  const next: NonNullable<ViewLayout["overrides"]> = [at(0, a), at(1, b), at(2, c), at(3, d)]
  return next.every((own) => Object.keys(own).length === 0) ? rest : { ...rest, overrides: next }
}

/** How often, at most, a pane other than the active one is drawn: they take turns, one at a time. */
export const IDLE_PANE_INTERVAL_MS = 80

export interface PaneTurns {
  readonly lastDrawnAt: number
  readonly next: number
}

export const firstPaneTurns: PaneTurns = { lastDrawnAt: -Infinity, next: 0 }

/**
 * Which slots to draw this frame (docs/DESKTOP.md § View panes): the active pane, and the others in turn. `everyPane` is
 * for when their pixels are gone or in the wrong place.
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
