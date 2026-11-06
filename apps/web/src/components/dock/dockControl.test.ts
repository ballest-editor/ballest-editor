import { assert, beforeEach, describe, it, vi } from "@effect/vitest"
import type { DockviewApi } from "dockview-react"
import { DOCK_STORAGE_KEY, type DockLayout, DOCUMENTS_PANEL } from "../../domain/dockLayout"
import { attachDock, closedPanelsIn, expandGroup, resetDockLayout, togglePanel } from "./dockControl"
import type { DockPanel } from "./panels"

const panel = (id: string, location: DockPanel["location"], rest: Partial<DockPanel> = {}): DockPanel => ({
  id,
  title: id,
  icon: () => null,
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

interface OverlayEvent {
  readonly group: unknown
  readonly position: string
  readonly preventDefault: () => void
}
type OverlayListener = (event: OverlayEvent) => void

interface GroupMember {
  readonly id: string
  readonly group: { readonly id: string }
}

/** Enough of a dock to follow: panels in groups (`side` in a second one), with what was asked of it in `calls`. */
const fakeDock = (
  { failLoad = false, loaded = [DOCUMENTS_PANEL] as ReadonlyArray<string>, side = [] as ReadonlyArray<string> } = {}
) => {
  const calls: Array<string> = []
  const loads: Array<DockLayout> = []
  /** The panels added without coming to the front of their group. */
  const behind: Array<string> = []
  let overlay: OverlayListener = () => undefined
  let willMutate: (event: { readonly kind: string }) => void = () => undefined
  let panelAdded: (panel: GroupMember) => void = () => undefined
  let panelRemoved: (panel: GroupMember) => void = () => undefined
  const open = new Map<string, ReturnType<typeof fakePanel>>()
  /** Takes `id` out as dockview does: the layout is about to change, and only then it has. */
  const remove = (id: string) => {
    const leaving = open.get(id)
    if (leaving === undefined) return
    willMutate({ kind: "remove" })
    open.delete(id)
    panelRemoved(leaving)
  }
  const groupNamed = (id: string) => ({
    id,
    width: 800,
    height: 600,
    get panels(): ReadonlyArray<GroupMember> {
      return [...open.values()].filter((member) => member.group.id === id)
    },
    get activePanel(): GroupMember | undefined {
      return this.panels.at(-1)
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
  })
  const group = groupNamed("1")
  const sideGroup = groupNamed("2")
  const fakePanel = (id: string) => ({
    id,
    group: side.includes(id) ? sideGroup : group,
    api: {
      location: { type: "grid" },
      getWindow: () => ({ focus: () => calls.push(`focus ${id}`) }),
      setActive: () => calls.push(`active ${id}`),
      close: () => {
        calls.push(`close ${id}`)
        remove(id)
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
      return side.length === 0 ? [group] : [group, sideGroup]
    },
    getPanel: (id: string) => open.get(id),
    addPanel: ({ id, inactive, position }: {
      readonly id: string
      readonly inactive?: boolean
      readonly position?: { readonly direction?: string; readonly index?: number }
    }) => {
      calls.push(position?.direction === undefined ? `add ${id}` : `add ${id} ${position.direction}`)
      if (inactive === true) behind.push(id)
      const added = fakePanel(id)
      const members = [...open.values()]
      const before = members.filter((member) => member.group === added.group)[position?.index ?? members.length]
      members.splice(before === undefined ? members.length : members.indexOf(before), 0, added)
      open.clear()
      for (const member of members) open.set(member.id, member)
      panelAdded(added)
      return added
    },
    removePanel: ({ id }: { readonly id: string }) => {
      calls.push(`remove ${id}`)
      remove(id)
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
    onWillMutateLayout: (listener: typeof willMutate) => {
      willMutate = listener
      return quiet()
    },
    onDidAddPanel: (listener: typeof panelAdded) => {
      panelAdded = listener
      return quiet()
    },
    onDidRemovePanel: (listener: typeof panelRemoved) => {
      panelRemoved = listener
      return quiet()
    },
    onDidMovePanel: quiet,
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the part of the API the dock uses
  return { api: api as unknown as DockviewApi, behind, calls, loads, overlay: (event: OverlayEvent) => overlay(event) }
}

const savedLayout = {
  grid: { root: { type: "branch", data: [], size: 600 }, orientation: "HORIZONTAL", width: 1280, height: 720 },
  panels: {}
}
const saved = (known: ReadonlyArray<string>, collapsed = {}, slots = {}) =>
  JSON.stringify({ layout: savedLayout, known, hint: { left: 0, right: 0, bottom: 0 }, collapsed, slots })

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

  it("starts with the first panel of a group in front: the rest join behind it", () => {
    const { api, behind } = fakeDock({ loaded: [] })
    attachDock(api, panels)
    assert.deepStrictEqual(behind, ["pieces"])
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

  describe("a closed panel's icon", () => {
    const closedIn = (api: DockviewApi) => api.groups.map((group) => closedPanelsIn(group).map(({ id }) => id))

    it("is in the strip it would come back to, or the centre's when that group is gone", () => {
      storage.set(DOCK_STORAGE_KEY, saved(panels.map(({ id }) => id)))
      const { api } = fakeDock({ loaded: [DOCUMENTS_PANEL, "project"], side: ["project"] })
      attachDock(api, panels)
      assert.deepStrictEqual(closedIn(api), [["inspector"], ["pieces"]])
    })

    it("is in the centre's strip while its group is a rail, which has no room", () => {
      storage.set(DOCK_STORAGE_KEY, saved(panels.map(({ id }) => id), { "2": { axis: "width", size: 260 } }))
      const { api } = fakeDock({ loaded: [DOCUMENTS_PANEL, "project"], side: ["project"] })
      attachDock(api, panels)
      assert.deepStrictEqual(closedIn(api), [["pieces", "inspector"], []])
    })

    it("isn't anywhere while its panel is open", () => {
      storage.set(DOCK_STORAGE_KEY, saved(panels.map(({ id }) => id)))
      const { api } = fakeDock({ loaded: [DOCUMENTS_PANEL, ...panels.map(({ id }) => id)] })
      attachDock(api, panels)
      assert.deepStrictEqual(closedIn(api), [[]])
    })
  })

  it("reopens a panel closed before the last launch in its slot", () => {
    const leftPanels = ["project", "pieces", "outline"].map((id) => panel(id, "left"))
    storage.set(DOCK_STORAGE_KEY, saved(leftPanels.map(({ id }) => id), {}, { pieces: { group: "2", index: 1 } }))
    const { api } = fakeDock({
      loaded: [DOCUMENTS_PANEL, "project", "outline"],
      side: ["project", "pieces", "outline"]
    })
    attachDock(api, leftPanels)
    togglePanel("pieces")
    assert.deepStrictEqual(api.panels.map(({ id }) => id), [DOCUMENTS_PANEL, "project", "pieces", "outline"])
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

  describe("reopening a panel", () => {
    const left = ["project", "pieces", "prefabs", "outline"]
    const leftPanels = left.map((id) => panel(id, "left"))
    const strip = (api: DockviewApi) => api.panels.map(({ id }) => id).filter((id) => id !== DOCUMENTS_PANEL)
    const leftDock = () => {
      const made = fakeDock({ loaded: [] })
      attachDock(made.api, leftPanels)
      return made
    }

    it("puts it back in the slot it closed from, not last", () => {
      const { api } = leftDock()
      togglePanel("prefabs")
      assert.deepStrictEqual(strip(api), ["project", "pieces", "outline"])
      togglePanel("prefabs")
      assert.deepStrictEqual(strip(api), left)
    })

    it("puts two back as they were, however they closed", () => {
      const { api } = leftDock()
      togglePanel("pieces")
      togglePanel("prefabs")
      togglePanel("pieces")
      togglePanel("prefabs")
      assert.deepStrictEqual(strip(api), left)
    })

    it("goes by the panel's own close too, the tab's × and the menus", () => {
      const { api } = leftDock()
      api.getPanel("project")?.api.close()
      togglePanel("project")
      assert.deepStrictEqual(strip(api), left)
    })

    it("uses the slot once: a panel closed from elsewhere gets a new one", () => {
      const { api } = leftDock()
      togglePanel("project")
      togglePanel("project")
      togglePanel("outline")
      togglePanel("outline")
      assert.deepStrictEqual(strip(api), left)
    })

    it("forgets the slots on Reset layout, which lays out the default", () => {
      const { api } = leftDock()
      togglePanel("project")
      resetDockLayout()
      assert.deepStrictEqual(strip(api), left)
      togglePanel("outline")
      togglePanel("outline")
      assert.deepStrictEqual(strip(api), left)
    })
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

  it("resets around the centre: the viewport's panel is never touched", () => {
    const { calls } = dock()
    resetDockLayout()
    assert.notInclude(calls, `remove ${DOCUMENTS_PANEL}`)
    assert.notInclude(calls, "clear")
    assert.includeMembers(calls, ["remove project", "remove pieces", "remove inspector", "add inspector right"])
  })
})
