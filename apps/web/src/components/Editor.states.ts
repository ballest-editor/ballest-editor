import { app, count, input, rect, scene, states, store } from "@ballest/app-driver/state"

export default states({
  "editor/start": {
    views: ["viewport:single"],
    fixture: "none",
    anchor: true,
    axes: { window: ["1280x800", "2560x1440"] },
    measure: { "panes": count("canvas") },
    checks: [{ metric: "panes", min: 1 }]
  },
  "editor/map": {
    views: ["viewport:single"],
    fixture: "map:simple",
    anchor: true,
    axes: { panes: ["quad"], dock: ["bare"], window: ["1280x800"] },
    measure: { items: store("doc.map.items"), objects: scene("objects"), canvasWidth: rect("canvas", "width") },
    checks: [{ metric: "items", min: 1 }, { metric: "objects", min: 1 }]
  },
  "editor/complex-map": {
    views: ["viewport:single"],
    fixture: "map:complex",
    measure: { items: store("doc.map.items"), objects: scene("objects") },
    checks: [{ metric: "items", min: 100 }]
  },
  "editor/selected-item": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    anchor: true,
    reach: [app.select("")],
    measure: { selected: store("selectedIds") },
    checks: [{ metric: "selected", equals: 1 }]
  },
  "editor/scale": {
    views: ["viewport:single"],
    fixture: "map:simple",
    anchor: true,
    reach: [app.select(""), input.click("[aria-label=\"Scale\"]")],
    measure: { selected: store("selectedIds"), tool: store("tool") },
    checks: [{ metric: "selected", equals: 1 }, { metric: "tool", equals: "scale" }],
    axes: { panes: ["quad"] }
  },
  "editor/selected-size": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    reach: [app.settings({ panels: { inspectorScale: "size" } }), app.select("")],
    measure: { scale: store("settings.panels.inspectorScale") },
    checks: [{ metric: "scale", equals: "size" }]
  },
  "editor/selected-many": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    reach: [app.select("", 5)],
    measure: { selected: store("selectedIds") },
    checks: [{ metric: "selected", min: 2 }]
  },
  "editor/columns": { views: ["viewport:columns"], fixture: "map:simple", reach: [app.panes("columns")] },
  "editor/rows": { views: ["viewport:rows"], fixture: "map:simple", reach: [app.panes("rows")] },
  "editor/quad": { views: ["viewport:quad"], fixture: "map:simple", reach: [app.panes("quad")] }
})
