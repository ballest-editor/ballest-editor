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

/** What a focused menu title does itself: walks the menu bar, opens its menu, or leaves the bar (`MenuBar`). */
const MENU_TITLE_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Enter",
  " ",
  "Escape",
  "Tab"
])

/**
 * Keyboard events that belong to a text field, an open dialog or a menu never drive the editor. A menu bar title with
 * its menu closed keeps only the keys it uses, so Ctrl+G still groups with focus on one.
 */
export const isEditorKeyEvent = (e: KeyboardEvent): boolean => {
  if (isTypingTarget(e.target) || isModalOpen(useEditor.getState())) return false
  const element = elementOf(e.target)
  if (element?.closest("[role=dialog], [role=menu]") != null) return false
  return element?.closest("[role=menubar]") == null ||
    (element.ariaExpanded !== "true" && !MENU_TITLE_KEYS.has(e.key))
}
