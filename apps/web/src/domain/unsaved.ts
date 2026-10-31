/**
 * What the unsaved-changes prompt says. One prompt guards everything that would lose the open map's edits: closing the
 * window, reloading the page, New map, opening or importing another map, closing the map's tab, and switching projects.
 */
export type UnsavedAction = "close" | "reload" | "newMap" | "openMap" | "closeMap" | "switchProject"

export interface UnsavedPrompt {
  /** The question, answered with Save, Don't save or Cancel. */
  readonly message: string
  readonly detail: string
}

const doing: Record<UnsavedAction, string> = {
  close: "closing",
  reload: "reloading",
  newMap: "starting a new map",
  openMap: "opening another map",
  closeMap: "closing the map",
  switchProject: "switching projects"
}

const verb: Record<UnsavedAction, string> = {
  close: "close the editor",
  reload: "reload",
  newMap: "start a new map",
  openMap: "open another map",
  closeMap: "close the map",
  switchProject: "switch projects"
}

/** The desktop prompt: Save, Don't save, Cancel. `map` is the map's name, as the title bar shows it. */
export const unsavedPromptOf = (action: UnsavedAction, map: string): UnsavedPrompt => ({
  message: `Save the changes to ${map} before ${doing[action]}?`,
  detail: action === "switchProject"
    ? "If you don't save, its file in this project keeps the last save. The map stays open, unsaved, in the other project."
    : "If you don't save, the changes are lost."
})

/** A browser's `confirm`, which has only OK and Cancel: OK goes on without saving. */
export const discardQuestionOf = (action: UnsavedAction, map: string): string =>
  `${map} has unsaved changes. Discard them and ${verb[action]}?`
