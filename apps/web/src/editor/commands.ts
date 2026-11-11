/**
 * The editor's commands: what a one-shot keybind runs, and what the menu bar runs for
 * the same action, so the two can't drift apart.
 */
import { groupPathOf, soleGroupOf } from "../domain/groupSelection"
import type { KeybindAction } from "../domain/Keybinds"
import type { ViewProjection } from "../domain/viewLayout"
import {
  alignToScreen,
  closeActiveTab,
  cycleTab,
  deleteSelection,
  duplicateSelection,
  importMap,
  playMap,
  saveMap,
  selectAll,
  startNewMap,
  toggleSnapping
} from "./actions"
import { sceneRegistry } from "./sceneRegistry"
import { noTabOpen, useEditor } from "./store"

/** Turns the active pane to `projection`. */
export const lookAlong = (projection: ViewProjection) => {
  const { activePane, setPaneProjection } = useEditor.getState()
  setPaneProjection(activePane, projection)
}

/** Rolls the active pane's orthographic view by quarter turns, clockwise for a positive number. */
export const rollActivePane = (turns: number) => {
  const { activePane, rollPane } = useEditor.getState()
  rollPane(activePane, turns)
}

/** A command that has nothing to act on with no tab open. */
const onOpenTab = (command: () => void) => () => {
  if (!noTabOpen(useEditor.getState())) command()
}

/** Enters the group the selection is, if it is one, with nothing selected inside it, as the outline's Enter group does. */
const enterSelectedGroup = () => {
  const { doc, selectedIds, enteredGroupId, expandGroups, select, enterGroup } = useEditor.getState()
  const { tree } = doc.structure
  const group = soleGroupOf(tree, selectedIds, enteredGroupId)
  if (group === undefined) return
  expandGroups([...groupPathOf(tree, group.id), group.id])
  select([])
  enterGroup(group.id)
}

/**
 * The command for each one-shot action. Held keys and mouse drags aren't here (FlyCamera
 * runs them), nor are selection or paint clicks (the viewport does).
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
  selectAll,
  deselect: () => useEditor.getState().deselect(),
  enterGroup: enterSelectedGroup,
  groupSelection: () => useEditor.getState().groupSelection(),
  chainSelection: () => useEditor.getState().chainSelection(),
  ungroupSelection: () => useEditor.getState().ungroupSelection(),
  alignLeft: () => alignToScreen("left"),
  alignRight: () => alignToScreen("right"),
  alignUp: () => alignToScreen("up"),
  alignDown: () => alignToScreen("down"),
  selectMode: () => useEditor.getState().setTool("select"),
  translateMode: () => useEditor.getState().setTool("translate"),
  rotateMode: () => useEditor.getState().setTool("rotate"),
  scaleMode: () => useEditor.getState().setTool("scale"),
  paintMode: () => useEditor.getState().setTool("paint"),
  toggleGizmoSpace: () => useEditor.getState().toggleGizmoSpace(),
  togglePivotMode: () => useEditor.getState().togglePivotMode(),
  snapToggle: onOpenTab(toggleSnapping),
  speedFaster: () => useEditor.getState().changeSpeed(1),
  speedSlower: () => useEditor.getState().changeSpeed(-1),
  viewTop: () => lookAlong("top"),
  viewBottom: () => lookAlong("bottom"),
  viewFront: () => lookAlong("front"),
  viewBack: () => lookAlong("back"),
  viewRight: () => lookAlong("right"),
  viewLeft: () => lookAlong("left"),
  toggleOrthographic: () => lookAlong(sceneRegistry.toggledProjection()),
  rollViewCounterClockwise: () => rollActivePane(-1),
  rollViewClockwise: () => rollActivePane(1),
  frameAll: onOpenTab(() => useEditor.getState().requestFrameAll()),
  hideSelection: () => useEditor.getState().toggleSelectionFlag("hidden"),
  showAll: () => useEditor.getState().clearFlag("hidden"),
  isolateSelection: () => useEditor.getState().toggleIsolation(),
  lockSelection: () => useEditor.getState().toggleSelectionFlag("locked"),
  unlockAll: () => useEditor.getState().clearFlag("locked"),
  newMap: () => void startNewMap(),
  /** Import… on desktop, Open… in a browser. */
  openMap: () => void importMap(),
  saveMap: onOpenTab(() => void saveMap()),
  /** Duplicate… on desktop, where a map's location is the project; Export… (a download) in a browser. */
  saveMapAs: onOpenTab(() => {
    const { capabilities, document, openDialog } = useEditor.getState()
    // a definition's copies are the Prefabs panel's
    if (document.kind === "map") openDialog({ id: capabilities.projects ? "duplicate" : "saveAs" })
  }),
  closeTab: () => void closeActiveTab(),
  nextTab: () => cycleTab(1),
  previousTab: () => cycleTab(-1),
  playMap: () => void playMap(),
  showKeybinds: () => useEditor.getState().setCheatSheet(true)
} satisfies Partial<Record<KeybindAction, () => void>>

export type CommandAction = keyof typeof actionCommands

const hasCommand = (action: KeybindAction): action is CommandAction => Object.hasOwn(actionCommands, action)

/** The action's command, or undefined when it isn't a one-shot action. */
export const commandFor = (action: KeybindAction): (() => void) | undefined =>
  hasCommand(action) ? actionCommands[action] : undefined
