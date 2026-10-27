import {
  type Icon,
  IconArrowBigUp,
  IconArrowsMaximize,
  IconArrowsMove,
  IconClipboard,
  IconCopy,
  IconRefresh
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Kbd } from "@workspace/ui/components/kbd"
import { Label } from "@workspace/ui/components/label"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ReactNode, useState } from "react"
import type { UeTransform, Vec3 } from "../domain/coords"
import { classNameOf, isPlayerStart, objectPathOf } from "../domain/MapFile"
import { quatToRotator, rotatorToQuat } from "../domain/ueMath"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import { selectedIndex, useEditor } from "../editor/store"
import { glbUrl, visualsOf } from "../editor/visuals"
import { MouseButtonIcon } from "./MouseButtonIcon"
import { NumberField } from "./NumberField"

type Axis = "x" | "y" | "z"
const axes: ReadonlyArray<Axis> = ["x", "y", "z"]

/** One X/Y/Z row of the transform, in display values (units, degrees). */
interface TransformRowSpec {
  readonly kind: "position" | "rotation" | "scale"
  readonly title: string
  readonly icon: Icon
  readonly labels: Readonly<Record<Axis, string>>
  readonly read: (t: UeTransform) => Vec3
  readonly write: (t: UeTransform, v: Vec3) => UeTransform
}

const transformRows = (perUnit: number): ReadonlyArray<TransformRowSpec> => [
  {
    kind: "position",
    title: "Location",
    icon: IconArrowsMove,
    labels: { x: "X", y: "Y", z: "Z" },
    read: (t) => ({ x: t.translation.x / perUnit, y: t.translation.y / perUnit, z: t.translation.z / perUnit }),
    write: (t, v) => ({ ...t, translation: { x: v.x * perUnit, y: v.y * perUnit, z: v.z * perUnit } })
  },
  {
    // UE rotator axes: roll about X, pitch about Y, yaw about Z.
    kind: "rotation",
    title: "Rotation",
    icon: IconRefresh,
    labels: { x: "X roll", y: "Y pitch", z: "Z yaw" },
    read: (t) => {
      const r = quatToRotator(t.rotation)
      return { x: r.roll, y: r.pitch, z: r.yaw }
    },
    write: (t, v) => ({ ...t, rotation: rotatorToQuat({ roll: v.x, pitch: v.y, yaw: v.z }) })
  },
  {
    kind: "scale",
    title: "Scale",
    icon: IconArrowsMaximize,
    labels: { x: "X", y: "Y", z: "Z" },
    read: (t) => ({ x: t.scale3D.x, y: t.scale3D.y, z: t.scale3D.z }),
    write: (t, v) => ({ ...t, scale3D: { x: v.x, y: v.y, z: v.z } })
  }
]

/** Copied rows, in display values, shared by every item. */
const copiedRows = new Map<TransformRowSpec["kind"], Vec3>()

function TransformRow(props: {
  readonly row: TransformRowSpec
  /** Tooltip heading, with units. */
  readonly title: string
  /** The transform on screen (live during a drag or scrub). */
  readonly shown: UeTransform
  /** The document's transform, which edits build on. */
  readonly committed: UeTransform
  readonly onCommit: (transform: UeTransform) => void
  readonly onPreview: (transform: UeTransform | null) => void
  readonly step: number
  readonly digits: number
}) {
  const notify = useEditor((s) => s.notify)
  const { row, committed } = props
  const value = row.read(props.shown)
  const [open, setOpen] = useState(false)
  const copy = () => {
    copiedRows.set(row.kind, row.read(committed))
    notify("info", `Copied ${row.title.toLowerCase()}.`)
  }
  const paste = () => {
    const copied = copiedRows.get(row.kind)
    if (copied === undefined) notify("info", `Nothing copied for ${row.title.toLowerCase()} yet.`)
    else props.onCommit(row.write(committed, copied))
  }
  const withAxis = (axis: Axis, n: number) => row.write(committed, { ...row.read(committed), [axis]: n })
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
                    aria-label={props.title}
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
          <TooltipContent side="left" className="flex flex-col items-start gap-1">
            <span>{props.title}</span>
            <span className="flex items-center gap-1.5">
              Copy{" "}
              <Kbd>
                <IconArrowBigUp />
                <MouseButtonIcon button="right" />
              </Kbd>
              Paste{" "}
              <Kbd>
                <IconArrowBigUp />
                <MouseButtonIcon button="left" />
              </Kbd>
            </span>
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="left" align="start" className="w-auto gap-1 p-1">
          <div className="px-2 py-1 text-xs text-muted-foreground">{props.title}</div>
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
            <Kbd>
              <IconArrowBigUp />
              <MouseButtonIcon button="right" />
            </Kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-between gap-4"
            disabled={copiedRows.get(row.kind) === undefined}
            onClick={() => {
              paste()
              setOpen(false)
            }}
          >
            <span className="flex items-center gap-2">
              <IconClipboard />Paste
            </span>
            <Kbd>
              <IconArrowBigUp />
              <MouseButtonIcon button="left" />
            </Kbd>
          </Button>
        </PopoverContent>
      </Popover>
      {axes.map((axis) => (
        <NumberField
          key={axis}
          label={row.labels[axis]}
          value={value[axis]}
          onCommit={(n) => props.onCommit(withAxis(axis, n))}
          onScrub={(n) => props.onPreview(n === null ? null : withAxis(axis, n))}
          step={props.step}
          digits={props.digits}
          handleClassName={AXIS_BG_CLASSES[axis]}
        />
      ))}
    </div>
  )
}

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

export function Inspector() {
  const index = useEditor(selectedIndex)
  const item = useEditor((s) => (index < 0 ? undefined : s.doc.map.items[index]))
  const selectedId = useEditor((s) => s.selectedId)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const missing = useEditor((s) => s.missingGlbs)
  const transformItem = useEditor((s) => s.transformItem)
  const setPreview = useEditor((s) => s.setPreview)
  const preview = useEditor((s) => s.preview)
  const units = useEditor((s) => s.settings.general.units)

  if (item === undefined || selectedId === null) {
    return (
      <ScrollArea className="h-full bg-card">
        <div className="p-3">
          <MapSettings />
        </div>
      </ScrollArea>
    )
  }

  // While the gizmo drags, show the live transform (committed on release).
  const t = preview?.id === selectedId ? preview.transform : item.itemTransform
  // Display units only; the map always stores centimetres.
  const perUnit = units === "m" ? 100 : 1
  const rows = transformRows(perUnit)
  const fieldProps = {
    position: { step: perUnit === 100 ? 0.01 : 1, digits: perUnit === 100 ? 5 : 3 },
    rotation: { step: 1, digits: 3 },
    scale: { step: 0.01, digits: 3 }
  } as const
  const failed = visualsOf(item, catalogIndex).flatMap((v) => {
    const url = glbUrl(v.mesh?.glb)
    return url !== undefined && missing.has(url)
      ? [`${v.mesh?.meshAssetPath.split(".").at(-1)}: mesh failed to load`]
      : []
  })

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col gap-3 p-3">
        <SectionTitle>Item #{index}</SectionTitle>
        <div className="text-sm font-semibold break-all" title={item.actorToSpawn}>
          {classNameOf(item.actorToSpawn)}
        </div>
        {isPlayerStart(item) && <Badge variant="secondary">Player start (required)</Badge>}
        {failed.map((w) => <Badge key={w} variant="destructive">{w}</Badge>)}

        <Separator />
        <div className="flex items-baseline justify-between">
          <SectionTitle>Transform</SectionTitle>
          <span className="text-[0.65rem] text-muted-foreground">game {units} · degrees · Z up</span>
        </div>
        <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-1.5 gap-y-1.5">
          {rows.map((row) => (
            <TransformRow
              key={row.kind}
              row={row}
              title={row.kind === "position"
                ? `Location (game ${units}, Z up)`
                : row.kind === "rotation"
                ? "Rotation (degrees: roll, pitch, yaw)"
                : row.title}
              shown={t}
              committed={item.itemTransform}
              onCommit={(transform) => transformItem(selectedId, transform)}
              onPreview={(transform) => setPreview(transform === null ? null : { id: selectedId, transform })}
              {...fieldProps[row.kind]}
            />
          ))}
        </div>

        <Separator />
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
      </div>
    </ScrollArea>
  )
}
