import { count, input, states } from "@ballest/app-driver/state"

export default states({
  "popover/snap-menu": {
    views: ["popover:snapMenu"],
    fixture: "map:simple",
    reach: [input.click("[aria-label='Snap menu']")],
    measure: { menus: count("[data-snap-menu]"), switches: count("[data-snap-menu] [role=switch]") },
    checks: [{ metric: "menus", equals: 1 }, { metric: "switches", min: 7 }]
  },
  "popover/snap-menu-on": {
    views: ["popover:snapMenu"],
    fixture: "map:simple",
    reach: [input.click("[aria-label='Snapping']"), input.click("[aria-label='Snap menu']")],
    measure: { pressed: count("[aria-label='Snapping'][aria-pressed=true]") },
    checks: [{ metric: "pressed", equals: 1 }]
  }
})
