import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronRight,
  IconCircleCheck,
  IconClipboard,
  IconCopy,
  IconFolderOpen,
  IconSettings,
  IconTrash,
  IconUserCircle
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { Fragment, type ReactNode, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { UeTransform, Vec3 } from "../domain/coords"
import { creatorChipText, mapCreatorLabel } from "../domain/creator"
import { editTransform, isDecal } from "../domain/editTransform"
import { mapLabelOf } from "../domain/factory"
import { counted, exactSelectedGroup } from "../domain/groupSelection"
import { type Axis, readField, type TransformField } from "../domain/groupTransform"
import { type PlacedItem, selectionProperties } from "../domain/itemProperties"
import { formatBindings, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
import { classNameOf, isPlayerStart, type Item, objectPathOf } from "../domain/MapFile"
import { assetNameOf } from "../domain/Materials"
import { pieceNameOf } from "../domain/structure"
import { createdAtIso, formatAgo, formatDate, formatDateTime } from "../domain/time"
import type { MapValidation } from "../domain/validateMap"
import {
  deleteSelection,
  duplicateSelection,
  editSelectionAxis,
  previewSelectionAxis,
  revealProject,
  setSelectionField
} from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import {
  noTabOpen,
  selectedIndices,
  selectionPivot,
  shownTransform,
  shownValidation,
  useCreator,
  useEditor,
  useOpenPrefab
} from "../editor/store"
import { useNow } from "../editor/useNow"
import { glbUrl, visualsOf } from "../editor/visuals"
import { Disclosure } from "./Disclosure"
import { Fact, Facts } from "./Facts"
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
import { Section, SectionHeader, SectionTitle } from "./SectionTitle"
import { GroupSection, InstanceSection, ItemTags, LabelledField } from "./StructureSection"

const axes: ReadonlyArray<Axis> = ["x", "y", "z"]

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

/** The day the map was made, with how long ago and the time of day in the tooltip. */
function CreatedFact({ createdAt }: { readonly createdAt: string }) {
  const now = useNow()
  if (createdAt === "") {
    return (
      <Fact label="Created">
        <span className="text-fg-tertiary">Set on first save</span>
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

/** The creator in a pill: the whole name, and where it came from, in the tooltip. */
function CreatorChip({ name }: { readonly name: string }) {
  const creator = useCreator()
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge className="min-w-0 shrink justify-start pl-0.5 [&>svg]:size-4!" />}
      >
        <IconUserCircle />
        <span className="min-w-0 truncate">{creatorChipText(name)}</span>
      </TooltipTrigger>
      {/* Above, not to the left, where it would cover the fact's label. */}
      <TooltipContent className="flex-col items-start wrap-anywhere">
        <span>{name}</span>
        <span>{mapCreatorLabel(name, creator)}</span>
      </TooltipContent>
    </Tooltip>
  )
}

const VALIDATED_HINT =
  "Validate checks the file against the game's format. Separately, someone finished a validation run of this map in the in-game editor, which set its medal times."

const NOT_VALIDATED_HINT =
  "Validate checks the file against the game's format. It isn't a validation run, a race of the map in the in-game editor that sets its medal times, and nobody has finished one yet. Ballest Editor can't run one, so open the map in the game."

/** The row's words for a check: the errors if there are any, as the map isn't valid then. */
const validationLabel = ({ errors, warnings }: MapValidation): string => {
  if (errors.length > 0) return counted(errors.length, "error")
  return warnings.length > 0 ? `Valid · ${counted(warnings.length, "warning")}` : "Valid"
}

const ErrorIcon = () => <IconAlertCircle className="size-4 shrink-0 text-destructive" />
const WarningIcon = () => <IconAlertTriangle className="size-4 shrink-0 text-status-warn-foreground" />

function ValidationIcon({ errors, warnings }: MapValidation) {
  if (errors.length > 0) return <ErrorIcon />
  return warnings.length > 0
    ? <WarningIcon />
    : <IconCircleCheck className="size-4 shrink-0 text-status-ok-foreground" />
}

function ValidationList({ errors, warnings }: MapValidation) {
  const rows = [
    ...errors.map((text) => ({ text, icon: <ErrorIcon /> })),
    ...warnings.map((text) => ({ text, icon: <WarningIcon /> }))
  ]
  return (
    <ScrollArea className="rounded-surface bg-muted ring-edge not-dark:ring-1 [&_[data-slot=scroll-area-viewport]]:max-h-48">
      <ul className="flex flex-col gap-1 p-2 text-fg-secondary select-text">
        {rows.map(({ icon, text }) => (
          <li key={text} className="flex gap-1.5">
            <span className="flex h-5 items-center">{icon}</span>
            <span className="min-w-0 wrap-anywhere">{text}</span>
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}

/**
 * The map against the game's format, on request. The store keeps the result with the document it was run on, so a
 * selection that swaps the inspector's sections leaves it, and any edit puts the button back.
 */
function StatusFact({ validated }: { readonly validated: boolean }) {
  const result = useEditor(shownValidation)
  const validate = useEditor((s) => s.validateDoc)
  const hint = <InfoHint>{validated ? VALIDATED_HINT : NOT_VALIDATED_HINT}</InfoHint>
  if (result === undefined) {
    return (
      <Fact label="Status">
        <Button variant="secondary" size="sm" onClick={validate}>Validate</Button>
        {hint}
      </Fact>
    )
  }
  const label = (
    <>
      <ValidationIcon {...result} />
      <span className="min-w-0 truncate">{validationLabel(result)}</span>
    </>
  )
  if (result.errors.length + result.warnings.length === 0) {
    return (
      <Fact label="Status">
        {label}
        {hint}
      </Fact>
    )
  }
  return (
    <Collapsible className="contents">
      <Fact label="Status">
        <CollapsibleTrigger className="group/status -ml-1 flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-control px-1 outline-none transition-colors hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring">
          {label}
          <IconChevronRight className="size-4 shrink-0 text-fg-secondary transition-transform group-data-[panel-open]/status:rotate-90" />
        </CollapsibleTrigger>
        {hint}
      </Fact>
      <CollapsibleContent render={<dd />} className="col-span-2">
        <ValidationList {...result} />
      </CollapsibleContent>
    </Collapsible>
  )
}

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
      <LabelledField id="map-name" label="Name">
        <Input
          id="map-name"
          value={name}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      </LabelledField>
      <Facts>
        <Fact label="Creator">
          {levelData.creatorName === ""
            ? (
              <>
                <span className="text-fg-tertiary">Not set</span>
                <InfoHint>Your creator name is set in Settings › General.</InfoHint>
              </>
            )
            : <CreatorChip name={levelData.creatorName} />}
        </Fact>
        <Fact label="Items">{itemCount.toLocaleString()}</Fact>
        <CreatedFact createdAt={levelData.createdAt} />
        <StatusFact validated={levelData.bValidated} />
        <Fact label="File">
          {file === null ? <span className="text-fg-tertiary">Not saved yet</span> : (
            <>
              <TipText
                className="min-w-0 truncate"
                tip={
                  <>
                    <span>{file.path ?? file.name}</span>
                    {!hasEditorState && <span>A published map: it holds no in-game editor state.</span>}
                  </>
                }
              >
                {mapLabelOf(file.name)}
              </TipText>
              {projects && file.path !== null && (
                <PathAction
                  label="Reveal in folder"
                  icon={IconFolderOpen}
                  onClick={() => void revealProject()}
                  className="ml-auto"
                />
              )}
            </>
          )}
        </Fact>
      </Facts>
    </div>
  )
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

/** The rows for an item (its own transform) or a whole group (its frame: a point, with no turn or scale of its own). */
const transformRows = (units: "cm" | "m", of: "item" | "group"): ReadonlyArray<TransformRowSpec> => {
  const unitName = units === "m" ? "metres" : "centimetres"
  return [
    {
      field: "translation",
      label: "Location",
      unit: units,
      help: of === "item"
        ? `The piece's origin, as the map stores it, in ${unitName}, Z up`
        : `Where the group pivots, in ${unitName}, Z up: the centre of its items, or an instance's origin`,
      axisLabels: AXIS_LABELS,
      step: units === "m" ? 0.01 : 1,
      digits: units === "m" ? 3 : 1
    },
    {
      field: "rotation",
      label: "Rotation",
      unit: "°",
      help: of === "item"
        ? "Degrees: roll, pitch, yaw"
        : "Degrees: roll, pitch, yaw. A group holds no turn of its own, so a value here turns it by that much about its pivot",
      axisLabels: { x: "X roll", y: "Y pitch", z: "Z yaw" },
      step: 1,
      digits: 1
    },
    {
      field: "scale3D",
      label: "Scale",
      unit: "×",
      help: of === "item"
        ? "A factor of the piece's own size"
        : "A group holds no scale of its own, so a value here scales its items by that much about its pivot, each along its own axes",
      axisLabels: AXIS_LABELS,
      step: 0.01,
      digits: 2
    }
  ]
}

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

const FIELD_HELP =
  "Drag a field to change it: Shift ×10, Alt ×0.1. Type +50, -20, *2 or /2 to change what's there, =-20 to set a negative."

/** Copied rows in stored units (cm, degrees, factor), shared by every selection. */
const copiedRows = new Map<TransformField, Vec3>()

/**
 * One editable row over the whole selection: its name and unit, a button whose menu (or
 * Shift+click shortcuts) copies and pastes all three axes, then an X/Y/Z field each, side by side
 * while a big coordinate still fits. The fields show the selection's unit: the active item, or a whole group's frame.
 * A typed value takes the unit's axis there and the rest of the selection follows by the same change, as a scrub
 * does and as the game's panel does, so a selection keeps its spread; items that differ from the unit are marked
 * Mixed. Paste is the one edit that sets every item to a value. With snapping on, a scrub lands on the grid or
 * rotation step. `perUnit` converts display units to the stored value.
 */
function TransformRow(props: {
  readonly row: TransformRowSpec
  /** The unit's transform as shown (live while a drag or scrub is in progress). */
  readonly unit: UeTransform
  /** The axes on which the selection's items differ from the unit. */
  readonly mixed: ReadonlySet<Axis>
  /** The active item's document transform, which a copy reads; a group's frame has nothing worth copying. */
  readonly active?: UeTransform | undefined
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
  const { active } = props
  const copy = () => {
    if (active === undefined) return
    copiedRows.set(field, readField(active, field))
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
          <TooltipContent side="left" className="flex-col items-start">
            <span>{row.help}</span>
            <span>{FIELD_HELP}</span>
          </TooltipContent>
        </Tooltip>
        {props.mixed.size > 0 && (
          <Tooltip>
            <TooltipTrigger render={<span className="ml-auto text-caption text-fg-tertiary" />}>Mixed</TooltipTrigger>
            <TooltipContent side="left">
              {`The items differ on ${
                [...props.mixed].map((a) => AXIS_LABELS[a]).join(", ")
              }: the active one is shown, and a change here moves them all together`}
            </TooltipContent>
          </Tooltip>
        )}
        {active !== undefined && (
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
        )}
      </div>
      <div className="grid grid-cols-3 gap-1 @max-[16rem]:grid-cols-1">
        {axes.map((axis) => {
          const value = readField(props.unit, field)[axis] / perUnit
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

/** The axes on which any of `transforms` differs from `unit`, in the field's units. */
const mixedAxes = (unit: UeTransform, transforms: ReadonlyArray<UeTransform>, field: TransformField): Set<Axis> => {
  const reference = readField(unit, field)
  const values = transforms.map((t) => readField(t, field))
  return new Set(AXES.filter((axis) => values.some((v) => Math.abs(v[axis] - reference[axis]) > 1e-6)))
}

/**
 * The Transform section: the selection's unit, edited as one thing. For items that is the active one with the rest
 * following; for a whole group it is the frame, with the group's items as `transforms` only to mark what differs.
 */
function TransformSection({ of, unit, transforms, active, decals = false, children }: {
  readonly of: "item" | "group"
  readonly unit: UeTransform
  readonly transforms: ReadonlyArray<UeTransform>
  /** The active item's document transform, for Copy; none for a group. */
  readonly active?: UeTransform | undefined
  /** Whether every item is a decal, whose scale is a size. */
  readonly decals?: boolean
  readonly children?: ReactNode
}) {
  const units = useEditor((s) => s.settings.general.units)
  // Display units only; the map always stores centimetres (rotation and scale don't convert).
  const perUnit = units === "m" ? 100 : 1
  return (
    <Section>
      <SectionTitle>Transform</SectionTitle>
      <div className="flex @container flex-col gap-2">
        {transformRows(units, of).map((row) => (
          <TransformRow
            key={row.field}
            row={row.field === "scale3D" && decals ? DECAL_SIZE_ROW : row}
            unit={unit}
            mixed={of === "item" ? mixedAxes(unit, transforms, row.field) : EMPTY_AXES}
            active={active}
            perUnit={row.field === "translation" ? perUnit : 1}
          />
        ))}
        {children}
      </div>
    </Section>
  )
}

const AXES: ReadonlyArray<Axis> = ["x", "y", "z"]
const EMPTY_AXES: ReadonlySet<Axis> = new Set()

/**
 * Everything that edits the selection's items, all of them at once. A whole group's items get no Transform section:
 * the group has its own, over its frame.
 */
function ItemEditor({ items, ids, transforms, placed, transform }: {
  readonly items: ReadonlyArray<Item>
  readonly ids: ReadonlyArray<string>
  readonly transforms: ReadonlyArray<UeTransform>
  readonly placed: ReadonlyArray<PlacedItem>
  readonly transform: boolean
}) {
  const active = items.at(-1)
  const shownActive = transforms.at(-1)
  if (active === undefined || shownActive === undefined) return null
  return (
    <>
      {transform && (
        <TransformSection
          of="item"
          unit={shownActive}
          transforms={transforms}
          active={editTransform(active)}
          decals={items.every(isDecal)}
        >
          <FlipSection items={placed} />
        </TransformSection>
      )}
      <PivotSection />
      <Section>
        <SectionTitle>Paint</SectionTitle>
        <PaintSection selected={items.map((item, i) => ({ item, id: ids[i] ?? "" }))} />
      </Section>
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
  // A whole group's frame as shown, which its Transform rows edit. Read from the store at the time, since the frame
  // is built afresh from the items' shown transforms and a selector returning it would re-render without end.
  const frame = useMemo(() => {
    if (group === undefined) return undefined
    const s = useEditor.getState()
    return selectionPivot(s, (id) => shownTransform(s, id))?.unit
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `transforms` and `catalogIndex` are what the frame is made of
  }, [group, transforms, catalogIndex])

  const prefab = useOpenPrefab()
  const noTab = useEditor(noTabOpen)
  const first = items[0]
  if (noTab) {
    return <div className="flex h-full items-center justify-center bg-card p-4 text-fg-tertiary">Nothing selected</div>
  }
  if (first === undefined) {
    return (
      <ScrollArea className="h-full bg-card">
        <div className="flex flex-col gap-5 p-3">
          {prefab === null
            ? (
              <>
                <MapSettings />
                <Section>
                  <SectionTitle>Lighting</SectionTitle>
                  <LightingSettings />
                </Section>
              </>
            )
            : <PrefabSettings prefab={prefab} />}
        </div>
      </ScrollArea>
    )
  }

  const placed = items.map((item) => ({ item, piece: catalogIndex?.pieceByClass.get(item.actorToSpawn) }))
  const editor = (
    <ItemEditor items={items} ids={ids} transforms={transforms} placed={placed} transform={group === undefined} />
  )

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col gap-5 p-3">
        {group === undefined
          ? (
            <>
              <Section>
                <SelectionHeader items={items} itemKey={items.length === 1 ? ids[0] : undefined} />
                {items.length === 1 && ids[0] !== undefined && <ItemTags itemKey={ids[0]} />}
              </Section>
              {editor}
              {items.length === 1 && <ItemDetails item={first} index={indices[0] ?? -1} />}
            </>
          )
          : (
            // A group is one thing with a name, so it's summed up; its items stay a click away, edited all at once.
            <>
              <GroupSection
                key={group.id}
                group={group}
                items={items}
                transforms={transforms}
                actions={<SelectionActions />}
              >
                <PieceCounts items={items} />
              </GroupSection>
              {group.prefab !== undefined && <InstanceSection group={group} link={group.prefab} />}
              {frame !== undefined && (
                <TransformSection of="group" unit={frame} transforms={transforms}>
                  <FlipSection items={placed} />
                </TransformSection>
              )}
              <Disclosure
                key={`${group.id}/items`}
                title={items.length === 1 ? "Edit its item" : `Edit all ${items.length} items`}
              >
                {group.prefab !== undefined && (
                  <p className="text-body text-fg-tertiary">
                    An edit in here changes the instance, so it no longer follows its definition.
                  </p>
                )}
                {editor}
              </Disclosure>
            </>
          )}
      </div>
    </ScrollArea>
  )
}
