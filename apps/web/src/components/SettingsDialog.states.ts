import { app, count, input, type State, states } from "@ballest/app-driver/state"

const page = (category: string, extra: Partial<State> = {}): State => ({
  views: [`settings:${category}`, "dialog:settings"],
  fixture: "none",
  reach: [app.openSettings(category)],
  measure: { dialogs: count("[role=dialog]") },
  checks: [{ metric: "dialogs", equals: 1 }],
  ...extra
})

export default states({
  "settings/general": page("general", { anchor: true }),
  "settings/editor": page("editor"),
  // Scrolled to the Snapping group: your snapping, and the button that puts new maps' back to the factory's.
  "settings/editor-snapping": page("editor", {
    reach: [app.openSettings("editor"), input.wheel("[role=dialog] section", 2000)],
    measure: { dialogs: count("[role=dialog]"), groups: count("[role=dialog] section") },
    checks: [{ metric: "dialogs", equals: 1 }, { metric: "groups", equals: 2 }]
  }),
  "settings/camera": page("camera"),
  "settings/keybinds": page("keybinds"),
  "settings/appearance": page("appearance", { anchor: true }),
  "settings/beta": page("beta"),
  "settings/game": page("game", { target: "desktop" })
})
