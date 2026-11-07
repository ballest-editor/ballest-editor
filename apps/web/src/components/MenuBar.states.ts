import { count, input, type State, states } from "@ballest/app-driver/state"

const menu = (title: string, extra: Partial<State> = {}): State => ({
  views: [`menu:${title}`],
  fixture: "none",
  reach: [input.click(`text:${title}`)],
  measure: { items: count("[role=menu] [role^=menuitem]") },
  checks: [{ metric: "items", min: 1 }],
  ...extra
})

export default states({
  "menu/file": menu("File", { anchor: true }),
  "menu/edit": menu("Edit"),
  "menu/view": menu("View"),
  "menu/tools": menu("Tools"),
  "menu/project": menu("Project"),
  "menu/help": menu("Help")
})
