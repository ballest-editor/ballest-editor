import { count, input, states, store } from "@ballest/app-driver/state"

export default states({
  "tool/paint": {
    views: ["tool:paint"],
    fixture: "map:simple",
    anchor: true,
    reach: [input.click("[aria-label=\"Paint\"]")],
    measure: { tool: store("tool"), palette: count("[data-paint-palette]") },
    checks: [{ metric: "tool", equals: "paint" }, { metric: "palette", equals: 1 }]
  },
  "tool/paint/grid": {
    views: ["tool:paint"],
    fixture: "map:simple",
    reach: [input.click("[aria-label=\"Paint\"]"), input.click("[aria-label=\"Every finish\"]")],
    measure: {
      view: store("settings.panels.paintView"),
      grid: count("[data-paint-palette=\"grid\"]"),
      finishes: count("[data-paint-palette] [role=group]")
    },
    checks: [{ metric: "view", equals: "grid" }, { metric: "grid", equals: 1 }, { metric: "finishes", min: 8 }],
    axes: { window: ["1280x800"] }
  }
})
