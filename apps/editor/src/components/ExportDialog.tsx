import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useMemo, useState } from "react"
import { riskyClassesIn } from "../domain/Catalog"
import { isValidName, mapFileNameOf, NAME_RULE } from "../domain/factory"
import { classNameOf } from "../domain/MapFile"
import { exportMap, saveSettings } from "../editor/actions"
import { useEditor } from "../editor/store"

/**
 * Export always confirms the map name, so a renamed file never disagrees with the names
 * inside it (the game refuses to load those). The creator comes from Settings › General.
 */
export function ExportDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const displayName = useEditor((s) => s.doc.map.worldSettings.levelData.levelDisplayName)
  const settings = useEditor((s) => s.settings)
  const renameLevel = useEditor((s) => s.renameLevel)
  const openDialog = useEditor((s) => s.openDialog)
  const items = useEditor((s) => s.doc.map.items)
  const catalog = useEditor((s) => s.catalog)
  const risky = useMemo(
    () =>
      riskyClassesIn(
        items.map((it) => classNameOf(it.actorToSpawn)),
        catalog?.catalog.pieces ?? [],
        catalog?.verified ?? {}
      ),
    [items, catalog]
  )
  const creator = settings.general.creatorName.trim()
  const [name, setName] = useState(displayName)
  const [creatorDraft, setCreatorDraft] = useState("")
  // Each time the dialog opens, start from the map's current name.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setName(displayName)
  }

  const effectiveCreator = creator || creatorDraft.trim()
  const nameOk = isValidName(name)
  const creatorOk = isValidName(effectiveCreator)
  const submit = async () => {
    if (!nameOk || !creatorOk) return
    if (creator === "") {
      await saveSettings({ ...settings, general: { ...settings.general, creatorName: effectiveCreator } })
    }
    renameLevel(name, effectiveCreator)
    onClose()
    await exportMap()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Export map</DialogTitle>
            <DialogDescription>
              Saves{" "}
              <code className="break-all">{mapFileNameOf(name || "name", effectiveCreator || "creator")}</code>. Drop it
              in the game's UserSavedMaps folder; don't rename the file afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="export-name">Map name</Label>
            <Input
              id="export-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={name !== "" && !nameOk}
            />
            <span className="text-[0.7rem] text-muted-foreground">{NAME_RULE}</span>
          </div>
          {creator === ""
            ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="export-creator">Creator (your in-game name)</Label>
                <Input
                  id="export-creator"
                  value={creatorDraft}
                  onChange={(e) => setCreatorDraft(e.target.value)}
                  aria-invalid={creatorDraft !== "" && !creatorOk}
                />
                <span className="text-[0.7rem] text-muted-foreground">Saved to Settings › General.</span>
              </div>
            )
            : (
              <div className="text-xs text-muted-foreground">
                Creator: <span className="text-foreground">{creator}</span>{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => openDialog("settings", "general")}
                >
                  change
                </button>
              </div>
            )}
          {risky.rejected.length > 0 && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              The in-game editor rejects {risky.rejected.join(", ")} and will discard the whole map. Remove them first.
            </p>
          )}
          {risky.unverified.length > 0 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Not yet confirmed to load in-game:{" "}
              {risky.unverified.join(", ")}. If the game rejects one, it discards the whole map — test with a copy.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!nameOk || !creatorOk || risky.rejected.length > 0}>Export</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
