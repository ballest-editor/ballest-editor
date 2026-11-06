import { assert, beforeEach, describe, it } from "@effect/vitest"
import { elementOf, isEditorKeyEvent } from "./keyTargets"
import { useEditor } from "./store"

/** Stands in for a DOM node, with none of this realm's prototypes: what a popped-out panel's elements look like here. */
const node = (fields: object): EventTarget => Object.assign(new EventTarget(), fields)

describe("elementOf", () => {
  it("knows an element from another window's realm, where instanceof wouldn't", () => {
    const element = node({ nodeType: 1, tagName: "INPUT" })
    assert.strictEqual(elementOf(element), element)
  })

  it("takes a window, a text node or nothing for no element", () => {
    assert.isNull(elementOf(null))
    assert.isNull(elementOf(new EventTarget()))
    assert.isNull(elementOf(node({ nodeType: 3 })))
  })
})

describe("isEditorKeyEvent", () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only its target and key are read, and node has no KeyboardEvent
  const key = (target: EventTarget, name = "g") => ({ target, key: name }) as KeyboardEvent
  const element = { nodeType: 1, tagName: "DIV", closest: () => null }
  const outside = node(element)

  beforeEach(() => useEditor.setState({ dialog: null }))

  it("drives the editor from the page and from a key forwarded by a popped-out panel", () => {
    assert.isTrue(isEditorKeyEvent(key(outside)))
    assert.isTrue(isEditorKeyEvent(key(new EventTarget())))
  })

  it("leaves a text field its keys, in any window", () => {
    assert.isFalse(isEditorKeyEvent(key(node({ ...element, tagName: "INPUT" }))))
    assert.isFalse(isEditorKeyEvent(key(node({ ...element, isContentEditable: true }))))
  })

  it("leaves dialogs and menus theirs", () => {
    assert.isFalse(isEditorKeyEvent(key(node({ ...element, closest: () => ({}) }))))
  })

  describe("on a menu bar title", () => {
    const inBar = { ...element, closest: (selector: string) => selector === "[role=menubar]" ? {} : null }
    const closedTitle = node({ ...inBar, ariaExpanded: "false" })

    it("drives the editor while the menu is closed", () => {
      assert.isTrue(isEditorKeyEvent(key(closedTitle, "g")))
      assert.isTrue(isEditorKeyEvent(key(closedTitle, "Delete")))
    })

    it("leaves the title the keys it walks the bar with, opens its menu with and leaves by", () => {
      for (
        const name of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " ", "Escape", "Tab"]
      ) {
        assert.isFalse(isEditorKeyEvent(key(closedTitle, name)), name)
      }
    })

    it("leaves every key to an open menu", () => {
      assert.isFalse(isEditorKeyEvent(key(node({ ...inBar, ariaExpanded: "true" }), "g")))
    })
  })

  it("is off behind a modal dialog, and back when it closes", () => {
    useEditor.getState().openDialog({ id: "settings" })
    assert.isFalse(isEditorKeyEvent(key(outside)))
    useEditor.getState().closeDialog()
    assert.isTrue(isEditorKeyEvent(key(outside)))
  })
})
