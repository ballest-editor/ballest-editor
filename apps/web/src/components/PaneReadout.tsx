import { useMemo, useSyncExternalStore } from "react"
import { editTransform } from "../domain/editTransform"
import { exactSelectedGroup } from "../domain/groupSelection"
import { formatPaneScale } from "../domain/orthoView"
import { formatPaneReadout, type PaneMark, paneMarkOf } from "../domain/paneReadout"
import { pieceNameOf } from "../domain/structure"
import { isOrthoView, type ViewProjection } from "../domain/viewLayout"
import { onPaneScaleChange, paneCameraAt } from "../editor/paneCameras"
import { useEditor } from "../editor/store"
import { usePaneReading } from "../editor/usePaneReading"

const LINE = "max-w-64 truncate px-0.5 text-caption text-fg-tertiary tabular-nums"

/** The selection as the readout measures to it: the group it is, the one item it is, or a count. */
const useSelectionMark = (): PaneMark | undefined => {
  const selectedIds = useEditor((s) => s.selectedIds)
  const doc = useEditor((s) => s.doc)
  const preview = useEditor((s) => s.preview)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  return useMemo(() => {
    const selected = new Set(selectedIds)
    const items = doc.map.items.flatMap((item, index) => {
      const key = doc.ids[index] ?? ""
      return selected.has(key) ? [{ item, key }] : []
    })
    const [first] = items
    const itemName = first === undefined || items.length > 1
      ? undefined
      : doc.structure.items.get(first.key)?.name ?? pieceNameOf(first.item, catalogIndex)
    const group = exactSelectedGroup(doc.structure.tree, selectedIds, enteredGroupId)
    const points = items.map(({ item, key }) => (preview?.get(key) ?? editTransform(item)).translation)
    return paneMarkOf(points, group?.name ?? itemName)
  }, [selectedIds, doc, preview, catalogIndex, enteredGroupId])
}

/** A perspective pane's scale: the camera's height and how far off the selection is, as it moves. */
function CameraReadout({ slot }: { readonly slot: number }) {
  const units = useEditor((s) => s.settings.general.units)
  const floor = useEditor((s) => s.floorHeight)
  const mark = useSelectionMark()
  const text = usePaneReading(slot, (pane) => formatPaneReadout(pane.eyePoint(), floor, mark, units))
  return <div className={LINE}>{text}</div>
}

/** An orthographic pane's scale: its zoom. */
function ZoomReadout({ slot }: { readonly slot: number }) {
  const units = useEditor((s) => s.settings.general.units)
  // The zoom isn't React state: it changes with every wheel notch.
  const scale = useSyncExternalStore(onPaneScaleChange, () => paneCameraAt(slot).cmPerPixel)
  return <div className={LINE}>{formatPaneScale(scale, units)}</div>
}

/** The line under a pane's gizmo: how big what it shows is. */
export function PaneReadout({ slot, projection }: { readonly slot: number; readonly projection: ViewProjection }) {
  return isOrthoView(projection) ? <ZoomReadout slot={slot} /> : <CameraReadout slot={slot} />
}
