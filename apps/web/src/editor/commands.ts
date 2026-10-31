/**
 * The editor's commands: what a one-shot keybind runs, and what the menu bar runs for
 * the same action, so the two can't drift apart.
 */
import type { KeybindAction } from "../domain/Keybinds"
import { deleteSelection, duplicateSelection, openMap, saveMap } from "./actions"
import { useEditor } from "./store"

/**
 * The command for each one-shot action. Held keys and mouse drags aren't here (FlyCamera
 * runs them), nor are selection clicks (the viewport does).
 */
export const actionCommands = {
  undo: () => useEditor.getState().undo(),
  redo: () => useEditor.getState().redo(),
  deleteSelection,
  duplicateSelection,
  copySelection: () => useEditor.getState().copySelection(),
  cutSelection: () => useEditor.getState().cutSelection(),
  paste: () => useEditor.getState().paste(),
  focusSelection: () => useEditor.getState().requestFocus(),
  deselect: () => useEditor.getState().select([]),
  selectMode: () => useEditor.getState().setTool("select"),
  translateMode: () => useEditor.getState().setTool("translate"),
  rotateMode: () => useEditor.getState().setTool("rotate"),
  scaleMode: () => useEditor.getState().setTool("scale"),
  toggleGizmoSpace: () => useEditor.getState().toggleGizmoSpace(),
  speedFaster: () => useEditor.getState().changeSpeed(1),
  speedSlower: () => useEditor.getState().changeSpeed(-1),
  newMap: () => useEditor.getState().openDialog("new"),
  openMap: () => void openMap(),
  saveMap: () => void saveMap(),
  saveMapAs: () => useEditor.getState().openDialog("saveAs"),
  showKeybinds: () => useEditor.getState().setCheatSheet(true)
} satisfies Partial<Record<KeybindAction, () => void>>

export type CommandAction = keyof typeof actionCommands

const hasCommand = (action: KeybindAction): action is CommandAction => Object.hasOwn(actionCommands, action)

/** The action's command, or undefined when it isn't a one-shot action. */
export const commandFor = (action: KeybindAction): (() => void) | undefined =>
  hasCommand(action) ? actionCommands[action] : undefined
