import { assert, beforeEach, describe, it } from "@effect/vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { vi } from "vitest"
import { ProjectPanel } from "./ProjectPanel"

const state = vi.hoisted(() => ({
  capabilities: { projects: true, exportToGame: true, play: true },
  project: null,
  projectMaps: [] as ReadonlyArray<unknown>,
  tabIds: [] as ReadonlyArray<string>,
  tabId: "untitled",
  openDialog: () => undefined,
  activateTab: () => undefined
}))

// The server render reads a store's initial state, so the test gives it the state it means instead.
vi.mock("../editor/store", () => ({
  tabsWithoutFile: (s: typeof state) => s.tabIds,
  useEditor: (selector: (s: typeof state) => unknown) => selector(state),
  useHasUnsavedEdits: () => false,
  useTabSummary: () => ({ label: "Untitled" })
}))

vi.mock("../editor/actions", () => ({}))

const panel = () => renderToStaticMarkup(createElement(ProjectPanel))

describe("the Project panel with no maps", () => {
  beforeEach(() => {
    state.tabIds = []
  })

  it("lists an unsaved tab and leaves out the empty state", () => {
    state.tabIds = ["untitled"]
    const markup = panel()
    assert.include(markup, "Unsaved")
    assert.notInclude(markup, "No maps yet")
  })

  it("shows the empty state when there is nothing at all", () => {
    const markup = panel()
    assert.include(markup, "No maps yet")
    assert.notInclude(markup, "Unsaved")
  })
})
