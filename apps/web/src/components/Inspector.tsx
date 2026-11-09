import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronRight,
  IconCircleCheck,
  IconCopy,
  IconFolderOpen,
  IconPercentage,
  IconRuler2,
  IconSettings,
  IconTrash,
  IconUserCircle
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { Fragment, type ReactNode, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { CatalogIndex } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { creatorChipText, mapCreatorLabel } from "../domain/creator"
import { editTransform, isDecal } from "../domain/editTransform"
import { mapLabelOf } from "../domain/factory"
import { counted, soleGroupOf } from "../domain/groupSelection"
import { type Axis, readField, type TransformField } from "../domain/groupTransform"
import { extentOf, sizeAt } from "../domain/itemBounds"
import { type PlacedItem, selectionProperties } from "../domain/itemProperties"
import { formatBindings, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
import { classNameOf, isPlayerStart, type Item, objectPathOf } from "../domain/MapFile"
import { assetNameOf } from "../domain/Materials"
import { scaleSnapStep, snapsGrid, snapsRotation } from "../domain/snapConfig"
import { pieceNameOf } from "../domain/structure"
import { createdAtIso, formatAgo, formatDate, formatDateTime } from "../domain/time"
import { pivotUnitOf } from "../domain/units"
import type { MapValidation } from "../domain/validateMap"
import {
  deleteSelection,
  duplicateSelection,
  editSelectionAxis,
  previewSelectionAxis,
  revealProject,
  setSelectionField,
  setSelectionSize,
  setSelectionUnitField,
  updateSettings
} from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import {
  noTabOpen,
  selectedIndices,
  selectionPivot,
  shownTransform,
  shownValidation,
  snapConfigOf,
  useCreator,
  useEditor,
  useOpenPrefab
} from "../editor/store"
import { useNow } from "../editor/useNow"
import { glbUrl, visualsOf } from "../editor/visuals"
import { ConnectsAtSection } from "./ConnectsAtSection"
import { Disclosure } from "./Disclosure"
import { Fact, Facts } from "./Facts"
import { FlipSection } from "./FlipSection"
import { HintBadge } from "./HintBadge"
import { InfoHint } from "./InfoHint"
import { ItemProperties } from "./ItemProperties"
import { LightingSettings } from "./LightingSettings"
import { NumberField } from "./NumberField"
import { PaintSection } from "./PaintSection"
import { PathAction, PathText } from "./PathText"
import { PivotSection } from "./PivotSection"
import { PrefabSettings } from "./PrefabSettings"
import { type ClipKey, RowClipboard } from "./RowClipboard"
import { Section, SectionHeader, SectionTitle } from "./SectionTitle"
import { ChainSection, GroupSection, InstanceSection, ItemTags, LabelledField } from "./StructureSection"

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
  /** Centimetres per shown unit, on a row whose scrubs land on the tool bar's grid (a location or a size). */
  readonly grid?: number
}

const AXIS_LABELS: Readonly<Record<Axis, string>> = { x: "X", y: "Y", z: "Z" }

/**
 * The rows for an item (its own transform) or a whole group: a group has no stored origin, so its Location is its pivot
 * and lives in the Pivot section as Position; here it has a turn and a scale to apply about that.
 */
const transformRows = (units: "cm" | "m", of: "item" | "group"): ReadonlyArray<TransformRowSpec> => {
  const location: TransformRowSpec = {
    field: "translation",
    label: "Location",
    unit: units,
    help: `The piece's origin, as the map stores it, in ${units === "m" ? "meters" : "centimeters"}, Z up`,
    axisLabels: AXIS_LABELS,
    step: units === "m" ? 0.01 : 1,
    digits: units === "m" ? 3 : 1,
    grid: units === "m" ? 100 : 1
  }
  return [
    ...(of === "item" ? [location] : []),
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
  digits: 1,
  grid: 1
}

/**
 * The Scale row as a size: the piece's bounds along its own axes at its scale (domain/itemBounds), in display units. A
 * change scales the selection as the factor row does, by the ratio it makes of the active item's size.
 */
const sizeRow = (units: "cm" | "m"): TransformRowSpec => ({
  field: "scale3D",
  label: "Size",
  unit: units,
  help: "The piece's size along its own axes. A change scales it",
  axisLabels: AXIS_LABELS,
  step: units === "m" ? 0.01 : 1,
  digits: units === "m" ? 3 : 1,
  grid: units === "m" ? 100 : 1
})

const SCALE_MODES = ["factor", "size"] as const

/** One choice of `ScaleModeToggle`. A disabled item takes no pointer events, so the tooltip is on a wrapper. */
function ScaleModeItem({ value, label, disabled = false, children }: {
  readonly value: typeof SCALE_MODES[number]
  readonly label: string
  readonly disabled?: boolean
  readonly children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <ToggleGroupItem
          value={value}
          aria-label={label}
          disabled={disabled}
          className="h-4 min-w-0 px-0.5 [&_svg:not([class*='size-'])]:size-3.5"
        >
          {children}
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Whether the Scale row shows a factor or a size, kept in settings; Size needs the active piece's bounds. */
function ScaleModeToggle({ units, sizeKnown }: { readonly units: "cm" | "m"; readonly sizeKnown: boolean }) {
  const mode = useEditor((s) => s.settings.panels.inspectorScale)
  return (
    <ToggleGroup
      aria-label="Show scale as"
      value={[sizeKnown ? mode : "factor"]}
      onValueChange={(picked) => {
        const next = SCALE_MODES.find((m) => picked.includes(m))
        if (next !== undefined) void updateSettings("panels", { inspectorScale: next })
      }}
      className="p-px"
    >
      <ScaleModeItem value="factor" label="Factor">
        <IconPercentage />
      </ScaleModeItem>
      <ScaleModeItem
        value="size"
        label={sizeKnown ? `Size in ${units}` : "This piece's size isn't known"}
        disabled={!sizeKnown}
      >
        <IconRuler2 />
      </ScaleModeItem>
    </ToggleGroup>
  )
}

/**
 * One editable row over the whole selection: its name and unit, its clipboard button (`RowClipboard`), then an X/Y/Z
 * field each, side by side while a big coordinate still fits. The fields show the selection's unit: the active item,
 * or a whole group's frame. A typed value takes the unit's axis there and the rest of the selection follows by the
 * same change, as a scrub does and as the game's panel does, so a selection keeps its spread; items that differ from
 * the unit are marked Mixed. A paste is the row's `onPaste`. With snapping on, a scrub lands on the grid or rotation
 * step. `perUnit` converts each axis's display value to the stored one (a size to its scale). `mode` is a control
 * after the label (Scale's factor or size).
 */
function TransformRow(props: {
  readonly row: TransformRowSpec
  /** The unit's transform as shown (live while a drag or scrub is in progress). */
  readonly unit: UeTransform
  /** The axes on which the selection's items differ from the unit. */
  readonly mixed: ReadonlySet<Axis>
  /** What a copy of the row reads, in stored units. */
  readonly copyValue: Vec3
  /** What a paste of three values does to the selection. */
  readonly onPaste: (value: Vec3) => void
  readonly perUnit: Readonly<Record<Axis, number>>
  /** The leading item's local size (cm), which a snapped Scale scrub keeps on the grid; none for a group. */
  readonly extent?: Vec3 | undefined
  /** The clipboard's kind of row, when it isn't the field's (a size). */
  readonly clipKey?: ClipKey
  readonly mode?: ReactNode
}) {
  const snapping = useEditor(snapConfigOf)
  const { row, perUnit } = props
  const { field } = row
  // Scrubs follow the tool bar's snapping, in display units: the grid for a location or a size, the step for rotation.
  const snap = row.grid !== undefined
    ? snapsGrid(snapping) ? snapping.gridSize / row.grid : undefined
    : field === "rotation" && snapsRotation(snapping)
    ? snapping.rotationStep
    : undefined
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger render={<span className="text-body text-fg-secondary" />}>
              {row.label}
              {row.unit !== "" && <span className="text-caption text-fg-tertiary">{` ${row.unit}`}</span>}
            </TooltipTrigger>
            <TooltipContent side="left">{row.help}</TooltipContent>
          </Tooltip>
          {props.mode}
        </div>
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
        <RowClipboard
          clipKey={props.clipKey ?? field}
          label={row.label}
          value={props.copyValue}
          onPaste={props.onPaste}
        />
      </div>
      <div className="grid grid-cols-3 gap-1 @max-[16rem]:grid-cols-1">
        {axes.map((axis) => {
          const value = readField(props.unit, field)[axis] / perUnit[axis]
          const offset = (v: number, from: number) => ({ kind: "offset", by: (v - from) * perUnit[axis] }) as const
          return (
            <NumberField
              key={axis}
              label={row.axisLabels[axis]}
              value={value}
              onCommit={(v) => editSelectionAxis(field, axis, { kind: "set", value: v * perUnit[axis] })}
              onScrub={(v, from) => previewSelectionAxis(field, axis, v === null ? null : offset(v, from))}
              onScrubCommit={(v, from) => editSelectionAxis(field, axis, offset(v, from))}
              step={row.step}
              snap={field === "scale3D"
                ? (() => {
                  const step = scaleSnapStep(snapping, props.extent?.[axis])
                  return step === undefined ? undefined : step / Math.abs(perUnit[axis])
                })()
                : snap}
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

/** The axes on which any of `values` differs from `reference`. */
const differingAxes = (reference: Vec3, values: ReadonlyArray<Vec3>, tolerance = 1e-6): Set<Axis> =>
  new Set(AXES.filter((axis) => values.some((v) => Math.abs(v[axis] - reference[axis]) > tolerance)))

/** The axes on which any of `transforms` differs from `unit`, in the field's units. */
const mixedAxes = (unit: UeTransform, transforms: ReadonlyArray<UeTransform>, field: TransformField): Set<Axis> =>
  differingAxes(readField(unit, field), transforms.map((t) => readField(t, field)))

const uniform = (n: number): Readonly<Record<Axis, number>> => ({ x: n, y: n, z: n })

/** The Scale row's props as a size: `extent` is the active item's, `items` and `transforms` line up. */
const sizeRowProps = (
  { unit, active, extent, items, transforms, catalog, perUnit }: {
    readonly unit: UeTransform
    readonly active: UeTransform
    readonly extent: Vec3
    readonly items: ReadonlyArray<Item>
    readonly transforms: ReadonlyArray<UeTransform>
    readonly catalog: CatalogIndex | null
    readonly perUnit: number
  }
) => {
  const sizes = items.flatMap((item, i) => {
    const own = extentOf(item, catalog)
    const t = transforms[i]
    return own === undefined || t === undefined ? [] : [sizeAt(own, t.scale3D)]
  })
  const sign = (axis: Axis) => (unit.scale3D[axis] < 0 ? -1 : 1)
  return {
    // a display value times this is the active item's scale for that size, flipped as it is
    perUnit: {
      x: sign("x") * perUnit / extent.x,
      y: sign("y") * perUnit / extent.y,
      z: sign("z") * perUnit / extent.z
    },
    mixed: differingAxes(sizeAt(extent, unit.scale3D), sizes, 1e-3),
    copyValue: sizeAt(extent, active.scale3D),
    onPaste: setSelectionSize,
    clipKey: "size"
  } as const
}

/**
 * The Transform section: the selection's unit, edited as one thing. For items that is the active one with the rest
 * following; for a whole group it is the frame, with the group's items as `transforms` only to mark what differs.
 */
function TransformSection({ of, unit, transforms, active, activeIndex = -1, items = NO_ITEMS, children }: {
  readonly of: "item" | "group"
  readonly unit: UeTransform
  readonly transforms: ReadonlyArray<UeTransform>
  /** Which of `items` is the unit, whose size a Scale row shows; the last when absent. */
  readonly activeIndex?: number
  /** The active item's document transform, which a copy reads; a group's copy reads the unit as shown. */
  readonly active?: UeTransform | undefined
  /** The selected items, in line with `transforms`, whose Scale row can show a size; none for a group. */
  readonly items?: ReadonlyArray<Item>
  readonly children?: ReactNode
}) {
  const units = useEditor((s) => s.settings.general.units)
  const catalog = useEditor((s) => s.catalogIndex)
  const scaleMode = useEditor((s) => s.settings.panels.inspectorScale)
  // Display units only; the map always stores centimetres (rotation and scale don't convert).
  const perUnit = units === "m" ? 100 : 1
  // a decal's scale is its size already; a group's is a factor of nothing it holds
  const decals = items.length > 0 && items.every(isDecal)
  const activeItem = decals ? undefined : items.at(activeIndex)
  const extent = activeItem === undefined ? undefined : extentOf(activeItem, catalog)
  return (
    <Section>
      <SectionTitle>Transform</SectionTitle>
      <div className="flex @container flex-col gap-2">
        {transformRows(units, of).map((row) => {
          const props = {
            row,
            unit,
            mixed: of === "item" ? mixedAxes(unit, transforms, row.field) : EMPTY_AXES,
            copyValue: readField(active ?? unit, row.field),
            // a piece's paste sets every item; a group's takes the group there, as typing the three values would
            onPaste: (value: Vec3) =>
              of === "item" ? setSelectionField(row.field, value) : setSelectionUnitField(row.field, value),
            extent: extent ?? (decals ? uniform(1) : undefined),
            perUnit: uniform(row.field === "translation" ? perUnit : 1)
          }
          if (row.field !== "scale3D") return <TransformRow key={row.field} {...props} />
          if (decals) return <TransformRow key={row.field} {...props} row={DECAL_SIZE_ROW} />
          if (activeItem === undefined) return <TransformRow key={row.field} {...props} />
          const mode = <ScaleModeToggle units={units} sizeKnown={extent !== undefined} />
          if (extent === undefined || scaleMode === "factor") {
            // the toggle says it's a factor
            return <TransformRow key={row.field} {...props} row={{ ...row, unit: "" }} mode={mode} />
          }
          return (
            <TransformRow
              key={row.field}
              {...props}
              {...sizeRowProps({ unit, active: active ?? unit, extent, items, transforms, catalog, perUnit })}
              row={sizeRow(units)}
              mode={mode}
            />
          )
        })}
        {children}
      </div>
    </Section>
  )
}

const AXES: ReadonlyArray<Axis> = ["x", "y", "z"]
const NO_ITEMS: ReadonlyArray<Item> = []
const EMPTY_AXES: ReadonlySet<Axis> = new Set()

/**
 * Everything that edits the selection's items, all of them at once. A whole group's items get no Transform section:
 * the group has its own, over its frame.
 */
function ItemEditor({ items, ids, transforms, placed, transform, unit, groupUnit, unitIndex }: {
  /** The gizmo's unit as shown, which the Transform rows edit: a piece, a whole group, or a chain's first link. */
  readonly unit: UeTransform | undefined
  /** Whether that unit is a group among the selection rather than one of `items`. */
  readonly groupUnit: boolean
  /** The unit's index in `items`, -1 when it is a group. */
  readonly unitIndex: number
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
        <>
          <TransformSection
            of={groupUnit ? "group" : "item"}
            unit={unit ?? shownActive}
            transforms={transforms}
            active={groupUnit ? unit : editTransform(items[unitIndex] ?? active)}
            activeIndex={unitIndex}
            items={groupUnit ? NO_ITEMS : items}
          >
            <FlipSection items={placed} />
          </TransformSection>
          <PivotSection />
          {items.length === 1 && ids[0] !== undefined && <ConnectsAtSection itemKey={ids[0]} />}
        </>
      )}
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
    () => soleGroupOf(tree, selectedIds, enteredGroupId),
    [tree, selectedIds, enteredGroupId]
  )
  // The selection's gizmo target as shown, whose unit the Transform rows edit. Read from the store at the time, since
  // it is built afresh from the items' shown transforms and a selector returning it would re-render without end.
  const pivotMode = useEditor((s) => s.pivotMode)
  const doc = useEditor((s) => s.doc)
  const previewLanding = useEditor((s) => s.previewLanding)
  const target = useMemo(() => {
    const s = useEditor.getState()
    return selectionPivot(s, (id) => shownTransform(s, id))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the store values the target is built from, read inside
  }, [doc, preview, previewLanding, catalogIndex, pivotMode, selectedIds, enteredGroupId])
  const frame = target?.unit
  const unitKey = target === undefined ? undefined : pivotUnitOf(target.selection, pivotMode).id
  const groupUnit = unitKey !== undefined && !ids.includes(unitKey)
  const unitIndex = unitKey === undefined ? -1 : ids.indexOf(unitKey)

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
    <ItemEditor
      items={items}
      ids={ids}
      transforms={transforms}
      placed={placed}
      transform={group === undefined}
      unit={frame}
      groupUnit={groupUnit}
      unitIndex={unitIndex}
    />
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
              <PivotSection />
              <ChainSection group={group} />
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
