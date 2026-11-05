import { isModalOpen, useEditor } from "./store"

const isElement = (target: EventTarget | null): target is Element =>
  target !== null && "nodeType" in target && target.nodeType === 1

/**
 * The element an event came from. Not `instanceof`: a panel popped out into its own window has that window's `Element`,
 * and the event's target can be the window itself (keys forwarded from one).
 */
export const elementOf = (target: EventTarget | null): Element | null => isElement(target) ? target : null

const isTypingTarget = (target: EventTarget | null): boolean =>
  isElement(target) &&
  (("isContentEditable" in target && target.isContentEditable === true) ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

/**
 * Keyboard events that belong to a text field, an open dialog or a menu (the menu bar's arrow keys, Escape and
 * type-ahead) never drive the editor, and nothing does while another tab hides the map (`mapInFront`).
 */
export const isEditorKeyEvent = (e: KeyboardEvent): boolean =>
  !isTypingTarget(e.target) &&
  !isModalOpen(useEditor.getState()) &&
  useEditor.getState().mapInFront &&
  elementOf(e.target)?.closest("[role=dialog], [role=menu], [role=menubar]") == null
