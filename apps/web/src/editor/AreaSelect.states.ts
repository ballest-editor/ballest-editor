import { app, count, input, states, store } from "@ballest/app-driver/state"

/** Into the Top view of the pane under the pointer, where the Waterfront's pieces sit along the bottom of the pane. */
const top = [input.hover([800, 500]), input.key("7", "Numpad7")]

/** How many items `map:complex` (the Waterfront sample) has. */
const WATERFRONT_ITEMS = 155

/** DevTools' modifier bits. */
const CTRL_SHIFT = 2 | 8

const ALT = { key: "Alt", code: "AltLeft" } as const

/** A region that holds something. */
const CAUGHT = "[data-area-caught]:not([data-area-caught='0'])"

export default states({
  "select/box/inside": {
    views: ["select:box"],
    fixture: "map:complex",
    source: "#85",
    anchor: true,
    reach: [...top, input.drag([480, 630], [1060, 900], { hold: true })],
    measure: {
      box: count("[data-area-select=box][data-area-mode=inside]"),
      caught: count(CAUGHT),
      chip: count("[data-area-chip]")
    },
    checks: [{ metric: "box", equals: 1 }, { metric: "caught", equals: 1 }, { metric: "chip", equals: 1 }]
  },
  "select/box/touching": {
    views: ["select:box"],
    fixture: "map:complex",
    source: "#85",
    reach: [...top, input.drag([1060, 900], [480, 630], { hold: true })],
    measure: { box: count("[data-area-select=box][data-area-mode=touching]"), caught: count(CAUGHT) },
    checks: [{ metric: "box", equals: 1 }, { metric: "caught", equals: 1 }]
  },
  "select/box/released": {
    views: ["select:box"],
    fixture: "map:complex",
    source: "#85",
    reach: [...top, input.drag([480, 630], [1060, 900])],
    measure: { selected: store("selectedIds.length"), dragging: count("[data-area-select]") },
    checks: [{ metric: "selected", min: 1 }, { metric: "dragging", equals: 0 }]
  },
  "select/box/remove": {
    views: ["select:box"],
    fixture: "map:complex",
    source: "#85",
    reach: [...top, app.select("", WATERFRONT_ITEMS), input.drag([1060, 900], [480, 630], { modifiers: CTRL_SHIFT })],
    measure: { selected: store("selectedIds.length") },
    // Ctrl+Shift takes away what it touches, and never adds: some of the map stays selected, not all of it
    checks: [{ metric: "selected", min: 1, max: WATERFRONT_ITEMS - 1 }]
  },
  "select/lasso": {
    views: ["select:lasso"],
    fixture: "map:complex",
    source: "#85",
    anchor: true,
    reach: [
      ...top,
      input.drag([480, 640], [600, 900], { through: [[1060, 640], [1060, 760], [800, 900]], key: ALT, hold: true })
    ],
    measure: { lasso: count("[data-area-select=lasso][data-area-mode=inside]"), caught: count(CAUGHT) },
    checks: [{ metric: "lasso", equals: 1 }, { metric: "caught", equals: 1 }]
  }
})
