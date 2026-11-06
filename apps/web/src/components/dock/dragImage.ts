import { elementOf } from "../../editor/keyTargets"

/** Where the pointer holds a whole strip's image: on its first tab. */
const STRIP_GRIP = { x: 12, y: 16 }
const IMAGE_CLASS =
  "dock-drag-image fixed -top-[9999px] left-0 flex h-8 w-max overflow-hidden rounded-[calc(var(--radius)*0.75)] border bg-card text-foreground"

/**
 * A panel's drag shows a copy of its tab on the card it sits on, held where it was grabbed; a group's shows its whole
 * strip. Dockview's image is the bare tab hanging under the pointer, and it has no option for that. This listens on the
 * document, so it runs after dockview's on the tab, and the last `setDragImage` wins. The copy goes in the tab's group,
 * for the rules that style what's in it. Returns how to stop.
 */
export const followDockDrags = (document: Document): () => void => {
  const onDragStart = (e: DragEvent) => {
    const target = elementOf(e.target)
    const group = target?.closest(".dv-groupview")
    if (e.defaultPrevented || e.dataTransfer === null || target == null || group == null) return
    const tab = target.closest(".dv-tab")
    const source = tab ??
      (target.closest(".dv-void-container") === null ? null : group.querySelector(".dv-tabs-container"))
    if (source === null) return
    const image = document.createElement("div")
    image.className = IMAGE_CLASS
    image.append(source.cloneNode(true))
    group.append(image)
    const { left, top } = source.getBoundingClientRect()
    const { width, height } = image.getBoundingClientRect()
    const grip = tab === null ? STRIP_GRIP : { x: e.clientX - left, y: e.clientY - top }
    e.dataTransfer.setDragImage(image, Math.min(grip.x, width), Math.min(grip.y, height))
    setTimeout(() => image.remove(), 0)
  }
  document.addEventListener("dragstart", onDragStart)
  return () => document.removeEventListener("dragstart", onDragStart)
}
