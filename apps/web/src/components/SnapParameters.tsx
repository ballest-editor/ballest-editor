import { Button } from "@workspace/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { Struct } from "effect"
import type { ReactNode } from "react"
import { MESH_ELEMENT_NAMES, MESH_ELEMENTS, type SnapConfig, type SnapTarget } from "../domain/snapConfig"
import { NumberField } from "./NumberField"

/** A label, and what it sets, which drops under the label when the two can't share the width. */
export function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="min-w-0 truncate text-fg-secondary">{label}</span>
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">{children}</div>
    </div>
  )
}

export function Toggle({ label, checked, onChange }: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (on: boolean) => void
}) {
  return (
    <Row label={label}>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </Row>
  )
}

/** A choice of a few words. */
function Choice<V extends string>({ label, value, items, onChange }: {
  readonly label: string
  readonly value: V
  readonly items: Readonly<Record<V, string>>
  readonly onChange: (value: V) => void
}) {
  return (
    <Row label={label}>
      <Select value={value} items={items} onValueChange={(v: V | null) => v !== null && onChange(v)}>
        <SelectTrigger aria-label={label} size="sm" className="w-40 max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Struct.keys(items).map((key) => <SelectItem key={key} value={key}>{items[key]}</SelectItem>)}
        </SelectContent>
      </Select>
    </Row>
  )
}

/** A step as it reads in its field: no more digits than it has, so the game's 2.8125° fits beside a 15°. */
const stepText = (step: number) => String(Number(step.toFixed(4)))

/** A step chosen from a list, or typed. */
export function StepField({ label, value, options, format, unit, onChange }: {
  readonly label: string
  readonly value: number
  readonly options: ReadonlyArray<number>
  readonly format: (step: number) => string
  readonly unit: string
  readonly onChange: (step: number) => void
}) {
  const items = Object.fromEntries(options.map((option) => [option, format(option)]))
  return (
    <div className="flex items-center gap-1">
      <div className="w-20">
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
        <SelectTrigger
          aria-label={`${label}, from the list`}
          size="sm"
          className="w-8 px-1 [&>[data-slot=select-value]]:hidden"
        />
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{format(option)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function NumberRow({ label, value, unit, min, onChange }: {
  readonly label: string
  readonly value: number
  readonly unit: string
  readonly min?: number
  readonly onChange: (value: number) => void
}) {
  return (
    <Row label={label}>
      <div className="w-24">
        <NumberField
          label={label}
          value={value}
          digits={1}
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

/** Sets part of a target: on the map in the Snap popover, on what new maps start on in Settings. */
export type UpdateTarget = <T extends SnapTarget>(target: T, patch: Partial<SnapConfig["targets"][T]>) => void

interface TargetProps {
  readonly config: SnapConfig
  readonly update: UpdateTarget
}

function ConnectorParameters({ config, update: updateTarget }: TargetProps) {
  const { flipToFit, matchRotation, profiles, range, showOpenEnds } = config.targets.connectors
  const update = (patch: Partial<SnapConfig["targets"]["connectors"]>) => updateTarget("connectors", patch)
  return (
    <>
      <Row label="Range">
        <div className="w-20">
          <NumberField
            label="Range"
            value={range ?? config.threshold}
            digits={0}
            handle={false}
            unit="px"
            onCommit={(next) => {
              if (next > 0) update({ range: next })
            }}
          />
        </div>
        <Button size="sm" variant="ghost" disabled={range === null} onClick={() => update({ range: null })}>
          Shared
        </Button>
      </Row>
      <Toggle label="Match rotation" checked={matchRotation} onChange={(on) => update({ matchRotation: on })} />
      <Choice
        label="Profiles"
        value={profiles}
        items={{ strict: "Strict", warn: "Warn", any: "Any" }}
        onChange={(next) => update({ profiles: next })}
      />
      <Choice
        label="Show open ends"
        value={showOpenEnds}
        items={{ never: "Never", hover: "On hover", always: "Always" }}
        onChange={(next) => update({ showOpenEnds: next })}
      />
      <Toggle label="Flip to fit" checked={flipToFit} onChange={(on) => update({ flipToFit: on })} />
    </>
  )
}

function MeshParameters({ config, update: updateTarget }: TargetProps) {
  const { elements, occlusion, offset, rotateToFace, sharpAngle } = config.targets.mesh
  const update = (patch: Partial<SnapConfig["targets"]["mesh"]>) => updateTarget("mesh", patch)
  return (
    <>
      {MESH_ELEMENTS.map((element) => (
        <Toggle
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
      <Choice
        label="Occlusion"
        value={occlusion}
        items={{ front: "In front only", through: "Through pieces" }}
        onChange={(next) => update({ occlusion: next })}
      />
      <Choice
        label="Rotate to face"
        value={rotateToFace}
        items={{ keep: "Keep rotation", upright: "Upright on the face", align: "Align to normal" }}
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
        unit=""
        min={1}
        onChange={(next) => update({ keep: Math.round(next) })}
      />
      <NumberRow label="Hover time" value={hoverMs} unit="ms" min={0} onChange={(next) => update({ hoverMs: next })} />
      <Choice
        label="Acquire"
        value={acquire}
        items={{ auto: "Automatically", shift: "With Shift held" }}
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
        <Choice
          label="Gap guides"
          value={props.config.targets.alignment.gapGuides}
          items={{ ortho: "In orthographic panes", always: "Always", never: "Never" }}
          onChange={(gapGuides) => props.update("alignment", { gapGuides })}
        />
      )
    case "construction":
      return null
  }
}
