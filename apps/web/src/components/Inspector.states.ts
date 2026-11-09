import { app, count, input, states, store } from "@ballest/app-driver/state"

/** Ctrl, and Ctrl with Shift, in the DevTools protocol's modifier bits. */
const CTRL = 2
const CTRL_SHIFT = 10

export default states({
  "inspector/group": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    reach: [app.select("", 3), input.key("g", "KeyG", CTRL)],
    measure: { groups: store("doc.structure.tree.length") },
    checks: [{ metric: "groups", min: 1 }]
  },
  "inspector/closed-section": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    reach: [app.settings({ panels: { inspectorSections: { transform: false, details: true } } }), app.select("")],
    measure: {
      open: count("[data-slot=collapsible][data-open]"),
      closed: count("[data-slot=collapsible][data-closed]")
    },
    checks: [{ metric: "closed", min: 1 }]
  },
  "inspector/properties": {
    views: ["panel:inspector"],
    fixture: "sample:qa props save",
    reach: [app.select("AirVent")],
    measure: { properties: count("[data-slot=label]") },
    checks: [{ metric: "properties", min: 5 }]
  },
  "inspector/decal": {
    views: ["panel:inspector"],
    fixture: "sample:qa props save",
    reach: [app.select("Decal")]
  },
  "inspector/group-contents": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    // a whole group's paint and properties sit in the open, as several loose pieces' do, under its Location row
    reach: [app.select("", 3), input.key("g", "KeyG", CTRL)],
    measure: { sections: count("[data-slot=collapsible]") },
    checks: [{ metric: "sections", min: 4 }]
  },
  "inspector/group-and-piece": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    // two pieces grouped, then selected with a third: the pivot choices stay in place, greyed, with why under them
    reach: [app.select("", 2), input.key("g", "KeyG", CTRL), app.select("", 3)],
    measure: { pivotOff: count("[aria-label='Pivot'] button:disabled") },
    checks: [{ metric: "pivotOff", equals: 8 }]
  },
  "inspector/chain-link": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    // inside a chain (Enter on it), its first link selected: the identity says which link it is
    reach: [app.select("", 3), input.key("G", "KeyG", 10), input.key("Enter", "Enter"), app.select("", 1)],
    measure: { entered: store("enteredGroupId"), selected: store("selectedIds") }
  },
  "inspector/align": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    // three pieces: the Align section, its buttons live where they'd move something
    reach: [app.select("", 3), app.settings({ panels: { inspectorSections: { contents: false, paint: false } } })],
    measure: { enabled: count("button[aria-label^='Align ']:not(:disabled)") },
    checks: [{ metric: "enabled", min: 1 }]
  },
  "inspector/align-preview": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    // pointing at Align −X sides previews it in the pane, nothing moved yet
    reach: [
      app.select("", 3),
      app.settings({ panels: { inspectorSections: { contents: false, paint: false } } }),
      input.hover("button[aria-label='Align −X sides']")
    ],
    measure: { previewing: store("arrangeHover.kind"), undo: store("past.length") },
    checks: [{ metric: "previewing", equals: "align" }]
  },
  "inspector/align-applied": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    // pressing Align −X sides moves the others onto the active item as one undo step, and the button goes off
    reach: [
      app.select("", 3),
      app.settings({ panels: { inspectorSections: { contents: false, paint: false } } }),
      input.click("button[aria-label='Align −X sides']")
    ],
    measure: { undo: store("past.length"), off: count("button[aria-label='Align −X sides']:disabled") },
    checks: [{ metric: "undo", equals: 1 }, { metric: "off", equals: 1 }]
  },
  "inspector/align-by-key": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    // Ctrl+Shift+Left lines the selection up on the active item's side that's left on screen
    reach: [app.select("", 3), input.key("ArrowLeft", "ArrowLeft", CTRL_SHIFT)],
    measure: { undo: store("past.length") },
    checks: [{ metric: "undo", equals: 1 }]
  }
})
