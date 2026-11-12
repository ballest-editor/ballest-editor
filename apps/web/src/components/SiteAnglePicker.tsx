import type { PrefabRef } from "@ballest/contracts"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef, useState } from "react"
import { readDefinitionItems } from "../editor/actions"
import { mountSitePreview, type SitePreview } from "../editor/sitePreview"
import { useEditor } from "../editor/store"
import { THUMBNAIL_TILE } from "./PieceThumbnail"

/** The preview's size in css px, square like the site's gallery card. */
const SIZE = 240

/**
 * The upload's view of the prefab for its picture on ballestrecords.com: drag to turn it, scroll to zoom, right-drag to
 * pan. `onReady` gets the preview once it has drawn, to read the view from at Upload, and null when it goes.
 */
export function SiteAnglePicker({ onReady, prefab }: {
  readonly onReady: (preview: SitePreview | null) => void
  readonly prefab: PrefabRef
}) {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [preview, setPreview] = useState<SitePreview | "loading" | "empty">("loading")
  useEffect(() => {
    const element = canvas.current
    if (element === null || index === null || table === null) return
    const status = { live: true, mounted: null as SitePreview | null }
    void readDefinitionItems(prefab)
      .then((items) => mountSitePreview(element, SIZE, items, index, table, () => !status.live))
      .then((mounted) => {
        if (!status.live) {
          mounted?.dispose()
          return
        }
        status.mounted = mounted ?? null
        setPreview(mounted ?? "empty")
        onReady(mounted ?? null)
      })
    return () => {
      status.live = false
      status.mounted?.dispose()
      onReady(null)
    }
  }, [prefab, index, table, onReady])
  const ready = typeof preview === "object"
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>Picture</Label>
        <Button
          type="button"
          variant="link"
          className="h-auto border-0 px-0 text-caption"
          disabled={!ready}
          onClick={() => {
            if (typeof preview === "object") preview.reset()
          }}
        >
          Reset view
        </Button>
      </div>
      <div className="relative self-center">
        <canvas
          ref={canvas}
          aria-label="The prefab's picture: drag to turn it, scroll to zoom, right-drag to pan"
          className={cn("size-60 cursor-grab rounded-control active:cursor-grabbing", THUMBNAIL_TILE)}
        />
        {!ready && (
          <span className="absolute inset-0 grid place-items-center text-body text-fg-tertiary">
            {preview === "loading" ? "Loading…" : "Nothing to draw"}
          </span>
        )}
      </div>
      <span className="text-caption text-fg-tertiary">
        Drag to turn it, scroll to zoom, right-drag to pan. The site draws its card and page from this view.
      </span>
    </div>
  )
}
