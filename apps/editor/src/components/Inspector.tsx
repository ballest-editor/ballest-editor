import { IconCopy, IconTrash } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { type ReactNode, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { UeTransform } from "../domain/coords"
import type { Axis, TransformField } from "../domain/groupTransform"
import { formatBindings, type KeybindAction, keybindActionLabels } from "../domain/Keybinds"
import { classNameOf, isPlayerStart, type Item, objectPathOf } from "../domain/MapFile"
import { deleteSelection, duplicateSelection, editSelectionAxis, previewSelectionAxis } from "../editor/actions"
import { selectedIndices, shownTransform, useEditor } from "../editor/store"
import { glbUrl, visualsOf } from "../editor/visuals"
import { NumberField } from "./NumberField"

const axes: ReadonlyArray<Axis> = ["x", "y", "z"]

const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <div className="text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>
)

function MapSettings() {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const itemCount = useEditor((s) => s.doc.map.items.length)
  const hasEditorState = useEditor((s) => s.doc.map.editorState !== undefined)
  const sourceName = useEditor((s) => s.sourceName)
  const renameLevel = useEditor((s) => s.renameLevel)
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
    ["Created", levelData.createdAt || "on export"],
    ["Validated", levelData.bValidated ? "yes" : "no"],
    ["Source", `${sourceName ?? "new map"}${hasEditorState ? "" : " (no editorState)"}`]
  ]
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Map</SectionTitle>
      <div className="flex flex-col gap-1">
        <Label htmlFor="map-name" className="text-muted-foreground">Name</Label>
        <Input id="map-name" value={name} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** The value all items share, or null when they differ (shown as mixed). */
const shared = (values: ReadonlyArray<number>): number | null => {
  const first = values[0]
  return first !== undefined && values.every((v) => v === first) ? first : null
}

const fixed = (value: number | null, digits: number) => (value === null ? "mixed" : value.toFixed(digits))

/**
 * One editable row (position or scale) over the whole selection. A typed value sets every
 * selected item; a scrub moves each by the same amount from where it was, so a mixed
 * selection keeps its spread. `perUnit` converts display units to the stored value.
 */
function AxisFields(props: {
  readonly field: TransformField
  readonly transforms: ReadonlyArray<UeTransform>
  readonly perUnit: number
  readonly step: number
  readonly digits: number
}) {
  const { field, transforms, perUnit, step, digits } = props
  return (
    <div className="grid grid-cols-3 gap-2">
      {axes.map((axis) => {
        const value = shared(transforms.map((t) => t[field][axis] / perUnit))
        const offset = (v: number) => ({ kind: "offset", by: (v - (value ?? 0)) * perUnit }) as const
        return (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            value={value}
            onCommit={(v) => editSelectionAxis(field, axis, { kind: "set", value: v * perUnit })}
            onScrub={(v) => previewSelectionAxis(field, axis, v === null ? null : offset(v))}
            onScrubCommit={(v) => editSelectionAxis(field, axis, offset(v))}
            step={step}
            digits={digits}
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
          <ul className="flex flex-col gap-0.5 text-xs break-all">
            {[...counts].map(([name, n]) => (
              <li key={name}>
                <span className="font-semibold">{name}</span>
                <span className="ml-1 text-muted-foreground">× {n}</span>
              </li>
            ))}
          </ul>
        )
        : (
          <div className="text-sm font-semibold break-all" title={only.item.actorToSpawn}>
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
        <div key={i} className="flex flex-col gap-1 text-xs break-all">
          <div className="font-mono" title={mesh.meshAssetPath}>
            {mesh.meshAssetPath === undefined || mesh.meshAssetPath === ""
              ? "(no main mesh)"
              : mesh.meshAssetPath.split("/").at(-1)}
          </div>
          <ul className="flex flex-col gap-0.5 pl-2 font-mono text-muted-foreground">
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
  const transforms = useEditor(useShallow((s) => s.selectedIds.flatMap((id) => shownTransform(s, id) ?? [])))
  const units = useEditor((s) => s.settings.general.units)

  const first = items[0]
  if (first === undefined) {
    return (
      <ScrollArea className="h-full bg-card">
        <div className="p-3">
          <MapSettings />
        </div>
      </ScrollArea>
    )
  }

  // Display units only; the map always stores centimetres.
  const perUnit = units === "m" ? 100 : 1
  const rotation = (axis: keyof UeTransform["rotation"]) => fixed(shared(transforms.map((t) => t.rotation[axis])), 4)

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col gap-3 p-3">
        <SelectionHeader items={items.map((item, i) => ({ item, index: indices[i] ?? -1 }))} />
        <SelectionActions />

        <Separator />
        <SectionTitle>Position (game {units}, Z up)</SectionTitle>
        <AxisFields
          field="translation"
          transforms={transforms}
          perUnit={perUnit}
          step={units === "m" ? 0.01 : 1}
          digits={units === "m" ? 5 : 3}
        />

        <SectionTitle>Rotation (quaternion)</SectionTitle>
        <div className="font-mono text-xs text-muted-foreground">
          x {rotation("x")} y {rotation("y")} z {rotation("z")} w {rotation("w")}
        </div>
        <SectionTitle>Scale</SectionTitle>
        <AxisFields field="scale3D" transforms={transforms} perUnit={1} step={0.01} digits={3} />

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
