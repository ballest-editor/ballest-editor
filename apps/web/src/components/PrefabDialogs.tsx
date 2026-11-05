import type { PrefabTier } from "@ballest/contracts"
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
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { useState } from "react"
import { isPrefabName, PREFAB_NAME_RULE } from "../domain/prefab"
import { deletePrefab, renamePrefab, saveSelectionAsPrefab } from "../editor/actions"
import { useEditor } from "../editor/store"

interface DialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

/** The name field of a prefab: a name is its file's, so `saveprefab`'s rule applies as it is typed. */
function PrefabNameField({ value, onChange, invalid }: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly invalid: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="prefab-name">Name</Label>
      <Input
        id="prefab-name"
        autoFocus
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-xs text-muted-foreground">{PREFAB_NAME_RULE}</span>
    </div>
  )
}

/** Edit › Save selection as prefab…: its name and tier. A name the tier has already replaces that prefab, and says so. */
export function SavePrefabDialog({ open, onClose }: DialogProps) {
  const projects = useEditor((s) => s.capabilities.projects)
  const hasProject = useEditor((s) => s.project?.current != null)
  const prefabs = useEditor((s) => s.prefabs)
  const [name, setName] = useState("")
  const [chosenTier, setTier] = useState<PrefabTier>("project")
  // only a named project has a tier of its own
  const tier = projects && hasProject ? chosenTier : "user"
  const valid = isPrefabName(name)
  const taken = prefabs.some((p) => p.tier === tier && p.name === name)
  const submit = () => {
    if (!valid) return
    onClose()
    setName("")
    void saveSelectionAsPrefab({ tier, name }, taken)
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save selection as prefab</DialogTitle>
          <DialogDescription>
            {projects
              ? "A project prefab stays with this project. A user prefab is the game's own: the in-game editor spawns it too."
              : "This build keeps prefabs in memory, until the page closes."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <PrefabNameField value={name} onChange={setName} invalid={name !== "" && !valid} />
          {projects && (
            <div className="flex flex-col gap-1.5">
              <Label>Tier</Label>
              <ToggleGroup
                value={[tier]}
                variant="outline"
                onValueChange={([picked]) => {
                  if (picked === "user" || picked === "project") setTier(picked)
                }}
              >
                <ToggleGroupItem value="project" disabled={!hasProject}>Project</ToggleGroupItem>
                <ToggleGroupItem value="user">User</ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid}>{taken ? "Replace" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The Prefabs panel's Rename…; the form is keyed by the prefab, so it starts on that name. */
function RenameForm({ from, onClose, tier }: {
  readonly from: string
  readonly tier: PrefabTier
  readonly onClose: () => void
}) {
  const prefabs = useEditor((s) => s.prefabs)
  const [name, setName] = useState(from)
  const taken = name !== from && prefabs.some((p) => p.tier === tier && p.name === name)
  const valid = isPrefabName(name) && !taken
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onClose()
        if (name !== from) void renamePrefab({ tier, name: from }, name)
      }}
    >
      <PrefabNameField value={name} onChange={setName} invalid={!valid} />
      {taken && <p className="text-xs text-destructive">There is already a prefab called {name}.</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!valid}>Rename</Button>
      </DialogFooter>
    </form>
  )
}

export function RenamePrefabDialog({ open, onClose }: DialogProps) {
  const prefab = useEditor((s) => s.dialog?.id === "renamePrefab" ? s.dialog.prefab : null)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename prefab</DialogTitle>
          <DialogDescription>
            Instances in open maps go with it, and other maps find it when they open.
          </DialogDescription>
        </DialogHeader>
        {prefab !== null && <RenameForm key={prefab.name} from={prefab.name} tier={prefab.tier} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

/** The Prefabs panel's Delete…: the file goes to the backups, and instances keep their items. */
export function DeletePrefabDialog({ open, onClose }: DialogProps) {
  const prefab = useEditor((s) => s.dialog?.id === "deletePrefab" ? s.dialog.prefab : null)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {prefab?.name}?</DialogTitle>
          <DialogDescription>
            Its file goes to the backups. Instances of it keep their items and stop following anything.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => {
              onClose()
              if (prefab !== null) void deletePrefab(prefab)
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
