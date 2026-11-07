import { IconChevronRight, IconGripVertical } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Slider } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
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
  SNAP_BASES,
  SNAP_TARGET_NAMES,
  type SnapConfig,
  type SnapTarget,
  targetSummary,
  withPreset,
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
import { Row, StepField, Toggle, ValueParameters } from "./SnapParameters"

const BASE_NAMES = { pivot: "Pivot", closest: "Closest", centre: "Centre" } as const

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
        <Button size="sm" variant="outline" disabled={atWorld} onClick={gridOriginToWorld}>World</Button>
        <Button size="sm" variant="outline" onClick={startGridOriginPick}>Pick…</Button>
        <Button size="sm" variant="outline" disabled={!hasSelection} onClick={gridOriginToSelection}>
          Selection
        </Button>
      </Row>
      <Row label={`Rotation ${Math.round(yaw * 10) / 10}°`}>
        <Button size="sm" variant="outline" disabled={yaw === 0} onClick={gridYawReset}>Reset</Button>
        <Button size="sm" variant="outline" disabled={!hasSelection} onClick={gridYawToSelection}>Selection</Button>
      </Row>
    </>
  )
}

function ConstructionParameters() {
  const construction = useEditor((s) => annotationsOf(s.doc.structure).construction)
  const removeConstruction = useEditor((s) => s.removeConstruction)
  const renameConstruction = useEditor((s) => s.renameConstruction)
  const setConstructionGrid = useEditor((s) => s.setConstructionGrid)
  const [distance, setDistance] = useState(100)
  const [angle, setAngle] = useState(0)
  return (
    <>
      <Row label="Plane from">
        <Button size="sm" variant="outline" onClick={startPlaneFromFace}>Face…</Button>
        <Button size="sm" variant="outline" onClick={startPlaneFromPoints}>3 points…</Button>
      </Row>
      <Row label="World plane">
        {WORLD_PLANES.map((plane) => (
          <Button
            key={plane}
            size="sm"
            variant="outline"
            onClick={() => addWorldPlane(plane)}
          >
            {plane.toUpperCase()}
          </Button>
        ))}
      </Row>
      <Row label="Axis from">
        {WORLD_AXES.map((axis) => (
          <Button key={axis} size="sm" variant="outline" onClick={() => addWorldAxis(axis)}>
            {axis.toUpperCase()}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={startAxisFromPoints}>2 points…</Button>
      </Row>
      {construction.map((one) => (
        <div key={one.id} className="flex flex-col gap-1 rounded-control border p-1.5">
          <div className="flex items-center gap-1">
            <input
              aria-label={`Name of ${one.name}`}
              className="min-w-0 flex-1 bg-transparent outline-none"
              defaultValue={one.name}
              onBlur={(e) => {
                if (e.target.value !== one.name && e.target.value.length > 0) renameConstruction(one.id, e.target.value)
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => removeConstruction(one.id)}>Delete</Button>
          </div>
          {one.kind === "plane" && (
            <>
              <Toggle
                label="Grid on this plane"
                checked={one.grid}
                onChange={(on) => setConstructionGrid(one.id, on)}
              />
              <div className="flex flex-wrap items-end justify-end gap-1">
                <div className="min-w-20 flex-1">
                  <NumberField
                    label="Offset"
                    value={distance}
                    digits={1}
                    handle={false}
                    unit="cm"
                    onCommit={setDistance}
                  />
                </div>
                <div className="min-w-20 flex-1">
                  <NumberField label="Angle" value={angle} digits={1} handle={false} unit="°" onCommit={setAngle} />
                </div>
                <Button size="sm" variant="outline" onClick={() => addOffsetPlane(one.id, distance, angle)}>
                  New plane
                </Button>
              </div>
            </>
          )}
        </div>
      ))}
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

/** One row of the priority list: a toggle, the name, what it's set to, and its parameters behind a disclosure. */
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
      <div className="flex h-8 items-center gap-1">
        <span
          draggable
          role="button"
          aria-label={`Drag ${SNAP_TARGET_NAMES[target]} to change its priority`}
          className="cursor-grab text-fg-tertiary"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move"
            onDragStart()
          }}
        >
          <IconGripVertical className="size-4" />
        </span>
        <Switch
          aria-label={SNAP_TARGET_NAMES[target]}
          checked={config.targets[target].enabled}
          onCheckedChange={(enabled) => updateSnapTarget(target, { enabled })}
        />
        <CollapsibleTrigger className="group/row flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-control text-left focus-ring">
          <span className="shrink-0">{SNAP_TARGET_NAMES[target]}</span>
          <span className="min-w-0 flex-1 truncate text-caption text-fg-tertiary">{summary}</span>
          <IconChevronRight className="size-4 shrink-0 text-fg-tertiary transition-transform group-data-[panel-open]/row:rotate-90" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="flex flex-col gap-1 py-1 pl-6">
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
      <SectionTitle>Base</SectionTitle>
      <ToggleGroup
        aria-label="Snap base"
        value={[config.base]}
        onValueChange={(value: ReadonlyArray<string>) => {
          const base = SNAP_BASES.find((one) => value.includes(one) && one !== config.base)
          if (base !== undefined) updateSnap({ base })
        }}
      >
        {SNAP_BASES.map((base) => <ToggleGroupItem key={base} value={base}>{BASE_NAMES[base]}</ToggleGroupItem>)}
      </ToggleGroup>
      <SectionTitle>Affect</SectionTitle>
      <Row label="Move">
        <Switch aria-label="Move" checked disabled />
      </Row>
      <Row label="Rotate">
        <StepField
          label="Rotation step"
          value={config.rotationStep}
          options={ROTATION_STEPS}
          format={formatRotationStep}
          unit="°"
          onChange={(rotationStep) => updateSnap({ rotationStep })}
        />
        <Switch
          aria-label="Snap rotation"
          className="ml-1"
          checked={config.rotationEnabled}
          onCheckedChange={(rotationEnabled) => updateSnap({ rotationEnabled })}
        />
      </Row>
      <Row label="Scale">
        <StepField
          label="Scale step"
          value={config.scaleStep}
          options={SCALE_STEPS}
          format={formatScaleStep}
          unit="%"
          onChange={(scaleStep) => updateSnap({ scaleStep })}
        />
        <Switch
          aria-label="Snap scale"
          className="ml-1"
          checked={config.scaleEnabled}
          onCheckedChange={(scaleEnabled) => updateSnap({ scaleEnabled })}
        />
      </Row>
      <SectionTitle>Targets</SectionTitle>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={isPreset(config, "gridFirst") ? "secondary" : "outline"}
          onClick={() => updateSnap({ order: withPreset(config, "gridFirst").order })}
        >
          Grid first
        </Button>
        <Button
          size="sm"
          variant={isPreset(config, "piecesFirst") ? "secondary" : "outline"}
          onClick={() => updateSnap({ order: withPreset(config, "piecesFirst").order })}
        >
          Pieces first
        </Button>
      </div>
      <div className="flex flex-col">
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
      <SectionTitle>Tracking points</SectionTitle>
      <Row label={`${tracked} acquired`}>
        <Button size="sm" variant="outline" disabled={tracked === 0} onClick={clearTracked}>Clear</Button>
      </Row>
      <SectionTitle>Threshold</SectionTitle>
      <div className="flex items-center gap-3">
        <Slider
          aria-label="Snap threshold"
          min={2}
          max={40}
          step={1}
          value={[config.threshold]}
          onValueChange={(value) => {
            const threshold = typeof value === "number" ? value : value[0]
            if (threshold !== undefined) updateSnap({ threshold })
          }}
        />
        <span className="w-10 shrink-0 text-right tabular-nums text-fg-secondary">{config.threshold} px</span>
      </div>
    </div>
  )
}
