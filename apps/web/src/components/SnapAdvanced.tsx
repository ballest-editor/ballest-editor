import { IconGripVertical } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useState } from "react"
import { rowsOf, type SnapConfig, type SnapTarget, targetSummary, withTargetMoved } from "../domain/snapConfig"
import { WORLD_AXES, WORLD_PLANES } from "../domain/snapTools"
import { annotationsOf } from "../domain/structure"
import {
  addOffsetPlane,
  addWorldAxis,
  addWorldPlane,
  gridOriginToSelection,
  gridOriginToWorld,
  gridYawReset,
  gridYawToSelection,
  startAxisFromPoints,
  startGridOriginPick,
  startPlaneFromFace,
  startPlaneFromPoints,
  updateSnap,
  updateSnapTarget
} from "../editor/actions"
import { tabSnapOf, useEditor } from "../editor/store"
import { InfoHint } from "./InfoHint"
import { NumberField } from "./NumberField"
import { SectionTitle } from "./SectionTitle"
import { DISCLOSURE_BODY, DisclosureChevron, Row, Segmented, SwitchRow, ValueParameters } from "./SnapParameters"

const BASE_NAMES = { pivot: "Pivot", closest: "Closest", centre: "Center" } as const

/**
 * The targets as the snap menu names them (docs/SNAPPING.md § The snap menu): Ends, Surfaces and Guides are the plain
 * screen's switches under Snap to pieces, and Guides is two targets there, line-up guides to nearby pieces and guides
 * from remembered points.
 */
export const TARGET_WORDS: Readonly<Record<SnapTarget, { readonly label: string; readonly help: string }>> = {
  grid: {
    label: "Grid",
    help: "Lines a set distance apart, from the grid's origin and turned with it."
  },
  connectors: {
    label: "Ends",
    help:
      "The ends of tracks, tubes and ramps join end to end. Example: a Curve's end joins a Track's end with no step."
  },
  mesh: {
    label: "Surfaces",
    help: "The corners, edges, middles and faces of other pieces. Example: a lamp dropped on a wall sits on the wall."
  },
  construction: {
    label: "Planes",
    help: "Planes and lines you add yourself, to build along. Example: a plane at 45° to lay a ramp's pieces on."
  },
  tracking: {
    label: "Point guides",
    help: "Guides from points the pointer rested on. Example: rest on a corner, then move along the guide out of it."
  },
  alignment: {
    label: "Line-up guides",
    help: "Lines up with pieces nearby, and draws a guide while it does. Example: a kicker set level with a landing."
  }
}

/** Buttons that act, as one cluster at a row's right: the same height as every other control. */
function Actions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-1">{children}</div>
}

function GridParameters({ config }: { readonly config: SnapConfig }) {
  const { origin, yaw } = config.targets.grid
  const hasSelection = useEditor((s) => s.selectedIds.length > 0)
  const atWorld = origin.x === 0 && origin.y === 0 && origin.z === 0
  return (
    <>
      <Row
        label="Origin"
        help="Where the grid's lines count from: the world's center, a point you pick, or the selection."
      >
        <Actions>
          <Button variant="outline" disabled={atWorld} onClick={gridOriginToWorld}>World</Button>
          <Button variant="outline" onClick={startGridOriginPick}>Pick…</Button>
          <Button variant="outline" disabled={!hasSelection} onClick={gridOriginToSelection}>Selection</Button>
        </Actions>
      </Row>
      <Row label="Rotation" help="Turns the grid, to build square to a piece that isn't square to the world.">
        <span className="pr-1 text-fg-secondary tabular-nums">{Math.round(yaw * 10) / 10}°</span>
        <Actions>
          <Button variant="outline" disabled={yaw === 0} onClick={gridYawReset}>Reset</Button>
          <Button variant="outline" disabled={!hasSelection} onClick={gridYawToSelection}>Selection</Button>
        </Actions>
      </Row>
    </>
  )
}

/** One construction plane or axis: its name, and for a plane its grid and a new plane made from it. */
function ConstructionEntry({ one }: { readonly one: ReturnType<typeof annotationsOf>["construction"][number] }) {
  const removeConstruction = useEditor((s) => s.removeConstruction)
  const renameConstruction = useEditor((s) => s.renameConstruction)
  const setConstructionGrid = useEditor((s) => s.setConstructionGrid)
  const [distance, setDistance] = useState(100)
  const [angle, setAngle] = useState(0)
  return (
    <div className="flex flex-col rounded-surface bg-muted/60 px-2 py-1">
      <div className="flex min-h-7 items-center gap-1">
        <Input
          aria-label={`Name of ${one.name}`}
          className="min-w-0 flex-1"
          defaultValue={one.name}
          onBlur={(e) => {
            if (e.target.value !== one.name && e.target.value.length > 0) renameConstruction(one.id, e.target.value)
          }}
        />
        <Button variant="ghost" onClick={() => removeConstruction(one.id)}>Delete</Button>
      </div>
      {one.kind === "plane" && (
        <>
          <SwitchRow
            label="Grid on this plane"
            help="Draws the grid on this plane and snaps to it there."
            checked={one.grid}
            onChange={(on) => setConstructionGrid(one.id, on)}
          />
          <div className="flex min-h-7 items-center gap-1">
            <div className="min-w-0 flex-1">
              <NumberField label="Offset" value={distance} digits={1} handle={false} unit="cm" onCommit={setDistance} />
            </div>
            <div className="min-w-0 flex-1">
              <NumberField label="Angle" value={angle} digits={1} handle={false} unit="°" onCommit={setAngle} />
            </div>
            <Button variant="outline" onClick={() => addOffsetPlane(one.id, distance, angle)}>New plane</Button>
          </div>
        </>
      )}
    </div>
  )
}

function ConstructionParameters() {
  const construction = useEditor((s) => annotationsOf(s.doc.structure).construction)
  return (
    <>
      <Row label="Plane from" help="Adds a plane on a face you click, or through three points you click.">
        <Actions>
          <Button variant="outline" onClick={startPlaneFromFace}>Face…</Button>
          <Button variant="outline" onClick={startPlaneFromPoints}>3 points…</Button>
        </Actions>
      </Row>
      <Row label="World plane" help="Adds one of the world's planes through the grid's origin.">
        <Actions>
          {WORLD_PLANES.map((plane) => (
            <Button key={plane} variant="outline" onClick={() => addWorldPlane(plane)}>{plane.toUpperCase()}</Button>
          ))}
        </Actions>
      </Row>
      <Row label="Axis from" help="Adds a line along a world axis, or through two points you click.">
        <Actions>
          {WORLD_AXES.map((axis) => (
            <Button key={axis} variant="outline" onClick={() => addWorldAxis(axis)}>{axis.toUpperCase()}</Button>
          ))}
          <Button variant="outline" onClick={startAxisFromPoints}>2 points…</Button>
        </Actions>
      </Row>
      {construction.length > 0 && (
        <div className="flex flex-col gap-1 pt-1">
          {construction.map((one) => <ConstructionEntry key={one.id} one={one} />)}
        </div>
      )}
    </>
  )
}

function Parameters({ config, target }: { readonly config: SnapConfig; readonly target: SnapTarget }) {
  switch (target) {
    case "grid":
      return <GridParameters config={config} />
    case "construction":
      return <ConstructionParameters />
    default:
      return <ValueParameters config={config} target={target} />
  }
}

/** The targets whose rows have no parameters of the map's: what is left of Tracking's is Settings › Editor › Snapping's. */
const NO_PARAMETERS: ReadonlySet<SnapTarget> = new Set(["tracking"])

/**
 * One row of the priority list: a handle, the name, what it's set to, its help, its switch, and its parameters, where
 * it has any.
 */
function TargetRow({ config, target, index, dragging, onDragStart, onDropAt }: {
  readonly config: SnapConfig
  readonly target: SnapTarget
  readonly index: number
  readonly dragging: boolean
  readonly onDragStart: () => void
  readonly onDropAt: (index: number) => void
}) {
  const units = useEditor((s) => s.settings.general.units)
  const constructions = useEditor((s) => annotationsOf(s.doc.structure).construction.length)
  const summary = targetSummary(config, target, units, { construction: constructions })
  const { label, help } = TARGET_WORDS[target]
  const title = (
    <>
      <span className="shrink-0 text-body-strong">{label}</span>
      <span className="min-w-0 flex-1 truncate text-caption text-fg-tertiary">{summary}</span>
    </>
  )
  return (
    <Collapsible
      data-snap-target={target}
      className={cn("rounded-control", dragging && "opacity-50")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropAt(index)
      }}
    >
      <div className="flex min-h-7 items-center gap-1">
        <span
          draggable
          role="button"
          aria-label={`Drag ${label} to change its place`}
          className="flex w-5 shrink-0 cursor-grab justify-center text-fg-tertiary"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move"
            onDragStart()
          }}
        >
          <IconGripVertical className="size-4" />
        </span>
        {NO_PARAMETERS.has(target)
          ? (
            <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-1">
              {title}
              {/* the chevron's room, so the switches line up down the list */}
              <span className="size-4 shrink-0" />
            </div>
          )
          : (
            <CollapsibleTrigger className="group/disclosure flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control px-1 text-left focus-ring hover:bg-hover">
              {title}
              <DisclosureChevron />
            </CollapsibleTrigger>
          )}
        <InfoHint>{help}</InfoHint>
        <Switch
          aria-label={label}
          checked={config.targets[target].enabled}
          onCheckedChange={(enabled) => updateSnapTarget(target, { enabled })}
        />
      </div>
      {!NO_PARAMETERS.has(target) && (
        <CollapsibleContent className={DISCLOSURE_BODY}>
          <Parameters config={config} target={target} />
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

/**
 * The snap menu's Advanced (docs/SNAPPING.md § The snap menu): which point snaps, and the priority list with each
 * target's parameters.
 */
export function SnapAdvanced() {
  // as the tab keeps them: the grid's origin from the document's, so World is the 0, 0, 0 a definition shows
  const config = useEditor(tabSnapOf)
  const [dragged, setDragged] = useState<SnapTarget | null>(null)
  return (
    <div className="flex flex-col gap-2" data-snap-advanced>
      <div className="flex flex-col">
        <Row
          label="Snap from"
          help="Which point of what you drag lands on the target: its pivot, its point nearest the target, or its center."
        >
          <Segmented
            label="Snap from"
            value={config.base}
            items={BASE_NAMES}
            onChange={(base) => updateSnap({ base })}
          />
        </Row>
      </div>
      <div className="flex flex-col">
        <div className="flex min-h-7 items-center gap-1">
          <SectionTitle>Order</SectionTitle>
          <InfoHint>
            When two are near at once, the higher one wins. Drag a row by its handle to move it; Prefer sets the two
            usual orders.
          </InfoHint>
        </div>
        {rowsOf(config).map((target, index) => (
          <TargetRow
            key={target}
            config={config}
            target={target}
            index={index}
            dragging={dragged === target}
            onDragStart={() => setDragged(target)}
            onDropAt={(at) => {
              if (dragged !== null) updateSnap({ order: withTargetMoved(config, dragged, at).order })
              setDragged(null)
            }}
          />
        ))}
      </div>
    </div>
  )
}
