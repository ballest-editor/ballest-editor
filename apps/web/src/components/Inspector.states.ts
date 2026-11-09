import { app, count, input, states, store } from "@ballest/app-driver/state"

/** Ctrl, in the DevTools protocol's modifier bits. */
const CTRL = 2

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
  }
})
