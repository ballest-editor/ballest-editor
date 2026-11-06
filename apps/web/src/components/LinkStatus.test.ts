import { assert, describe, it } from "@effect/vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { vi } from "vitest"
import { LinkStatus } from "./LinkStatus"

// The server render reads a store's initial state, so the test gives it the state it means instead.
let blank = false
vi.mock("../editor/store", () => ({
  useEditor: (selector: (s: unknown) => unknown) =>
    selector({ dirty: false, tabId: "tab-1", capabilities: { exportToGame: true, play: true } }),
  useOpenPrefab: () => null,
  useOpenProjectMap: () => null,
  useTabSummary: () => ({ label: "Untitled", unsaved: !blank, blank, fileName: null, prefabTier: null })
}))

vi.mock("../editor/actions", () => ({}))

describe("the status bar, on a map that was never saved", () => {
  const markup = renderToStaticMarkup(createElement(LinkStatus))

  it("shows the Unsaved chip the row uses", () => {
    assert.include(markup, "Unsaved")
    assert.include(markup, "rounded-full")
    assert.include(markup, "bg-status-warn")
  })

  it("makes the chip a button that opens a popover", () => {
    assert.match(markup, /^<button/)
    assert.include(markup, "aria-haspopup=\"dialog\"")
  })

  it("no longer says it in plain text", () => {
    assert.notInclude(markup, "Not saved in the project yet")
  })

  it("shows nothing at all while the map is blank: there is nothing to save yet", () => {
    blank = true
    try {
      assert.strictEqual(renderToStaticMarkup(createElement(LinkStatus)), "")
    } finally {
      blank = false
    }
  })
})
