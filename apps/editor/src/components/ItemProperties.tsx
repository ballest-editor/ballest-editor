import { IconArrowBackUp } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ColorPicker, ColorSwatch } from "@workspace/ui/components/color-picker"
import { Label } from "@workspace/ui/components/label"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import { Option } from "effect"
import { type ReactNode, useId, useState } from "react"
import { hexToLinear, linearToHex, type Rgb } from "../domain/color"
import {
  type ColorProperty,
  type ItemProperty,
  optionLabel,
  propertyLabel,
  type PropertyRow,
  propertyRows
} from "../domain/itemProperties"
import { setSelectionProperties } from "../editor/actions"
import { NumberField } from "./NumberField"
import { SectionTitle } from "./SectionTitle"

/** The value every selected item shares, or undefined when they differ (mixed). */
const sharedValue = (values: ReadonlyArray<unknown>): unknown => {
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

/** An integer with labelled values; a value outside them is listed too, with what it draws. */
function OptionValue(props: {
  readonly options: ReadonlyArray<string>
  readonly value: unknown
  readonly onChange: (value: number) => void
}) {
  const current = typeof props.value === "number" ? props.value : null
  const labels = new Map(props.options.map((label, i) => [String(i), label]))
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
          {value === undefined && <span className="text-xs text-muted-foreground">Mixed</span>}
        </div>
      )
    case "intProperties":
    case "floatProperties": {
      if (property.options !== undefined) return <OptionValue options={property.options} value={value} onChange={set} />
      const integer = property.list === "intProperties"
      const shown = typeof value === "number" ? value : null
      const reference = typeof property.default === "number" ? property.default : shown ?? 0
      const commit = (v: number) => set(integer ? Math.round(v) : v)
      return (
        <NumberField
          label={property.name}
          value={scrub ?? shown}
          onCommit={commit}
          onScrub={setScrub}
          onScrubCommit={commit}
          step={integer ? 1 : scrubStep(reference)}
          digits={integer ? 0 : 3}
          {...(handleClassName === undefined ? {} : { handleClassName })}
        />
      )
    }
    default:
      // No sample or class has text/name/string properties, so their value shape is unknown: shown, not edited.
      return <div className="truncate font-mono text-xs text-muted-foreground">{formatValue(value)}</div>
  }
}

const CHANNEL_HANDLES = ["bg-red-500", "bg-green-500", "bg-blue-500"] as const

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
        className="flex h-7 w-full min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-input text-xs text-muted-foreground transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
        render={<ColorSwatch color={mixed ? null : hex} className="rounded-md ring-0" />}
      >
        {mixed && "Mixed"}
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-56 gap-2">
        <ColorPicker value={hex} onCommit={commit} />
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          {color.channels.map((channel, i) => (
            <div key={channel.name} className="contents">
              <span title={channel.name} className="text-muted-foreground">{"RGB"[i]}</span>
              <PropertyValue property={channel} handleClassName={CHANNEL_HANDLES[i]} />
            </div>
          ))}
        </div>
        <p className="text-muted-foreground">
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
  const hidden = props.properties.some((p) => p.hidden)
  const resettable = props.properties.filter((p) => p.default !== undefined)
  const atDefault = resettable.every((p) => p.values.every((v) => v === p.default))
  const details = [...props.details, ...(hidden ? ["Hidden in the game's own property panel"] : [])].join("\n")
  return (
    <div className="contents">
      <Label htmlFor={id} title={details} className="min-w-0 text-xs leading-tight break-words text-muted-foreground">
        {props.label}
        {hidden && "*"}
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
      label={propertyLabel(property.name)}
      details={[
        `${property.name} (${property.type})`,
        hasDefault
          ? `Default: ${describe(property, property.default)}`
          : "Not a property the catalog lists for this piece"
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
    <>
      <Separator />
      <SectionTitle>Properties</SectionTitle>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_1.5rem] items-center gap-x-1.5 gap-y-1.5">
        {propertyRows(properties).map((row) => {
          const first = row._tag === "Color" ? row.color.channels[0] : row.property
          return <PropertyRowView key={`${first.list}/${first.name}`} row={row} />
        })}
      </div>
      {properties.some((p) => p.hidden) && (
        <p className="text-xs text-muted-foreground">
          * Hidden in the game's own property panel.
        </p>
      )}
    </>
  )
}
