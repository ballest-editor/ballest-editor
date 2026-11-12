import {
  type PrefabRef,
  type PrefabTier,
  SITE_DESCRIPTION_LIMIT,
  SITE_MAX_TAGS,
  SITE_NAME_LIMIT,
  SiteTag
} from "@ballest/contracts"
import { Button } from "@workspace/ui/components/button"
import { DialogFooter } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ReactNode, useState } from "react"
import {
  isPrefabName,
  isSamePrefab,
  PREFAB_NAME_RULE,
  PREFAB_NEEDS_PROJECT,
  PREFAB_TIER_HINTS,
  prefabTierLabel
} from "../domain/prefab"
import {
  deletePrefab,
  renamePrefab,
  saveNewPrefab,
  saveSelectionAsPrefab,
  signInToSite,
  suggestNewPrefabName,
  suggestPrefabName,
  uploadPrefab
} from "../editor/actions"
import { useEditor } from "../editor/store"
import { TitledDialog } from "./TitledDialog"
import { useOnOpen } from "./useOnOpen"

interface DialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * A prefab's name, and what goes with it: a name is its file's, so `saveprefab`'s rule applies as it is typed. The rule
 * shows only once it is broken, as in `NameMapDialog`.
 */
function PrefabNameForm({ canSubmit, children, name, nameProblem, onChange, onClose, onSubmit, submitLabel }: {
  readonly canSubmit: boolean
  readonly children?: ReactNode
  readonly name: string
  /** Under the field while the name keeps the rule: what is wrong with it otherwise. */
  readonly nameProblem?: string | undefined
  readonly onChange: (name: string) => void
  readonly onClose: () => void
  readonly onSubmit: () => void
  readonly submitLabel: string
}) {
  const problem = name !== "" && !isPrefabName(name) ? `${PREFAB_NAME_RULE}.` : nameProblem
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
          // a name is usually replaced whole: the suggestion, or the one a rename starts on
          onFocus={(e) => e.currentTarget.select()}
          value={name}
          aria-invalid={problem !== undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {problem !== undefined && <span className="text-body text-destructive">{problem}</span>}
      </div>
      {children}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!canSubmit}>{submitLabel}</Button>
      </DialogFooter>
    </form>
  )
}

/** One tier in Stored in. A disabled segment takes no pointer events, so the tooltip is on a wrapper. */
function TierSegment({ disabled, hint, label, tier }: {
  readonly disabled?: boolean
  readonly hint: string
  readonly label: string
  readonly tier: PrefabTier
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <ToggleGroupItem value={tier} disabled={disabled}>{label}</ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Edit › Save selection as prefab…: its name, which starts on what the selection reads as, and where it is stored. A name
 * the tier has already replaces that prefab, and says so.
 */
export function SavePrefabDialog({ open, onClose }: DialogProps) {
  const projects = useEditor((s) => s.capabilities.projects)
  const hasProject = useEditor((s) => s.project?.current != null)
  const prefabs = useEditor((s) => s.prefabs)
  const [name, setName] = useState("")
  useOnOpen(open, () => setName(suggestPrefabName(useEditor.getState())))
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
      // with no Stored in to say so
      description={projects ? undefined : SESSION_TIER_NOTE}
    >
      <PrefabNameForm
        name={name}
        onChange={setName}
        canSubmit={valid}
        submitLabel={taken ? "Replace" : "Save"}
        onClose={onClose}
        onSubmit={() => void saveSelectionAsPrefab({ tier, name }, taken)}
      >
        {projects && (
          <div className="flex flex-col gap-1.5">
            <Label>Stored in</Label>
            <ToggleGroup
              value={[tier]}
              onValueChange={([picked]) => {
                if (picked === "user" || picked === "project") setTier(picked)
              }}
            >
              <TierSegment
                tier="project"
                label={prefabTierLabel("project", projects)}
                disabled={!hasProject}
                hint={hasProject ? PREFAB_TIER_HINTS.project : PREFAB_NEEDS_PROJECT}
              />
              <TierSegment tier="user" label={prefabTierLabel("user", projects)} hint={PREFAB_TIER_HINTS.user} />
            </ToggleGroup>
          </div>
        )}
      </PrefabNameForm>
    </TitledDialog>
  )
}

/** The browser's one tier, which Stored in would otherwise say. */
const SESSION_TIER_NOTE = "This build keeps prefabs in memory, until the page closes."

/** "There is already a prefab called ..." when the tier has `name`. */
const takenProblem = (taken: boolean, name: string) => taken ? `There is already a prefab called ${name}.` : undefined

/**
 * A new prefab's first Save, as `NameMapDialog`'s `saveAs` is a new map's: its name, which starts on what its items read
 * as, in the tab's tier. A name the tier has is refused, as Rename refuses it. Submit saves and goes on to `afterSave`
 * (the unsaved-changes prompt's next step); Cancel drops it.
 */
export function NamePrefabDialog({ open, onClose }: DialogProps) {
  const projects = useEditor((s) => s.capabilities.projects)
  const tier = useEditor((s) => s.document.kind === "prefab" ? s.document.tier : null)
  const prefabs = useEditor((s) => s.prefabs)
  const afterSave = useEditor((s) => s.dialog?.id === "namePrefab" ? s.dialog.afterSave : undefined)
  const [name, setName] = useState("")
  useOnOpen(open, () => setName(suggestNewPrefabName(useEditor.getState())))
  const taken = tier !== null && prefabs.some((p) => isSamePrefab(p, { tier, name }))
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title="Save prefab"
      description={!projects ? SESSION_TIER_NOTE : tier === null ? undefined : PREFAB_TIER_HINTS[tier]}
    >
      <PrefabNameForm
        name={name}
        onChange={setName}
        nameProblem={takenProblem(taken, name)}
        canSubmit={tier !== null && isPrefabName(name) && !taken}
        submitLabel="Save"
        onClose={onClose}
        onSubmit={() => void saveNewPrefab(name, afterSave)}
      />
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
      nameProblem={takenProblem(taken, name)}
      canSubmit={valid}
      submitLabel="Rename"
      onClose={onClose}
      onSubmit={() => {
        if (name !== from) void renamePrefab({ tier, name: from }, name)
      }}
    />
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

/**
 * Asked when an edit would give prefab instances members or take them away (docs/DESKTOP.md § Prefabs): Unlink lets it
 * go ahead with them made plain groups; Cancel, or closing, drops it.
 */
export function UnlinkInstancesDialog({ open, onClose }: DialogProps) {
  const names = useEditor((s) => s.dialog?.id === "unlinkInstances" ? s.dialog.names : null) ?? []
  const one = names.length === 1
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title={one ? <>Unlink {names[0]}?</> : <>Unlink {names.length} instances?</>}
      description={one
        ? "Adding or removing pieces makes this instance a plain group, and it stops following its prefab. Editing a piece in place keeps it linked."
        : "Adding or removing pieces makes these instances plain groups, and they stop following their prefabs. Editing a piece in place keeps them linked."}
    >
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => useEditor.getState().resolveUnlinkPrompt(true)}>Unlink</Button>
      </DialogFooter>
    </TitledDialog>
  )
}

/** The site's limits on a prefab's page, as its upload checks them. */
const UPLOAD_RULES = { name: SITE_NAME_LIMIT, description: SITE_DESCRIPTION_LIMIT, tags: SITE_MAX_TAGS } as const

function UploadForm({ onClose, prefab }: { readonly onClose: () => void; readonly prefab: PrefabRef }) {
  const [name, setName] = useState(prefab.name)
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState<ReadonlyArray<SiteTag>>([])
  const [uploading, setUploading] = useState(false)
  const trimmed = name.trim()
  const valid = trimmed !== "" && trimmed.length <= UPLOAD_RULES.name &&
    description.length <= UPLOAD_RULES.description
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid || uploading) return
        setUploading(true)
        void uploadPrefab(prefab, { name: trimmed, description: description.trim(), tags }).then((uploaded) => {
          setUploading(false)
          if (uploaded) onClose()
        })
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="upload-name">Name</Label>
        <Input
          id="upload-name"
          autoFocus
          value={name}
          maxLength={UPLOAD_RULES.name}
          aria-invalid={trimmed === ""}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="upload-description">Description</Label>
        <Textarea
          id="upload-description"
          className="min-h-16"
          value={description}
          maxLength={UPLOAD_RULES.description}
          placeholder="What it is, and where it fits (optional)"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Tags, up to {UPLOAD_RULES.tags}</Label>
        <ToggleGroup
          multiple
          className="flex-wrap"
          value={[...tags]}
          onValueChange={(picked) => {
            const known = picked.filter((tag): tag is SiteTag => SiteTag.literals.some((literal) => literal === tag))
            if (known.length <= UPLOAD_RULES.tags) setTags(known)
          }}
        >
          {SiteTag.literals.map((tag) => (
            <ToggleGroupItem
              key={tag}
              value={tag}
              disabled={!tags.includes(tag) && tags.length >= UPLOAD_RULES.tags}
            >
              {tag}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!valid || uploading}>{uploading ? "Uploading…" : "Upload"}</Button>
      </DialogFooter>
    </form>
  )
}

/**
 * A prefab's Upload to ballestrecords.com… (docs/DESKTOP.md § Prefabs): the page it gets on the site, under the player's
 * Steam name. Signed out, it signs in first.
 */
export function UploadPrefabDialog({ open, onClose }: DialogProps) {
  const prefab = useEditor((s) => s.dialog?.id === "uploadPrefab" ? s.dialog.prefab : null)
  const signedIn = useEditor((s) => s.siteAccount._tag === "SignedIn")
  const [signingIn, setSigningIn] = useState(false)
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      title="Upload to ballestrecords.com"
      description={signedIn
        ? "Anyone can find it there and place it in their maps. You can take it down from its page."
        : "Uploading needs a sign-in with Steam, which opens in the browser."}
    >
      {prefab === null ? null : signedIn
        ? <UploadForm key={`${prefab.tier}/${prefab.name}`} prefab={prefab} onClose={onClose} />
        : (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={signingIn}
              onClick={() => {
                setSigningIn(true)
                void signInToSite().finally(() => setSigningIn(false))
              }}
            >
              {signingIn ? "Waiting for the browser…" : "Sign in"}
            </Button>
          </DialogFooter>
        )}
    </TitledDialog>
  )
}
