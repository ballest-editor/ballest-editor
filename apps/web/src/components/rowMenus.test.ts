// @vitest-environment jsdom
import { assert, describe, it } from "@effect/vitest"
import { PortalContainerContext } from "@workspace/ui/lib/portal-container"
import { act, createElement, type ReactElement } from "react"
import { useEditor } from "../editor/store"
import { reactRootPerTest } from "../test/reactRoot"
import { PrefabsPanel } from "./PrefabsPanel"
import { MapRow } from "./ProjectPanel"

const MAP = {
  fileName: "Map_LevelEditorMain&Big Loop_me.balledit",
  path: "/maps/Big Loop.balledit",
  modifiedAt: new Date().toISOString(),
  hash: "a".repeat(64),
  publishedFileId: -1,
  link: null
}

const PREFAB = {
  tier: "user",
  name: "Arch",
  itemCount: 2,
  path: null,
  modifiedAt: new Date().toISOString(),
  hash: "b".repeat(64)
} as const

const dom = reactRootPerTest()

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

const render = async (element: ReactElement) => {
  act(() => dom.root.render(element))
  await settle()
}

const rightClick = async (element: Element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 10 }))
  })
  await settle()
}

const menus = () => document.querySelectorAll("[role=menu]").length
const opened = (slot: string) => document.querySelector(`[data-slot=${slot}]`) !== null

const rows = {
  "a map": () => createElement("ul", null, createElement(MapRow, { map: MAP, now: Date.now() })),
  "a prefab": () => {
    useEditor.setState({ prefabs: [PREFAB] })
    return createElement(PrefabsPanel)
  }
}

describe.each(Object.entries(rows))("%s's row", (_, row) => {
  it("opens a right-click's menu as a context menu, which goes to the pointer, not by its ⋮", async () => {
    await render(row())
    const li = dom.host.querySelector("li")
    assert.isNotNull(li)
    await rightClick(li)
    assert.isTrue(opened("context-menu-content"))
    assert.isFalse(opened("dropdown-menu-content"))
  })

  it("leaves a right-click inside its open ⋮ menu to that menu", async () => {
    await render(row())
    const dots = dom.host.querySelector("button[aria-label^='More for']")
    assert.isNotNull(dots)
    act(() => {
      dots.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    await settle()
    const popup = document.querySelector("[data-slot=dropdown-menu-content]")
    assert.isNotNull(popup)
    await rightClick(popup)
    assert.strictEqual(menus(), 1)
    assert.isFalse(opened("context-menu-content"))
  })
})

describe("a right-click's menu in a popped-out panel", () => {
  it("opens in the panel's window, as a dropdown does", async () => {
    const popout = document.body.appendChild(document.createElement("div"))
    await render(createElement(PortalContainerContext, { value: popout }, rows["a map"]()))
    const li = dom.host.querySelector("li")
    assert.isNotNull(li)
    await rightClick(li)
    assert.isNotNull(popout.querySelector("[data-slot=context-menu-content]"))
    popout.remove()
  })
})
