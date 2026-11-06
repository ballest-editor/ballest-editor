import { assert, beforeEach, describe, it } from "@effect/vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { vi } from "vitest"
import { ProjectPanel } from "./ProjectPanel"

const state = vi.hoisted(() => ({
  capabilities: { projects: true, exportToGame: true, play: true },
  project: null,
  projectMaps: [] as ReadonlyArray<unknown>,
  mapThumbnails: new Map<string, string>(),
  file: null,
  tabIds: [] as ReadonlyArray<string>,
  tabId: "untitled",
  unsaved: true,
  openDialog: () => undefined,
  activateTab: () => undefined
}))

// The server render reads a store's initial state, so the test gives it the state it means instead.
vi.mock("../editor/store", () => ({
  tabsWithoutFile: (s: typeof state) => s.tabIds,
  useEditedAt: (_: string, modifiedAt: string) => modifiedAt,
  useEditor: (selector: (s: typeof state) => unknown) => selector(state),
  useHasUnsavedEdits: () => false,
  useTabSummary: () => ({ label: "Untitled", unsaved: state.unsaved })
}))

vi.mock("../editor/actions", () => ({}))

const panel = () => renderToStaticMarkup(createElement(ProjectPanel))

const MAP = {
  fileName: "Map_LevelEditorMain&Big Loop_me.balledit",
  path: "/maps/Big Loop.balledit",
  modifiedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  hash: "a".repeat(64),
  publishedFileId: -1,
  link: null
}

describe("the Project panel with no maps", () => {
  beforeEach(() => {
    state.tabIds = []
    state.unsaved = true
  })

  it("lists an unsaved tab and leaves out the empty state", () => {
    state.tabIds = ["untitled"]
    const markup = panel()
    assert.include(markup, "Unsaved")
    assert.notInclude(markup, "No maps yet")
  })

  it("lists a blank tab with no Unsaved badge", () => {
    state.tabIds = ["untitled"]
    state.unsaved = false
    const markup = panel()
    assert.include(markup, "Untitled")
    assert.notInclude(markup, "Unsaved")
  })

  it("shows the empty state when there is nothing at all", () => {
    const markup = panel()
    assert.include(markup, "No maps yet")
    assert.notInclude(markup, "Unsaved")
  })
})

describe("a map's row in the Project panel", () => {
  beforeEach(() => {
    state.tabIds = []
    state.projectMaps = [MAP]
    state.mapThumbnails = new Map()
  })

  it("is two lines, 40 px tall, the second saying when it was edited", () => {
    const markup = panel()
    assert.include(markup, "h-10")
    assert.include(markup, "Big Loop")
    assert.include(markup, "Edited 3 min ago")
  })

  it("shows the glyph until a Save has rendered its file, and then the render", () => {
    assert.notInclude(panel(), "<img")
    state.mapThumbnails = new Map([[MAP.hash, "data:image/png;base64,AAAA"]])
    assert.include(panel(), "src=\"data:image/png;base64,AAAA\"")
  })

  it("shows no render of other bytes", () => {
    state.mapThumbnails = new Map([["b".repeat(64), "data:image/png;base64,AAAA"]])
    assert.notInclude(panel(), "<img")
  })

  it("can be dragged", () => {
    assert.include(panel(), "draggable=\"true\"")
  })
})
