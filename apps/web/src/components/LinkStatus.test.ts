import { assert, describe, it } from "@effect/vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { vi } from "vitest"
import { LinkStatus } from "./LinkStatus"

// The server render reads a store's initial state, so the test gives it the state it means instead.
let blank = false
let file: { readonly name: string } | null = null
let dirty = false
vi.mock("../editor/store", () => ({
  useEditor: (selector: (s: unknown) => unknown) =>
    selector({
      dirty,
      file,
      savedDoc: null,
      tabId: "tab-1",
      mapShownRequest: 0,
      capabilities: { exportToGame: true, play: true }
    }),
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

  it("isn't Unsaved once a first save has given it a file, before the project's list has it", () => {
    file = { name: "a.balledit" }
    try {
      const saved = renderToStaticMarkup(createElement(LinkStatus))
      assert.notInclude(saved, "Unsaved")
      dirty = true
      assert.include(renderToStaticMarkup(createElement(LinkStatus)), "Unsaved")
    } finally {
      file = null
      dirty = false
    }
  })
})
