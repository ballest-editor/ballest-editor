import { assert, describe, it } from "@effect/vitest"
import { defaultSettings } from "../domain/Settings"
import { defaultViewLayout } from "../domain/viewLayout"
import { PREFAB_TAB_STAYS_HERE } from "../editor/store"
import { BROWSER, DESKTOP } from "../test/capabilities"
import { menuEntries, type MenuEntry, menusOf, type MenuState, searchMenus } from "./menuModel"

const state = (over: Partial<MenuState> = {}): MenuState => ({
  capabilities: DESKTOP,
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  canGroup: false,
  canChain: false,
  canUngroup: false,
  canPaste: false,
  canSelectAll: true,
  prefabProblem: undefined,
  saveOff: null,
  exportOff: null,
  noTabOff: null,
  untitled: false,
  reimportable: null,
  openedInGame: false,
  recent: [],
  openElsewhere: [],
  panels: [{ id: "outline", title: "Outline", open: true }],
  snapping: defaultSettings.snapping,
  undoDescription: undefined,
  redoDescription: undefined,
  selectionCount: 0,
  measurements: 0,
  units: "cm",
  layout: defaultViewLayout,
  projection: "perspective",
  update: null,
  ...over
})

const entries = (over?: Partial<MenuState>) => menuEntries(menusOf(state(over)))
const crumbs = (found: ReadonlyArray<MenuEntry>) => found.map(({ label, path }) => [...path, label].join(" › "))
const find = (query: string, over?: Partial<MenuState>) => crumbs(searchMenus(entries(over), query))

describe("searching the menus", () => {
  it("finds a row in any menu, those that can run first", () => {
    assert.deepStrictEqual(find("dup"), ["Project › Duplicate map…", "Edit › Duplicate"])
  })

  it("keeps menu order among rows that can all run", () => {
    assert.deepStrictEqual(find("dup", { hasSelection: true }), ["Edit › Duplicate", "Project › Duplicate map…"])
  })

  it("ignores case and takes the words in any order", () => {
    assert.deepStrictEqual(find("MAP new"), ["File › New map", "Project › New map"])
  })

  it("puts a label's matches above a path's", () => {
    const [first, ...rest] = find("project")
    assert.strictEqual(first, "Project › Project settings…")
    assert.isAbove(rest.indexOf("Project › Play"), rest.indexOf("File › New project…"))
  })

  it("reaches into sections and submenus", () => {
    assert.deepStrictEqual(find("outline"), ["View › Panels › Outline"])
    assert.include(find("active top"), "View › Panes › Active pane › Top")
    assert.include(find("snapping"), "View › Snap › Snapping")
  })

  it("finds nothing for what's in no menu", () => {
    assert.deepStrictEqual(find("xyzq"), [])
  })

  it("carries a row's reason, shortcut and state", () => {
    const duplicate = searchMenus(entries(), "duplicate").find(({ path }) => path[0] === "Edit")
    assert.strictEqual(duplicate?.reason, "Select something first.")
    assert.strictEqual(duplicate?.shortcut, "duplicateSelection")
    assert.strictEqual(searchMenus(entries(), "outline")[0]?.checked, true)
    const perspective = searchMenus(entries(), "perspective")[0]
    assert.strictEqual(perspective?.checked, true)
    assert.strictEqual(perspective?.shortcut, "toggleOrthographic")
  })
})

describe("View › Snap", () => {
  const snapRows = (over?: Partial<MenuState>) =>
    entries(over).filter(({ path }) => path.join(" › ") === "View › Snap" && path.length === 2)
  const checks = (over?: Partial<MenuState>) =>
    snapRows(over).flatMap(({ label, checked }) => checked === undefined ? [] : [[label, checked] as const])

  it("turns snapping as a whole on with its keybind, and leaves the rest to the snap menu", () => {
    const snapping = { ...defaultSettings.snapping, enabled: true }
    assert.deepStrictEqual(checks({ snapping }), [["Snapping", true]])
    assert.deepStrictEqual(snapRows().map(({ label }) => label), ["Snapping"])
    assert.strictEqual(snapRows().find(({ label }) => label === "Snapping")?.shortcut, "snapToggle")
  })
})

describe("the menus", () => {
  it("say what's in a browser, which has no project and no updater", () => {
    const rows = crumbs(entries({ capabilities: BROWSER }))
    assert.include(rows, "File › Export…")
    assert.notInclude(rows, "File › Quit")
    assert.notInclude(rows, "Project › Duplicate map…")
    assert.notInclude(rows, "Help › Check for updates")
  })

  it("list Recent projects' title, saying why, when it has no rows", () => {
    const [recent] = searchMenus(entries(), "recent projects")
    assert.deepStrictEqual(recent?.path, ["File"])
    assert.strictEqual(recent?.reason, "No recent projects yet.")
  })

  it("list a recent project under its submenu", () => {
    const project = { path: "/projects/Canyon", name: "Canyon", exists: true, lastOpened: null }
    assert.deepStrictEqual(find("canyon", { recent: [project] }), ["File › Recent projects › Canyon"])
  })

  it("turn off what a definition's tab can't do", () => {
    const off = (label: string) =>
      entries({ exportOff: PREFAB_TAB_STAYS_HERE }).find((entry) =>
        entry.label === label && entry.path[0] === "Project"
      )?.reason
    assert.isNotNull(off("Duplicate map…"))
    assert.isNotNull(off("Export to game"))
    assert.isNotNull(off("Play"))
  })

  it("say why Re-import is off, until there's an export", () => {
    const reason = (over: Partial<MenuState>) =>
      entries(over).find(({ label }) => label === "Re-import from game")?.reason
    assert.include(reason({}), "Export this map first")
    assert.isNull(reason({ reimportable: "map.balledit" }))
  })
})
