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
  "inspector/group-items": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    reach: [app.select("", 3), input.key("g", "KeyG", CTRL), input.click("text:Edit all 3 items")]
  }
})
