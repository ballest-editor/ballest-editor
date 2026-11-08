import { IconChevronRight, IconRestore } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@workspace/ui/components/select"
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { Struct } from "effect"
import type { ReactNode } from "react"
import {
  CONNECTOR_WEIGHTS,
  formatWeight,
  MESH_ELEMENT_NAMES,
  MESH_ELEMENTS,
  type SnapConfig,
  type SnapTarget
} from "../domain/snapConfig"
import { NumberField } from "./NumberField"

/**
 * The rows every snap control is made of, in the snap menu, the Snap popover and Settings › Snapping alike: a 28px row,
 * its label at the left and its control at the right, which drops under the label when the two can't share the width.
 * Fields are one width (`FIELD`), so their edges line up down a list.
 */
const FIELD = "w-28"

/** What a disclosure opens: its rows, indented under the title. */
export const DISCLOSURE_BODY = "flex flex-col py-1 pl-6"

export function Row({ label, dimmed = false, strong = false, children }: {
  readonly label: string
  /** Snapping as a whole is off: the row still works, and says it has no effect yet. */
  readonly dimmed?: boolean
  /** A row that names a thing, a target, rather than a parameter of one. */
  readonly strong?: boolean
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span
        className={cn("min-w-0 truncate", strong ? "text-body-strong" : "text-body", dimmed && "text-fg-tertiary")}
      >
        {label}
      </span>
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">{children}</div>
    </div>
  )
}

export function SwitchRow({ label, checked, onChange, dimmed, strong }: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (on: boolean) => void
  readonly dimmed?: boolean
  readonly strong?: boolean
}) {
  return (
    <Row label={label} {...(dimmed !== undefined && { dimmed })} {...(strong !== undefined && { strong })}>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </Row>
  )
}

/** One of a few short words, as a segmented control. `value` null presses none, for an order no preset matches. */
export function Segmented<V extends string>({ label, value, items, onChange }: {
  readonly label: string
  readonly value: V | null
  readonly items: Readonly<Record<V, string>>
  readonly onChange: (value: V) => void
}) {
  const keys = Struct.keys(items)
  return (
    <ToggleGroup
      aria-label={label}
      value={value === null ? [] : [value]}
      onValueChange={(next: ReadonlyArray<string>) => {
        const picked = keys.find((key) => next.includes(key) && key !== value)
        if (picked !== undefined) onChange(picked)
      }}
    >
      {keys.map((key) => <ToggleGroupItem key={key} value={key}>{items[key]}</ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function ChoiceRow<V extends string>(props: {
  readonly label: string
  readonly value: V
  readonly items: Readonly<Record<V, string>>
  readonly onChange: (value: V) => void
}) {
  return (
    <Row label={props.label}>
      <Segmented {...props} />
    </Row>
  )
}

/** A step as it reads in its field: no more digits than it has, so the game's 2.8125° fits beside a 15°. */
const stepText = (step: number) => String(Number(step.toFixed(4)))

export interface StepProps {
  readonly label: string
  readonly value: number
  readonly options: ReadonlyArray<number>
  readonly format: (step: number) => string
  readonly unit: string
  readonly onChange: (step: number) => void
}

/** A step chosen from a list, or typed: one field's width, the list's chevron inside it. */
export function StepField({ label, value, options, format, unit, onChange }: StepProps) {
  const items = Object.fromEntries(options.map((option) => [option, format(option)]))
  return (
    <div className={cn("flex items-center gap-1", FIELD)}>
      <div className="min-w-0 flex-1">
        <NumberField
          label={label}
          value={value}
          digits={4}
          handle={false}
          unit={unit}
          format={stepText}
          onCommit={(step) => {
            if (step > 0) onChange(step)
          }}
        />
      </div>
      <Select value={value} items={items} onValueChange={(step: number | null) => step !== null && onChange(step)}>
        <SelectTrigger aria-label={`${label}, from the list`} className="w-7 justify-center px-0" />
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{format(option)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

/** A kind of snapping with a step: the step, then the switch that turns it on. */
export function StepRow({ label, step, enabled, onEnabled, dimmed }: {
  readonly label: string
  readonly step: StepProps
  readonly enabled: boolean
  readonly onEnabled: (on: boolean) => void
  readonly dimmed?: boolean
}) {
  return (
    <Row label={label} {...(dimmed !== undefined && { dimmed })}>
      <StepField {...step} />
      <Switch aria-label={`Snap ${label.toLowerCase()}`} checked={enabled} onCheckedChange={onEnabled} />
    </Row>
  )
}

function NumberRow({ label, value, unit, min, digits = 1, onChange, children }: {
  readonly label: string
  readonly value: number
  readonly unit: string
  readonly min?: number
  readonly digits?: number
  readonly onChange: (value: number) => void
  /** What sits before the field, such as a way back to the shared value. */
  readonly children?: ReactNode
}) {
  return (
    <Row label={label}>
      {children}
      <div className={FIELD}>
        <NumberField
          label={label}
          value={value}
          digits={digits}
          handle={false}
          unit={unit}
          onCommit={(next) => {
            if (min === undefined || next >= min) onChange(next)
          }}
        />
      </div>
    </Row>
  )
}

/** A slider the whole width of its block, with what its ends mean under it. */
export function SliderField({ label, ends, onChange, ...range }: {
  readonly label: string
  readonly ends?: readonly [string, string]
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <Slider
        aria-label={label}
        {...range}
        onValueChange={(v) => {
          const next = sliderValue(v)
          if (next !== undefined) onChange(next)
        }}
      />
      {ends !== undefined && (
        <div className="flex justify-between text-caption text-fg-tertiary">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  )
}

/** What a row shows of a value it doesn't edit itself, such as a slider's. */
export const RowValue = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-fg-secondary tabular-nums">{children}</span>
)

/** The stop nearest `weight`: a sidecar may hold a pull between two. */
const stopOf = (weight: number) => {
  const distance = (stop: number) => Math.abs(Math.log(stop / weight))
  return CONNECTOR_WEIGHTS.reduce(
    (best, stop, i) => distance(stop) < distance(CONNECTOR_WEIGHTS[best] ?? 1) ? i : best,
    0
  )
}

/** How hard connector ends pull against Grid and Mesh (docs/SNAPPING.md § Priority), in five stops. */
export function PullSlider({ weight, onChange, dimmed }: {
  readonly weight: number
  readonly onChange: (weight: number) => void
  readonly dimmed?: boolean
}) {
  return (
    <div className="flex flex-col">
      <Row label="Connector pull" {...(dimmed !== undefined && { dimmed })}>
        <RowValue>{formatWeight(weight)}</RowValue>
      </Row>
      <SliderField
        label="Connector pull"
        ends={["Grid and mesh", "Connectors"]}
        min={0}
        max={CONNECTOR_WEIGHTS.length - 1}
        step={1}
        value={stopOf(weight)}
        onChange={(stop) => onChange(CONNECTOR_WEIGHTS[stop] ?? 1)}
      />
    </div>
  )
}

/** Sets part of a target: on the map in the Snap popover, on what new maps start on in Settings. */
export type UpdateTarget = <T extends SnapTarget>(target: T, patch: Partial<SnapConfig["targets"][T]>) => void

interface TargetProps {
  readonly config: SnapConfig
  readonly update: UpdateTarget
}

function ConnectorParameters({ config, update: updateTarget }: TargetProps) {
  const { flipToFit, matchRotation, profiles, range, showOpenEnds, weight } = config.targets.connectors
  const update = (patch: Partial<SnapConfig["targets"]["connectors"]>) => updateTarget("connectors", patch)
  return (
    <>
      <NumberRow
        label="Range"
        value={range ?? config.threshold}
        digits={0}
        unit="px"
        min={1}
        onChange={(next) => update({ range: next })}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Use the shared threshold"
          title="Use the shared threshold"
          disabled={range === null}
          onClick={() => update({ range: null })}
        >
          <IconRestore />
        </Button>
      </NumberRow>
      <PullSlider weight={weight} onChange={(next) => update({ weight: next })} />
      <SwitchRow label="Match rotation" checked={matchRotation} onChange={(on) => update({ matchRotation: on })} />
      <ChoiceRow
        label="Profiles"
        value={profiles}
        items={{ strict: "Strict", warn: "Warn", any: "Any" }}
        onChange={(next) => update({ profiles: next })}
      />
      <ChoiceRow
        label="Open ends"
        value={showOpenEnds}
        items={{ never: "Never", hover: "Hover", always: "Always" }}
        onChange={(next) => update({ showOpenEnds: next })}
      />
      <SwitchRow label="Flip to fit" checked={flipToFit} onChange={(on) => update({ flipToFit: on })} />
    </>
  )
}

function MeshParameters({ config, update: updateTarget }: TargetProps) {
  const { elements, occlusion, offset, rotateToFace, sharpAngle } = config.targets.mesh
  const update = (patch: Partial<SnapConfig["targets"]["mesh"]>) => updateTarget("mesh", patch)
  return (
    <>
      {MESH_ELEMENTS.map((element) => (
        <SwitchRow
          key={element}
          label={MESH_ELEMENT_NAMES[element]}
          checked={elements[element]}
          onChange={(on) => update({ elements: { ...elements, [element]: on } })}
        />
      ))}
      <NumberRow
        label="Sharp edge angle"
        value={sharpAngle}
        unit="°"
        min={0}
        onChange={(next) => update({ sharpAngle: next })}
      />
      <ChoiceRow
        label="Occlusion"
        value={occlusion}
        items={{ front: "In front", through: "Through" }}
        onChange={(next) => update({ occlusion: next })}
      />
      <ChoiceRow
        label="Rotate to face"
        value={rotateToFace}
        items={{ keep: "Keep", upright: "Upright", align: "Align" }}
        onChange={(next) => update({ rotateToFace: next })}
      />
      <NumberRow label="Offset" value={offset} unit="cm" onChange={(next) => update({ offset: next })} />
    </>
  )
}

function TrackingParameters({ config, update: updateTarget }: TargetProps) {
  const { acquire, hoverMs, keep } = config.targets.tracking
  const update = (patch: Partial<SnapConfig["targets"]["tracking"]>) => updateTarget("tracking", patch)
  return (
    <>
      <NumberRow
        label="Points kept"
        value={keep}
        digits={0}
        unit=""
        min={1}
        onChange={(next) => update({ keep: Math.round(next) })}
      />
      <NumberRow
        label="Hover time"
        value={hoverMs}
        digits={0}
        unit="ms"
        min={0}
        onChange={(next) => update({ hoverMs: next })}
      />
      <ChoiceRow
        label="Acquire"
        value={acquire}
        items={{ auto: "Automatically", shift: "With Shift" }}
        onChange={(next) => update({ acquire: next })}
      />
    </>
  )
}

/** A grid's place as numbers: a map also has the pickers, but what new maps start on has no selection to take it from. */
function GridValues({ config, update }: TargetProps) {
  const { origin, yaw } = config.targets.grid
  return (
    <>
      {(["x", "y", "z"] as const).map((axis) => (
        <NumberRow
          key={axis}
          label={`Origin ${axis.toUpperCase()}`}
          value={origin[axis]}
          unit="cm"
          onChange={(next) => update("grid", { origin: { ...origin, [axis]: next } })}
        />
      ))}
      <NumberRow label="Rotation" value={yaw} unit="°" onChange={(next) => update("grid", { yaw: next })} />
    </>
  )
}

/** A target's parameters that are plain values, whoever they're being set for. */
export function ValueParameters({ target, ...props }: TargetProps & { readonly target: SnapTarget }) {
  switch (target) {
    case "grid":
      return <GridValues {...props} />
    case "connectors":
      return <ConnectorParameters {...props} />
    case "mesh":
      return <MeshParameters {...props} />
    case "tracking":
      return <TrackingParameters {...props} />
    case "alignment":
      return (
        <ChoiceRow
          label="Gap guides"
          value={props.config.targets.alignment.gapGuides}
          items={{ ortho: "In ortho", always: "Always", never: "Never" }}
          onChange={(gapGuides) => props.update("alignment", { gapGuides })}
        />
      )
    case "construction":
      return null
  }
}

/**
 * The chevron of a disclosure that opens a block of parameters, the same in the Snap popover and Settings: its trigger
 * is `group/disclosure`, and it turns down while the block shows.
 */
export const DisclosureChevron = () => (
  <IconChevronRight className="size-4 shrink-0 text-fg-tertiary transition-transform group-data-[panel-open]/disclosure:rotate-90" />
)
