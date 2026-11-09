import { app, count, states } from "@ballest/app-driver/state"

export default states({
  "inspector/connects-at": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    reach: [app.select("BP_Track_Short1")],
    measure: {
      ends: count("[aria-label$='connects at']"),
      spots: count("[aria-label='End 1 connects at'] [aria-pressed]"),
      pressed: count("[aria-label='End 1 connects at'] [aria-pressed=true]")
    },
    checks: [{ metric: "ends", equals: 2 }, { metric: "spots", equals: 9 }, { metric: "pressed", equals: 1 }]
  }
})
