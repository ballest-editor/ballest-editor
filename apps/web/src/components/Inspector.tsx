import {
  type Icon,
  IconArrowsMaximize,
  IconArrowsMove,
  IconClipboard,
  IconCopy,
  IconRefresh,
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
import { useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { UeTransform, Vec3 } from "../domain/coords"
import { editTransform, isDecal } from "../domain/editTransform"
import { exactSelectedGroup } from "../domain/groupSelection"
import { type Axis, readField, type TransformField } from "../domain/groupTransform"
import { selectionProperties } from "../domain/itemProperties"
import { formatBindings, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
import { classNameOf, isPlayerStart, type Item, objectPathOf } from "../domain/MapFile"
import { formatCreatedAt } from "../domain/time"
import {
  deleteSelection,
  duplicateSelection,
  editSelectionAxis,
  previewSelectionAxis,
  setSelectionField
} from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import { selectedIndices, useEditor, useOpenPrefab } from "../editor/store"
import { glbUrl, visualsOf } from "../editor/visuals"
import { FlipSection } from "./FlipSection"
import { ItemProperties } from "./ItemProperties"
import { LightingSettings } from "./LightingSettings"
import { ShiftClick } from "./MouseButtonIcon"
import { NumberField } from "./NumberField"
import { PaintSection } from "./PaintSection"
import { PathText } from "./PathText"
import { PivotSection } from "./PivotSection"
import { PrefabSettings } from "./PrefabSettings"
import { SectionTitle } from "./SectionTitle"
import { GroupSection, InstanceSection, ItemTags } from "./StructureSection"

const axes: ReadonlyArray<Axis> = ["x", "y", "z"]

function Facts({ facts }: { readonly facts: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
      {facts.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-secondary">{k}</dt>
          <dd className="min-w-0">{k === "File" ? <PathText block>{v}</PathText> : v}</dd>
        </div>
      ))}
    </dl>
  )
}

function MapSettings() {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const itemCount = useEditor((s) => s.doc.map.items.length)
  const hasEditorState = useEditor((s) => s.doc.map.editorState !== undefined)
  const fileName = useEditor((s) => s.file?.name ?? null)
  const renameLevel = useEditor((s) => s.renameLevel)
  const openDialog = useEditor((s) => s.openDialog)
  // An edit in progress; otherwise the input shows the map's name.
  const [draft, setDraft] = useState<string | null>(null)
  const name = draft ?? levelData.levelDisplayName
  const commit = () => {
    if (name !== levelData.levelDisplayName) renameLevel(name, levelData.creatorName)
    setDraft(null)
  }
  const facts: ReadonlyArray<readonly [string, string]> = [
    ["Creator", levelData.creatorName || "set in Settings › General"],
    ["Items", String(itemCount)],
    ["Created", levelData.createdAt ? formatCreatedAt(levelData.createdAt) : "on export"],
    ["Validated", levelData.bValidated ? "yes" : "no"],
    ["File", fileName === null ? "not saved yet" : `${fileName}${hasEditorState ? "" : " (no editorState)"}`]
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="-my-1.5 flex items-center justify-between">
        <SectionTitle>Map</SectionTitle>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-fg-secondary"
                aria-label="Map settings"
                onClick={() => openDialog({ id: "mapSettings" })}
              />
            }
          >
            <IconSettings />
          </TooltipTrigger>
          <TooltipContent side="left">Map settings</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="map-name" className="text-fg-secondary">Name</Label>
        <Input id="map-name" value={name} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      </div>
      <Facts facts={facts} />
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
  readonly title: string
  readonly icon: Icon
  readonly labels: Readonly<Record<Axis, string>>
  readonly step: number
  readonly digits: number
}

const transformRows = (units: "cm" | "m"): ReadonlyArray<TransformRowSpec> => [
  {
    field: "translation",
    title: `Location (game ${units}, Z up)`,
    icon: IconArrowsMove,
    labels: { x: "X", y: "Y", z: "Z" },
    step: units === "m" ? 0.01 : 1,
    digits: units === "m" ? 3 : 1
  },
  {
    field: "rotation",
    title: "Rotation (degrees: roll, pitch, yaw)",
    icon: IconRefresh,
    labels: { x: "X roll", y: "Y pitch", z: "Z yaw" },
    step: 1,
    digits: 1
  },
  {
    field: "scale3D",
    title: "Scale",
    icon: IconArrowsMaximize,
    labels: { x: "X", y: "Y", z: "Z" },
    step: 0.01,
    digits: 2
  }
]

/** A decal's scale is its size (domain/editTransform.ts): cm, so a factor's step would crawl. */
const DECAL_SIZE_ROW: TransformRowSpec = {
  field: "scale3D",
  title: "Size (cm: height, width, depth)",
  icon: IconArrowsMaximize,
  labels: { x: "X", y: "Y", z: "Z" },
  step: 1,
  digits: 1
}

const rowName = (
  field: TransformField
) => (field === "translation" ? "location" : field === "scale3D" ? "scale" : field)

/** Copied rows in stored units (cm, degrees, factor), shared by every selection. */
const copiedRows = new Map<TransformField, Vec3>()

/**
 * One editable row over the whole selection: a label icon whose menu (or Shift+click
 * shortcuts) copies and pastes all three axes, then an X/Y/Z field each. A typed value sets
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
  const copy = () => {
    copiedRows.set(field, readField(props.active, field))
    notify("info", `Copied ${rowName(field)}.`)
  }
  const paste = () => {
    const copied = copiedRows.get(field)
    if (copied === undefined) notify("info", `Nothing copied for ${rowName(field)} yet.`)
    else setSelectionField(field, copied)
  }
  return (
    <div className="contents">
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
                    size="icon"
                    aria-label={row.title}
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
            <row.icon />
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8} className="flex flex-col items-start py-2 pr-3 pl-2.5">
            <div className="text-body-strong">{row.title}</div>
            <div className="mt-1.5 grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-1 opacity-80">
              <span>Copy</span>
              <ShiftClick button="right" />
              <span>Paste</span>
              <ShiftClick button="left" />
            </div>
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="left" align="start" className="w-auto gap-1 p-1">
          <div className="px-2 py-1 text-body text-fg-secondary">{row.title}</div>
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
      {axes.map((axis) => {
        const value = shared(props.shown.map((t) => readField(t, field)[axis] / perUnit))
        const offset = (v: number, from: number) => ({ kind: "offset", by: (v - from) * perUnit }) as const
        return (
          <NumberField
            key={axis}
            label={row.labels[axis]}
            value={value}
            onCommit={(v) => editSelectionAxis(field, axis, { kind: "set", value: v * perUnit })}
            onScrub={(v, from) => previewSelectionAxis(field, axis, v === null ? null : offset(v, from))}
            onScrubCommit={(v, from) => editSelectionAxis(field, axis, offset(v, from))}
            step={row.step}
            snap={snap}
            digits={row.digits}
            handleClassName={AXIS_BG_CLASSES[axis]}
          />
        )
      })}
    </div>
  )
}

function SelectionActions() {
  const keybinds = useEditor((s) => s.keybinds)
  const shortcut = (action: KeybindAction) => `${keybindActionLabels[action]} (${formatBindings(keybinds[action])})`
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" title={shortcut("duplicateSelection")} onClick={duplicateSelection}>
        <IconCopy />
        Duplicate
      </Button>
      <Button variant="destructive" size="sm" title={shortcut("deleteSelection")} onClick={deleteSelection}>
        <IconTrash />
        Delete
      </Button>
    </div>
  )
}

/** What's selected: one item's class (and index), or a count with the classes involved. */
function SelectionHeader(
  { items }: { readonly items: ReadonlyArray<{ readonly index: number; readonly item: Item }> }
) {
  const only = items.length === 1 ? items[0] : undefined
  const counts = new Map<string, number>()
  for (const { item } of items) {
    const name = classNameOf(item.actorToSpawn)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return (
    <>
      <SectionTitle>{only === undefined ? `${items.length} items selected` : `Item #${only.index}`}</SectionTitle>
      {only === undefined
        ? (
          <ul className="flex flex-col gap-0.5 text-body break-all">
            {[...counts].map(([name, n]) => (
              <li key={name}>
                <span className="text-body-strong">{name}</span>
                <span className="ml-1 text-fg-tertiary">× {n}</span>
              </li>
            ))}
          </ul>
        )
        : (
          <div className="text-title break-all" title={only.item.actorToSpawn}>
            {classNameOf(only.item.actorToSpawn)}
          </div>
        )}
      {items.some(({ item }) => isPlayerStart(item)) && <Badge variant="secondary">Player start (required)</Badge>}
    </>
  )
}

function Meshes({ item }: { readonly item: Item }) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const missing = useEditor((s) => s.missingGlbs)
  const failed = visualsOf(item, catalogIndex).flatMap((v) => {
    const url = glbUrl(v.mesh?.glb)
    return url !== undefined && missing.has(url)
      ? [`${v.mesh?.meshAssetPath.split(".").at(-1)}: mesh failed to load`]
      : []
  })
  return (
    <>
      {failed.map((w) => <Badge key={w} variant="destructive">{w}</Badge>)}
      <SectionTitle>Meshes</SectionTitle>
      {item.meshComponents.map((mesh, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- mesh components have no id; the slot index is their identity
        <div key={i} className="flex flex-col gap-1 text-body break-all">
          <div className="font-mono" title={mesh.meshAssetPath}>
            {mesh.meshAssetPath === undefined || mesh.meshAssetPath === ""
              ? "(no main mesh)"
              : mesh.meshAssetPath.split("/").at(-1)}
          </div>
          <ul className="flex flex-col gap-0.5 pl-2 font-mono text-fg-tertiary">
            {mesh.materials.map((m) => (
              <li key={m.materialIndex} title={m.material}>
                {m.materialIndex}: {objectPathOf(m.material).split(".").at(-1)}
              </li>
            ))}
          </ul>
        </div>
      ))}
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
  const units = useEditor((s) => s.settings.general.units)
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

  // Display units only; the map always stores centimetres (rotation and scale don't convert).
  const perUnit = units === "m" ? 100 : 1
  const active = items.at(-1) ?? first
  const placed = items.map((item) => ({ item, piece: catalogIndex?.pieceByClass.get(item.actorToSpawn) }))

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col gap-3 p-3">
        {group !== undefined && (
          <>
            {group.prefab !== undefined && <InstanceSection group={group} link={group.prefab} />}
            <GroupSection key={group.id} group={group} />
            <Separator />
          </>
        )}
        <SelectionHeader items={items.map((item, i) => ({ item, index: indices[i] ?? -1 }))} />
        <SelectionActions />
        {items.length === 1 && ids[0] !== undefined && <ItemTags itemKey={ids[0]} />}

        <Separator />
        <SectionTitle>Transform</SectionTitle>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-1">
            {transformRows(units).map((row) => (
              <TransformRow
                key={row.field}
                row={row.field === "scale3D" && items.every(isDecal) ? DECAL_SIZE_ROW : row}
                shown={transforms}
                active={editTransform(active)}
                perUnit={row.field === "translation" ? perUnit : 1}
              />
            ))}
          </div>
          <FlipSection items={placed} />
        </div>

        <Separator />
        <PivotSection />

        <Separator />
        <SectionTitle>Paint</SectionTitle>
        <PaintSection selected={items.map((item, i) => ({ item, id: ids[i] ?? "" }))} />
        <ItemProperties properties={selectionProperties(placed)} />

        {items.length === 1 && (
          <>
            <Separator />
            <Meshes item={first} />
          </>
        )}
      </div>
    </ScrollArea>
  )
}
