/**
 * Paste. In the tab the items came from they go back where they were copied, like the game. Anywhere else that place
 * means nothing, so they're placed anew, as a whole: in a map where a palette piece would go, in a definition's tab
 * centred on the prefab's origin (docs/DESKTOP.md § Edit).
 */
import type { Vec3 } from "../../domain/coords"
import { boxCentreOf, itemsBoxOf } from "../../domain/itemBounds"
import { frameStanding, roomOf } from "../../domain/placement"
import { documentOrigin } from "../../domain/prefab"
import { vecSub } from "../../domain/ueMath"
import { sceneRegistry } from "../sceneRegistry"
import { type DocClip, type EditorState, snapConfigOf, useEditor } from "../store"

/**
 * How far to move `clip` to place it in `s`'s document. Across the floor it moves by whole grid steps, so what sat on the
 * grid still does, and up by whole cm, so it stands on the floor as a palette piece does. Undefined where it was copied.
 */
const pasteOffset = (s: EditorState, clip: DocClip): Vec3 | undefined => {
  if (clip.source === s.tabId) return undefined
  const box = itemsBoxOf(clip.items, s.catalogIndex)
  if (box === undefined) return undefined
  const { height, width } = roomOf(box)
  const offset = s.document.kind === "map"
    ? frameStanding(box, sceneRegistry.placementPoint(width, height))
    : vecSub(documentOrigin(s.document), boxCentreOf(box))
  const step = snapConfigOf(s).gridSize
  const steps = (v: number) => Math.round(v / step) * step
  return { x: steps(offset.x), y: steps(offset.y), z: Math.round(offset.z) }
}

/** Edit › Paste and Ctrl+V. */
export const pasteClipboard = () => {
  const s = useEditor.getState()
  if (s.clipboard !== null) s.paste(pasteOffset(s, s.clipboard))
}
