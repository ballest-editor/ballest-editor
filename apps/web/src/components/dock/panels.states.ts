import { app, input, rect, states } from "@ballest/app-driver/state"

export default states({
  "panel/project": { views: ["panel:project"], fixture: "map:simple" },
  "panel/pieces": { views: ["panel:pieces"], fixture: "map:simple", reach: [input.click("text:Pieces")], anchor: true },
  "panel/prefabs": { views: ["panel:prefabs"], fixture: "map:simple", reach: [input.click("text:Prefabs")] },
  "panel/outline": {
    views: ["panel:outline"],
    fixture: "map:simple",
    reach: [input.click("text:Outline")],
    anchor: true
  },
  "panel/inspector": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    measure: { width: rect("[aria-label=Inspector]", "width") }
  },
  "panel/popped-out": {
    views: ["panel:inspector"],
    target: "desktop",
    fixture: "map:simple",
    reach: [app.popOut("inspector")]
  }
})
