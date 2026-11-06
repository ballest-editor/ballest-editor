import { setWindowTheme } from "../../editor/actions"
import { elementOf, isEditorKeyEvent } from "../../editor/keyTargets"
import { followDockDrags } from "./dragImage"

/**
 * Chrome hands focus back after a pointer click (docs/DESKTOP.md § Dock). Not in dialogs, nor in the menu bar: its menus
 * open in the next frame and would close on the blur, and they hand focus back themselves. Returns how to stop.
 */
export const blurChromeAfterClick = (document: Document): () => void => {
  const onPointerUp = (e: PointerEvent) => {
    const chrome = elementOf(e.target)?.closest<HTMLElement>("button, .dv-tab")
    // this document's frame: the other window's may not run while this one has the focus
    if (chrome?.closest("[role=dialog], [role=menubar]") === null) {
      document.defaultView?.requestAnimationFrame(() => chrome.blur())
    }
  }
  document.addEventListener("pointerup", onPointerUp)
  return () => document.removeEventListener("pointerup", onPointerUp)
}

/**
 * Makes a popped-out panel's window part of the editor. It follows the main window's theme and animation speed (both
 * live on <html>), its chrome hands focus back, its drags look like the main window's, and the keys it doesn't use go
 * to the main window, where the keybinds listen. Dockview has already copied the stylesheets over. Returns how to stop.
 */
export const adoptPopoutWindow = (popout: Window, title: string): () => void => {
  popout.document.title = title
  const source = document.documentElement
  const target = popout.document.documentElement
  const mirror = () => {
    target.className = source.className
    target.style.cssText = source.style.cssText
  }
  mirror()
  const observer = new MutationObserver(mirror)
  observer.observe(source, { attributes: true, attributeFilter: ["class", "style"] })
  // the desktop window's controls and background are recoloured with the main window's, and this one starts on neither
  void setWindowTheme(source.classList.contains("dark"))

  const stopBlurring = blurChromeAfterClick(popout.document)
  const stopFollowingDrags = followDockDrags(popout.document)
  const forwarding = new AbortController()
  const { signal } = forwarding
  popout.addEventListener("keydown", (e) => {
    if (isEditorKeyEvent(e) && !window.dispatchEvent(new KeyboardEvent(e.type, e))) e.preventDefault()
  }, { signal })
  popout.addEventListener("keyup", (e) => void window.dispatchEvent(new KeyboardEvent(e.type, e)), { signal })
  // held keys stop flying when the focus leaves, as they do in the main window
  popout.addEventListener("blur", () => void window.dispatchEvent(new Event("blur")), { signal })
  return () => {
    observer.disconnect()
    stopBlurring()
    stopFollowingDrags()
    forwarding.abort()
  }
}
