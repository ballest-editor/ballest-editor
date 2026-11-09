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
  type MeshElement,
  type SnapConfig,
  type SnapTarget
} from "../domain/snapConfig"
import { updateSnapTarget } from "../editor/actions"
import { InfoHint } from "./InfoHint"
import { NumberField } from "./NumberField"

/**
 * The rows the snap menu is made of (docs/SNAPPING.md § The snap menu): a 28px row, its label and its one sentence of
 * help at the left and its control at the right, which drops under the label when the two can't share the width.
 * Fields are one width (`FIELD`), so their edges line up down a list.
 */
const FIELD = "w-28"

/** What a disclosure opens: its rows, indented under the title. */
export const DISCLOSURE_BODY = "flex flex-col py-1 pl-6"

/** A row's label and, when it has one, its help behind an (i): one plain sentence and an example. */
export function RowLabel({ label, help, dimmed = false, strong = false }: {
  readonly label: string
  readonly help?: string | undefined
  readonly dimmed?: boolean | undefined
  readonly strong?: boolean | undefined
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span
        className={cn("min-w-0 truncate", strong ? "text-body-strong" : "text-body", dimmed && "text-fg-tertiary")}
      >
        {label}
      </span>
      {help !== undefined && <InfoHint>{help}</InfoHint>}
    </span>
  )
}

export function Row({ label, help, dimmed, strong, children }: {
  readonly label: string
  readonly help?: string | undefined
  /** Snapping as a whole is off: the row still works, and says it has no effect yet. */
  readonly dimmed?: boolean | undefined
  /** A row that names a thing, a target, rather than a parameter of one. */
  readonly strong?: boolean | undefined
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <RowLabel label={label} help={help} dimmed={dimmed} strong={strong} />
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">{children}</div>
    </div>
  )
}

export function SwitchRow({ label, help, checked, onChange, dimmed, strong }: {
  readonly label: string
  readonly help?: string | undefined
  readonly checked: boolean
  readonly onChange: (on: boolean) => void
  readonly dimmed?: boolean | undefined
  readonly strong?: boolean | undefined
}) {
  return (
    <Row label={label} help={help} dimmed={dimmed} strong={strong}>
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

export function ChoiceRow<V extends string>({ help, ...props }: {
  readonly label: string
  readonly help: string
  readonly value: V
  readonly items: Readonly<Record<V, string>>
  readonly onChange: (value: V) => void
}) {
  return (
    <Row label={props.label} help={help}>
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
function StepField({ label, value, options, format, unit, onChange }: StepProps) {
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
export function StepRow({ label, help, step, enabled, onEnabled, dimmed }: {
  readonly label: string
  readonly help: string
  readonly step: StepProps
  readonly enabled: boolean
  readonly onEnabled: (on: boolean) => void
  readonly dimmed?: boolean | undefined
}) {
  return (
    <Row label={label} help={help} dimmed={dimmed}>
      <StepField {...step} />
      <Switch aria-label={`Snap ${label.toLowerCase()}`} checked={enabled} onCheckedChange={onEnabled} />
    </Row>
  )
}

function NumberRow({ label, help, value, unit, min, digits = 1, onChange, children }: {
  readonly label: string
  readonly help: string
  readonly value: number
  readonly unit: string
  readonly min?: number
  readonly digits?: number
  readonly onChange: (value: number) => void
  /** What sits before the field, such as a way back to the shared value. */
  readonly children?: ReactNode
}) {
  return (
    <Row label={label} help={help}>
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

/** How hard ends pull against the grid and pieces (docs/SNAPPING.md § Priority), in five stops. */
function PullSlider({ weight, onChange }: { readonly weight: number; readonly onChange: (weight: number) => void }) {
  return (
    <div className="flex flex-col">
      <Row
        label="Pull"
        help="How strongly ends win over the grid and pieces. Example: at ×4 an end joins even with a grid line under the pointer."
      >
        <RowValue>{formatWeight(weight)}</RowValue>
      </Row>
      <SliderField
        label="Pull"
        ends={["Grid and pieces", "Ends"]}
        min={0}
        max={CONNECTOR_WEIGHTS.length - 1}
        step={1}
        value={stopOf(weight)}
        onChange={(stop) => onChange(CONNECTOR_WEIGHTS[stop] ?? 1)}
      />
    </div>
  )
}

function ConnectorParameters({ config }: { readonly config: SnapConfig }) {
  const { matchRotation, range, weight } = config.targets.connectors
  const update = (patch: Partial<SnapConfig["targets"]["connectors"]>) => updateSnapTarget("connectors", patch)
  return (
    <>
      <NumberRow
        label="Range"
        help="How close an end has to get to join, when it should differ from Snap distance."
        value={range ?? config.threshold}
        digits={0}
        unit="px"
        min={1}
        onChange={(next) => update({ range: next })}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Use Snap distance"
          title="Use Snap distance"
          disabled={range === null}
          onClick={() => update({ range: null })}
        >
          <IconRestore />
        </Button>
      </NumberRow>
      <PullSlider weight={weight} onChange={(next) => update({ weight: next })} />
      <SwitchRow
        label="Match rotation"
        help="Turns the piece so its end faces the other end. Example: a Track dropped crooked on a Curve's end comes round straight."
        checked={matchRotation}
        onChange={(on) => update({ matchRotation: on })}
      />
    </>
  )
}

/** What each of a piece's points, edges and faces is, in a sentence: the bounds are the box around the piece. */
const ELEMENT_HELP: Readonly<Record<MeshElement, string>> = {
  boundsCorners: "The corners of the box around a piece.",
  boundsFaceCentres: "The middle of each side of the box around a piece.",
  boundsFaces: "Anywhere on the sides of the box around a piece.",
  vertices: "The corners of a piece's own shape.",
  sharpEdges: "Along the edges where a piece's surface folds sharply.",
  edgeMidpoints: "The middle of each sharp edge.",
  faceCentres: "The middle of each flat face.",
  faces: "Anywhere on a piece's surface."
}

function MeshParameters({ config }: { readonly config: SnapConfig }) {
  const { elements, offset, rotateToFace, sharpAngle } = config.targets.mesh
  const update = (patch: Partial<SnapConfig["targets"]["mesh"]>) => updateSnapTarget("mesh", patch)
  return (
    <>
      {MESH_ELEMENTS.map((element) => (
        <SwitchRow
          key={element}
          label={MESH_ELEMENT_NAMES[element]}
          help={ELEMENT_HELP[element]}
          checked={elements[element]}
          onChange={(on) => update({ elements: { ...elements, [element]: on } })}
        />
      ))}
      <NumberRow
        label="Sharp edge angle"
        help="How sharply a surface has to fold for the fold to count as an edge. Example: at 30° a box's edges count and a curve's don't."
        value={sharpAngle}
        unit="°"
        min={0}
        onChange={(next) => update({ sharpAngle: next })}
      />
      <ChoiceRow
        label="Rotate to face"
        help="What a piece does when it lands on a face: keeps its turn, stands upright on it, or turns square to it. Example: a lamp on a wall, Upright."
        value={rotateToFace}
        items={{ keep: "Keep", upright: "Upright", align: "Align" }}
        onChange={(next) => update({ rotateToFace: next })}
      />
      <NumberRow
        label="Offset"
        help="Lands this far off the face, for things that float. Example: a light 20 cm off a wall."
        value={offset}
        unit="cm"
        onChange={(next) => update({ offset: next })}
      />
    </>
  )
}

/** A target's parameters that are plain values. */
export function ValueParameters({ config, target }: { readonly config: SnapConfig; readonly target: SnapTarget }) {
  switch (target) {
    case "connectors":
      return <ConnectorParameters config={config} />
    case "mesh":
      return <MeshParameters config={config} />
    case "alignment":
      return (
        <ChoiceRow
          label="Gap guides"
          help="When to show a guide where the gaps either side come out equal: in orthographic panes, always, or never."
          value={config.targets.alignment.gapGuides}
          items={{ ortho: "In ortho", always: "Always", never: "Never" }}
          onChange={(gapGuides) => updateSnapTarget("alignment", { gapGuides })}
        />
      )
    case "grid":
    case "construction":
    case "tracking":
      return null
  }
}

/** The chevron of a disclosure that opens a block of parameters: its trigger is `group/disclosure`, and it turns down while the block shows. */
export const DisclosureChevron = () => (
  <IconChevronRight className="size-4 shrink-0 text-fg-tertiary transition-transform group-data-[panel-open]/disclosure:rotate-90" />
)
