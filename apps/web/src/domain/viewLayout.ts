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

/** How far an orthographic pane's picture is rolled, in quarter turns clockwise: 0 is upright, as the view is named. */
export const viewRolls = [0, 1, 2, 3] as const
export type ViewRoll = (typeof viewRolls)[number]
type Rolls = readonly [ViewRoll, ViewRoll, ViewRoll, ViewRoll]

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

const viewLayoutLabels: Readonly<Record<ViewLayoutKind, string>> = {
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
const Roll = Schema.Literals(viewRolls)

export const ViewLayout = Schema.Struct({
  kind: Schema.Literals(viewLayoutKinds),
  /** Where the vertical divider sits, as a share of the width (`columns`, `quad`). */
  splitX: Split,
  /** Where the horizontal divider sits, as a share of the height (`rows`, `quad`). */
  splitY: Split,
  /** What each slot looks along. A slot keeps its view while a smaller layout hides it. */
  projections: Schema.Tuple([Projection, Projection, Projection, Projection]),
  /** How far each slot's orthographic picture is rolled; absent: every pane upright, as layouts were saved before. */
  rolls: Schema.optionalKey(Schema.Tuple([Roll, Roll, Roll, Roll])),
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

/** The layouts by name, as `layout` sees them: the one a maximised pane goes back to says so. */
export const viewLayoutLabelsOf = (layout: ViewLayout): Readonly<Record<ViewLayoutKind, string>> =>
  maximisedSlotOf(layout) === undefined
    ? viewLayoutLabels
    : { ...viewLayoutLabels, [layout.kind]: `${viewLayoutLabels[layout.kind]} (maximised)` }

/** `layout` showing all its panes again. */
export const withoutMaximised = ({ maximised: _maximised, ...layout }: ViewLayout): ViewLayout => layout

/** Maximises `slot`, or goes back to the layout if a pane is maximised. One pane has nothing to fill. */
export const withMaximisedToggled = (layout: ViewLayout, slot: PaneSlot): ViewLayout => {
  if (maximisedSlotOf(layout) !== undefined) return withoutMaximised(layout)
  return paneCountOf(layout.kind) > 1 ? { ...layout, maximised: slot } : layout
}

/** How far `slot`'s picture is rolled. */
export const rollOf = (layout: ViewLayout, slot: number): ViewRoll => layout.rolls?.[slot] ?? 0

/** `layout` with these rolls; with every pane upright it has none, so it's the layout it was before any roll. */
const withRolls = ({ rolls: _rolls, ...layout }: ViewLayout, rolls: Rolls): ViewLayout =>
  rolls.every((roll) => roll === 0) ? layout : { ...layout, rolls }

const rollsOf = (layout: ViewLayout, roll: (slot: PaneSlot, current: ViewRoll) => ViewRoll): Rolls => [
  roll(0, rollOf(layout, 0)),
  roll(1, rollOf(layout, 1)),
  roll(2, rollOf(layout, 2)),
  roll(3, rollOf(layout, 3))
]

/**
 * Rolls `slot`'s picture by `turns` quarter turns, clockwise for a positive number. Only an orthographic pane rolls: a
 * perspective one stays upright, as looking around levels it anyway.
 */
export const withPaneRolled = (layout: ViewLayout, slot: number, turns: number): ViewLayout => {
  const projection = layout.projections[slot]
  if (projection === undefined || !isOrthoView(projection)) return layout
  return withRolls(
    layout,
    rollsOf(layout, (each, roll) => each === slot ? viewRolls[(((roll + turns) % 4) + 4) % 4] ?? 0 : roll)
  )
}

/** Puts `slot` on `projection`, upright: a view picked is shown the way it's named, even the one the pane is on. */
export const withPaneProjection = (layout: ViewLayout, slot: number, projection: ViewProjection): ViewLayout => {
  if (layout.projections[slot] === projection && rollOf(layout, slot) === 0) return layout
  const [a, b, c, d] = layout.projections
  const at = (i: number, current: ViewProjection) => i === slot ? projection : current
  return withRolls(
    { ...layout, projections: [at(0, a), at(1, b), at(2, c), at(3, d)] },
    rollsOf(layout, (each, roll) => each === slot ? 0 : roll)
  )
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

/** The panes of `layout` as shares of the canvas, for what's laid out over it. */
export const paneShares = (layout: ViewLayout): Panes => shownPanes(layout, 1, 1, layout.splitX, layout.splitY)

/** The pane in the top right of `panes`, whose corner the view controls share: the last of the top row. */
export const cornerPaneOf = (panes: Panes): PaneRect => panes.reduce((corner, pane) => pane.y === 0 ? pane : corner)

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
export const withPaneChange = (layout: ViewLayout, { kind, order }: PaneChange): ViewLayout => {
  const { projections } = layout
  const [a, b, c, d] = order
  return withRolls(
    {
      ...withoutMaximised(layout),
      kind,
      projections: [projections[a], projections[b], projections[c], projections[d]]
    },
    rollsOf(layout, (slot) => rollOf(layout, order[slot]))
  )
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
