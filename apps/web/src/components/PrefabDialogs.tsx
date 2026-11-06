import type { PrefabTier } from "@ballest/contracts"
import { Button } from "@workspace/ui/components/button"
import { DialogFooter } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { type ReactNode, useState } from "react"
import { isPrefabName, isSamePrefab, PREFAB_NAME_RULE } from "../domain/prefab"
import { deletePrefab, renamePrefab, saveSelectionAsPrefab } from "../editor/actions"
import { useEditor } from "../editor/store"
import { TitledDialog } from "./TitledDialog"

interface DialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

/** A prefab's name, and what goes with it: a name is its file's, so `saveprefab`'s rule applies as it is typed. */
function PrefabNameForm({ canSubmit, children, invalid, name, onChange, onClose, onSubmit, submitLabel }: {
  readonly canSubmit: boolean
  readonly children?: ReactNode
  readonly invalid: boolean
  readonly name: string
  readonly onChange: (name: string) => void
  readonly onClose: () => void
  readonly onSubmit: () => void
  readonly submitLabel: string
}) {
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit) return
        onClose()
        onSubmit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="prefab-name">Name</Label>
        <Input
          id="prefab-name"
          autoFocus
          value={name}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">{PREFAB_NAME_RULE}</span>
      </div>
      {children}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!canSubmit}>{submitLabel}</Button>
      </DialogFooter>
    </form>
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
  const taken = prefabs.some((p) => isSamePrefab(p, { tier, name }))
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title="Save selection as prefab"
      description={projects
        ? "A project prefab stays with this project. A user prefab is the game's own: the in-game editor spawns it too."
        : "This build keeps prefabs in memory, until the page closes."}
    >
      <PrefabNameForm
        name={name}
        onChange={setName}
        invalid={name !== "" && !valid}
        canSubmit={valid}
        submitLabel={taken ? "Replace" : "Save"}
        onClose={onClose}
        onSubmit={() => {
          setName("")
          void saveSelectionAsPrefab({ tier, name }, taken)
        }}
      >
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
      </PrefabNameForm>
    </TitledDialog>
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
  const taken = name !== from && prefabs.some((p) => isSamePrefab(p, { tier, name }))
  const valid = isPrefabName(name) && !taken
  return (
    <PrefabNameForm
      name={name}
      onChange={setName}
      invalid={!valid}
      canSubmit={valid}
      submitLabel="Rename"
      onClose={onClose}
      onSubmit={() => {
        if (name !== from) void renamePrefab({ tier, name: from }, name)
      }}
    >
      {taken && <p className="text-xs text-destructive">There is already a prefab called {name}.</p>}
    </PrefabNameForm>
  )
}

export function RenamePrefabDialog({ open, onClose }: DialogProps) {
  const prefab = useEditor((s) => s.dialog?.id === "renamePrefab" ? s.dialog.prefab : null)
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title="Rename prefab"
      description="Instances in open maps go with it, and other maps find it when they open."
    >
      {prefab !== null && <RenameForm key={prefab.name} from={prefab.name} tier={prefab.tier} onClose={onClose} />}
    </TitledDialog>
  )
}

/** The Prefabs panel's Delete…: the file goes to the backups, and instances keep their items. */
export function DeletePrefabDialog({ open, onClose }: DialogProps) {
  const prefab = useEditor((s) => s.dialog?.id === "deletePrefab" ? s.dialog.prefab : null)
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title={<>Delete {prefab?.name}?</>}
      description="Its file goes to the backups. Instances of it keep their items and stop following anything."
    >
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
    </TitledDialog>
  )
}
