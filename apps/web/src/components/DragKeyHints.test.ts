import { assert, describe, it } from "@effect/vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { vi } from "vitest"
import { defaultKeybinds } from "../domain/Keybinds"
import type { DragKeysShown } from "../editor/store"
import { DragKeyHints } from "./DragKeyHints"

// The server render reads a store's initial state, so the test gives it the state it means instead.
let dragKeys: DragKeysShown | null = null
vi.mock("../editor/store", () => ({
  useEditor: (selector: (s: unknown) => unknown) => selector({ dragKeys, keybinds: defaultKeybinds })
}))

/** The hints as they render: each one's keys and word, lit ones marked with a star. */
const hintsOf = (shown: DragKeysShown | null): ReadonlyArray<string> => {
  dragKeys = shown
  const html = renderToStaticMarkup(createElement(DragKeyHints))
  return [...html.matchAll(/data-drag-key="[^"]+" data-active="(true|false)">(.*?)<\/span><\/span>/g)].map(
    ([, active, inner = ""]) => {
      const keys = [...inner.matchAll(/<kbd[^>]*class="([^"]*)"[^>]*>(.*?)<\/kbd>/g)].map(([, cls = "", text]) =>
        cls.includes("bg-primary/12") ? `${text}*` : text
      )
      const word = inner.slice(inner.lastIndexOf(">") + 1)
      return `${keys.join(" ")} ${word}${active === "true" ? "*" : ""}`
    }
  )
}

describe("the status bar's drag keys", () => {
  it("shows nothing with no drag", () => {
    assert.strictEqual(renderToStaticMarkup(createElement(DragKeyHints)), "")
  })

  it("offers a move every key it can take", () => {
    assert.deepStrictEqual(hintsOf({ transform: "move", pressed: [], lock: undefined }), [
      "Control off",
      "Shift hold",
      "X Y Z lock",
      "J connectors",
      "M mesh",
      "L align"
    ])
  })

  it("offers a turn no hold or lock, and a scale only the mesh", () => {
    assert.deepStrictEqual(hintsOf({ transform: "turn", pressed: [], lock: undefined }), [
      "Control off",
      "J connectors",
      "M mesh",
      "L align"
    ])
    assert.deepStrictEqual(hintsOf({ transform: "scale", pressed: [], lock: undefined }), [
      "Control off",
      "M mesh"
    ])
  })

  it("lights what is held and the axis locked", () => {
    assert.deepStrictEqual(
      hintsOf({ transform: "move", pressed: ["ControlLeft", "KeyJ"], lock: { axis: "y", plane: true } }),
      ["Control* off*", "Shift hold", "X Y* Z lock*", "J* connectors*", "M mesh", "L align"]
    )
  })
})
