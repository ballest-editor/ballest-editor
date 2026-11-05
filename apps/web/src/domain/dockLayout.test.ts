import { assert, describe, it } from "@effect/vitest"
import {
  axisBesideCentre,
  collapseAxis,
  dockedPopouts,
  type DockLayout,
  DOCUMENTS_PANEL,
  fitToWindow,
  newPanels,
  onlyPanels,
  parseSavedDock,
  unfoldedLayout
} from "./dockLayout"

const leaf = (id: string, views: ReadonlyArray<string>, size: number, visible?: boolean) => ({
  type: "leaf" as const,
  data: { id, views },
  size,
  ...(visible !== undefined && { visible })
})
type Branch = DockLayout["grid"]["root"]
const branch = (data: Branch["data"], size: number): Branch => ({ type: "branch", data, size })

/** Pieces | (the centre over Output) | Inspector, in a 1000 × 600 window. */
const layout: DockLayout = {
  grid: {
    root: branch([
      leaf("1", ["pieces", "project"], 200),
      branch([leaf("2", [DOCUMENTS_PANEL], 450), leaf("3", ["output"], 150)], 500),
      leaf("4", ["inspector"], 300)
    ], 600),
    orientation: "HORIZONTAL",
    width: 1000,
    height: 600
  },
  panels: { pieces: {}, project: {}, [DOCUMENTS_PANEL]: {}, output: {}, inspector: {} }
}
const saved = (overrides: object = {}) =>
  JSON.stringify({ layout, known: [], hint: { left: 1, right: 2, bottom: 3 }, collapsed: {}, ...overrides })

const sizesOf = (root: DockLayout["grid"]["root"]): unknown =>
  root.data.map((node) => node.type === "leaf" ? node.size : [node.size, sizesOf(node)])

describe("parseSavedDock", () => {
  it("reads a saved dock and keeps the layout whole for fromJSON", () => {
    const withExtras = { ...layout, activeGroup: "2", somethingNew: true }
    const parsed = parseSavedDock(saved({ layout: withExtras, known: ["pieces"] }))
    assert.deepStrictEqual(parsed?.layout, withExtras)
    assert.deepStrictEqual(parsed?.known, ["pieces"])
  })

  it("takes what can't be read for no saved dock", () => {
    assert.isNull(parseSavedDock(null))
    assert.isNull(parseSavedDock("{nope"))
    assert.isNull(parseSavedDock(saved({ known: "pieces" })))
    assert.isNull(parseSavedDock(saved({ layout: { grid: {}, panels: {} } })))
    assert.isNull(parseSavedDock(saved({ layout: { grid: layout.grid } })))
  })

  it("takes a layout with a size that went NaN for no saved dock", () => {
    const grid = { ...layout.grid, root: branch([leaf("1", ["pieces"], Number.NaN)], 600) }
    assert.isNull(parseSavedDock(saved({ layout: { ...layout, grid } })))
  })
})

describe("newPanels", () => {
  const panels = [
    { id: "pieces", title: "Pieces", location: "left" },
    { id: "outline", title: "Outline", location: "left" }
  ] as const

  it("adds a panel the saved layout has never heard of", () => {
    assert.deepStrictEqual(newPanels(panels, ["pieces"]).map(({ id }) => id), ["outline"])
  })

  it("leaves a panel the user closed closed: it's known, and just not in the layout", () => {
    assert.deepStrictEqual(newPanels(panels, ["pieces", "outline"]), [])
  })
})

describe("collapseAxis", () => {
  const none = new Set<string>()

  it("folds a column by its width and a group in a stack by its height", () => {
    assert.strictEqual(collapseAxis(layout.grid, "1", none), "width")
    assert.strictEqual(collapseAxis(layout.grid, "3", none), "height")
  })

  it("leaves a group whose neighbours are folded already, or that isn't in the grid", () => {
    const stack = { ...layout.grid, root: branch([leaf("5", ["a"], 300), leaf("6", ["b"], 300)], 200) }
    const vertical = { ...stack, orientation: "VERTICAL" as const }
    assert.strictEqual(collapseAxis(vertical, "5", none), "height")
    assert.isNull(collapseAxis(vertical, "5", new Set(["6"])))
    assert.isNull(collapseAxis(layout.grid, "gone", none))
  })
})

describe("axisBesideCentre", () => {
  it("is the way a group lies against the centre group", () => {
    assert.strictEqual(axisBesideCentre(layout.grid, "3"), "height")
    const side = { ...layout.grid, root: branch([leaf("2", [DOCUMENTS_PANEL], 700), leaf("4", ["x"], 300)], 600) }
    assert.strictEqual(axisBesideCentre(side, "4"), "width")
  })

  it("is nothing for a group that isn't directly beside it", () => {
    assert.isNull(axisBesideCentre(layout.grid, "4"))
    assert.isNull(axisBesideCentre(layout.grid, "gone"))
  })
})

describe("fitToWindow", () => {
  it("puts a change of window size on the viewport, not the panels", () => {
    const { grid } = fitToWindow(layout, 1200, 700)
    assert.deepStrictEqual(sizesOf(grid.root), [200, [700, [550, 150]], 300])
    assert.strictEqual(grid.width, 1200)
    assert.strictEqual(grid.height, 700)
  })

  it("leaves the layout alone at no size", () => {
    assert.strictEqual(fitToWindow(layout, 0, 0), layout)
  })
})

describe("dockedPopouts", () => {
  it("puts a panel back in the hidden group it left, taking its room back", () => {
    const left: DockLayout = {
      ...layout,
      grid: {
        ...layout.grid,
        root: branch([leaf("1", ["pieces"], 200), leaf("2", [DOCUMENTS_PANEL], 800), leaf("4", [], 300, false)], 600)
      },
      popoutGroups: [{ gridReferenceGroup: "4", data: { views: ["inspector"], activeView: "inspector" } }]
    }
    const { layout: docked, loose } = dockedPopouts(left)
    assert.deepStrictEqual(loose, [])
    assert.isUndefined(docked.popoutGroups)
    assert.deepStrictEqual(sizesOf(docked.grid.root), [200, 500, 300])
    const group = docked.grid.root.data[2]
    assert.deepStrictEqual(group, {
      type: "leaf",
      data: { id: "4", views: ["inspector"], activeView: "inspector" },
      size: 300
    })
  })

  it("adds a panel to the tabs it left, deep in the grid", () => {
    const left = { ...layout, popoutGroups: [{ gridReferenceGroup: "3", data: { views: ["notes"] } }] }
    const { layout: docked } = dockedPopouts(left)
    const column = docked.grid.root.data[1]
    assert.deepStrictEqual(
      column?.type === "branch" ? column.data[1] : null,
      { type: "leaf", data: { id: "3", views: ["output", "notes"] }, size: 150 }
    )
    assert.deepStrictEqual(sizesOf(docked.grid.root), sizesOf(layout.grid.root))
  })

  it("hands back a panel whose group is gone", () => {
    const left = {
      ...layout,
      panels: { ...layout.panels, lost: {} },
      popoutGroups: [{ gridReferenceGroup: "gone", data: { views: ["lost"] } }]
    }
    const { layout: docked, loose } = dockedPopouts(left)
    assert.deepStrictEqual(loose, ["lost"])
    assert.notProperty(docked.panels, "lost")
  })

  it("has nothing to do without popouts", () => {
    assert.deepStrictEqual(dockedPopouts(layout), { layout, loose: [] })
  })
})

describe("onlyPanels", () => {
  const current = [DOCUMENTS_PANEL, "pieces", "project", "output", "inspector"]
  const withGrid = (root: Branch): DockLayout => ({
    ...layout,
    grid: { ...layout.grid, root },
    panels: { ...layout.panels, settings: {} }
  })

  it("leaves a layout of current panels as it was", () => {
    assert.deepStrictEqual(onlyPanels(layout, current), layout)
  })

  it("drops a panel from the group it shared, and the map comes to the front", () => {
    const centre = {
      ...leaf("2", [DOCUMENTS_PANEL, "settings"], 800),
      data: { id: "2", views: [DOCUMENTS_PANEL, "settings"], activeView: "settings" }
    }
    const { grid, panels } = onlyPanels(withGrid(branch([leaf("1", ["pieces"], 200), centre], 600)), current)
    assert.deepStrictEqual(grid.root.data[1], leaf("2", [DOCUMENTS_PANEL], 800))
    assert.notProperty(panels, "settings")
  })

  it("keeps the active panel of a group when it's another that goes", () => {
    const tabs = {
      ...leaf("1", ["pieces", "settings"], 200),
      data: { id: "1", views: ["pieces", "settings"], activeView: "pieces" }
    }
    const { grid } = onlyPanels(withGrid(branch([tabs, leaf("2", [DOCUMENTS_PANEL], 800)], 600)), current)
    assert.deepStrictEqual(grid.root.data[0], { ...tabs, data: { id: "1", views: ["pieces"], activeView: "pieces" } })
  })

  it("gives a group left empty's room to the viewport", () => {
    const root = branch(
      [leaf("1", ["pieces"], 200), leaf("2", [DOCUMENTS_PANEL], 500), leaf("5", ["settings"], 300)],
      600
    )
    assert.deepStrictEqual(sizesOf(onlyPanels(withGrid(root), current).grid.root), [200, 800])
  })

  it("gives it to the largest neighbour in a stack away from the viewport", () => {
    const stack = branch([leaf("4", ["inspector"], 400), leaf("5", ["settings"], 100), leaf("6", ["output"], 100)], 300)
    const root = branch([leaf("2", [DOCUMENTS_PANEL], 700), stack], 600)
    assert.deepStrictEqual(sizesOf(onlyPanels(withGrid(root), current).grid.root), [700, [300, [500, 100]]])
  })

  it("takes a branch of one out of the grid, as dockview would", () => {
    const column = branch([leaf("2", [DOCUMENTS_PANEL], 450), leaf("5", ["settings"], 150)], 800)
    const root = branch([leaf("1", ["pieces"], 200), column], 600)
    const { grid } = onlyPanels(withGrid(root), current)
    assert.deepStrictEqual(grid.root.data[1], leaf("2", [DOCUMENTS_PANEL], 800))
  })

  it("lifts what's left of a branch into the one around it", () => {
    const row = branch([leaf("2", [DOCUMENTS_PANEL], 500), leaf("4", ["inspector"], 300)], 450)
    const column = branch([row, leaf("5", ["settings"], 150)], 800)
    const { grid } = onlyPanels(withGrid(branch([leaf("1", ["pieces"], 200), column], 600)), current)
    assert.deepStrictEqual(sizesOf(grid.root), [200, 500, 300])
  })

  it("goes down a branch left with nothing", () => {
    const column = branch([leaf("5", ["settings"], 300), leaf("6", ["notes"], 300)], 300)
    const { grid } = onlyPanels(withGrid(branch([leaf("2", [DOCUMENTS_PANEL], 700), column], 600)), current)
    assert.deepStrictEqual(sizesOf(grid.root), [1000])
  })

  it("leaves a hidden empty group to whoever put it there", () => {
    const root = branch([leaf("2", [DOCUMENTS_PANEL], 700), leaf("4", [], 300, false)], 600)
    assert.deepStrictEqual(onlyPanels(withGrid(root), current).grid.root, root)
  })
})

describe("unfoldedLayout", () => {
  it("loads a folded group whole, taking the room from its largest neighbour", () => {
    const folded: DockLayout = {
      ...layout,
      grid: {
        ...layout.grid,
        root: branch([
          { ...leaf("1", ["pieces"], 32), data: { id: "1", views: ["pieces"], headerPosition: "left" } },
          leaf("2", [DOCUMENTS_PANEL], 668),
          leaf("4", ["inspector"], 300)
        ], 600)
      }
    }
    const { grid } = unfoldedLayout(folded, { "1": { axis: "width", size: 260 } })
    assert.deepStrictEqual(sizesOf(grid.root), [260, 440, 300])
    assert.deepStrictEqual(grid.root.data[0], leaf("1", ["pieces"], 260))
  })

  it("finds a folded group in a stack", () => {
    const { grid } = unfoldedLayout(layout, { "3": { axis: "height", size: 240 } })
    assert.deepStrictEqual(sizesOf(grid.root), [200, [500, [360, 240]], 300])
  })
})
