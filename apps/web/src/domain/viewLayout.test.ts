import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import {
  clampSplit,
  defaultViewLayout,
  firstPaneTurns,
  IDLE_PANE_INTERVAL_MS,
  isDefaultViewLayout,
  maximisedSlotOf,
  paneClose,
  paneCloseColumn,
  paneCloseRow,
  paneCountOf,
  paneDisplayOf,
  paneRectAt,
  paneRects,
  paneShares,
  paneSplitDown,
  paneSplitRight,
  panesToDraw,
  paneSwap,
  shownKindOf,
  ViewLayout,
  type ViewLayoutKind,
  viewLayoutKinds,
  withMaximisedToggled,
  withoutMaximised,
  withPaneChange,
  withPaneDisplay
} from "./viewLayout"

const layoutOf = (kind: ViewLayoutKind, splitX = 0.5, splitY = 0.5): ViewLayout => ({
  ...defaultViewLayout,
  kind,
  splitX,
  splitY
})

describe("pane rectangles", () => {
  it("gives one rectangle per pane, and together they tile the canvas", () => {
    for (const kind of viewLayoutKinds) {
      const rects = paneRects(layoutOf(kind, 0.3, 0.7), 1001, 603)
      assert.strictEqual(rects.length, paneCountOf(kind))
      assert.deepStrictEqual(rects.map((r) => r.slot), rects.map((_, i) => i))
      assert.strictEqual(rects.reduce((area, r) => area + r.width * r.height, 0), 1001 * 603)
    }
  })

  it("puts the dividers on whole pixels", () => {
    const [left, right] = paneRects(layoutOf("columns", 0.333), 1000, 500)
    assert.deepStrictEqual(left, { slot: 0, x: 0, y: 0, width: 333, height: 500 })
    assert.deepStrictEqual(right, { slot: 1, x: 333, y: 0, width: 667, height: 500 })
  })

  it("reads four panes left to right, top to bottom", () => {
    const rects = paneRects(layoutOf("quad", 0.25, 0.75), 400, 400)
    assert.deepStrictEqual(rects.map((r) => [r.x, r.y]), [[0, 0], [100, 0], [0, 300], [100, 300]])
  })

  it("finds the pane under a point, and the nearest for a drag that left the canvas", () => {
    const rects = paneRects(layoutOf("quad"), 400, 400)
    assert.strictEqual(paneRectAt(rects, 10, 10).slot, 0)
    assert.strictEqual(paneRectAt(rects, 200, 200).slot, 3) // a divider belongs to the pane after it
    assert.strictEqual(paneRectAt(rects, 399, 10).slot, 1)
    assert.strictEqual(paneRectAt(rects, -50, 390).slot, 2)
    assert.strictEqual(paneRectAt(rects, 900, 900).slot, 3)
  })
})

describe("the view layout", () => {
  it("holds a divider off the viewport's edges", () => {
    assert.strictEqual(clampSplit(0), 0.1)
    assert.strictEqual(clampSplit(1.4), 0.9)
    assert.strictEqual(clampSplit(0.42), 0.42)
  })

  it("starts as one perspective pane, with the other slots on the usual views", () => {
    assert.strictEqual(paneCountOf(defaultViewLayout.kind), 1)
    assert.deepStrictEqual(defaultViewLayout.projections, ["perspective", "top", "front", "right"])
  })

  it("knows the default whatever it's made of", () => {
    assert.isTrue(isDefaultViewLayout({ ...defaultViewLayout, projections: [...defaultViewLayout.projections] }))
    assert.isFalse(isDefaultViewLayout(layoutOf("quad")))
    assert.isFalse(isDefaultViewLayout(layoutOf("single", 0.4)))
    assert.isFalse(isDefaultViewLayout({ ...defaultViewLayout, projections: ["top", "top", "front", "right"] }))
  })

  it("survives JSON, and refuses what no drag could have made", () => {
    const decode = Schema.decodeUnknownOption(ViewLayout)
    const layout = layoutOf("rows", 0.2, 0.8)
    assert.deepStrictEqual(Option.getOrNull(decode(JSON.parse(JSON.stringify(layout)))), layout)
    assert.strictEqual(decode({ ...layout, kind: "hexagon" })._tag, "None")
    assert.strictEqual(decode({ ...layout, splitX: 0 })._tag, "None")
    assert.strictEqual(decode({ ...layout, projections: ["top"] })._tag, "None")
  })
})

describe("which panes draw", () => {
  const quad = [0, 1, 2, 3]

  it("draws the active pane every frame, whoever's turn it is", () => {
    let turns = firstPaneTurns
    for (let now = 0; now < 1000; now += 16) {
      const plan = panesToDraw(quad, 2, now, turns, false)
      assert.strictEqual(plan.slots[0], 2)
      turns = plan.turns
    }
  })

  it("adds at most one other pane a frame, and no more often than the interval", () => {
    let turns = firstPaneTurns
    let last = -Infinity
    for (let now = 0; now < 2000; now += 16) {
      const plan = panesToDraw(quad, 0, now, turns, false)
      turns = plan.turns
      assert.isAtMost(plan.slots.length, 2)
      if (plan.slots.length === 2) {
        assert.isAtLeast(now - last, IDLE_PANE_INTERVAL_MS)
        last = now
      }
    }
  })

  it("gives every other pane a turn", () => {
    let turns = firstPaneTurns
    const drawn: Array<number> = []
    for (let now = 0; drawn.length < 6; now += IDLE_PANE_INTERVAL_MS) {
      const plan = panesToDraw(quad, 1, now, turns, false)
      turns = plan.turns
      drawn.push(...plan.slots.slice(1))
    }
    assert.deepStrictEqual(drawn, [0, 2, 3, 0, 2, 3])
  })

  it("draws them all when their pixels are gone", () => {
    assert.deepStrictEqual(panesToDraw(quad, 3, 0, firstPaneTurns, true).slots, quad)
  })

  it("has nobody else to draw in a single pane", () => {
    assert.deepStrictEqual(panesToDraw([0], 0, 1000, firstPaneTurns, false).slots, [0])
  })
})

describe("splitting and closing panes", () => {
  const views: ViewLayout["projections"] = ["perspective", "top", "front", "right"]
  const layoutShowing = (kind: ViewLayoutKind): ViewLayout => ({ ...defaultViewLayout, kind, projections: views })

  it("splits one pane either way", () => {
    assert.strictEqual(paneSplitRight("single")?.kind, "columns")
    assert.strictEqual(paneSplitDown("single")?.kind, "rows")
  })

  it("makes four of two panes across their line, and nothing along it", () => {
    assert.strictEqual(paneSplitDown("columns")?.kind, "quad")
    assert.strictEqual(paneSplitRight("rows")?.kind, "quad")
    assert.strictEqual(paneSplitRight("columns"), undefined)
    assert.strictEqual(paneSplitDown("rows"), undefined)
    assert.strictEqual(paneSplitRight("quad"), undefined)
    assert.strictEqual(paneSplitDown("quad"), undefined)
  })

  it("leaves a stacked lower pane where it is when it becomes one of four", () => {
    const change = paneSplitRight("rows")
    assert.isDefined(change)
    const { projections } = withPaneChange(layoutShowing("rows"), change)
    assert.strictEqual(projections[0], "perspective")
    assert.strictEqual(projections[2], "top") // the lower left, under the pane it was under
  })

  it("keeps the other of two panes", () => {
    const closing = (slot: number) => withPaneChange(layoutShowing("columns"), paneClose(slot))
    assert.strictEqual(closing(1).kind, "single")
    assert.strictEqual(closing(1).projections[0], "perspective")
    assert.strictEqual(closing(0).projections[0], "top")
  })

  it("keeps the other row of four, side by side", () => {
    const closing = (slot: number) => withPaneChange(layoutShowing("quad"), paneCloseRow(slot))
    assert.strictEqual(closing(3).kind, "columns")
    assert.deepStrictEqual(closing(3).projections.slice(0, 2), ["perspective", "top"])
    assert.deepStrictEqual(closing(1).projections.slice(0, 2), ["front", "right"])
  })

  it("keeps the other column of four, stacked", () => {
    const closing = (slot: number) => withPaneChange(layoutShowing("quad"), paneCloseColumn(slot))
    assert.strictEqual(closing(1).kind, "rows")
    assert.deepStrictEqual(closing(1).projections.slice(0, 2), ["perspective", "front"])
    assert.deepStrictEqual(closing(2).projections.slice(0, 2), ["top", "right"])
  })

  it("loses no view, so a hidden pane comes back with what it had", () => {
    for (const change of [paneClose(0), paneCloseRow(0), paneCloseColumn(0), paneCloseColumn(1)]) {
      assert.sameMembers([...withPaneChange(layoutShowing("quad"), change).projections], [...views])
    }
  })
})

describe("swapping panes", () => {
  const quad = layoutOf("quad", 0.3, 0.7)

  it("trades the two panes' views and leaves the rest where they are", () => {
    const { kind, projections, splitX, splitY } = withPaneChange(quad, paneSwap("quad", 0, 3))
    assert.deepStrictEqual(projections, ["right", "top", "front", "perspective"])
    assert.deepStrictEqual([kind, splitX, splitY], ["quad", 0.3, 0.7])
  })

  it("takes the panes' overrides along", () => {
    const hidden = withPaneDisplay(quad, 0, { grid: true, sky: true }, "grid", false)
    const swapped = withPaneChange(hidden, paneSwap("quad", 0, 2))
    assert.deepStrictEqual(swapped.overrides, [{}, {}, { grid: false }, {}])
  })

  it("undoes itself", () => {
    const change = paneSwap("columns", 1, 0)
    assert.deepStrictEqual(withPaneChange(withPaneChange(layoutOf("columns"), change), change), layoutOf("columns"))
  })
})

describe("a maximised pane", () => {
  const quad = layoutOf("quad", 0.3, 0.7)
  const maximised = withMaximisedToggled(quad, 2)

  it("fills the viewport, in its own slot", () => {
    assert.deepStrictEqual(paneRects(maximised, 800, 600), [{ slot: 2, x: 0, y: 0, width: 800, height: 600 }])
    assert.deepStrictEqual(paneShares(maximised), [{ slot: 2, x: 0, y: 0, width: 1, height: 1 }])
    assert.strictEqual(shownKindOf(maximised), "single")
    assert.strictEqual(maximised.kind, "quad")
  })

  it("goes back to the layout it left, dividers and all", () => {
    assert.deepStrictEqual(withMaximisedToggled(maximised, 2), quad)
    assert.deepStrictEqual(withMaximisedToggled(maximised, 0), quad)
  })

  it("has nothing to fill in one pane", () => {
    const single = layoutOf("single")
    assert.strictEqual(withMaximisedToggled(single, 0), single)
  })

  it("ends with any change to the panes", () => {
    assert.isUndefined(withPaneChange(maximised, paneCloseRow(0)).maximised)
    assert.isUndefined(withoutMaximised(maximised).maximised)
  })

  it("doesn't count in a layout without that slot", () => {
    const stale = { ...layoutOf("columns"), maximised: 3 as const }
    assert.isUndefined(maximisedSlotOf(stale))
    assert.strictEqual(paneRects(stale, 100, 100).length, 2)
  })
})

describe("what a pane shows", () => {
  const quad = layoutOf("quad")
  const everything = { grid: true, sky: true }
  const nothing = { grid: false, sky: false }

  it("follows the Display popover, but an orthographic pane has no sky unasked", () => {
    assert.deepStrictEqual(paneDisplayOf(quad, 0, everything), everything)
    assert.deepStrictEqual(paneDisplayOf(quad, 1, everything), { grid: true, sky: false })
    assert.deepStrictEqual(paneDisplayOf(quad, 0, nothing), nothing)
  })

  it("lets a pane's override win, either way, and only for that pane", () => {
    const off = withPaneDisplay(quad, 0, everything, "grid", false)
    assert.deepStrictEqual(paneDisplayOf(off, 0, everything), { grid: false, sky: true })
    assert.isTrue(paneDisplayOf(off, 2, everything).grid)
    const on = withPaneDisplay(quad, 1, everything, "sky", true)
    assert.isTrue(paneDisplayOf(on, 1, nothing).sky)
    assert.isFalse(paneDisplayOf(on, 3, nothing).sky)
  })

  it("keeps an override when the Display popover changes", () => {
    const off = withPaneDisplay(quad, 0, everything, "grid", false)
    assert.isFalse(paneDisplayOf(off, 0, everything).grid)
    assert.isFalse(paneDisplayOf(off, 0, nothing).grid)
  })

  it("goes back to following once it's set to what it would show anyway", () => {
    const off = withPaneDisplay(quad, 0, everything, "grid", false)
    const back = withPaneDisplay(off, 0, everything, "grid", true)
    assert.notProperty(back, "overrides")
    assert.deepStrictEqual(back, quad)
  })

  it("keeps the pane's other override when one is dropped", () => {
    const both = withPaneDisplay(withPaneDisplay(quad, 0, everything, "grid", false), 0, everything, "sky", false)
    assert.deepStrictEqual(withPaneDisplay(both, 0, everything, "grid", true).overrides?.[0], { sky: false })
  })
})

describe("a stored layout", () => {
  const roundTrip = (layout: ViewLayout) => Schema.decodeSync(ViewLayout)(Schema.encodeSync(ViewLayout)(layout))

  it("keeps its dividers, overrides and maximised pane", () => {
    const shown = withPaneDisplay(layoutOf("quad", 0.3, 0.7), 1, { grid: true, sky: true }, "sky", true)
    const layout = withMaximisedToggled(shown, 3)
    assert.deepStrictEqual(roundTrip(layout), layout)
  })

  it("from before overrides and maximising still decodes", () => {
    const { kind, splitX, splitY, projections } = layoutOf("rows")
    assert.deepStrictEqual(
      Schema.decodeSync(ViewLayout)({ kind, splitX, splitY, projections }),
      layoutOf("rows")
    )
  })

  it("with anything set isn't the default", () => {
    assert.isFalse(isDefaultViewLayout(withPaneDisplay(defaultViewLayout, 0, { grid: true, sky: true }, "grid", false)))
    assert.isFalse(isDefaultViewLayout({ ...defaultViewLayout, maximised: 0 }))
  })
})
