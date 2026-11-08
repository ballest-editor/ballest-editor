import { count, input, states, store } from "@ballest/app-driver/state"

export default states({
  "tool/paint": {
    views: ["tool:paint"],
    fixture: "map:simple",
    anchor: true,
    reach: [input.click("[aria-label=\"Paint\"]")],
    measure: { tool: store("tool"), palette: count("[data-paint-palette]") },
    checks: [{ metric: "tool", equals: "paint" }, { metric: "palette", equals: 1 }]
  }
})
