import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { parseMapPrefs } from "./MapPrefs"
import {
  clampSplit,
  cornerPaneOf,
  defaultViewLayout,
  firstPaneTurns,
  IDLE_PANE_INTERVAL_MS,
  isDefaultViewLayout,
  maximisedSlotOf,
  paneClose,
  paneCloseColumn,
  paneCloseRow,
  paneCountOf,
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
  viewLayoutLabelsOf,
  withMaximisedToggled,
  withoutMaximised,
  withPaneChange,
  withPaneProjection,
  withPaneRolled
} from "./viewLayout"

const layoutOf = (kind: ViewLayoutKind, splitX = 0.5, splitY = 0.5): ViewLayout => ({
  ...defaultViewLayout,
  kind,
  splitX,
  splitY
})

describe("pane rectangles", () => {
  it("gives one rectangle per pane, and together they tile the whole canvas", () => {
    for (const kind of viewLayoutKinds) {
      const rects = paneRects(layoutOf(kind, 0.3, 0.7), 1001, 603)
      assert.strictEqual(rects.length, paneCountOf(kind))
      assert.deepStrictEqual(rects.map((r) => r.slot), rects.map((_, i) => i))
      assert.strictEqual(
        rects.reduce((area, r) => area + r.width * r.height, 0),
        1001 * 603
      )
    }
  })

  it("runs every layout to the canvas's foot, so the tool bar floats over the panes", () => {
    for (const kind of viewLayoutKinds) {
      const lowest = Math.max(...paneRects(layoutOf(kind), 1000, 600).map((r) => r.y + r.height))
      assert.strictEqual(lowest, 600)
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

describe("the pane in the top right", () => {
  const cornerOf = (layout: ViewLayout) => cornerPaneOf(paneShares(layout)).slot

  it("is the one pane, or the upper of two stacked", () => {
    assert.strictEqual(cornerOf(layoutOf("single")), 0)
    assert.strictEqual(cornerOf(layoutOf("rows")), 0)
  })

  it("is the right of the top row", () => {
    assert.strictEqual(cornerOf(layoutOf("columns")), 1)
    assert.strictEqual(cornerOf(layoutOf("quad")), 1)
  })

  it("is a maximised pane, wherever it came from", () => {
    assert.strictEqual(cornerOf(withMaximisedToggled(layoutOf("quad"), 2)), 2)
  })

  it("spans as much of the viewport as the divider leaves it", () => {
    const { x, width } = cornerPaneOf(paneShares(layoutOf("quad", 0.3)))
    assert.deepStrictEqual([x, width], [0.3, 0.7])
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

  it("undoes itself", () => {
    const change = paneSwap("columns", 1, 0)
    assert.deepStrictEqual(withPaneChange(withPaneChange(layoutOf("columns"), change), change), layoutOf("columns"))
  })
})

describe("rolling a pane", () => {
  const quad = layoutOf("quad")

  it("turns an orthographic pane a quarter at a time, either way round", () => {
    assert.deepStrictEqual(withPaneRolled(quad, 1, 1).rolls, [0, 1, 0, 0])
    assert.deepStrictEqual(withPaneRolled(quad, 1, -1).rolls, [0, 3, 0, 0])
    assert.deepStrictEqual(withPaneRolled(withPaneRolled(quad, 2, 1), 2, 1).rolls, [0, 0, 2, 0])
  })

  it("leaves a perspective pane as it is", () => {
    assert.strictEqual(withPaneRolled(quad, 0, 1), quad)
  })

  it("forgets the roll when every pane is upright again, so the layout is the default again", () => {
    const back = withPaneRolled(withPaneRolled(defaultViewLayout, 2, 1), 2, -1)
    assert.notProperty(back, "rolls")
    assert.isTrue(isDefaultViewLayout(back))
    assert.isFalse(isDefaultViewLayout(withPaneRolled(defaultViewLayout, 2, 1)))
  })

  it("stands a pane upright when a view is picked, even the one it's on", () => {
    const rolled = withPaneRolled(withPaneRolled(quad, 1, 1), 2, 1)
    assert.deepStrictEqual(withPaneProjection(rolled, 1, "back").rolls, [0, 0, 1, 0])
    assert.deepStrictEqual(withPaneProjection(rolled, 1, "top").rolls, [0, 0, 1, 0])
    assert.deepStrictEqual(withPaneProjection(rolled, 1, "back").projections, ["perspective", "back", "front", "right"])
    assert.strictEqual(withPaneProjection(quad, 1, "top"), quad)
  })

  it("goes with the view when panes are swapped or closed", () => {
    const rolled = withPaneRolled(quad, 3, 1)
    assert.deepStrictEqual(withPaneChange(rolled, paneSwap("quad", 0, 3)).rolls, [1, 0, 0, 0])
    assert.deepStrictEqual(withPaneChange(rolled, paneCloseRow(0)).rolls, [0, 1, 0, 0])
  })

  it("survives JSON, and a layout saved before rolls still loads upright", () => {
    const decode = Schema.decodeUnknownOption(ViewLayout)
    const rolled = withPaneRolled(quad, 2, -1)
    assert.deepStrictEqual(Option.getOrNull(decode(JSON.parse(JSON.stringify(rolled)))), rolled)
    assert.deepStrictEqual(Option.getOrNull(decode(quad)), quad)
    assert.strictEqual(decode({ ...quad, rolls: [0, 4, 0, 0] })._tag, "None")
  })
})

describe("a maximised pane", () => {
  it("names the layout it goes back to", () => {
    const labels = viewLayoutLabelsOf(withMaximisedToggled({ ...defaultViewLayout, kind: "quad" }, 2))
    assert.strictEqual(labels.quad, "Four panes (maximised)")
    assert.strictEqual(labels.single, "One pane")
    assert.strictEqual(viewLayoutLabelsOf({ ...defaultViewLayout, kind: "quad" }).quad, "Four panes")
  })

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

describe("a stored layout", () => {
  const roundTrip = (layout: ViewLayout) => Schema.decodeSync(ViewLayout)(Schema.encodeSync(ViewLayout)(layout))

  it("keeps its dividers and maximised pane", () => {
    const layout = withMaximisedToggled(layoutOf("quad", 0.3, 0.7), 3)
    assert.deepStrictEqual(roundTrip(layout), layout)
  })

  it("from before maximising still decodes", () => {
    const { kind, splitX, splitY, projections } = layoutOf("rows")
    assert.deepStrictEqual(
      Schema.decodeSync(ViewLayout)({ kind, splitX, splitY, projections }),
      layoutOf("rows")
    )
  })

  it("from when panes had overrides loses them, and the map keeps the rest of its prefs", () => {
    const viewLayout = withMaximisedToggled(layoutOf("quad", 0.3, 0.7), 3)
    const overrides = [{ grid: false }, { sky: true }, {}, {}]
    const stored: unknown = JSON.parse(
      JSON.stringify({ map: { gridHeight: 200, viewLayout: { ...viewLayout, overrides } } })
    )
    assert.deepStrictEqual(parseMapPrefs(stored), { map: { gridHeight: 200, viewLayout } })
  })

  it("with nothing but overrides set is the default once they've gone", () => {
    const overrides = [{ sky: true }, {}, {}, {}]
    const stored: unknown = JSON.parse(JSON.stringify({ map: { viewLayout: { ...defaultViewLayout, overrides } } }))
    const { viewLayout } = parseMapPrefs(stored)["map"] ?? {}
    assert.isTrue(viewLayout !== undefined && isDefaultViewLayout(viewLayout))
  })

  it("with anything set isn't the default", () => {
    assert.isFalse(isDefaultViewLayout({ ...defaultViewLayout, splitX: 0.3 }))
    assert.isFalse(isDefaultViewLayout({ ...defaultViewLayout, maximised: 0 }))
  })
})
