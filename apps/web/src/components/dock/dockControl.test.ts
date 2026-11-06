import { assert, beforeEach, describe, it, vi } from "@effect/vitest"
import type { DockviewApi } from "dockview-react"
import { DOCK_STORAGE_KEY, type DockLayout, DOCUMENTS_PANEL } from "../../domain/dockLayout"
import { attachDock, expandGroup, resetDockLayout, togglePanel } from "./dockControl"
import type { DockPanel } from "./panels"

const panel = (id: string, location: DockPanel["location"], rest: Partial<DockPanel> = {}): DockPanel => ({
  id,
  title: id,
  location,
  component: () => null,
  ...rest
})
const panels = [
  panel("project", "left"),
  panel("pieces", "left", { renderer: "always" }),
  panel("inspector", "right")
]

const quiet = () => ({ dispose: () => undefined })

interface MoveEvent {
  readonly panel: unknown
  readonly from: unknown
}
type MoveListener = (event: MoveEvent) => void

interface OverlayEvent {
  readonly group: unknown
  readonly position: string
  readonly preventDefault: () => void
}
type OverlayListener = (event: OverlayEvent) => void

/** Enough of a dock to follow: panels in groups, with what was asked of it in `calls`. */
const fakeDock = ({ failLoad = false, loaded = [DOCUMENTS_PANEL] as ReadonlyArray<string> } = {}) => {
  const calls: Array<string> = []
  const loads: Array<DockLayout> = []
  let overlay: OverlayListener = () => undefined
  let moved: MoveListener = () => undefined
  const open = new Map<string, ReturnType<typeof fakePanel>>()
  const group = {
    id: "1",
    width: 800,
    height: 600,
    get panels() {
      return [...open.values()]
    },
    get activePanel() {
      return [...open.values()].at(-1)
    },
    element: {
      dataset: {},
      closest: () => undefined,
      getBoundingClientRect: () => ({ left: 0, right: 800, bottom: 600 })
    },
    api: {
      onDidActivePanelChange: quiet,
      setActive: () => calls.push("group active"),
      setSize: () => undefined,
      setConstraints: () => undefined,
      setHeaderPosition: () => undefined
    }
  }
  const fakePanel = (id: string) => ({
    id,
    group,
    api: {
      location: { type: "grid" },
      getWindow: () => ({ focus: () => calls.push(`focus ${id}`) }),
      setActive: () => calls.push(`active ${id}`),
      close: () => {
        calls.push(`close ${id}`)
        open.delete(id)
      }
    }
  })
  for (const id of loaded) open.set(id, fakePanel(id))
  const api = {
    width: 1280,
    height: 720,
    get panels() {
      return [...open.values()]
    },
    get groups() {
      return [group]
    },
    getPanel: (id: string) => open.get(id),
    addPanel: ({ id, position }: { readonly id: string; readonly position?: { readonly direction?: string } }) => {
      calls.push(position?.direction === undefined ? `add ${id}` : `add ${id} ${position.direction}`)
      const added = fakePanel(id)
      open.set(id, added)
      return added
    },
    removePanel: ({ id }: { readonly id: string }) => {
      calls.push(`remove ${id}`)
      open.delete(id)
    },
    clear: () => {
      calls.push("clear")
      open.clear()
    },
    fromJSON: (layout: DockLayout) => {
      calls.push("fromJSON")
      loads.push(layout)
      if (failLoad) throw new Error("no such component")
    },
    toJSON: () => ({ grid: { root: { type: "branch", data: [], size: 0 } } }),
    onDidLayoutChange: quiet,
    onDidAddPanel: quiet,
    onDidRemovePanel: quiet,
    onDidMovePanel: (listener: MoveListener) => {
      moved = listener
      return quiet()
    },
    onDidRemoveGroup: quiet,
    onDidActivePanelChange: quiet,
    onDidAddPopoutGroup: quiet,
    onDidRemovePopoutGroup: quiet,
    onDidOpenPopoutWindowFail: quiet,
    onWillDragGroup: quiet,
    onWillShowOverlay: (listener: OverlayListener) => {
      overlay = listener
      return quiet()
    }
  }
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the part of the API the dock uses
    api: api as unknown as DockviewApi,
    calls,
    loads,
    overlay: (event: OverlayEvent) => overlay(event),
    move: (event: MoveEvent) => moved(event)
  }
}

const savedLayout = {
  grid: { root: { type: "branch", data: [], size: 600 }, orientation: "HORIZONTAL", width: 1280, height: 720 },
  panels: {}
}
const saved = (known: ReadonlyArray<string>, collapsed = {}) =>
  JSON.stringify({ layout: savedLayout, known, hint: { left: 0, right: 0, bottom: 0 }, collapsed })

describe("the dock's layout on launch", () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: () => undefined })
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  it("starts on the default layout: the panels around the centre", () => {
    const { api, calls } = fakeDock({ loaded: [] })
    attachDock(api, panels)
    assert.deepStrictEqual(calls.filter((call) => call.startsWith("add") || call === "fromJSON"), [
      `add ${DOCUMENTS_PANEL}`,
      "add project left",
      "add pieces",
      "add inspector right"
    ])
  })

  it("restores a saved layout, and a panel the user closed stays closed", () => {
    storage.set(DOCK_STORAGE_KEY, saved(panels.map(({ id }) => id)))
    const { api, calls } = fakeDock()
    attachDock(api, panels)
    assert.deepStrictEqual(calls, ["fromJSON"])
  })

  it("gives a panel added since the layout was saved its place", () => {
    storage.set(DOCK_STORAGE_KEY, saved(["project", "pieces"]))
    const { api, calls } = fakeDock()
    attachDock(api, panels)
    assert.deepStrictEqual(calls, ["fromJSON", "add inspector right"])
  })

  it("loads a layout saved with a panel the app no longer has, without it", () => {
    const leaf = (id: string, views: ReadonlyArray<string>, size: number) => ({
      type: "leaf",
      data: { id, views, activeView: views.at(-1) },
      size
    })
    const layout = {
      ...savedLayout,
      grid: {
        ...savedLayout.grid,
        root: {
          ...savedLayout.grid.root,
          data: [leaf("1", ["project"], 260), leaf("2", [DOCUMENTS_PANEL, "settings"], 1020)]
        }
      },
      panels: { project: {}, [DOCUMENTS_PANEL]: {}, settings: {} }
    }
    storage.set(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        layout,
        known: [...panels.map(({ id }) => id), "settings"],
        hint: { left: 0, right: 0, bottom: 0 },
        collapsed: {}
      })
    )
    const { api, calls, loads } = fakeDock()
    attachDock(api, panels)
    assert.deepStrictEqual(calls, ["fromJSON"])
    const [loaded] = loads
    assert.notProperty(loaded?.panels, "settings")
    assert.deepStrictEqual(loaded?.grid.root.data[1], {
      type: "leaf",
      data: { id: "2", views: [DOCUMENTS_PANEL] },
      size: 1020
    })
  })

  it("folds a column saved as a rail again, and a click on a tab undoes it", () => {
    storage.set(DOCK_STORAGE_KEY, saved(["project"], { "1": { axis: "width", size: 260 } }))
    const { api } = fakeDock()
    attachDock(api, panels)
    const [group] = api.groups
    assert.strictEqual(group?.element.dataset["dockRail"], "")
    if (group !== undefined) expandGroup(group)
    assert.isUndefined(group?.element.dataset["dockRail"])
  })

  it("falls back to the default when dockview refuses the layout", () => {
    storage.set(DOCK_STORAGE_KEY, saved(panels.map(({ id }) => id)))
    const { api, calls } = fakeDock({ failLoad: true, loaded: [] })
    attachDock(api, panels)
    assert.deepStrictEqual(calls.slice(0, 3), ["fromJSON", "clear", `add ${DOCUMENTS_PANEL}`])
  })

  it("falls back to the default when the saved layout has no centre", () => {
    storage.set(DOCK_STORAGE_KEY, saved(panels.map(({ id }) => id)))
    const { api, calls } = fakeDock({ loaded: [] })
    attachDock(api, panels)
    assert.deepStrictEqual(calls.slice(0, 3), ["fromJSON", "clear", `add ${DOCUMENTS_PANEL}`])
  })

  it("falls back to the default when what's saved can't be read", () => {
    storage.set(DOCK_STORAGE_KEY, "{nope")
    const { api, calls } = fakeDock({ loaded: [] })
    attachDock(api, panels)
    assert.notInclude(calls, "fromJSON")
    assert.include(calls, "add inspector right")
  })
})

describe("the dock's panels", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined })
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      focus: () => undefined
    })
  })

  const dock = () => {
    const made = fakeDock({ loaded: [] })
    attachDock(made.api, panels)
    made.calls.length = 0
    return made
  }

  it("closes an open panel from the View menu, and reopens it with its side", () => {
    const { calls } = dock()
    togglePanel("inspector")
    assert.deepStrictEqual(calls, ["close inspector"])
    calls.length = 0
    togglePanel("inspector")
    assert.deepStrictEqual(calls.slice(0, 1), ["add inspector right"])
  })

  it("takes a panel on the centre's sides, never as a tab", () => {
    const made = fakeDock({ loaded: [DOCUMENTS_PANEL] })
    attachDock(made.api, panels)
    const refused = (position: string) => {
      let prevented = false
      made.overlay({ group: made.api.groups[0], position, preventDefault: () => prevented = true })
      return prevented
    }
    assert.isTrue(refused("center"))
    assert.isFalse(refused("left"))
  })

  it("takes down the overlay a panel leaves in the window it went from, and only then", () => {
    const { calls, move } = dock()
    const container = (name: string) => ({ detatch: () => calls.push(`detatch from ${name}`) })
    const main = { model: { renderContainer: container("main") } }
    const popout = { id: "2", size: 2, model: { renderContainer: container("popout") } }
    move({ panel: { group: popout }, from: main })
    assert.deepStrictEqual(calls, ["detatch from main"])
    calls.length = 0
    move({ panel: { group: popout }, from: popout })
    assert.deepStrictEqual(calls, [])
  })

  it("resets around the centre: the viewport's panel is never touched", () => {
    const { calls } = dock()
    resetDockLayout()
    assert.notInclude(calls, `remove ${DOCUMENTS_PANEL}`)
    assert.notInclude(calls, "clear")
    assert.includeMembers(calls, ["remove project", "remove pieces", "remove inspector", "add inspector right"])
  })
})
