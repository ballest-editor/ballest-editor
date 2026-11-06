import { useEffect, useState } from "react"
import type { Item } from "../domain/MapFile"
import { useEditor } from "../editor/store"
import { mapThumbnailFor } from "../editor/thumbnails"

/**
 * `shot`'s items from above, as a data URL: undefined while it renders, null when there is nothing to show. `id` names
 * those items for as long as they last, and each is rendered once. Keep `shot` stable, as a new one renders again.
 */
export const useMapPicture = (shot: { readonly id: string; readonly items: ReadonlyArray<Item> } | null) => {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const surfaces = useEditor((s) => s.surfaces)
  const [rendered, setRendered] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (shot === null || index === null || table === null) return
    let live = true
    void mapThumbnailFor(shot.id, shot.items, index, table, surfaces).then((url) => {
      if (live) setRendered(url ?? null)
    })
    return () => {
      live = false
    }
  }, [shot, index, table, surfaces])
  return rendered
}
