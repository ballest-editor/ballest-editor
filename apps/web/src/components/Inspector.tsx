import {
  IconCircleCheck,
  IconCircleDashed,
  IconClipboard,
  IconCopy,
  IconFolderOpen,
  IconSettings,
  IconTrash
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { Fragment, type ReactNode, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { UeTransform, Vec3 } from "../domain/coords"
import { editTransform, isDecal } from "../domain/editTransform"
import { mapLabelOf } from "../domain/factory"
import { exactSelectedGroup } from "../domain/groupSelection"
import { type Axis, readField, type TransformField } from "../domain/groupTransform"
import { type PlacedItem, selectionProperties } from "../domain/itemProperties"
import { formatBindings, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
import { classNameOf, isPlayerStart, type Item, objectPathOf } from "../domain/MapFile"
import { assetNameOf } from "../domain/Materials"
import { pieceNameOf } from "../domain/structure"
import { createdAtIso, formatAgo, formatDate, formatDateTime } from "../domain/time"
import {
  deleteSelection,
  duplicateSelection,
  editSelectionAxis,
  previewSelectionAxis,
  revealProject,
  setSelectionField
} from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import { selectedIndices, useEditor, useOpenPrefab } from "../editor/store"
import { useNow } from "../editor/useNow"
import { glbUrl, visualsOf } from "../editor/visuals"
import { Disclosure } from "./Disclosure"
import { FlipSection } from "./FlipSection"
import { HintBadge } from "./HintBadge"
import { InfoHint } from "./InfoHint"
import { ItemProperties } from "./ItemProperties"
import { ShiftClick } from "./KeyChip"
import { LightingSettings } from "./LightingSettings"
import { NumberField } from "./NumberField"
import { PaintSection } from "./PaintSection"
import { PathAction, PathText } from "./PathText"
import { PivotSection } from "./PivotSection"
import { PrefabSettings } from "./PrefabSettings"
import { SectionHeader, SectionTitle } from "./SectionTitle"
import { GroupSection, InstanceSection, ItemTags } from "./StructureSection"

const axes: ReadonlyArray<Axis> = ["x", "y", "z"]

const Facts = ({ children }: { readonly children: ReactNode }) => (
  <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-body">{children}</dl>
)

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="flex min-h-6 min-w-0 items-center gap-1">{children}</dd>
    </div>
  )
}

/** Text with more to say than fits a fact: the rest is in a tooltip. */
function TipText({ tip, className, children }: {
  readonly tip: ReactNode
  readonly className: string
  readonly children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>{children}</TooltipTrigger>
      <TooltipContent side="left" className="flex-col items-start wrap-anywhere">{tip}</TooltipContent>
    </Tooltip>
  )
}

/** Where a document lives: its name, the path in a tooltip, and Reveal where there is a folder to show. */
function FileFact({ name, tip, onReveal }: {
  readonly name: string
  readonly tip: ReactNode
  readonly onReveal: (() => void) | null
}) {
  return (
    <Fact label="File">
      <TipText tip={tip} className="min-w-0 truncate">{name}</TipText>
      {onReveal !== null && <PathAction label="Reveal" icon={IconFolderOpen} onClick={onReveal} className="ml-auto" />}
    </Fact>
  )
}

/** The day the map was made, with how long ago and the time of day in the tooltip. */
function CreatedFact({ createdAt }: { readonly createdAt: string }) {
  const now = useNow()
  if (createdAt === "") {
    return (
      <Fact label="Created">
        <span className="text-fg-tertiary">Set on export</span>
      </Fact>
    )
  }
  const iso = createdAtIso(createdAt)
  if (iso === null) return <Fact label="Created">{createdAt}</Fact>
  const date = formatDate(iso)
  const ago = formatAgo(iso, now)
  return (
    <Fact label="Created">
      <TipText
        className="truncate"
        tip={
          <>
            {/* Past a week `formatAgo` gives the date too. */}
            {ago !== date && <span>Created {ago}</span>}
            <span>{formatDateTime(iso)}</span>
          </>
        }
      >
        {date}
      </TipText>
    </Fact>
  )
}

const VALIDATED_HINT = "Someone finished a validation run of this map in the in-game editor, which set its medal times."

const NOT_VALIDATED_HINT =
  "A validation run is a race of the map in the in-game editor. Finishing one validates the map and sets its medal times. Ballest Editor can't run one, so open the map in the game."

function MapSettings() {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const itemCount = useEditor((s) => s.doc.map.items.length)
  const hasEditorState = useEditor((s) => s.doc.map.editorState !== undefined)
  const file = useEditor((s) => s.file)
  const projects = useEditor((s) => s.capabilities.projects)
  const renameLevel = useEditor((s) => s.renameLevel)
  const openDialog = useEditor((s) => s.openDialog)
  // An edit in progress; otherwise the input shows the map's name.
  const [draft, setDraft] = useState<string | null>(null)
  const name = draft ?? levelData.levelDisplayName
  const commit = () => {
    if (name !== levelData.levelDisplayName) renameLevel(name, levelData.creatorName)
    setDraft(null)
  }
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader title="Map">
        <PathAction label="Map settings" icon={IconSettings} onClick={() => openDialog({ id: "mapSettings" })} />
      </SectionHeader>
      <div className="flex flex-col gap-1">
        <Label htmlFor="map-name" className="text-fg-secondary">Name</Label>
        <Input id="map-name" value={name} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      </div>
      <Facts>
        <Fact label="Creator">
          {levelData.creatorName === ""
            ? (
              <>
                <span className="text-fg-tertiary">Not set</span>
                <InfoHint>Your creator name is set in Settings › General.</InfoHint>
              </>
            )
            : (
              <TipText tip={levelData.creatorName} className="max-w-40 min-w-0 truncate">
                {levelData.creatorName}
              </TipText>
            )}
        </Fact>
        <Fact label="Items">{itemCount.toLocaleString()}</Fact>
        <CreatedFact createdAt={levelData.createdAt} />
        <Fact label="Status">
          {levelData.bValidated
            ? <IconCircleCheck className="size-4 shrink-0 text-fg-secondary" />
            : <IconCircleDashed className="size-4 shrink-0 text-fg-tertiary" />}
          {levelData.bValidated ? "Validated" : "Not validated"}
          <InfoHint>{levelData.bValidated ? VALIDATED_HINT : NOT_VALIDATED_HINT}</InfoHint>
        </Fact>
        {file === null
          ? (
            <Fact label="File">
              <span className="text-fg-tertiary">Not saved yet</span>
            </Fact>
          )
          : (
            <FileFact
              name={mapLabelOf(file.name)}
              tip={
                <>
                  <span>{file.path ?? file.name}</span>
                  {!hasEditorState && <span>A published map: it holds no in-game editor state.</span>}
                </>
              }
              onReveal={projects && file.path !== null ? () => void revealProject() : null}
            />
          )}
      </Facts>
    </div>
  )
}

/** The value all items share, or null when they differ (shown as mixed). */
const shared = (values: ReadonlyArray<number>): number | null => {
  const first = values[0]
  return first !== undefined && values.every((v) => v === first) ? first : null
}

/** One X/Y/Z row of the transform: which field, how it's labelled, and its display precision. */
interface TransformRowSpec {
  readonly field: TransformField
  readonly label: string
  readonly unit: string
  /** What the row's values mean, in the label's tooltip. */
  readonly help: string
  /** Each field's accessible name; the field itself shows the axis. */
  readonly axisLabels: Readonly<Record<Axis, string>>
  readonly step: number
  readonly digits: number
}

const AXIS_LABELS: Readonly<Record<Axis, string>> = { x: "X", y: "Y", z: "Z" }

const transformRows = (units: "cm" | "m"): ReadonlyArray<TransformRowSpec> => [
  {
    field: "translation",
    label: "Location",
    unit: units,
    help: `In the game's ${units === "m" ? "metres" : "centimetres"}, Z up`,
    axisLabels: AXIS_LABELS,
    step: units === "m" ? 0.01 : 1,
    digits: units === "m" ? 3 : 1
  },
  {
    field: "rotation",
    label: "Rotation",
    unit: "°",
    help: "Degrees: roll, pitch, yaw",
    axisLabels: { x: "X roll", y: "Y pitch", z: "Z yaw" },
    step: 1,
    digits: 1
  },
  {
    field: "scale3D",
    label: "Scale",
    unit: "×",
    help: "A factor of the piece's own size",
    axisLabels: AXIS_LABELS,
    step: 0.01,
    digits: 2
  }
]

/** A decal's scale is its size (domain/editTransform.ts): cm, so a factor's step would crawl. */
const DECAL_SIZE_ROW: TransformRowSpec = {
  field: "scale3D",
  label: "Size",
  unit: "cm",
  help: "Centimetres: height, width, depth",
  axisLabels: AXIS_LABELS,
  step: 1,
  digits: 1
}

/** Copied rows in stored units (cm, degrees, factor), shared by every selection. */
const copiedRows = new Map<TransformField, Vec3>()

/**
 * One editable row over the whole selection: its name and unit, a button whose menu (or
 * Shift+click shortcuts) copies and pastes all three axes, then an X/Y/Z field each, side by side
 * while a big coordinate still fits. A typed value sets
 * every selected item; a scrub moves or turns the selection together like the gizmo, so a
 * mixed selection keeps its spread; with snapping on, a scrub lands on the grid or rotation step
 * (a mixed selection moves in whole steps). `perUnit` converts display units to the stored value.
 */
function TransformRow(props: {
  readonly row: TransformRowSpec
  /** The selection's transforms as shown (live while a drag or scrub is in progress). */
  readonly shown: ReadonlyArray<UeTransform>
  /** The active item's document transform, which a copy reads. */
  readonly active: UeTransform
  readonly perUnit: number
}) {
  const notify = useEditor((s) => s.notify)
  const snapping = useEditor((s) => s.settings.snapping)
  const { row, perUnit } = props
  const { field } = row
  // Scrubs follow the tool bar's snapping, in display units: the grid for location, the step for rotation.
  const snap = field === "translation"
    ? snapping.enabled ? snapping.gridSize / perUnit : undefined
    : field === "rotation" && snapping.rotationEnabled
    ? snapping.rotationStep
    : undefined
  const [open, setOpen] = useState(false)
  const rowName = row.label.toLowerCase()
  const copy = () => {
    copiedRows.set(field, readField(props.active, field))
    notify("info", `Copied ${rowName}.`)
  }
  const paste = () => {
    const copied = copiedRows.get(field)
    if (copied === undefined) notify("info", `Nothing copied for ${rowName} yet.`)
    else setSelectionField(field, copied)
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger render={<span className="text-body text-fg-secondary" />}>
            {row.label} <span className="text-caption text-fg-tertiary">{row.unit}</span>
          </TooltipTrigger>
          <TooltipContent side="left">{row.help}</TooltipContent>
        </Tooltip>
        <Popover
          open={open}
          onOpenChange={(next, details) => {
            // Shift+click pastes instead of opening the menu
            if (next && details.event instanceof MouseEvent && details.event.shiftKey) return
            setOpen(next)
          }}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-fg-tertiary"
                      aria-label={`Copy or paste ${rowName}`}
                      onClick={(e) => {
                        if (e.shiftKey) paste()
                      }}
                      onContextMenu={(e) => {
                        if (!e.shiftKey) return
                        e.preventDefault()
                        copy()
                      }}
                    />
                  }
                />
              }
            >
              <IconClipboard />
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8} className="flex flex-col items-start py-2 pr-3 pl-2.5">
              <div className="text-body-strong">Copy / paste axis values</div>
              <div className="mt-1.5 grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-1 opacity-80">
                <span>Copy</span>
                <ShiftClick button="right" />
                <span>Paste</span>
                <ShiftClick button="left" />
              </div>
            </TooltipContent>
          </Tooltip>
          <PopoverContent side="left" align="start" className="w-auto gap-1 p-1">
            <div className="px-2 py-1 text-body text-fg-secondary">{row.label}</div>
            <Button
              variant="ghost"
              size="sm"
              className="justify-between gap-4"
              onClick={() => {
                copy()
                setOpen(false)
              }}
            >
              <span className="flex items-center gap-2">
                <IconCopy />Copy X, Y, Z
              </span>
              <ShiftClick button="right" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-between gap-4"
              disabled={copiedRows.get(field) === undefined}
              onClick={() => {
                paste()
                setOpen(false)
              }}
            >
              <span className="flex items-center gap-2">
                <IconClipboard />Paste
              </span>
              <ShiftClick button="left" />
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      <div className="grid grid-cols-3 gap-1 @max-[16rem]:grid-cols-1">
        {axes.map((axis) => {
          const value = shared(props.shown.map((t) => readField(t, field)[axis] / perUnit))
          const offset = (v: number, from: number) => ({ kind: "offset", by: (v - from) * perUnit }) as const
          return (
            <NumberField
              key={axis}
              label={row.axisLabels[axis]}
              value={value}
              onCommit={(v) => editSelectionAxis(field, axis, { kind: "set", value: v * perUnit })}
              onScrub={(v, from) => previewSelectionAxis(field, axis, v === null ? null : offset(v, from))}
              onScrubCommit={(v, from) => editSelectionAxis(field, axis, offset(v, from))}
              step={row.step}
              snap={snap}
              digits={row.digits}
              handleClassName={AXIS_BG_CLASSES[axis]}
              handleText={AXIS_LABELS[axis]}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Duplicate and Delete as icon buttons, for a section's header; both also have a shortcut and the context menu. */
function SelectionActions() {
  const keybinds = useEditor((s) => s.keybinds)
  const shortcut = (action: KeybindAction) => `${keybindActionLabels[action]} (${formatBindings(keybinds[action])})`
  return (
    <>
      <PathAction label={shortcut("duplicateSelection")} icon={IconCopy} onClick={duplicateSelection} />
      <PathAction
        label={shortcut("deleteSelection")}
        icon={IconTrash}
        onClick={deleteSelection}
        className="hover:text-destructive"
      />
    </>
  )
}

/** The pieces in a selection, by name, with how many of each. */
function PieceCounts({ items }: { readonly items: ReadonlyArray<Item> }) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const counts = new Map<string, number>()
  for (const item of items) {
    const name = pieceNameOf(item, catalogIndex)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return (
    <ul className="flex flex-col gap-0.5 text-body">
      {[...counts].map(([name, n]) => (
        <li key={name} className="break-words">
          {name}
          {n > 1 && <span className="ml-1 text-fg-tertiary">× {n}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Meshes the viewport couldn't load, for the top of the Inspector: it's the one thing here that needs acting on. */
function MeshWarning({ item }: { readonly item: Item }) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const missing = useEditor((s) => s.missingGlbs)
  const failed = visualsOf(item, catalogIndex).flatMap((v) => {
    const url = glbUrl(v.mesh?.glb)
    return url !== undefined && missing.has(url) ? [assetNameOf(v.mesh?.meshAssetPath ?? "")] : []
  })
  if (failed.length === 0) return null
  return (
    <Badge variant="destructive" title={failed.join("\n")}>
      {failed.length === 1 ? "A mesh failed to load" : `${failed.length} meshes failed to load`}
    </Badge>
  )
}

const PLAYER_START_HINT =
  "A map has exactly one player start. Copy, Cut and Duplicate leave it out, and if you delete it, Save and Export refuse the map until Undo brings it back."

/** What's selected: one item's piece, under its category, or a count with the pieces involved. */
function SelectionHeader(
  { items, itemKey }: { readonly items: ReadonlyArray<Item>; readonly itemKey: string | undefined }
) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const ownName = useEditor((s) => itemKey === undefined ? undefined : s.doc.structure.items.get(itemKey)?.name)
  const only = items.length === 1 ? items[0] : undefined
  const category = only === undefined ? undefined : catalogIndex?.pieceByClass.get(only.actorToSpawn)?.category
  return (
    <>
      <SectionHeader title={only === undefined ? `${items.length} items selected` : category || "Piece"}>
        <SelectionActions />
      </SectionHeader>
      {only === undefined
        ? <PieceCounts items={items} />
        : <div className="text-body-strong break-words">{ownName ?? pieceNameOf(only, catalogIndex)}</div>}
      {items.some(isPlayerStart) && <HintBadge label="Player start (required)">{PLAYER_START_HINT}</HintBadge>}
      {only !== undefined && <MeshWarning item={only} />}
    </>
  )
}

/** The identifiers behind a single item, for when something needs looking up. Closed unless asked for. */
function ItemDetails({ item, index }: { readonly item: Item; readonly index: number }) {
  return (
    <Disclosure title="Details">
      <Facts>
        <Fact label="Class">
          <span className="min-w-0 break-all">{classNameOf(item.actorToSpawn)}</span>
        </Fact>
        <Fact label="Asset">
          <PathText>{objectPathOf(item.actorToSpawn)}</PathText>
        </Fact>
        <Fact label="Index">{index}</Fact>
        {item.meshComponents.map((mesh, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- mesh components have no id; the slot index is their identity
          <Fragment key={i}>
            <Fact label="Mesh">
              {mesh.meshAssetPath === undefined || mesh.meshAssetPath === ""
                ? <span className="text-fg-tertiary">No main mesh</span>
                : (
                  <span className="min-w-0 break-all" title={mesh.meshAssetPath}>
                    {assetNameOf(mesh.meshAssetPath)}
                  </span>
                )}
            </Fact>
            {mesh.materials.map((m) => (
              <Fact key={m.materialIndex} label={`Paint ${m.materialIndex + 1}`}>
                <span className="min-w-0 break-all" title={m.material}>{assetNameOf(m.material)}</span>
              </Fact>
            ))}
          </Fragment>
        ))}
      </Facts>
    </Disclosure>
  )
}

/** Everything that edits the selection's items, all of them at once. */
function ItemEditor({ items, ids, transforms, placed }: {
  readonly items: ReadonlyArray<Item>
  readonly ids: ReadonlyArray<string>
  readonly transforms: ReadonlyArray<UeTransform>
  readonly placed: ReadonlyArray<PlacedItem>
}) {
  const units = useEditor((s) => s.settings.general.units)
  // Display units only; the map always stores centimetres (rotation and scale don't convert).
  const perUnit = units === "m" ? 100 : 1
  const active = items.at(-1)
  if (active === undefined) return null
  return (
    <>
      <SectionTitle>Transform</SectionTitle>
      <div className="flex @container flex-col gap-2">
        {transformRows(units).map((row) => (
          <TransformRow
            key={row.field}
            row={row.field === "scale3D" && items.every(isDecal) ? DECAL_SIZE_ROW : row}
            shown={transforms}
            active={editTransform(active)}
            perUnit={row.field === "translation" ? perUnit : 1}
          />
        ))}
        <FlipSection items={placed} />
      </div>

      <Separator />
      <PivotSection />

      <Separator />
      <SectionTitle>Paint</SectionTitle>
      <PaintSection selected={items.map((item, i) => ({ item, id: ids[i] ?? "" }))} />
      <ItemProperties properties={selectionProperties(placed)} />
    </>
  )
}

export function Inspector() {
  // Selected items in selection order, with their shown transforms (live while the gizmo
  // drags or a field scrubs; committed on release).
  const items = useEditor(useShallow((s) =>
    selectedIndices(s).flatMap((index) => {
      const item = s.doc.map.items[index]
      return item === undefined ? [] : [item]
    })
  ))
  const indices = useEditor(useShallow(selectedIndices))
  const ids = useEditor(useShallow((s) => selectedIndices(s).map((i) => s.doc.ids[i] ?? "")))
  const preview = useEditor((s) => s.preview)
  // As `shownTransform` reads them, but memoised: `editTransform` builds a decal's or an elevator's transform afresh
  // each call, and a selector returning fresh objects would re-render without end.
  const transforms = useMemo(
    () => items.map((item, i) => preview?.get(ids[i] ?? "") ?? editTransform(item)),
    [items, ids, preview]
  )
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const tree = useEditor((s) => s.doc.structure.tree)
  const selectedIds = useEditor((s) => s.selectedIds)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const group = useMemo(
    () => exactSelectedGroup(tree, selectedIds, enteredGroupId),
    [tree, selectedIds, enteredGroupId]
  )

  const prefab = useOpenPrefab()
  const first = items[0]
  if (first === undefined) {
    return (
      <ScrollArea className="h-full bg-card">
        <div className="flex flex-col gap-3 p-3">
          {prefab === null
            ? (
              <>
                <MapSettings />
                <Separator />
                <SectionTitle>Lighting</SectionTitle>
                <LightingSettings />
              </>
            )
            : <PrefabSettings prefab={prefab} />}
        </div>
      </ScrollArea>
    )
  }

  const placed = items.map((item) => ({ item, piece: catalogIndex?.pieceByClass.get(item.actorToSpawn) }))
  const editor = <ItemEditor items={items} ids={ids} transforms={transforms} placed={placed} />

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col gap-3 p-3">
        {group === undefined
          ? (
            <>
              <SelectionHeader items={items} itemKey={items.length === 1 ? ids[0] : undefined} />
              {items.length === 1 && ids[0] !== undefined && <ItemTags itemKey={ids[0]} />}
              <Separator />
              {editor}
              {items.length === 1 && (
                <>
                  <Separator />
                  <ItemDetails item={first} index={indices[0] ?? -1} />
                </>
              )}
            </>
          )
          : (
            // A group is one thing with a name, so it's summed up; its items stay a click away, edited all at once.
            <>
              <GroupSection key={group.id} group={group} actions={<SelectionActions />}>
                <PieceCounts items={items} />
              </GroupSection>
              {group.prefab !== undefined && (
                <>
                  <Separator />
                  <InstanceSection group={group} link={group.prefab} />
                </>
              )}
              <Separator />
              <Disclosure
                key={`${group.id}/items`}
                title={items.length === 1 ? "Edit its item" : `Edit all ${items.length} items`}
              >
                {editor}
              </Disclosure>
            </>
          )}
      </div>
    </ScrollArea>
  )
}
