// @vitest-environment jsdom
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest"
import { act, createElement } from "react"
import { vi } from "vitest"
import { useEditor } from "../editor/store"
import { reactRootPerTest } from "../test/reactRoot"
import { DRAG_KEYS_DELAY_MS, useDragKeysShown } from "./DragKeyHints"

const dom = reactRootPerTest()

const Probe = () => createElement("span", { "data-shown": String(useDragKeysShown()) })
const shown = () => dom.host.querySelector("[data-shown]")?.getAttribute("data-shown")

const press = (pressed: ReadonlyArray<string> = []) =>
  act(() => useEditor.getState().setDragKeys({ transform: "move", pressed, lock: undefined }))
const release = () => act(() => useEditor.getState().setDragKeys(null))
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

describe("the drag keys' wait", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    act(() => dom.root.render(createElement(Probe)))
  })
  afterEach(() => {
    release()
    vi.useRealTimers()
  })

  it("shows nothing for a click on a selected piece", () => {
    press()
    assert.strictEqual(shown(), "false")
    wait(DRAG_KEYS_DELAY_MS - 50)
    release()
    wait(DRAG_KEYS_DELAY_MS)
    assert.strictEqual(shown(), "false")
  })

  it("shows the keys once a press lasts, and hides them on the release", () => {
    press()
    wait(DRAG_KEYS_DELAY_MS)
    assert.strictEqual(shown(), "true")
    release()
    assert.strictEqual(shown(), "false")
    press()
    assert.strictEqual(shown(), "false", "the next press waits again")
  })

  it("shows them at once when a key goes down", () => {
    press()
    press(["KeyJ"])
    assert.strictEqual(shown(), "true")
  })
})
