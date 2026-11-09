/**
 * Editor keybinds. Each action has a list of bindings (primary first); a binding is a
 * chord string: optional modifiers then a code, e.g. "KeyW", "Ctrl+KeyZ", a mouse button
 * "Mouse0" | "Mouse1" | "Mouse2", or a wheel direction "WheelUp" | "WheelDown". Key codes
 * are `KeyboardEvent.code`, so bindings follow physical key positions. An empty list means
 * unbound.
 */
import { Schema } from "effect"
import { type KeyContext, matches, needsDrag, overlaps, specificity, type When, within } from "./keyContext"
import { SNAP_KINDS_OF, type SnapKind, type SnapTransform } from "./snapConfig"
import type { ViewProjection } from "./viewLayout"

/**
 * The sections are the editor's own, the same in Settings and Keyboard shortcuts. The names
 * follow the game: the in-game editor's hotkey overlay ("focus selection", "delete"...) and
 * its settings screen ("forward", "reverse"...). The exceptions: the tools get plain
 * "select", "move", "rotate", "scale" instead of the overlay's "select mode", "move
 * mode"..., the paint tool is the editor's own, and the overlay's edit commands (undo, copy, delete...) get their own "edit"
 * section, in the Edit menu's order. Game actions that mean nothing in the editor (replay
 * controls, nameplates) are omitted; editor-only actions get plain lower-case names in the
 * same style. keybinds.json `label` fields, when the extractor provides them, override the
 * camera names (see GameKeybinds); editor and edit names come from the in-game overlay and
 * are fixed here.
 */
export const keybindSections = [
  {
    name: "editor",
    actions: [
      "selectMode",
      "translateMode",
      "rotateMode",
      "scaleMode",
      "paintMode",
      "toggleGizmoSpace",
      "togglePivotMode",
      "focusSelection",
      "addToSelection",
      "toggleSelection",
      "removeFromSelection",
      "lassoSelect",
      "paintWholePiece",
      "pickPaint"
    ]
  },
  {
    name: "edit",
    actions: [
      "undo",
      "redo",
      "cutSelection",
      "copySelection",
      "paste",
      "duplicateSelection",
      "deleteSelection",
      "selectAll",
      "deselect",
      "cancelDrag",
      "enterGroup",
      "groupSelection",
      "chainSelection",
      "ungroupSelection",
      "alignLeft",
      "alignRight",
      "alignUp",
      "alignDown"
    ]
  },
  {
    name: "camera",
    actions: [
      "moveForward",
      "moveBack",
      "moveLeft",
      "moveRight",
      "look",
      "moveUp",
      "moveDown",
      "lookRight",
      "lookLeft",
      "lookUp",
      "lookDown",
      "fastMove",
      "speedFaster",
      "speedSlower",
      "orbit",
      "pan"
    ]
  },
  {
    name: "view",
    actions: [
      "viewTop",
      "viewBottom",
      "viewFront",
      "viewBack",
      "viewRight",
      "viewLeft",
      "toggleOrthographic",
      "frameAll"
    ]
  },
  {
    name: "snapping",
    actions: [
      "snapToggle",
      "snapOff",
      "snapHold",
      "snapLockX",
      "snapLockY",
      "snapLockZ",
      "snapPlaneX",
      "snapPlaneY",
      "snapPlaneZ",
      "snapOnlyConnectors",
      "snapOnlyMesh",
      "snapOnlyAlignment"
    ]
  },
  { name: "file", actions: ["newMap", "openMap", "saveMap", "saveMapAs", "closeTab", "nextTab", "previousTab"] },
  { name: "game", actions: ["playMap"] },
  { name: "help", actions: ["showKeybinds"] }
] as const

export type KeybindAction = (typeof keybindSections)[number]["actions"][number]
export const keybindActions: ReadonlyArray<KeybindAction> = keybindSections.flatMap((g) => g.actions)

/** Actions named by the in-game editor's hotkey overlay (keybinds.json naming doesn't apply). */
export const editorOverlayActions: ReadonlySet<KeybindAction> = new Set([
  ...keybindSections[0].actions,
  ...keybindSections[1].actions
])

/** The name shown in the settings (the game's wording where the action exists in-game). */
export const keybindActionLabels: Record<KeybindAction, string> = {
  selectMode: "select",
  translateMode: "move",
  rotateMode: "rotate",
  scaleMode: "scale",
  paintMode: "paint",
  toggleGizmoSpace: "local / world axes",
  togglePivotMode: "together / each, rigid / link by link",
  focusSelection: "focus selection",
  addToSelection: "add to selection",
  toggleSelection: "toggle selection",
  removeFromSelection: "remove from selection",
  lassoSelect: "lasso",
  paintWholePiece: "paint whole piece",
  pickPaint: "pick paint",
  deleteSelection: "delete",
  duplicateSelection: "duplicate",
  copySelection: "copy",
  cutSelection: "cut",
  paste: "paste",
  undo: "undo",
  redo: "redo",
  selectAll: "select all",
  deselect: "deselect",
  cancelDrag: "cancel drag",
  enterGroup: "enter group",
  groupSelection: "group",
  chainSelection: "make chain",
  ungroupSelection: "ungroup",
  alignLeft: "align left",
  alignRight: "align right",
  alignUp: "align up",
  alignDown: "align down",
  moveForward: "forward",
  moveBack: "reverse",
  moveLeft: "left",
  moveRight: "right",
  look: "look",
  moveUp: "up",
  moveDown: "down",
  lookRight: "look right",
  lookLeft: "look left",
  lookUp: "look up",
  lookDown: "look down",
  fastMove: "fly faster",
  speedFaster: "camera speed up",
  speedSlower: "camera speed down",
  orbit: "orbit",
  pan: "pan",
  snapToggle: "snapping on / off",
  snapOff: "snapping off",
  snapHold: "hold target",
  snapLockX: "lock to x",
  snapLockY: "lock to y",
  snapLockZ: "lock to z",
  snapPlaneX: "lock to plane across x",
  snapPlaneY: "lock to plane across y",
  snapPlaneZ: "lock to plane across z",
  snapOnlyConnectors: "connectors only",
  snapOnlyMesh: "mesh only",
  snapOnlyAlignment: "alignment only",
  viewTop: "top view",
  viewBottom: "bottom view",
  viewFront: "front view",
  viewBack: "back view",
  viewRight: "right view",
  viewLeft: "left view",
  toggleOrthographic: "perspective view",
  frameAll: "frame all",
  newMap: "new map",
  openMap: "import map",
  saveMap: "save map",
  saveMapAs: "duplicate map",
  closeTab: "close tab",
  nextTab: "next tab",
  previousTab: "previous tab",
  playMap: "play",
  showKeybinds: "keyboard shortcuts"
}

/** What each action does in the editor (binding tooltips). */
export const keybindActionDescriptions: Record<KeybindAction, string> = {
  selectMode: "Select: click to select, no gizmo. Q in the in-game editor.",
  translateMode:
    "Move: drag the arrows or plane handles to move the selection. W in the in-game editor. When its key is also a movement key, the \"fly only while looking\" camera setting decides which it does.",
  rotateMode: "Rotate: drag a ring to rotate the selection. E in the in-game editor.",
  scaleMode:
    "Scale: drag a cube to scale along one axis, or the center ring to scale uniformly. R in the in-game editor.",
  paintMode:
    "Paint: click or drag over pieces to paint the slot under the pointer with the tool's paint or surface, no gizmo. Editor only: the game paints from its Paint panel.",
  toggleGizmoSpace:
    "Switch the move and rotate gizmos between the selected item's own axes (the last one picked, when several are selected) and the world axes. Scale always uses each item's own axes. C in the in-game editor.",
  togglePivotMode:
    "Switch what a selection of several pieces or groups pivots about: one point for all of them, the active one's pivot, as the game does (Together), or each about its own pivot and axes (Each). With a chain selected, switch it between Rigid, where it moves as one piece, and link by link, where a turn bends it, a move spreads it and a scale stretches it. No equivalent in the in-game editor; Blender's pivot key.",
  focusSelection: "Frame the current selection in the viewport. F in the in-game editor.",
  addToSelection:
    "Click an item to add it to the selection (it becomes the active item), or drag a box to add what it catches. Shift+click, as in Unreal's editor; the game's key for this isn't recorded.",
  toggleSelection:
    "Click an item to add it to the selection, or to remove it if it's already selected; drag a box to do that to each thing it catches. Ctrl+click, which the in-game editor uses to deselect.",
  removeFromSelection:
    "Click an item, or drag a box, to take what it catches out of the selection, never adding. Editor only.",
  lassoSelect:
    "Hold while dragging a box to draw a lasso along the pointer's path instead, from where the drag began; let go for the box again. Only once the drag has begun: Alt at the press orbits. Editor only.",
  paintWholePiece:
    "With the paint tool, click or drag with this to paint every slot of a piece instead of the one under the pointer; hold its modifier to see which pieces. A surface always covers the whole piece.",
  pickPaint:
    "With the paint tool, click a piece to take its paint (or its surface) as the tool's, painting nothing. Dragging still orbits.",
  deleteSelection: "Delete the selected items. Backspace in the in-game editor; Delete also works.",
  duplicateSelection:
    "Copy the selected items in place and select the copies, ready to move. Ctrl+D, as in Unreal's editor; the game has no key for this and duplicates with Alt+drag on the move gizmo (see General settings).",
  copySelection:
    "Copy the selected items, with their properties, so paste can add them again. Ctrl+C in the in-game editor.",
  cutSelection:
    "Copy the selected items, then delete them (one undo step); paste puts them back where they were. Editor only: the game has copy and paste but no cut.",
  paste:
    "Add the copied items where they were when copied, and select them. Ctrl+V in the in-game editor, which also pastes in place.",
  undo: "Undo the last change. Ctrl+Z in the in-game editor; a whole gizmo drag or number-field scrub is one step.",
  redo: "Redo the last undone change. Ctrl+Y in the in-game editor; Ctrl+Shift+Z also works.",
  selectAll: "Select every item in the map; inside an entered group, every item in that group.",
  deselect:
    "Clear the selection. Inside an entered group it steps out of the group instead, and with a pane maximised it restores the panes. (The game uses Ctrl+click.)",
  cancelDrag:
    "During a drag, put the selection back where it started and end the drag; an Alt+drag's copies go. Editor only: the game has no gizmo drags to cancel.",
  enterGroup:
    "Enter the selected group, so a click selects what is inside it. Double-clicking an item of a group does the same. Editor only.",
  groupSelection:
    "Group the selection. Clicking any item of a group then selects the whole group. Ctrl+G in the in-game editor.",
  chainSelection:
    "Make the selection a chain, its links in order along the pieces from the first selected; one whole group selected becomes a chain itself. A turn then bends it. Editor only.",
  ungroupSelection: "Dissolve the selected groups; their items stay selected. Shift+G in the in-game editor.",
  alignLeft:
    "Line the selection up on the active item's side that's left on screen in the active pane, along whichever axis runs most nearly that way. Editor only.",
  alignRight:
    "Line the selection up on the active item's side that's right on screen in the active pane, along whichever axis runs most nearly that way. Editor only.",
  alignUp:
    "Line the selection up on the active item's side that's up on screen in the active pane, along whichever axis runs most nearly that way. Editor only.",
  alignDown:
    "Line the selection up on the active item's side that's down on screen in the active pane, along whichever axis runs most nearly that way. Editor only.",
  moveForward: "Fly the camera forward while held.",
  moveBack: "Fly the camera backward while held.",
  moveLeft: "Fly the camera left while held.",
  moveRight: "Fly the camera right while held.",
  look:
    "Hold and drag to turn the camera. The game uses plain mouse movement; in the browser a button has to be held. While it's held, the fly keys never trigger tool shortcuts.",
  moveUp: "Fly the camera straight up while held.",
  moveDown:
    "Fly the camera straight down while held. Left Ctrl, as in the game; when it's the modifier of a shortcut (Ctrl+Z, Ctrl+C...) it doesn't move the camera.",
  lookRight: "Turn the camera right while held.",
  lookLeft: "Turn the camera left while held.",
  lookUp: "Tilt the camera up while held.",
  lookDown: "Tilt the camera down while held.",
  fastMove: "Hold to fly several times faster. Unbound by default: the mouse wheel changes camera speed.",
  speedFaster: "Raise the camera's fly speed one step.",
  speedSlower: "Lower the camera's fly speed one step.",
  orbit: "Hold and drag to orbit around the focus point.",
  pan: "Hold and drag to slide the camera sideways and up/down.",
  snapToggle:
    "Turn snapping as a whole on or off: the magnet in the view bar. Grid, rotation, scale and each target keep their own toggles under it. No equivalent in the in-game editor.",
  snapOff:
    "Hold during a drag: nothing snaps while it is held. With snapping off already it does nothing. Only once a drag has begun, so Ctrl still flies down.",
  snapHold:
    "Hold during a drag: the selection stays on the target it found, sliding along it, and nothing else takes over.",
  snapLockX: "During a drag, lock the move to the X axis (the grid's, when it is turned). Press again to unlock.",
  snapLockY: "During a drag, lock the move to the Y axis (the grid's, when it is turned). Press again to unlock.",
  snapLockZ: "During a drag, lock the move to the Z axis. Press again to unlock.",
  snapPlaneX: "During a drag, lock the move to the plane square to X. Press again to unlock.",
  snapPlaneY: "During a drag, lock the move to the plane square to Y. Press again to unlock.",
  snapPlaneZ: "During a drag, lock the move to the plane square to Z. Press again to unlock.",
  snapOnlyConnectors:
    "Hold during a move or a turn: only connector ends count, even with snapping off. A move stays where it started until one of its ends meets another on screen, from further off than usual, and jumps to the join. J for join: C is the game's key for the gizmo's axes.",
  snapOnlyMesh:
    "Hold during a move, a turn or a scale: only the Mesh target counts (vertices, edges and faces, and the faces a turn or a scale stops on), even with snapping off. M for mesh.",
  snapOnlyAlignment:
    "Hold during a move: only alignment and tracking count, even with snapping off, so a row lines up without the grid or a face taking over. L for line up: A flies the camera left.",
  viewTop: "Look straight down in the active pane, orthographic. Editor only: the game has no orthographic views.",
  viewBottom: "Look straight up from under the map in the active pane, orthographic.",
  viewFront: "Look at the map from its front (the +X side, the game's forward) in the active pane, orthographic.",
  viewBack: "Look at the map from its back (the -X side) in the active pane, orthographic.",
  viewRight: "Look at the map from its right (the +Y side) in the active pane, orthographic.",
  viewLeft: "Look at the map from its left (the -Y side) in the active pane, orthographic.",
  toggleOrthographic:
    "Switch the active pane between perspective and the orthographic view closest to where it is looking.",
  frameAll: "Frame the whole map in the active pane.",
  newMap: "Start a new map.",
  openMap:
    "Import a .balledit or .ballmap file: it is copied into the project and opened from there. In the browser, open it.",
  saveMap:
    "Save the map into the project, asking nothing; after a rename the file moves to match. In the browser, download it.",
  saveMapAs:
    "Copy the map into the project under a new name and go on editing the copy. In the browser, export it (a download).",
  closeTab:
    "Close the open map's tab, asking about unsaved edits first. Closing the last one leaves a fresh map. Not Ctrl+W: Left Ctrl flies down, so Ctrl+W is down and forward.",
  nextTab: "Switch to the next map tab, wrapping around.",
  previousTab: "Switch to the previous map tab, wrapping around.",
  playMap:
    "Export the map to the game and race it there through the plugin manager, starting the game if it isn't running. Desktop app only.",
  showKeybinds: "Hold to show every keybind over the viewport; release to hide it. Editor only."
}

/** The keybind that puts the active pane on each view; Perspective has only the toggle. */
export const PROJECTION_ACTIONS: Readonly<Record<ViewProjection, KeybindAction>> = {
  perspective: "toggleOrthographic",
  top: "viewTop",
  bottom: "viewBottom",
  front: "viewFront",
  back: "viewBack",
  left: "viewLeft",
  right: "viewRight"
}

/** Actions bound to a mouse click (with modifiers) on an item in the viewport. */
export const mouseClickActions: ReadonlySet<KeybindAction> = new Set([
  "addToSelection",
  "toggleSelection",
  "removeFromSelection",
  "paintWholePiece",
  "pickPaint"
])

/** Actions bound to a mouse button held while dragging. */
export const mouseDragActions: ReadonlySet<KeybindAction> = new Set(["look", "orbit", "pan"])

/** The camera flies and changes speed with nothing dragged, during a look, and while a handle or body is being dragged. */
const FLYING: When = { drag: ["none", "camera", "move", "turn", "scale"] }
/** The tools whose clicks select; the paint tool's paint. */
const SELECTING: When = { tool: ["select", "translate", "rotate", "scale"] }
const PAINTING: When = { tool: ["paint"] }
const snapTransforms = ["move", "turn", "scale"] as const satisfies ReadonlyArray<SnapTransform>
/** The drags a snap key that narrows to `kind` is live in: the transforms that snap to that kind. */
const narrowing = (kind: SnapKind): When => ({
  drag: snapTransforms.filter((transform) => (SNAP_KINDS_OF[transform] as ReadonlyArray<SnapKind>).includes(kind))
})

/**
 * Where each action's bindings work (docs/design/keybinding-contexts.md). An action not listed works with nothing
 * dragged, in every tool, on both platforms. The drags are exclusive, so a key that means something during a move
 * (X locks the axis) is free to mean something else with nothing dragged (Ctrl+X cuts).
 */
export const actionWhen: Readonly<Record<KeybindAction, When>> = {
  selectMode: {},
  translateMode: {},
  rotateMode: {},
  scaleMode: {},
  paintMode: {},
  toggleGizmoSpace: {},
  togglePivotMode: {},
  focusSelection: {},
  addToSelection: SELECTING,
  toggleSelection: SELECTING,
  removeFromSelection: SELECTING,
  lassoSelect: { drag: ["area"] },
  paintWholePiece: PAINTING,
  pickPaint: PAINTING,
  undo: {},
  redo: {},
  cutSelection: {},
  copySelection: {},
  paste: {},
  duplicateSelection: {},
  deleteSelection: {},
  selectAll: {},
  deselect: {},
  cancelDrag: { drag: ["move", "turn", "scale", "area"] },
  enterGroup: {},
  groupSelection: {},
  chainSelection: {},
  ungroupSelection: {},
  alignLeft: {},
  alignRight: {},
  alignUp: {},
  alignDown: {},
  moveForward: FLYING,
  moveBack: FLYING,
  moveLeft: FLYING,
  moveRight: FLYING,
  look: {},
  moveUp: FLYING,
  moveDown: FLYING,
  lookRight: FLYING,
  lookLeft: FLYING,
  lookUp: FLYING,
  lookDown: FLYING,
  fastMove: FLYING,
  speedFaster: FLYING,
  speedSlower: FLYING,
  orbit: {},
  pan: {},
  viewTop: {},
  viewBottom: {},
  viewFront: {},
  viewBack: {},
  viewRight: {},
  viewLeft: {},
  toggleOrthographic: {},
  frameAll: {},
  snapToggle: {},
  snapOff: { drag: ["move", "turn", "scale", "place"] },
  snapHold: { drag: ["move", "turn"] },
  snapLockX: { drag: ["move"] },
  snapLockY: { drag: ["move"] },
  snapLockZ: { drag: ["move"] },
  snapPlaneX: { drag: ["move"] },
  snapPlaneY: { drag: ["move"] },
  snapPlaneZ: { drag: ["move"] },
  snapOnlyConnectors: narrowing("connectors"),
  snapOnlyMesh: narrowing("mesh"),
  snapOnlyAlignment: narrowing("alignment"),
  newMap: {},
  openMap: {},
  saveMap: {},
  saveMapAs: {},
  closeTab: {},
  nextTab: {},
  previousTab: {},
  playMap: { platform: ["desktop"] },
  showKeybinds: {}
}

/** Actions a drag takes once it has begun (docs/SNAPPING.md § Modifiers): nothing fires them from a key by itself. */
export const duringDragActions: ReadonlySet<KeybindAction> = new Set(
  keybindActions.filter((action) => needsDrag(actionWhen[action]))
)

/**
 * The word the status bar puts beside a drag key's chip, in the snap menu's words for the targets
 * (docs/SNAPPING.md § Modifiers). Keys that share a word share a hint (X, Y and Z: lock). A drag key without one isn't
 * listed.
 */
export const keybindActionHints: Partial<Record<KeybindAction, string>> = {
  snapOff: "off",
  snapHold: "hold",
  snapLockX: "lock",
  snapLockY: "lock",
  snapLockZ: "lock",
  snapOnlyConnectors: "ends",
  snapOnlyMesh: "pieces",
  snapOnlyAlignment: "guides",
  lassoSelect: "lasso"
}

/** Actions that are held down rather than fired once. */
export const heldActions: ReadonlySet<KeybindAction> = new Set([
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "moveUp",
  "moveDown",
  "lookRight",
  "lookLeft",
  "lookUp",
  "lookDown",
  "fastMove"
])

export type Bindings = ReadonlyArray<string>
export type Keybinds = Readonly<Record<KeybindAction, Bindings>>

/**
 * The defaults: the game's own bindings (its level-editor hotkey overlay and its settings
 * screen), plus editor-only actions. GameKeybinds overlays whatever assets/keybinds.json
 * defines on top.
 */
export const defaultKeybinds: Keybinds = {
  snapToggle: ["KeyN"],
  snapOff: ["ControlLeft", "ControlRight"],
  snapHold: ["ShiftLeft", "ShiftRight"],
  snapLockX: ["KeyX"],
  snapLockY: ["KeyY"],
  snapLockZ: ["KeyZ"],
  snapPlaneX: ["Shift+KeyX"],
  snapPlaneY: ["Shift+KeyY"],
  snapPlaneZ: ["Shift+KeyZ"],
  snapOnlyConnectors: ["KeyJ"],
  snapOnlyMesh: ["KeyM"],
  snapOnlyAlignment: ["KeyL"],
  selectMode: ["KeyQ"],
  translateMode: ["KeyW"],
  rotateMode: ["KeyE"],
  scaleMode: ["KeyR"],
  paintMode: ["KeyB"],
  toggleGizmoSpace: ["KeyC"],
  togglePivotMode: ["Period"],
  focusSelection: ["KeyF"],
  addToSelection: ["Shift+Mouse0"],
  toggleSelection: ["Ctrl+Mouse0"],
  removeFromSelection: ["Ctrl+Shift+Mouse0"],
  lassoSelect: ["AltLeft", "AltRight"],
  paintWholePiece: ["Shift+Mouse0"],
  pickPaint: ["Alt+Mouse0"],
  deleteSelection: ["Backspace", "Delete"],
  duplicateSelection: ["Ctrl+KeyD"],
  copySelection: ["Ctrl+KeyC"],
  cutSelection: ["Ctrl+KeyX"],
  paste: ["Ctrl+KeyV"],
  undo: ["Ctrl+KeyZ"],
  redo: ["Ctrl+KeyY", "Ctrl+Shift+KeyZ"],
  selectAll: ["Ctrl+KeyA"],
  deselect: ["Escape"],
  cancelDrag: ["Escape"],
  enterGroup: ["Enter", "NumpadEnter"],
  groupSelection: ["Ctrl+KeyG"],
  chainSelection: ["Ctrl+Shift+KeyG"],
  ungroupSelection: ["Shift+KeyG"],
  alignLeft: ["Ctrl+Shift+ArrowLeft"],
  alignRight: ["Ctrl+Shift+ArrowRight"],
  alignUp: ["Ctrl+Shift+ArrowUp"],
  alignDown: ["Ctrl+Shift+ArrowDown"],
  moveForward: ["KeyW"],
  moveBack: ["KeyS"],
  moveLeft: ["KeyA"],
  moveRight: ["KeyD"],
  look: ["Mouse2"],
  moveUp: ["Space"],
  moveDown: ["ControlLeft"],
  lookRight: ["ArrowRight"],
  lookLeft: ["ArrowLeft"],
  lookUp: ["ArrowUp"],
  lookDown: ["ArrowDown"],
  fastMove: [],
  speedFaster: ["WheelUp"],
  speedSlower: ["WheelDown"],
  orbit: ["Alt+Mouse0"],
  pan: ["Mouse1"],
  viewTop: ["Numpad7"],
  viewBottom: ["Ctrl+Numpad7"],
  viewFront: ["Numpad1"],
  viewBack: ["Ctrl+Numpad1"],
  viewRight: ["Numpad3"],
  viewLeft: ["Ctrl+Numpad3"],
  toggleOrthographic: ["Numpad5"],
  frameAll: ["Shift+KeyF"],
  newMap: ["Alt+KeyN"],
  openMap: ["Ctrl+KeyO"],
  saveMap: ["Ctrl+KeyS"],
  saveMapAs: ["Ctrl+Shift+KeyS"],
  closeTab: ["Ctrl+F4"],
  nextTab: ["Ctrl+Tab", "Ctrl+PageDown"],
  previousTab: ["Ctrl+Shift+Tab", "Ctrl+PageUp"],
  playMap: ["F5"],
  showKeybinds: ["Shift+Slash"]
}

/** What's persisted: any subset, unknown actions ignored. Older saves stored one string. */
export const StoredKeybinds = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Array(Schema.String)]))
export type StoredKeybinds = typeof StoredKeybinds.Type

export const uniqueBindings = (
  bindings: ReadonlyArray<string>
): Bindings => [...new Set(bindings.filter((b) => b.length > 0))]

/** Actions saved under an older name: their bindings carry over when the new name has none saved. */
const RENAMED_ACTIONS: Partial<Record<KeybindAction, string>> = {
  openMap: "importMap",
  saveMapAs: "exportMap",
  snapOff: "snapInvert"
}

export const mergeKeybinds = (stored: StoredKeybinds, defaults: Keybinds = defaultKeybinds): Keybinds => {
  const out: Record<KeybindAction, Bindings> = { ...defaults }
  for (const action of keybindActions) {
    const renamed = RENAMED_ACTIONS[action]
    const value = stored[action] ?? (renamed === undefined ? undefined : stored[renamed])
    if (value === undefined) continue
    out[action] = uniqueBindings(typeof value === "string" ? [value] : value)
  }
  // a drag used to cancel on the deselect key too, so a save from then keeps cancelling on what deselect was bound to
  if (stored["cancelDrag"] === undefined && stored["deselect"] !== undefined) {
    out.cancelDrag = uniqueBindings([...out.cancelDrag, ...out.deselect])
  }
  return out
}

export const sameBindings = (a: Bindings, b: Bindings): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** True when the action's bindings are exactly its defaults. */
export const isDefaultBinding = (keybinds: Keybinds, defaults: Keybinds, action: KeybindAction): boolean =>
  sameBindings(keybinds[action], defaults[action])

const MODIFIER_NAME_CODES: Readonly<Record<string, ReadonlyArray<string>>> = {
  Ctrl: ["ControlLeft", "ControlRight", "MetaLeft", "MetaRight"],
  Alt: ["AltLeft", "AltRight"],
  Shift: ["ShiftLeft", "ShiftRight"]
}

/** Does releasing key `code` end a hold of `binding` (its key, or one of its modifiers)? */
export const releasesBinding = (binding: string, code: string): boolean =>
  binding.split("+").some((part) => part === code || (MODIFIER_NAME_CODES[part]?.includes(code) ?? false))

/** Is `binding` held, of the codes `pressed`: its key, and each of its modifiers by either hand? */
export const bindingHeld = (binding: string, pressed: ReadonlySet<string>): boolean =>
  binding.length > 0 &&
  binding.split("+").every((part) =>
    pressed.has(part) || (MODIFIER_NAME_CODES[part]?.some((code) => pressed.has(code)) ?? false)
  )

/** Is `chord` one of the action's bindings? */
export const isBound = (keybinds: Keybinds, action: KeybindAction, chord: string): boolean =>
  keybinds[action].includes(chord)

/** The action(s) a chord is bound to, wherever they work. */
export const actionsFor = (keybinds: Keybinds, chord: string): ReadonlyArray<KeybindAction> =>
  keybindActions.filter((action) => keybinds[action].includes(chord))

/**
 * The actions `chord` fires in `ctx`: those bound to it whose condition holds, the narrowest first, so a binding that
 * names the tool or the drag wins over one that works everywhere. Two with the same specificity keep the table's order,
 * and are what `conflictingBindings` marks.
 */
export const resolveChord = (keybinds: Keybinds, ctx: KeyContext, chord: string): ReadonlyArray<KeybindAction> =>
  actionsFor(keybinds, chord)
    .filter((action) => matches(actionWhen[action], ctx))
    .map((action, index) => ({ action, index, rank: specificity(actionWhen[action]) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ action }) => action)

/** Is `chord` bound to `action` where `ctx` is? */
export const firesHere = (keybinds: Keybinds, ctx: KeyContext, action: KeybindAction, chord: string): boolean =>
  keybinds[action].includes(chord) && matches(actionWhen[action], ctx)

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight"
])

export interface ModifierState {
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

const withModifiers = (e: ModifierState, code: string): string => {
  const mods: Array<string> = []
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl")
  if (e.altKey) mods.push("Alt")
  if (e.shiftKey) mods.push("Shift")
  return [...mods, code].join("+")
}

/** Chord string for a key event. Modifier keys pressed on their own produce just their code. */
export const chordOf = (e: ModifierState & { readonly code: string }): string =>
  MODIFIER_CODES.has(e.code) ? e.code : withModifiers(e, e.code)

export const mouseChordOf = (e: ModifierState & { readonly button: number }): string =>
  withModifiers(e, `Mouse${e.button}`)

/**
 * The chord a press starts a camera drag with: its own, or the bare button when the modifiers make it mean nothing. Left
 * Ctrl held to fly down mustn't stop right-click looking, and the bindings that do use a modifier keep it.
 */
export const dragChordOf = (keybinds: Keybinds, e: ModifierState & { readonly button: number }): string => {
  const chord = mouseChordOf(e)
  return actionsFor(keybinds, chord).length > 0 ? chord : `Mouse${e.button}`
}

interface WheelState extends ModifierState {
  readonly deltaX: number
  readonly deltaY: number
}

/** How far up or down a scroll went. Windows turns Shift+scroll sideways; any other sideways scroll is zero. */
const wheelDelta = (e: WheelState): number => e.deltaY !== 0 ? e.deltaY : e.shiftKey ? e.deltaX : 0

const wheelCodeOf = (e: WheelState): string => wheelDelta(e) < 0 ? "WheelUp" : "WheelDown"

export const wheelChordOf = (e: WheelState): string => withModifiers(e, wheelCodeOf(e))

/**
 * The camera speed step a scroll asks for. Modifiers don't take the wheel away: Left Ctrl flies down, and
 * the speed has to change on the way. A chord bound with the modifiers held wins over the plain wheel.
 */
export const wheelSpeedStep = (keybinds: Keybinds, e: WheelState): 1 | -1 | 0 => {
  if (wheelDelta(e) === 0) return 0
  for (const chord of [wheelChordOf(e), wheelCodeOf(e)]) {
    if (isBound(keybinds, "speedFaster", chord)) return 1
    if (isBound(keybinds, "speedSlower", chord)) return -1
  }
  return 0
}

/** The key code a binding waits for, ignoring modifiers (used for held movement keys). */
export const baseCodeOf = (binding: string): string => binding.slice(binding.lastIndexOf("+") + 1)

/**
 * Whether the modifiers held are exactly those of one of the action's bindings that has any: Shift held reads as
 * "Shift+Mouse0" before the click, for a hover that shows what the click will do.
 */
export const holdsModifiersOf = (keybinds: Keybinds, action: KeybindAction, e: ModifierState): boolean =>
  keybinds[action].some((binding) => binding.includes("+") && withModifiers(e, baseCodeOf(binding)) === binding)

/** True when `chord` is bound to a one-shot action (anything that isn't held or a drag). */
export const isOneShotChord = (keybinds: Keybinds, chord: string): boolean =>
  actionsFor(keybinds, chord).some((action) =>
    !heldActions.has(action) && !mouseDragActions.has(action) && !duringDragActions.has(action)
  )

/** True when `chord` (from chordOf) is bound to a one-shot action with a modifier, e.g. Ctrl+KeyZ. */
export const isBoundChord = (keybinds: Keybinds, chord: string): boolean =>
  chord.includes("+") && isOneShotChord(keybinds, chord)

/** How long a bare modifier must be held alone before it drives a held action (fly down on Ctrl). */
export const MODIFIER_HOLD_MS = 120

/**
 * Tracks held keys for continuous actions. A bare modifier (Ctrl/Shift/Alt) bound to a
 * held action only counts once it has been held for MODIFIER_HOLD_MS, unless the caller
 * says it counts at once (see `flyingActions`); pressing a key or button that makes it a
 * chord while it's down (Ctrl+Z, Ctrl+C, Ctrl+click with "down" on
 * Left Ctrl) suppresses it until it's released. Movement keys (Ctrl+W flying down and
 * forward) don't. So chords take precedence over a modifier used as a movement key.
 */
export class HeldKeys {
  private readonly downAt = new Map<string, number>()
  private readonly suppressed = new Set<string>()

  /** `formsChord`: this press made a chord with the held modifiers (see `formsChord` in flyKeys). */
  press(code: string, now: number, formsChord = false): void {
    if (!this.downAt.has(code)) this.downAt.set(code, now)
    if (formsChord && !MODIFIER_CODES.has(code)) this.suppressModifiers()
  }

  /**
   * The key `code` was pressed as a bound chord with modifiers (`isBoundChord`): until it is released it drives no held
   * action, so Ctrl+Shift+Left aligns and doesn't also turn the camera left.
   */
  claim(code: string): void {
    if (this.downAt.has(code)) this.suppressed.add(code)
  }

  /** The held modifiers are part of a chord (a key or a click): none of them drive held actions until released. */
  suppressModifiers(): void {
    for (const held of this.downAt.keys()) if (MODIFIER_CODES.has(held)) this.suppressed.add(held)
  }

  release(code: string): void {
    this.downAt.delete(code)
    this.suppressed.delete(code)
  }

  clear(): void {
    this.downAt.clear()
    this.suppressed.clear()
  }

  has(code: string): boolean {
    return this.downAt.has(code)
  }

  anyModifierHeld(): boolean {
    for (const code of this.downAt.keys()) if (MODIFIER_CODES.has(code)) return true
    return false
  }

  /** Is one of the action's bindings held? (bare modifiers obey the chord rule) */
  holdsAny(bindings: Bindings, now: number): boolean {
    return bindings.some((binding) => this.holds(binding, now))
  }

  /** Is the binding's key held, for a held action? (bare modifiers obey the chord rule; `atOnce` skips their wait) */
  holds(binding: string, now: number, atOnce = false): boolean {
    if (binding.length === 0) return false
    const code = baseCodeOf(binding)
    const since = this.downAt.get(code)
    if (since === undefined || this.suppressed.has(code)) return false
    return !MODIFIER_CODES.has(code) || atOnce || now - since >= MODIFIER_HOLD_MS
  }
}

const SYMBOLS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Slash: "/",
  Backslash: "\\",
  Period: ".",
  Comma: ",",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "="
}

/** Whether this is macOS. A browser global, read here and nowhere else. */
const onMac = /^mac/i.test(navigator.platform)

/**
 * Display form of one chord, e.g. "Ctrl + Z", "RMB", "←". `chordOf` takes ⌘ and Ctrl alike, and macOS calls it ⌘. `mac`
 * is for tests: the app shows this machine's.
 */
export const formatBinding = (binding: string, mac = onMac): string =>
  binding.length === 0 ? "Unbound" : binding
    .split("+")
    .map((part) => {
      if (part === "Ctrl") return mac ? "⌘" : "Ctrl"
      if (part.startsWith("Key")) return part.slice(3)
      if (part.startsWith("Digit")) return part.slice(5)
      if (/^Numpad\d$/.test(part)) return `Num ${part.slice(6)}`
      if (part === "Mouse0") return "LMB"
      if (part === "Mouse1") return "MMB"
      if (part === "Mouse2") return "RMB"
      if (part.startsWith("Mouse")) return `Mouse ${Number(part.slice(5)) + 1}`
      if (SYMBOLS[part] !== undefined) return SYMBOLS[part]
      if (part === "WheelUp") return "Wheel up"
      if (part === "WheelDown") return "Wheel down"
      if (part.endsWith("Left") && MODIFIER_CODES.has(part)) return part.replace("Left", "")
      if (part.endsWith("Right") && MODIFIER_CODES.has(part)) return `Right ${part.replace("Right", "")}`
      return part
    })
    .join(" + ")

/** Display form of an action's bindings ("Q / F", or "Unbound"). */
export const formatBindings = (bindings: Bindings): string =>
  bindings.length === 0 ? "Unbound" : bindings.map((binding) => formatBinding(binding)).join(" / ")

/** A click binding as a hint says it: "Alt + click", "Click"; anything else as `formatBinding` has it. */
export const formatClick = (binding: string, mac = onMac): string => {
  if (baseCodeOf(binding) !== "Mouse0") return formatBinding(binding, mac)
  const at = binding.lastIndexOf("+")
  return at < 0 ? "Click" : `${formatBinding(binding.slice(0, at), mac)} + click`
}

/** The modifiers of a click binding, as a hint says them ("Shift"); undefined when it has none. */
export const formatModifiers = (binding: string, mac = onMac): string | undefined => {
  const at = binding.lastIndexOf("+")
  return at < 0 ? undefined : formatBinding(binding.slice(0, at), mac)
}

/** What a chord bound to an action runs into elsewhere in the table. */
export interface BindingConflict {
  /** Actions with the same chord whose conditions can hold at once, neither within the other: Settings marks these red. */
  readonly clashes: ReadonlyArray<KeybindAction>
  /** Actions this binding takes the chord from where its narrower condition holds (the eyedropper over orbit, in Paint). */
  readonly overrides: ReadonlyArray<KeybindAction>
  /** Actions that take the chord from this one where theirs holds. */
  readonly overriddenBy: ReadonlyArray<KeybindAction>
}

/** Each action's chords that run into another action's, with what they run into. */
export type BindingConflicts = ReadonlyMap<KeybindAction, ReadonlyMap<string, BindingConflict>>

/**
 * Where two actions share a chord and both conditions (`actionWhen`) can hold at once. A condition within the other's
 * overrides it there rather than clashing: Alt+click picks paint in the Paint tool and orbits in the rest. Held camera
 * keys never clash with anything else: a fly key doubling as a tool shortcut (W: forward + translate, as in the game) is
 * decided by the "movement keys need the look button" setting, and Ctrl, flying down, is snapping's once a drag has
 * begun because the camera lets go of its modifiers then (FlyCamera).
 */
export const conflictingBindings = (keybinds: Keybinds): BindingConflicts => {
  const out = new Map<KeybindAction, Map<string, BindingConflict>>()
  for (const action of keybindActions) {
    for (const chord of keybinds[action]) {
      const others = actionsFor(keybinds, chord).filter((other) =>
        other !== action && heldActions.has(other) === heldActions.has(action) &&
        overlaps(actionWhen[action], actionWhen[other])
      )
      if (others.length === 0) continue
      const mine = actionWhen[action]
      // only a key that fires one action at a time can be overridden: held keys and a drag's all apply at once
      const exclusive = (other: KeybindAction) =>
        !heldActions.has(other) && !duringDragActions.has(other) && !duringDragActions.has(action)
      const overrides = (a: When, b: When) => within(a, b) && !within(b, a)
      const conflict: BindingConflict = {
        overrides: others.filter((other) => exclusive(other) && overrides(mine, actionWhen[other])),
        overriddenBy: others.filter((other) => exclusive(other) && overrides(actionWhen[other], mine)),
        clashes: others.filter((other) =>
          !exclusive(other) || (!overrides(mine, actionWhen[other]) && !overrides(actionWhen[other], mine))
        )
      }
      const byChord = out.get(action) ?? new Map<string, BindingConflict>()
      byChord.set(chord, conflict)
      out.set(action, byChord)
    }
  }
  return out
}

/** The chords Settings marks red: bound to two actions that can both take them. */
export const clashingChords = (conflicts: BindingConflicts): ReadonlySet<string> =>
  new Set(
    [...conflicts.values()].flatMap((byChord) =>
      [...byChord].filter(([, conflict]) => conflict.clashes.length > 0).map(([chord]) => chord)
    )
  )
