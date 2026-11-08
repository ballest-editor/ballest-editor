import { count, input, states } from "@ballest/app-driver/state"

export default states({
  "popover/display": {
    views: ["popover:display"],
    fixture: "map:simple",
    reach: [input.click("[aria-label='Display']")],
    measure: { switches: count("[data-slot=popover-content] [role=switch]") },
    checks: [{ metric: "switches", min: 4 }]
  }
})
