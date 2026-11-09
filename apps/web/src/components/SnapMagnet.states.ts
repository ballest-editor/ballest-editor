import { count, input, states } from "@ballest/app-driver/state"

export default states({
  "popover/snap": {
    views: ["popover:snap"],
    fixture: "map:simple",
    reach: [input.click("[aria-label='Snap menu']")],
    measure: {
      menus: count("[data-snap-menu]"),
      switches: count("[data-snap-menu] [role=switch]"),
      help: count("[data-snap-menu] [data-slot=tooltip-trigger]"),
      magnets: count("[aria-label='Snapping'][aria-pressed]")
    },
    checks: [
      { metric: "menus", equals: 1 },
      { metric: "switches", equals: 7 },
      { metric: "help", min: 9 },
      { metric: "magnets", equals: 1 }
    ],
    anchor: true,
    axes: { window: ["1280x800", "2560x1440"] }
  },
  "popover/snap-advanced": {
    views: ["popover:snapAdvanced"],
    fixture: "map:simple",
    reach: [input.click("[aria-label='Snap menu']"), input.click("text:Advanced")],
    measure: { targets: count("[data-snap-advanced] [data-snap-target]") },
    checks: [{ metric: "targets", equals: 6 }],
    anchor: true,
    axes: { window: ["1280x800", "2560x1440"] }
  }
})
