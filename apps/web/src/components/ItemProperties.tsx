import { IconArrowBackUp } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ColorPicker, ColorSwatch } from "@workspace/ui/components/color-picker"
import { Label } from "@workspace/ui/components/label"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { Option } from "effect"
import { type ReactNode, useId, useState } from "react"
import { hexToLinear, linearToHex, type Rgb } from "../domain/color"
import {
  clampToRange,
  type ColorProperty,
  type ItemProperty,
  optionLabel,
  type Options,
  propertyLabel,
  type PropertyRange,
  type PropertyRow,
  propertyRows,
  sliderStep
} from "../domain/itemProperties"
import { setSelectionProperties } from "../editor/actions"
import { AXIS_BG_CLASSES } from "../editor/axisColors"
import { NumberField } from "./NumberField"
import { Section, SectionTitle } from "./SectionTitle"

/** The value every selected item shares, or undefined when they differ (mixed). */
export function sharedValue<T>(values: ReadonlyArray<T>): T | undefined {
  const first = values[0]
  return values.every((v) => v === first) ? first : undefined
}

const formatValue = (value: unknown): string => typeof value === "string" ? `"${value}"` : JSON.stringify(value)

/** A value as the inspector names it: an option's label, else the value itself. */
const describe = (property: ItemProperty, value: unknown): string => {
  if (typeof value !== "number") return formatValue(value)
  return property.options === undefined ? String(value) : `${optionLabel(property.options, value)} (${value})`
}

/** Scrub speed per pixel, scaled to the property's magnitude (a vent's 750000 vs its 0.25). */
const scrubStep = (reference: number): number => {
  const magnitude = Math.abs(reference)
  return magnitude === 0 ? 0.01 : Math.max(0.001, 10 ** (Math.floor(Math.log10(magnitude)) - 2))
}

/**
 * Decimals a ranged float shows: enough to tell its slider's positions apart (a density runs 0 to 0.01), few
 * enough that a big value (a vent's 750000) still fits the field. The stored value keeps whatever was typed.
 */
const displayDigits = ({ min, max, step }: PropertyRange): number => {
  if (step >= 1) return 0
  const span = max - min
  return Math.min(5, Math.max(span >= 10000 ? 0 : 1, 4 - Math.ceil(Math.log10(span))))
}

/** A saved value with labelled choices; one outside them is listed too, with what the game makes of it. */
function OptionValue(props: {
  readonly options: Options
  readonly value: unknown
  readonly onChange: (value: number) => void
}) {
  const current = typeof props.value === "number" ? props.value : null
  const labels = new Map(props.options.map((o) => [String(o.value), o.label] as const))
  if (current !== null && !labels.has(String(current))) labels.set(String(current), optionLabel(props.options, current))
  return (
    <Select
      value={current === null ? null : String(current)}
      items={Object.fromEntries(labels)}
      onValueChange={(v) => v !== null && props.onChange(Number(v))}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Mixed" />
      </SelectTrigger>
      <SelectContent>
        {[...labels].map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function PropertyValue({ property, id, handleClassName }: {
  readonly property: ItemProperty
  readonly id?: string
  readonly handleClassName?: string | undefined
}) {
  // The live value while the field is scrubbed; committed (one undo step) on release.
  const [scrub, setScrub] = useState<number | null>(null)
  const value = sharedValue(property.values)
  const set = (v: unknown) => setSelectionProperties([{ property, value: v }])
  switch (property.list) {
    case "boolProperties":
      return (
        <div className="flex h-7 items-center gap-2">
          <Switch id={id} checked={value === true} onCheckedChange={(checked) => set(checked)} />
          {value === undefined && <span className="text-body text-fg-tertiary">Mixed</span>}
        </div>
      )
    case "intProperties":
    case "floatProperties": {
      if (property.options !== undefined) return <OptionValue options={property.options} value={value} onChange={set} />
      const integer = property.list === "intProperties"
      const shown = typeof value === "number" ? value : null
      const reference = typeof property.default === "number" ? property.default : shown ?? 0
      const commit = (v: number) => set(clampToRange(property, integer ? Math.round(v) : v))
      const { range } = property
      const field = (
        <NumberField
          label={property.name}
          value={scrub ?? shown}
          onCommit={commit}
          onScrub={setScrub}
          onScrubCommit={commit}
          step={integer ? 1 : scrubStep(reference)}
          digits={integer ? 0 : range === undefined ? 3 : displayDigits(range)}
          handleClassName={handleClassName}
        />
      )
      if (range === undefined) return field
      // The slider stays inside its range; the field shows a value past it, as the game's text box does.
      const position = Math.min(Math.max(scrub ?? shown ?? range.min, range.min), range.max)
      return (
        // The field keeps room for its widest value; where the slider would be left too short, it goes under the field.
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(4.5rem,1fr)] items-center gap-2 @max-[15rem]:grid-cols-1">
          <Slider
            aria-label={propertyLabel(property)}
            className="@max-[15rem]:order-last"
            min={range.min}
            max={range.max}
            step={sliderStep(range)}
            // one thumb: the shared Slider draws a thumb per array entry, and a bare number as a range
            value={[position]}
            onValueChange={(v) => setScrub(sliderValue(v) ?? null)}
            onValueCommitted={(v) => {
              const next = sliderValue(v)
              setScrub(null)
              if (next !== undefined) commit(next)
            }}
          />
          {field}
        </div>
      )
    }
    default:
      // No sample or class has text/name/string properties, so their value shape is unknown: shown, not edited.
      return <div className="truncate text-body text-fg-tertiary">{formatValue(value)}</div>
  }
}

/** Red, green and blue, in the axes' colours. */
const CHANNEL_HANDLES = [AXIS_BG_CLASSES.x, AXIS_BG_CLASSES.y, AXIS_BG_CLASSES.z] as const

const channelValues = (color: ColorProperty, pick: (channel: ItemProperty) => unknown): Rgb => {
  const [r, g, b] = color.channels.map((channel) => {
    const v = pick(channel)
    return typeof v === "number" ? v : 0
  })
  return [r ?? 0, g ?? 0, b ?? 0]
}

/**
 * A colour as a swatch that opens a picker. The picker and hex code are sRGB; underneath
 * are the linear channels the file stores, which can also go above 1.
 */
function ColorValue({ color, id }: { readonly color: ColorProperty; readonly id: string }) {
  const mixed = color.channels.some((channel) => sharedValue(channel.values) === undefined)
  const linear = channelValues(color, (channel) => channel.values[0])
  const hex = linearToHex(linear)
  const commit = (next: string) =>
    Option.map(
      hexToLinear(next),
      (rgb) => setSelectionProperties(color.channels.map((property, i) => ({ property, value: rgb[i] })))
    )
  return (
    <Popover>
      <PopoverTrigger
        id={id}
        title={mixed ? "Mixed" : hex}
        aria-label={mixed ? `${color.label}: mixed` : `${color.label}: ${hex}`}
        className="flex h-7 w-full min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-control text-body text-fg-tertiary transition-shadow focus-ring hover:ring-foreground/40"
        render={<ColorSwatch color={mixed ? null : hex} className="rounded-control" />}
      >
        {mixed && "Mixed"}
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-56 gap-2">
        <ColorPicker value={hex} onCommit={commit} />
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          {color.channels.map((channel, i) => (
            <div key={channel.name} className="contents">
              <span title={channel.name} className="text-fg-secondary">{"RGB"[i]}</span>
              <PropertyValue property={channel} handleClassName={CHANNEL_HANDLES[i]} />
            </div>
          ))}
        </div>
        <p className="text-fg-tertiary">
          Linear values, as the map file stores them.
          {linear.some((c) => c > 1) && " Above 1 is brighter than the swatch shows."}
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** A labelled row with a reset button for the properties it edits. */
function Row(props: {
  readonly label: string
  readonly details: ReadonlyArray<string>
  readonly properties: ReadonlyArray<ItemProperty>
  readonly resetTo: string
  readonly children: (id: string) => ReactNode
}) {
  const id = useId()
  const resettable = props.properties.filter((p) => p.default !== undefined)
  const atDefault = resettable.every((p) => p.values.every((v) => v === p.default))
  return (
    <div className="contents">
      <Label
        htmlFor={id}
        title={props.details.join("\n")}
        className="min-w-0 text-body break-words text-fg-secondary"
      >
        {props.label}
      </Label>
      {props.children(id)}
      {resettable.length > 0 && !atDefault
        ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reset ${props.label}`}
            title={`Reset to ${props.resetTo}`}
            onClick={() =>
              setSelectionProperties(resettable.map((property) => ({ property, value: property.default })))}
          >
            <IconArrowBackUp />
          </Button>
        )
        : <span />}
    </div>
  )
}

function PropertyRowView({ row }: { readonly row: PropertyRow }) {
  if (row._tag === "Color") {
    const { color } = row
    const known = color.channels.every((c) => c.default !== undefined)
    const defaults = channelValues(color, (channel) => channel.default)
    const resetTo = `${linearToHex(defaults)} (${defaults.join(", ")})`
    return (
      <Row
        label={color.label}
        details={[
          `${color.channels.map((c) => c.name).join(", ")} (linear ${color.channels[0].type})`,
          known ? `Default: ${resetTo}` : "Not a property the catalog lists for this piece"
        ]}
        properties={color.channels}
        resetTo={resetTo}
      >
        {(id) => <ColorValue color={color} id={id} />}
      </Row>
    )
  }
  const { property } = row
  const hasDefault = property.default !== undefined
  return (
    <Row
      label={propertyLabel(property)}
      details={[
        `${property.name} (${property.type})`,
        hasDefault
          ? `Default: ${describe(property, property.default)}`
          : "Not a property the catalog lists for this piece",
        ...(property.range === undefined ? [] : [`Range: ${property.range.min} to ${property.range.typedMax}`]),
        ...(property.optional === true
          ? ["Not yet seen in a game save of this piece: export warns about items that carry it"]
          : [])
      ]}
      properties={[property]}
      resetTo={describe(property, property.default)}
    >
      {(id) => <PropertyValue property={property} id={id} />}
    </Row>
  )
}

/**
 * The selection's item properties (the typed lists in the map file): the ones every
 * selected item has, each set on all of them at once.
 */
export function ItemProperties({ properties }: { readonly properties: ReadonlyArray<ItemProperty> }) {
  if (properties.length === 0) return null
  return (
    <Section>
      <SectionTitle>Properties</SectionTitle>
      <div className="grid @container grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_1.5rem] items-center gap-x-2 gap-y-1">
        {propertyRows(properties).map((row) => {
          const first = row._tag === "Color" ? row.color.channels[0] : row.property
          return <PropertyRowView key={`${first.list}/${first.name}`} row={row} />
        })}
      </div>
    </Section>
  )
}
