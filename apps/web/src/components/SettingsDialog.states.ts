import { app, count, type State, states } from "@ballest/app-driver/state"

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
  "settings/camera": page("camera"),
  "settings/keybinds": page("keybinds"),
  "settings/appearance": page("appearance", { anchor: true }),
  "settings/game": page("game", { target: "desktop" })
})
