import { app, count, input, states } from "@ballest/app-driver/state"

/** Alt, Ctrl and Shift in the DevTools protocol's modifier bits. */
const ALT = 1
const CTRL = 2
const SHIFT = 8

export default states({
  "outline/hidden-and-locked": {
    views: ["panel:outline"],
    fixture: "map:simple",
    // two pieces hidden (H), two more locked, by Ctrl+L and by a row's padlock: the rows keep their eye and padlock,
    // and a hidden piece's name is in italics
    reach: [
      input.click("text:Outline"),
      app.select("", 2),
      input.key("h", "KeyH"),
      app.select("Track", 1),
      input.key("l", "KeyL", CTRL),
      input.click("[data-row-index='5'] button[aria-label^='Lock ']")
    ],
    measure: {
      hidden: count("[role=treeitem] button[aria-label^='Show ']"),
      locked: count("[role=treeitem] button[aria-label^='Unlock ']")
    },
    checks: [{ metric: "hidden", equals: 2 }, { metric: "locked", min: 2 }]
  },
  "outline/isolated": {
    views: ["panel:outline", "viewport:single"],
    fixture: "map:simple",
    anchor: true,
    // three pieces isolated (Shift+H): the panes draw only them and say so, the Outline dims the rest
    reach: [input.click("text:Outline"), app.select("", 3), input.key("H", "KeyH", SHIFT)],
    measure: { chips: count("button[aria-label='End isolation']") },
    // one chip beside each pane's card, as every pane of the tab is isolated
    checks: [{ metric: "chips", min: 1 }],
    axes: { panes: ["quad"] }
  },
  "outline/shown-again": {
    views: ["panel:outline"],
    fixture: "map:simple",
    // hidden, then Alt+H: everything is back and selected, with no eye left on
    reach: [input.click("text:Outline"), app.select("", 2), input.key("h", "KeyH"), input.key("h", "KeyH", ALT)],
    measure: { hidden: count("[role=treeitem] button[aria-label^='Show ']") },
    checks: [{ metric: "hidden", equals: 0 }]
  }
})
