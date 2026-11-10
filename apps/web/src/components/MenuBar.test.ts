// @vitest-environment jsdom
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { act, createElement, Fragment } from "react"
import { vi } from "vitest"
import { type EditorState, useEditor } from "../editor/store"
import { BROWSER, DESKTOP } from "../test/capabilities"
import { reactRootPerTest } from "../test/reactRoot"
import { MenuBar } from "./MenuBar"
import { MENU_TITLES, menuEntries, type Menus, useMenus } from "./menuModel"

// the dock isn't mounted here, so its panels come from this list
vi.mock("./dock/dockControl", async (importActual) => ({
  ...await importActual<object>(),
  useViewMenuPanels: () => [{ id: "project", title: "Project" }, { id: "outline", title: "Outline" }],
  useOpenPanels: () => new Set(["project"])
}))

/** Hears the menus the app is drawing, as the model has them. */
const onMenus = vi.fn<(menus: Menus) => void>()
const ModelProbe = () => {
  onMenus(useMenus())
  return null
}

const dom = reactRootPerTest()

const settle = Effect.promise(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20))))

const press = (element: Element, key: string) =>
  Effect.andThen(
    Effect.sync(() =>
      act(() => {
        if (element instanceof HTMLElement) element.focus()
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
      })
    ),
    settle
  )

/** A row's words, without its key chip. */
const labelOf = (row: Element): string => {
  const words = row.cloneNode(true)
  if (!(words instanceof Element)) return ""
  for (const chip of words.querySelectorAll("[data-slot=kbd]")) chip.remove()
  return words.textContent
}

const ROWS = "[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]"

/** The section `row` is under, if any. */
const sectionsOf = (row: Element): ReadonlyArray<string> => {
  const title = row.closest("[role=group]")?.querySelector("[data-slot=dropdown-menu-label]")?.textContent
  return title === undefined ? [] : [title]
}

/** Every row `popup` draws, opening its submenus to read theirs. */
const rowsOf = (popup: Element, path: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function*() {
    const rows: Array<string> = []
    for (const row of popup.querySelectorAll(ROWS)) {
      const here = [...path, ...sectionsOf(row)]
      if (row.getAttribute("aria-haspopup") === "menu" && !row.hasAttribute("data-disabled")) {
        yield* press(row, "ArrowRight")
        const submenu = document.getElementById(row.getAttribute("aria-controls") ?? "")
        assert.isNotNull(submenu, `${labelOf(row)} opens`)
        rows.push(...yield* rowsOf(submenu, [...here, labelOf(row)]))
        yield* press(submenu, "ArrowLeft")
      } else {
        rows.push([...here, labelOf(row)].join(" › "))
      }
    }
    return rows
  })

/** Opens each menu in turn and reads all it draws. */
const renderedRows = Effect.gen(function*() {
  const rows: Array<string> = []
  for (const title of MENU_TITLES) {
    const trigger = [...dom.host.querySelectorAll("[data-slot=menubar-trigger]")].find((t) => t.textContent === title)
    assert.isDefined(trigger, `the bar has ${title}`)
    yield* press(trigger, "ArrowDown")
    const popup = document.querySelector("[data-slot=menubar-content]")
    assert.isNotNull(popup, `${title} opens`)
    rows.push(...yield* rowsOf(popup, [title]))
    yield* press(popup, "Escape")
  }
  return rows.sort()
})

/** What the menus draw with the store in `state`, and what the model says they hold. */
const drawnAndModelled = (state: Partial<EditorState>) =>
  Effect.gen(function*() {
    useEditor.setState(state)
    act(() => dom.root.render(createElement(Fragment, null, createElement(ModelProbe), createElement(MenuBar))))
    const drawn = yield* renderedRows
    const menus = onMenus.mock.lastCall?.[0]
    assert.isDefined(menus)
    return { drawn, modelled: menuEntries(menus).map(({ label, path }) => [...path, label].join(" › ")).sort() }
  })

const projects = (names: ReadonlyArray<string>) => ({
  current: { path: "/projects/Demo", name: "Demo", exists: true },
  recent: names.map((name) => ({ path: `/projects/${name}`, name, exists: true, lastOpened: null })),
  openMaps: { files: [], active: null },
  projectsFolder: "/projects",
  chooserRequired: false,
  openElsewhere: [],
  startRefused: null
})

const IDLE_UPDATER = {
  status: "idle",
  currentVersion: "1.0.0",
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  releaseUrl: null,
  downloadPercent: null,
  checkedAt: null,
  message: null
} as const

describe("the drawn menus", () => {
  it.effect("are the model's rows, on the desktop", () =>
    Effect.gen(function*() {
      const { drawn, modelled } = yield* drawnAndModelled({
        capabilities: DESKTOP,
        project: projects(["One", "Two"]),
        update: IDLE_UPDATER
      })
      assert.include(drawn, "File › Recent projects › Two")
      assert.include(drawn, "View › Panes › Active pane › Top")
      assert.deepStrictEqual(drawn, modelled)
    }))

  it.effect("are the model's rows with no recent project, whose submenu stands in for its rows", () =>
    Effect.gen(function*() {
      const { drawn, modelled } = yield* drawnAndModelled({
        capabilities: DESKTOP,
        project: projects([]),
        update: null
      })
      assert.include(drawn, "File › Recent projects")
      assert.deepStrictEqual(drawn, modelled)
    }))

  it.effect("are the model's rows in a browser", () =>
    Effect.gen(function*() {
      const { drawn, modelled } = yield* drawnAndModelled({ capabilities: BROWSER, project: null, update: null })
      assert.include(drawn, "File › Export…")
      assert.deepStrictEqual(drawn, modelled)
    }))
})

describe("Help's search", () => {
  const field = () => {
    const input = document.querySelector("[data-slot=menubar-content] input")
    assert.instanceOf(input, HTMLInputElement)
    return input
  }

  const typeInto = (input: HTMLInputElement, text: string) =>
    Effect.andThen(
      Effect.sync(() =>
        act(() => {
          // past React's own value tracker, or it wouldn't see a change
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text)
          input.dispatchEvent(new Event("input", { bubbles: true }))
        })
      ),
      settle
    )

  const results = () =>
    [...document.querySelectorAll("[data-slot=menubar-list] [role=menuitem]")].map((row) => ({
      text: labelOf(row),
      off: row.hasAttribute("data-disabled"),
      highlighted: row.hasAttribute("data-highlighted")
    }))

  const openHelp = Effect.gen(function*() {
    useEditor.setState({ capabilities: DESKTOP, project: projects([]), update: null, selectedIds: [], dialog: null })
    act(() => dom.root.render(createElement(MenuBar)))
    const trigger = [...dom.host.querySelectorAll("[data-slot=menubar-trigger]")].find((t) => t.textContent === "Help")
    assert.isDefined(trigger)
    yield* press(trigger, "ArrowDown")
    return field()
  })

  it.effect("lists every menu's matches under Help's field, with where they are and why they're off", () =>
    Effect.gen(function*() {
      const input = yield* openHelp
      yield* typeInto(input, "dup")
      assert.deepStrictEqual(results(), [
        { text: "Duplicate map…Project", off: false, highlighted: true },
        { text: "DuplicateEditSelect something first.", off: true, highlighted: false }
      ])
    }))

  it.effect("runs the highlighted row on Enter", () =>
    Effect.gen(function*() {
      const input = yield* openHelp
      yield* typeInto(input, "dup")
      yield* press(input, "Enter")
      assert.deepStrictEqual(useEditor.getState().dialog, { id: "duplicate" })
    }))

  it.effect("clears on the first Escape and closes on the second", () =>
    Effect.gen(function*() {
      const input = yield* openHelp
      yield* typeInto(input, "dup")
      yield* press(input, "Escape")
      assert.strictEqual(input.value, "")
      assert.isTrue(input.isConnected, "the menu stays open")
      assert.strictEqual(results()[0]?.text, "Keyboard shortcuts")
      yield* press(input, "Escape")
      assert.isNull(document.querySelector("[data-slot=menubar-content][data-open]"))
    }))

  it.effect("says when nothing matches", () =>
    Effect.gen(function*() {
      const input = yield* openHelp
      yield* typeInto(input, "xyzq")
      assert.deepStrictEqual(results(), [])
      assert.include(document.querySelector("[data-slot=menubar-empty]")?.textContent, "Nothing in the menus matches.")
    }))
})
