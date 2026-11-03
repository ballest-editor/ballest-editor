/**
 * What the unsaved-changes prompt says. One prompt per map guards everything that would lose its edits: closing the
 * window, reloading the page or closing its tab, switching projects, and replacing it (re-importing it from the game,
 * recovering a previous version, importing a file over it).
 */
export type UnsavedAction =
  | "close"
  | "reload"
  | "closeTab"
  | "switchProject"
  | "reimport"
  | "recover"
  | "replaceOnImport"

export interface UnsavedPrompt {
  /** The question, answered with Save, Don't save or Cancel. */
  readonly message: string
  readonly detail: string
}

const doing: Record<UnsavedAction, string> = {
  close: "closing",
  reload: "reloading",
  closeTab: "closing it",
  switchProject: "switching projects",
  reimport: "re-importing it from the game",
  recover: "opening a previous version",
  replaceOnImport: "replacing it with the imported map"
}

const verb: Record<UnsavedAction, string> = {
  close: "close the editor",
  reload: "reload",
  closeTab: "close it",
  switchProject: "switch projects",
  reimport: "re-import it from the game",
  recover: "open a previous version",
  replaceOnImport: "replace it with the imported map"
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
