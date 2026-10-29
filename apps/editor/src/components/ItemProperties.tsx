import { IconArrowBackUp } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import { useId, useState } from "react"
import { type ItemProperty, propertyLabel } from "../domain/itemProperties"
import { setSelectionProperty } from "../editor/actions"
import { NumberField } from "./NumberField"
import { SectionTitle } from "./SectionTitle"

/** The value every selected item shares, or undefined when they differ (mixed). */
const sharedValue = (values: ReadonlyArray<unknown>): unknown => {
  const first = values[0]
  return values.every((v) => v === first) ? first : undefined
}

const formatValue = (value: unknown): string => typeof value === "string" ? `"${value}"` : JSON.stringify(value)

/** Scrub speed per pixel, scaled to the property's magnitude (a vent's 750000 vs its 0.25). */
const scrubStep = (reference: number): number => {
  const magnitude = Math.abs(reference)
  return magnitude === 0 ? 0.01 : Math.max(0.001, 10 ** (Math.floor(Math.log10(magnitude)) - 2))
}

function PropertyValue({ property, id }: { readonly property: ItemProperty; readonly id: string }) {
  // The live value while the field is scrubbed; committed (one undo step) on release.
  const [scrub, setScrub] = useState<number | null>(null)
  const value = sharedValue(property.values)
  const set = (v: unknown) => setSelectionProperty(property, v)
  switch (property.list) {
    case "boolProperties":
      return (
        <div className="flex h-7 items-center gap-2">
          <Switch id={id} checked={value === true} onCheckedChange={(checked) => set(checked)} />
          {value === undefined && <span className="text-xs text-muted-foreground">Mixed</span>}
        </div>
      )
    case "floatProperties":
    case "intProperties": {
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
        />
      )
    }
    default:
      // No sample or class has text/name/string properties, so their value shape is unknown: shown, not edited.
      return <div className="truncate font-mono text-xs text-muted-foreground">{formatValue(value)}</div>
  }
}

function PropertyRow({ property }: { readonly property: ItemProperty }) {
  const id = useId()
  const hasDefault = property.default !== undefined
  const atDefault = property.values.every((v) => v === property.default)
  const details = [
    `${property.name} (${property.type})`,
    hasDefault ? `Default: ${formatValue(property.default)}` : "Not a property the catalog lists for this piece",
    ...(property.hidden ? ["Hidden in the game's own property panel"] : [])
  ].join("\n")
  return (
    <div className="contents">
      <Label htmlFor={id} title={details} className="min-w-0 text-xs leading-tight break-words text-muted-foreground">
        {propertyLabel(property.name)}
        {property.hidden && "*"}
      </Label>
      <PropertyValue property={property} id={id} />
      {hasDefault && !atDefault
        ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reset ${property.name}`}
            title={`Reset to ${formatValue(property.default)}`}
            onClick={() => setSelectionProperty(property, property.default)}
          >
            <IconArrowBackUp />
          </Button>
        )
        : <span />}
    </div>
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
        {properties.map((property) => <PropertyRow key={`${property.list}/${property.name}`} property={property} />)}
      </div>
      {properties.some((p) => p.hidden) && (
        <p className="text-xs text-muted-foreground">
          * Hidden in the game's own property panel.
        </p>
      )}
    </>
  )
}
