import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronRight,
  IconCircleCheck,
  IconClick,
  IconCopy,
  IconFocusCentered,
  IconFolderOpen,
  IconMap,
  IconPercentage,
  IconRuler2,
  IconSettings,
  IconStack2,
  IconTrash,
  IconUserCircle
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { createElement, Fragment, memo, type ReactNode, useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { Vec3 } from "../domain/coords"
import { creatorChipText, mapCreatorLabel } from "../domain/creator"
import { isDecal } from "../domain/editTransform"
import { mapLabelOf } from "../domain/factory"
import { type FieldKind, type FieldView, readThing, sharedValue, type Thing } from "../domain/fieldEdit"
import { counted, groupTrail, selectedNodes, soleGroupOf, unitSummaryOf } from "../domain/groupSelection"
import type { Axis, TransformField } from "../domain/groupTransform"
import { type PlacedItem, selectionProperties } from "../domain/itemProperties"
import { formatBindings, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
import { classNameOf, isPlayerStart, type Item, objectPathOf } from "../domain/MapFile"
import { assetNameOf } from "../domain/Materials"
import { documentOrigin } from "../domain/prefab"
import { gridScrubOf, scaleSnapStep, snapsGrid, snapsRotation } from "../domain/snapConfig"
import { idOf, pieceNameOf } from "../domain/structure"
import { createdAtIso, formatAgo, formatDate, formatDateTime } from "../domain/time"
import { ORIGIN, vecScale } from "../domain/ueMath"
import type { MapValidation } from "../domain/validateMap"
import {
  deleteSelection,
  duplicateSelection,
  editSelectionField,
  pasteSelectionField,
  revealProject,
  scrubSelectionField,
  updateSettings
} from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import {
  type EditorState,
  noTabOpen,
  selectedIndices,
  selectionThings,
  selectionUnits,
  shownTransform,
  shownValidation,
  snapConfigOf,
  useCreator,
  useEditor,
  useOpenPrefab
} from "../editor/store"
import { useNow } from "../editor/useNow"
import { glbUrl, visualsOf } from "../editor/visuals"
import { AlignSection } from "./AlignSection"
import { ConnectsAtSection } from "./ConnectsAtSection"
import { Fact, Facts } from "./Facts"
import { FlipSection } from "./FlipSection"
import { HintBadge } from "./HintBadge"
import { InfoHint } from "./InfoHint"
import {
  FIELD_LABEL,
  Identity,
  IDENTITY_TILE,
  IdentityBlock,
  IdentityName,
  InlineName,
  Section,
  SectionStack
} from "./InspectorLayout"
import { ItemProperties } from "./ItemProperties"
import { LightingSettings } from "./LightingSettings"
import { NumberField } from "./NumberField"
import { hasOwnGlyph, itemGlyphOf } from "./outlineGlyphs"
import { ItemIcon } from "./OutlineRow"
import { PaintSection } from "./PaintSection"
import { PathAction, PathText } from "./PathText"
import { PieceThumbnail } from "./PieceThumbnail"
import { PivotSection } from "./PivotSection"
import { PrefabSettings } from "./PrefabSettings"
import { type ClipKey, RowClipboard } from "./RowClipboard"
import { ChainSection, GroupIdentity, InstanceSection, ItemTags } from "./StructureSection"

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

/** An open map with nothing selected: its name, edited in place, and the map's settings. */
function MapIdentity() {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const hasEditorState = useEditor((s) => s.doc.map.editorState !== undefined)
  const renameLevel = useEditor((s) => s.renameLevel)
  const openDialog = useEditor((s) => s.openDialog)
  return (
    <IdentityBlock>
      <Identity
        tile={
          <span className={IDENTITY_TILE}>
            <IconMap className="size-5" />
          </span>
        }
        title={
          <InlineName
            label="Map name"
            value={levelData.levelDisplayName}
            onCommit={(name) => renameLevel(name, levelData.creatorName)}
          />
        }
        subtitle={hasEditorState ? "Map · Draft" : "Map · Published"}
        actions={
          <PathAction
            label="Map settings"
            icon={IconSettings}
            onClick={() => openDialog({ id: "mapSettings" })}
          />
        }
      />
    </IdentityBlock>
  )
}

/** The map's facts: who made it, how big it is, when, whether it's valid and where it's kept. */
function MapInfo() {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const itemCount = useEditor((s) => s.doc.map.items.length)
  const hasEditorState = useEditor((s) => s.doc.map.editorState !== undefined)
  const file = useEditor((s) => s.file)
  const projects = useEditor((s) => s.capabilities.projects)
  return (
    <Section id="mapInfo" title="Details">
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
    </Section>
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

/** Whom the rows speak of: one item, one whole group, or several things (the editor's rules § 4). */
type RowsOf = "item" | "group" | "things"

/**
 * The rows for an item (its own transform), a whole group, or several things: a group has no stored origin, so its
 * Location is its pivot, and it has a turn and a scale to apply about that.
 */
const transformRows = (units: "cm" | "m", of: RowsOf): ReadonlyArray<TransformRowSpec> => {
  const length = units === "m" ? "meters" : "centimeters"
  const location: TransformRowSpec = {
    field: "translation",
    label: "Location",
    unit: units,
    help: {
      item: `The piece's origin, as the map stores it, in ${length}, Z up`,
      group:
        `Where the group is: its pivot, or the origin of the member it pivots on, in ${length}, Z up. A value moves the whole group there`,
      things:
        `Where each one is: a piece's origin, a group's pivot, in ${length}, Z up. A number moves every one there whole; +=100 moves each from where it is`
    }[of],
    axisLabels: AXIS_LABELS,
    step: units === "m" ? 0.01 : 1,
    digits: units === "m" ? 3 : 1,
    grid: units === "m" ? 100 : 1
  }
  return [
    location,
    {
      field: "rotation",
      label: "Rotation",
      unit: "°",
      help: {
        item: "Degrees: roll, pitch, yaw",
        group: "Degrees: roll, pitch, yaw, the group's own turn. A value turns it there about its pivot",
        things:
          "Degrees: roll, pitch, yaw. A number turns every one to it about its own pivot; +=90 turns each from its own"
      }[of],
      axisLabels: { x: "X roll", y: "Y pitch", z: "Z yaw" },
      step: 1,
      digits: 1
    },
    {
      field: "scale3D",
      label: "Scale",
      unit: "×",
      help: {
        item: "A factor of the piece's own size",
        group:
          "A group holds no scale of its own, so a value here scales its items by that much about its pivot, each along its own axes",
        things:
          "A number gives every one that scale about its own pivot; *=2 doubles each. A group holds no scale, so it reads 1 and scales by the value"
      }[of],
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
 * The Scale row as a size: each thing's bounds along its own axes at its scale (domain/itemBounds), in display units. A
 * change scales each thing as the factor row does, by the ratio it makes of its own size.
 */
const sizeRow = (units: "cm" | "m", of: RowsOf): TransformRowSpec => ({
  field: "scale3D",
  label: "Size",
  unit: units,
  help: {
    item: "The piece's size along its own axes. A change scales it",
    group: "The size of the member the group pivots on. A change scales the group",
    things: "Each one's size along its own axes. A number sizes every one to it; *=2 doubles each"
  }[of],
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
function ScaleModeToggle({ units, sizeKnown, unknown }: {
  readonly units: "cm" | "m"
  readonly sizeKnown: boolean
  /** Why there's no size to show, on the disabled Size choice. */
  readonly unknown: string
}) {
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
        label={sizeKnown ? `Size in ${units}` : unknown}
        disabled={!sizeKnown}
      >
        <IconRuler2 />
      </ScaleModeItem>
    </ToggleGroup>
  )
}

/**
 * One editable row over the selected things (the editor's rules § 4): its name and unit, its clipboard button
 * (`RowClipboard`), then an X/Y/Z field each, side by side while a big coordinate still fits. A field shows the value
 * every thing holds, or Multiple where they differ. What's typed is worked out for each thing from its own value and
 * takes each one whole (`editSelectionField`), a scrub changes each by the same amount, and a paste is its three values
 * typed. With snapping on, a scrub lands on the grid, rotation or scale step. `mode` is a control after the label
 * (Scale's factor or size).
 */
function TransformRow(props: {
  readonly row: TransformRowSpec
  readonly view: FieldView
  /** Every thing's values as shown (live while a drag or scrub is in progress), in selection order. */
  readonly values: ReadonlyArray<Vec3 | undefined>
  /** What a copy reads, in stored units: the active thing's values. */
  readonly copyValue: Vec3
  /** The active thing's size at scale 1 (cm), which a snapped Scale scrub keeps on the grid. */
  readonly extent: Vec3 | undefined
  /** The clipboard's kind of row, when it isn't the field's (a size). */
  readonly clipKey?: ClipKey
  readonly mode?: ReactNode
}) {
  const snapping = useEditor(snapConfigOf)
  const { row, view, extent } = props
  // Scrubs follow the tool bar's snapping, in display units: the grid for a location or a size, the step for rotation,
  // and for a scale the factor that keeps the active thing's size on the grid.
  const snapOf = (axis: Axis): number | undefined => {
    if (view.kind === "scale" || view.kind === "size") {
      const step = scaleSnapStep(snapping, extent?.[axis])
      if (view.kind === "scale" || step === undefined) return step
      return extent === undefined ? undefined : step * extent[axis] / view.perUnit
    }
    if (row.grid !== undefined) return snapsGrid(snapping) ? snapping.gridSize / row.grid : undefined
    return snapsRotation(snapping) ? snapping.rotationStep : undefined
  }
  // a location lands on the grid's own lines, counted from its origin
  const snapFromOf = (axis: Axis): number | undefined => {
    // as measured from where the row reads 0
    const lattice = view.kind === "location" ? gridScrubOf(snapping, axis, view.origin) : undefined
    return lattice === undefined ? undefined : lattice.from / view.perUnit
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-6 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger render={<span className={FIELD_LABEL} />}>
              {row.label}
              {row.unit !== "" && <span className="text-caption text-fg-tertiary">{` ${row.unit}`}</span>}
            </TooltipTrigger>
            <TooltipContent side="left">{row.help}</TooltipContent>
          </Tooltip>
          {props.mode}
        </div>
        <RowClipboard
          clipKey={props.clipKey ?? row.field}
          label={row.label}
          value={props.copyValue}
          onPaste={(value) => pasteSelectionField(view, value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-1 @max-[16rem]:grid-cols-1">
        {axes.map((axis) => (
          <NumberField
            key={axis}
            label={row.axisLabels[axis]}
            // what the field shows rounded tells the things apart
            value={sharedValue(props.values.map((v) => v?.[axis]), 10 ** -row.digits / 2)}
            onEntry={(entry) => editSelectionField(view, axis, entry)}
            {...scrubSelectionField(view, axis)}
            step={row.step}
            snap={snapOf(axis)}
            snapFrom={snapFromOf(axis)}
            digits={row.digits}
            handleClassName={AXIS_BG_CLASSES[axis]}
            handleText={AXIS_LABELS[axis]}
          />
        ))}
      </div>
    </div>
  )
}

/** Frame, Duplicate and Delete as icon buttons, for the identity at the top; each also has a shortcut. */
function SelectionActions() {
  const keybinds = useEditor((s) => s.keybinds)
  const requestFocus = useEditor((s) => s.requestFocus)
  const shortcut = (action: KeybindAction) => `${keybindActionLabels[action]} (${formatBindings(keybinds[action])})`
  return (
    <>
      <PathAction label={shortcut("focusSelection")} icon={IconFocusCentered} onClick={requestFocus} />
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

/** The pieces in a selection, by name, with how many of each, most first. */
const ContentsSection = memo(function ContentsSection({ items }: { readonly items: ReadonlyArray<Item> }) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const counts = new Map<string, { readonly actorClass: string; n: number }>()
  for (const item of items) {
    const name = pieceNameOf(item, catalogIndex)
    const entry = counts.get(name)
    if (entry === undefined) counts.set(name, { actorClass: item.actorToSpawn, n: 1 })
    else entry.n += 1
  }
  const rows = [...counts].toSorted(([, a], [, b]) => b.n - a.n)
  return (
    <Section id="contents" title="Contents" className="gap-0">
      <ul className="flex flex-col">
        {rows.map(([name, { actorClass, n }]) => (
          <li key={name} className="flex h-6 min-w-0 items-center gap-1 text-body">
            <ItemIcon actorClass={actorClass} />
            <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
            <span className="shrink-0 text-caption text-fg-tertiary">{n}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
})

/** An item's picture on the identity's tile: its piece's thumbnail, or its glyph where it has one of its own. */
function ItemTile({ item }: { readonly item: Item }) {
  const piece = useEditor((s) => s.catalogIndex?.pieceByClass.get(item.actorToSpawn))
  const glyph = createElement(itemGlyphOf(item.actorToSpawn, piece), { className: "size-5" })
  return (
    <span className={IDENTITY_TILE}>
      {piece === undefined || hasOwnGlyph(item.actorToSpawn, piece)
        ? glyph
        : <PieceThumbnail key={piece.className} piece={piece} className="size-9 object-contain" placeholder={glyph} />}
    </span>
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

/** Which link a lone selected link of an entered chain is, "Link 2 of 5", since everything a chain does counts from 1. */
const linkOf = (s: EditorState): string | undefined => {
  const chain = groupTrail(s.doc.structure.tree, s.enteredGroupId).at(-1)
  if (chain?.chain !== true) return undefined
  const [only, second] = selectedNodes(s.doc.structure.tree, s.selectedIds, s.enteredGroupId)
  if (only === undefined || second !== undefined) return undefined
  const index = chain.children.findIndex((child) => idOf(child) === idOf(only))
  return index < 0 ? undefined : `Link ${index + 1} of ${chain.children.length}`
}

const PLAYER_START_HINT =
  "A map has exactly one player start. Copy, Cut and Duplicate leave it out, and if you delete it, Save and Export refuse the map until Undo brings it back."

/**
 * What's selected, at the top: one item, by its own name (edited in place; cleared, it takes its piece's) over its piece
 * and category, or how many items; then anything about it that needs a look, and one item's tags.
 */
const SelectionIdentity = memo(function SelectionIdentity(
  { items, itemKey }: { readonly items: ReadonlyArray<Item>; readonly itemKey: string | undefined }
) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const renameItem = useEditor((s) => s.renameItem)
  const ownName = useEditor((s) => itemKey === undefined ? undefined : s.doc.structure.items.get(itemKey)?.name)
  const only = items.length === 1 ? items[0] : undefined
  const kinds = new Set(items.map((item) => item.actorToSpawn)).size
  // a group among pieces moves as one, so say so: the gizmo takes it as one unit
  const units = useEditor((s) => unitSummaryOf(s.doc.structure.tree, s.selectedIds, s.enteredGroupId))
  const link = useEditor(linkOf)
  const identity = only === undefined || itemKey === undefined
    ? (
      <Identity
        tile={
          <span className={IDENTITY_TILE}>
            <IconStack2 className="size-5" />
          </span>
        }
        title={<IdentityName>{`${items.length} items`}</IdentityName>}
        subtitle={units ?? (kinds === 1 ? "All one piece" : `${kinds} kinds of piece`)}
        actions={<SelectionActions />}
      />
    )
    : (
      <Identity
        tile={<ItemTile item={only} />}
        title={
          <InlineName
            label="Item name"
            value={ownName ?? ""}
            placeholder={pieceNameOf(only, catalogIndex)}
            onCommit={(name) => renameItem(itemKey, name === "" ? null : name)}
          />
        }
        subtitle={[
          ownName === undefined ? undefined : pieceNameOf(only, catalogIndex),
          catalogIndex?.pieceByClass.get(only.actorToSpawn)?.category || "Piece",
          link
        ].filter((part) => part !== undefined).join(" · ")}
        actions={<SelectionActions />}
      />
    )
  const playerStart = items.some(isPlayerStart)
  const meshWarning = only === undefined ? null : <MeshWarning item={only} />
  return (
    <IdentityBlock>
      {identity}
      {(playerStart || meshWarning !== null) && (
        <div className="flex flex-wrap gap-1 empty:hidden">
          {playerStart && <HintBadge label="Player start (required)">{PLAYER_START_HINT}</HintBadge>}
          {meshWarning}
        </div>
      )}
      {only !== undefined && itemKey !== undefined && <ItemTags itemKey={itemKey} />}
    </IdentityBlock>
  )
})

/** The identifiers behind a single item, for when something needs looking up. Closed unless asked for. */
const ItemDetails = memo(function ItemDetails({ item, index }: { readonly item: Item; readonly index: number }) {
  return (
    <Section id="details" title="Details" defaultOpen={false}>
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
    </Section>
  )
})

/** The row a transform field is in. */
const FIELD_KINDS: Readonly<Record<TransformField, FieldKind>> = {
  translation: "location",
  rotation: "rotation",
  scale3D: "scale"
}

/** Whether a thing is one item, not a group of them. */
const isItemThing = ({ unit }: Thing) => unit.id === unit.anchor

/** What the rows' help and the Size choice speak of: one item, one group, or several things. */
const rowsOf = (things: ReadonlyArray<Thing>): RowsOf =>
  things.length > 1 ? "things" : things.every(isItemThing) ? "item" : "group"

const SIZE_UNKNOWN: Readonly<Record<RowsOf, string>> = {
  item: "This piece's size isn't known",
  group:
    "A group's items scale along their own axes, so it has no one size. Pivot it on a member to size it by that member",
  things:
    "Not every one of these has a size: a group's items scale along their own axes, so it has none unless it pivots on a member"
}

/**
 * The Transform section: the selected things, each edited as one, with the same rows for a piece, a group and several
 * (the editor's rules § 4). `active` is the thing holding the last selected item, which a copy reads and whose size
 * a snapped Scale scrub keeps on the grid. `items` are the selected items when every thing is one, so decals get their
 * Size row.
 */
function TransformSection({ things, active, items = NO_ITEMS, children }: {
  readonly things: ReadonlyArray<Thing>
  readonly active: Thing
  readonly items?: ReadonlyArray<Item>
  readonly children?: ReactNode
}) {
  const units = useEditor((s) => s.settings.general.units)
  const scaleMode = useEditor((s) => s.settings.panels.inspectorScale)
  // a definition's tab reads its locations from the prefab's frame, where the origin marker is
  const origin = useEditor((s) => documentOrigin(s.document))
  // Display units only; the map always stores centimetres (rotation and scale don't convert).
  const perUnit = units === "m" ? 100 : 1
  // a decal's scale is its size already
  const decals = items.length > 0 && items.every(isDecal)
  const of = rowsOf(things)
  const sizeKnown = things.every((thing) => thing.extent !== undefined)
  const rowProps = (row: TransformRowSpec, view: FieldView) => {
    const copied = readThing(active, view)
    return {
      row,
      view,
      values: things.map((thing) => readThing(thing, view)),
      copyValue: copied === undefined ? ORIGIN : vecScale(copied, view.perUnit),
      extent: active.extent
    }
  }
  return (
    <Section id="transform" title="Transform" className="@container gap-2">
      {transformRows(units, of).map((row) => {
        const view: FieldView = row.field === "translation"
          ? { kind: "location", perUnit, origin }
          : { kind: FIELD_KINDS[row.field], perUnit: 1 }
        if (row.field !== "scale3D") return <TransformRow key={row.field} {...rowProps(row, view)} />
        if (decals) return <TransformRow key={row.field} {...rowProps(DECAL_SIZE_ROW, view)} />
        const mode = <ScaleModeToggle units={units} sizeKnown={sizeKnown} unknown={SIZE_UNKNOWN[of]} />
        if (!sizeKnown || scaleMode === "factor") {
          // the toggle says it's a factor
          return <TransformRow key={row.field} {...rowProps({ ...row, unit: "" }, view)} mode={mode} />
        }
        return (
          <TransformRow
            key={row.field}
            {...rowProps(sizeRow(units, of), { kind: "size", perUnit })}
            clipKey="size"
            mode={mode}
          />
        )
      })}
      {children}
    </Section>
  )
}

const NO_ITEMS: ReadonlyArray<Item> = []

/**
 * Everything that edits the selection's items, all of them at once. A whole group's items get no Transform section:
 * the group has its own, over its frame.
 */
function ItemEditor({ items, ids, placed, transform, things, active: activeThing }: {
  /** The selected things as shown, in selection order, which the Transform rows edit one by one. */
  readonly things: ReadonlyArray<Thing>
  /** The thing holding the last selected item. */
  readonly active: Thing | undefined
  readonly items: ReadonlyArray<Item>
  readonly ids: ReadonlyArray<string>
  readonly placed: ReadonlyArray<PlacedItem>
  readonly transform: boolean
}) {
  const painted = useMemo(() => items.map((item, i) => ({ item, id: ids[i] ?? "" })), [items, ids])
  const properties = useMemo(() => selectionProperties(placed), [placed])
  if (items.length === 0) return null
  return (
    <>
      {transform && activeThing !== undefined && (
        <>
          <TransformSection
            things={things}
            active={activeThing}
            items={things.every(isItemThing) ? items : NO_ITEMS}
          >
            <FlipSection items={placed} />
          </TransformSection>
          <PivotSection />
          <AlignSection />
          {items.length === 1 && ids[0] !== undefined && <ConnectsAtSection itemKey={ids[0]} />}
        </>
      )}
      <PaintSection selected={painted} />
      <ItemProperties properties={properties} />
    </>
  )
}

/** The array as it is: through `useShallow`, the last one while they hold the same values. */
function sameArray<T>(values: ReadonlyArray<T>): ReadonlyArray<T> {
  return values
}

/** How long a change waits for a frame to be painted before it shows anyway: a window out of sight paints none. */
const PAINT_WAIT_MS = 100

/**
 * `value`, once the frame after it changed has been painted: what this shows waits for the viewport to show the change,
 * then renders at once. React's own deferral would share the time with the viewport's frames, and take twice as long.
 */
function useAfterPaint<T>(value: T): T {
  const [shown, setShown] = useState(() => value)
  useEffect(() => {
    if (Object.is(shown, value)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = () => {
      clearTimeout(fallback)
      setShown(() => value)
    }
    const fallback = setTimeout(show, PAINT_WAIT_MS)
    // a frame's callbacks run before it paints: the timeout after one runs once it has
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(show)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(fallback)
    }
  }, [value, shown])
  return shown
}

export function Inspector() {
  // The selection as the Inspector shows it: a frame behind the store's when it changes, so a click's outline and gizmo
  // show in the viewport straight away, rather than after the sections a selection mounts.
  const selectedIds = useAfterPaint(useEditor((s) => s.selectedIds))
  const doc = useEditor((s) => s.doc)
  // Selected items in selection order. Kept while they are the same items, so an edit elsewhere in the map renders none
  // of this.
  const indices = useShallow(sameArray<number>)(selectedIndices({ doc, selectedIds }))
  const items = useShallow(sameArray<Item>)(indices.flatMap((index) => doc.map.items[index] ?? []))
  const ids = useShallow(sameArray<string>)(indices.map((index) => doc.ids[index] ?? ""))
  // live while the gizmo drags or a field scrubs, committed on release
  const preview = useEditor((s) => s.preview)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const tree = useEditor((s) => s.doc.structure.tree)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const group = useMemo(
    () => soleGroupOf(tree, selectedIds, enteredGroupId),
    [tree, selectedIds, enteredGroupId]
  )
  // The selected things as shown, which the Transform rows edit one by one, and the one holding the active item. Read
  // from the store at the time, since they are built afresh from the items' shown transforms and a selector returning
  // them would re-render without end.
  const previewLanding = useEditor((s) => s.previewLanding)
  const { things, active } = useMemo(() => {
    const s = { ...useEditor.getState(), selectedIds }
    const transformOf = (id: string) => shownTransform(s, id)
    const shown = selectionThings(s, transformOf) ?? []
    const activeUnit = selectionUnits(s, transformOf)?.active
    return { things: shown, active: shown.find((thing) => thing.unit.id === activeUnit?.id) }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the store values the things are built from, read inside
  }, [doc, preview, previewLanding, catalogIndex, selectedIds, enteredGroupId])

  // Kept from one render to the next, so the sections that take it skip the renders a drag or a scrub causes.
  const placed = useMemo(
    () => items.map((item) => ({ item, piece: catalogIndex?.pieceByClass.get(item.actorToSpawn) })),
    [items, catalogIndex]
  )

  const prefab = useOpenPrefab()
  const noTab = useEditor(noTabOpen)
  const first = items[0]
  if (noTab) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-card p-4 text-center text-fg-tertiary">
        <IconClick className="size-6" />
        <span>Open a map to see what's in it here</span>
      </div>
    )
  }
  if (first === undefined) {
    return (
      <ScrollArea className="h-full bg-card">
        <SectionStack>
          {prefab === null
            ? (
              <>
                <MapIdentity />
                <MapInfo />
                <Section id="lighting" title="Lighting">
                  <LightingSettings />
                </Section>
              </>
            )
            : <PrefabSettings prefab={prefab} />}
        </SectionStack>
      </ScrollArea>
    )
  }

  const editor = (
    <ItemEditor
      items={items}
      ids={ids}
      placed={placed}
      transform={group === undefined}
      things={things}
      active={active}
    />
  )

  return (
    <ScrollArea className="h-full bg-card">
      <SectionStack>
        {group === undefined
          ? (
            <>
              <SelectionIdentity items={items} itemKey={items.length === 1 ? ids[0] : undefined} />
              {items.length > 1 && <ContentsSection items={items} />}
              {editor}
              {items.length === 1 && <ItemDetails item={first} index={indices[0] ?? -1} />}
            </>
          )
          : (
            // A group is one thing with a name, so it's summed up; its items stay a click away, edited all at once.
            <>
              <GroupIdentity
                key={group.id}
                group={group}
                items={items}
                actions={<SelectionActions />}
              />
              <ContentsSection items={items} />
              {group.prefab !== undefined && <InstanceSection group={group} link={group.prefab} />}
              {active !== undefined && (
                <TransformSection things={things} active={active}>
                  <FlipSection items={placed} group />
                </TransformSection>
              )}
              <PivotSection />
              <ChainSection group={group} />
              {editor}
            </>
          )}
      </SectionStack>
    </ScrollArea>
  )
}
