import { app, count, type State, states, type Step } from "@ballest/app-driver/state"

/**
 * A dialog open over the start map, and proof that it opened: an empty capture would otherwise pass. A real map behind
 * it would only cost software WebGL time.
 */
const dialog = (id: string, open: Step = app.openDialog({ id }), extra: Partial<State> = {}): State => ({
  views: [`dialog:${id}`],
  fixture: "none",
  reach: [open],
  measure: { dialogs: count("[role=dialog], [role=alertdialog]") },
  checks: [{ metric: "dialogs", min: 1 }],
  ...extra
})

const prefab = { tier: "user", name: "Ramp set" }

export default states({
  "dialog/save-as": dialog("saveAs", undefined, { anchor: true }),
  "dialog/rename": dialog("rename"),
  "dialog/duplicate": dialog("duplicate"),
  "dialog/new-draft": dialog("newDraft"),
  "dialog/project-settings": dialog("projectSettings"),
  "dialog/map-settings": dialog("mapSettings"),
  "dialog/game-link": dialog("gameLink"),
  "dialog/keybinds": dialog("keybinds"),
  "dialog/about": dialog("about", undefined, { anchor: true }),
  "dialog/new-project": dialog("newProject"),
  "dialog/recover": dialog("recover"),
  "dialog/recover-unsaved": dialog("recoverUnsaved", app.recoverUnsaved("Waterfront")),
  "dialog/replace-published": dialog(
    "replacePublished",
    app.openDialog({ id: "replacePublished", name: "Waterfront", publishedFileId: 3339810, from: "export" })
  ),
  "dialog/sync-conflict": dialog(
    "syncConflict",
    app.openDialog({ id: "syncConflict", name: "Waterfront", from: "export", replacePublished: false, diff: null })
  ),
  "dialog/replace-in-game": dialog(
    "replaceInGame",
    app.openDialog({ id: "replaceInGame", name: "Waterfront", inGame: "Waterfront", replacePublished: false })
  ),
  "dialog/import-clash": dialog("importClash", app.importClash("Waterfront.balledit")),
  "dialog/where-to-open": dialog(
    "whereToOpen",
    app.openDialog({ id: "whereToOpen", target: { _tag: "Folder", path: "/tmp/Project" }, name: "Project" })
  ),
  "dialog/save-prefab": dialog("savePrefab"),
  "dialog/rename-prefab": dialog("renamePrefab", app.openDialog({ id: "renamePrefab", prefab })),
  "dialog/delete-prefab": dialog("deletePrefab", app.openDialog({ id: "deletePrefab", prefab }))
})
