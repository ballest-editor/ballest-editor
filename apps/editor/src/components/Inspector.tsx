import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { type ReactNode, useEffect, useState } from "react"
import { classNameOf, isPlayerStart, objectPathOf } from "../domain/MapFile"
import { glbUrl, visualsOf } from "../editor/visuals"
import { selectedIndex, useEditor } from "../editor/store"
import { NumberField } from "./NumberField"

const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <div className="text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>
)

function MapSettings() {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const itemCount = useEditor((s) => s.doc.map.items.length)
  const hasEditorState = useEditor((s) => s.doc.map.editorState !== undefined)
  const sourceName = useEditor((s) => s.sourceName)
  const renameLevel = useEditor((s) => s.renameLevel)
  const [name, setName] = useState(levelData.levelDisplayName)
  useEffect(() => setName(levelData.levelDisplayName), [levelData.levelDisplayName])
  const commit = () => {
    if (name !== levelData.levelDisplayName) renameLevel(name, levelData.creatorName)
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
        <Input id="map-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} />
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

export function Inspector() {
  const index = useEditor(selectedIndex)
  const item = useEditor((s) => (index < 0 ? undefined : s.doc.map.items[index]))
  const selectedId = useEditor((s) => s.selectedId)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const missing = useEditor((s) => s.missingGlbs)
  const moveItem = useEditor((s) => s.moveItem)
  const preview = useEditor((s) => s.preview)
  const units = useEditor((s) => s.settings.general.units)

  if (item === undefined || selectedId === null) {
    return (
      <ScrollArea className="h-full bg-card">
        <div className="p-3"><MapSettings /></div>
      </ScrollArea>
    )
  }

  // While the gizmo drags, show the live transform (committed on release).
  const t = preview !== null && preview.id === selectedId ? preview.transform : item.itemTransform
  // Display units only; the map always stores centimetres.
  const perUnit = units === "m" ? 100 : 1
  const setAxis = (axis: "x" | "y" | "z") => (value: number) => moveItem(selectedId, { ...t.translation, [axis]: value * perUnit })
  const failed = visualsOf(item, catalogIndex).flatMap((v) => {
    const url = glbUrl(v.mesh?.glb)
    return url !== undefined && missing.has(url) ? [`${v.mesh?.meshAssetPath.split(".").at(-1)}: mesh failed to load`] : []
  })

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col gap-3 p-3">
        <SectionTitle>Item #{index}</SectionTitle>
        <div className="text-sm font-semibold break-all" title={item.actorToSpawn}>{classNameOf(item.actorToSpawn)}</div>
        {isPlayerStart(item) && <Badge variant="secondary">Player start (required)</Badge>}
        {failed.map((w) => <Badge key={w} variant="destructive">{w}</Badge>)}

        <Separator />
        <SectionTitle>Position (game {units}, Z up)</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="X" value={t.translation.x / perUnit} onCommit={setAxis("x")} digits={units === "m" ? 5 : 3} />
          <NumberField label="Y" value={t.translation.y / perUnit} onCommit={setAxis("y")} digits={units === "m" ? 5 : 3} />
          <NumberField label="Z" value={t.translation.z / perUnit} onCommit={setAxis("z")} digits={units === "m" ? 5 : 3} />
        </div>

        <SectionTitle>Rotation (quaternion)</SectionTitle>
        <div className="font-mono text-xs text-muted-foreground">
          x {t.rotation.x.toFixed(4)} y {t.rotation.y.toFixed(4)} z {t.rotation.z.toFixed(4)} w {t.rotation.w.toFixed(4)}
        </div>
        <SectionTitle>Scale</SectionTitle>
        <div className="font-mono text-xs text-muted-foreground">
          {t.scale3D.x.toFixed(3)} × {t.scale3D.y.toFixed(3)} × {t.scale3D.z.toFixed(3)}
        </div>

        <Separator />
        <SectionTitle>Meshes</SectionTitle>
        {item.meshComponents.map((mesh, i) => (
          <div key={i} className="flex flex-col gap-1 text-xs break-all">
            <div className="font-mono" title={mesh.meshAssetPath}>
              {mesh.meshAssetPath === undefined || mesh.meshAssetPath === "" ? "(no main mesh)" : mesh.meshAssetPath.split("/").at(-1)}
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
      </div>
    </ScrollArea>
  )
}
