import { IconGripVertical } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useState } from "react"
import {
  formatGridSize,
  formatRotationStep,
  formatScaleStep,
  GRID_SIZES,
  ROTATION_STEPS,
  SCALE_STEPS
} from "../domain/snap"
import {
  isPreset,
  rowsOf,
  SNAP_PRESETS,
  SNAP_TARGET_NAMES,
  type SnapConfig,
  type SnapPreset,
  type SnapTarget,
  targetSummary,
  withTargetMoved
} from "../domain/snapConfig"
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
import { snapConfigOf, useEditor } from "../editor/store"
import { NumberField } from "./NumberField"
import { SectionTitle } from "./SectionTitle"
import {
  DISCLOSURE_BODY,
  DisclosureChevron,
  Row,
  RowValue,
  Segmented,
  SliderField,
  StepField,
  StepRow,
  SwitchRow,
  ValueParameters
} from "./SnapParameters"

const BASE_NAMES = { pivot: "Pivot", closest: "Closest", centre: "Centre" } as const

export const PRESET_NAMES: Readonly<Record<SnapPreset, string>> = {
  gridFirst: "Grid first",
  piecesFirst: "Pieces first"
}

/** The preset the order is, or null for an order of the user's own. */
export const presetOf = (config: SnapConfig): SnapPreset | null =>
  isPreset(config, "gridFirst") ? "gridFirst" : isPreset(config, "piecesFirst") ? "piecesFirst" : null

/** A block of the popover: its title, then its rows. Blocks sit 8px apart, rows flush, as 28px rows give the rhythm. */
function Block({ title, children }: { readonly title: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex min-h-7 items-center justify-between gap-2">{title}</div>
      {children}
    </div>
  )
}

/** Buttons that act, as one cluster at a row's right: the same height as every other control. */
function Actions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-1">{children}</div>
}

function GridParameters({ config }: { readonly config: SnapConfig }) {
  const units = useEditor((s) => s.settings.general.units)
  const { origin, yaw } = config.targets.grid
  const hasSelection = useEditor((s) => s.selectedIds.length > 0)
  const atWorld = origin.x === 0 && origin.y === 0 && origin.z === 0
  return (
    <>
      <Row label="Step">
        <StepField
          label="Grid step"
          value={config.gridSize}
          options={GRID_SIZES}
          format={(size) => formatGridSize(size, units)}
          unit="cm"
          onChange={(gridSize) => updateSnap({ gridSize })}
        />
      </Row>
      <Row label="Origin">
        <Actions>
          <Button variant="outline" disabled={atWorld} onClick={gridOriginToWorld}>World</Button>
          <Button variant="outline" onClick={startGridOriginPick}>Pick…</Button>
          <Button variant="outline" disabled={!hasSelection} onClick={gridOriginToSelection}>Selection</Button>
        </Actions>
      </Row>
      <Row label="Rotation">
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
      <Row label="Plane from">
        <Actions>
          <Button variant="outline" onClick={startPlaneFromFace}>Face…</Button>
          <Button variant="outline" onClick={startPlaneFromPoints}>3 points…</Button>
        </Actions>
      </Row>
      <Row label="World plane">
        <Actions>
          {WORLD_PLANES.map((plane) => (
            <Button key={plane} variant="outline" onClick={() => addWorldPlane(plane)}>{plane.toUpperCase()}</Button>
          ))}
        </Actions>
      </Row>
      <Row label="Axis from">
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
      return <ValueParameters config={config} target={target} update={updateSnapTarget} />
  }
}

/** One row of the priority list: a handle, a toggle, the name, what it's set to, and its parameters behind a disclosure. */
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
          aria-label={`Drag ${SNAP_TARGET_NAMES[target]} to change its priority`}
          className="flex w-5 shrink-0 cursor-grab justify-center text-fg-tertiary"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move"
            onDragStart()
          }}
        >
          <IconGripVertical className="size-4" />
        </span>
        <CollapsibleTrigger className="group/disclosure flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control px-1 text-left focus-ring hover:bg-hover">
          <span className="shrink-0 text-body-strong">{SNAP_TARGET_NAMES[target]}</span>
          <span className="min-w-0 flex-1 truncate text-caption text-fg-tertiary">{summary}</span>
          <DisclosureChevron />
        </CollapsibleTrigger>
        <Switch
          aria-label={SNAP_TARGET_NAMES[target]}
          checked={config.targets[target].enabled}
          onCheckedChange={(enabled) => updateSnapTarget(target, { enabled })}
        />
      </div>
      <CollapsibleContent className={DISCLOSURE_BODY}>
        <Parameters config={config} target={target} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The Snap popover's body (docs/SNAPPING.md § The Snap popover): base, affect, the priority list, tracking, threshold. */
export function SnapPopoverContent() {
  const config = useEditor(snapConfigOf)
  const tracked = useEditor((s) => s.tracked.length)
  const clearTracked = useEditor((s) => s.clearTracked)
  const [dragged, setDragged] = useState<SnapTarget | null>(null)
  const rows = rowsOf(config)
  return (
    // The padding is the scroller's own, so a switch's wider hit area stays inside it and the scrollbar sits at the edge.
    <div
      className="flex max-h-[min(70vh,calc(var(--available-height)-0.5rem))] flex-col gap-2 overflow-x-hidden overflow-y-auto px-3 py-2 [scrollbar-color:color-mix(in_oklch,var(--foreground)_25%,transparent)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
      data-snap-popover
    >
      <Block title={<SectionTitle>Base</SectionTitle>}>
        <Row label="Snap from">
          <Segmented
            label="Snap base"
            value={config.base}
            items={BASE_NAMES}
            onChange={(base) => updateSnap({ base })}
          />
        </Row>
      </Block>
      <Block title={<SectionTitle>Affect</SectionTitle>}>
        <Row label="Move">
          <Switch aria-label="Snap move" checked disabled />
        </Row>
        <StepRow
          label="Rotation"
          step={{
            label: "Rotation step",
            value: config.rotationStep,
            options: ROTATION_STEPS,
            format: formatRotationStep,
            unit: "°",
            onChange: (rotationStep) => updateSnap({ rotationStep })
          }}
          enabled={config.rotationEnabled}
          onEnabled={(rotationEnabled) => updateSnap({ rotationEnabled })}
        />
        <StepRow
          label="Scale"
          step={{
            label: "Scale step",
            value: config.scaleStep,
            options: SCALE_STEPS,
            format: formatScaleStep,
            unit: "%",
            onChange: (scaleStep) => updateSnap({ scaleStep })
          }}
          enabled={config.scaleEnabled}
          onEnabled={(scaleEnabled) => updateSnap({ scaleEnabled })}
        />
      </Block>
      <Block
        title={
          <>
            <SectionTitle>Targets</SectionTitle>
            <Segmented
              label="Priority"
              value={presetOf(config)}
              items={PRESET_NAMES}
              onChange={(preset) => updateSnap({ order: SNAP_PRESETS[preset] })}
            />
          </>
        }
      >
        <div className="flex flex-col pt-1">
          {rows.map((target, index) => (
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
      </Block>
      <Block title={<SectionTitle>Tracking points</SectionTitle>}>
        <Row label={`${tracked} acquired`}>
          <Button variant="outline" disabled={tracked === 0} onClick={clearTracked}>Clear</Button>
        </Row>
      </Block>
      <Block
        title={
          <>
            <SectionTitle>Threshold</SectionTitle>
            <RowValue>{config.threshold} px</RowValue>
          </>
        }
      >
        <SliderField
          label="Snap threshold"
          min={2}
          max={40}
          step={1}
          value={config.threshold}
          onChange={(threshold) => updateSnap({ threshold })}
        />
      </Block>
    </div>
  )
}
