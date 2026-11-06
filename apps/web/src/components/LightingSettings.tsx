import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useShallow } from "zustand/react/shallow"
import { formatTimeOfDay, type Lighting, LIGHTING_RANGES, lightingOf, parseTimeOfDay } from "../domain/sunlight"
import { shownLighting, useEditor } from "../editor/store"
import { NumberField } from "./NumberField"

/** One control per slider in the game's World Settings › lighting, labelled as the game labels them. */
const CONTROLS: ReadonlyArray<{
  readonly key: keyof Lighting
  readonly label: string
  readonly title: string
  readonly step: number
  readonly digits: number
  readonly unit?: string
  readonly format?: (value: number) => string
  readonly parse?: (text: string) => number | null
}> = [
  {
    key: "timeOfDay",
    label: "Time of day",
    title: "24-hour clock: sunrise at 06:00, noon overhead",
    step: 0.05,
    digits: 2,
    format: formatTimeOfDay,
    parse: parseTimeOfDay
  },
  { key: "brightness", label: "Sunlight", title: "The sun's brightness", step: 0.05, digits: 2 },
  { key: "angle", label: "Light rotation", title: "The sun's compass direction", step: 1, digits: 1, unit: "°" }
]

/**
 * The map's sun, edited like the game's World Settings panel: a slider over the game's
 * range plus a number input that takes any value (new maps save sunlight 12, above the
 * game's slider). Dragging a slider previews live in the viewport; each release, and each
 * typed value, is one undo step. Each setting is one row; where the slider would be left too
 * short, it goes under its label and field.
 */
export function LightingSettings() {
  const shown = useEditor(useShallow(shownLighting))
  const mapLighting = useEditor((s) => s.settings.lighting.mapLighting)

  const committed = () => lightingOf(useEditor.getState().doc.map.worldSettings)
  const preview = (key: keyof Lighting, value: number | null) =>
    useEditor.getState().setLightingPreview(value === null ? null : { ...committed(), [key]: value })
  const commit = (key: keyof Lighting, value: number) => {
    const { setLighting, setLightingPreview } = useEditor.getState()
    setLightingPreview(null)
    setLighting({ ...committed(), [key]: value })
  }

  return (
    <div className="flex @container flex-col gap-1">
      {CONTROLS.map(({ key, label, title, step, digits, unit, format, parse }) => {
        const { min, max } = LIGHTING_RANGES[key]
        const value = shown[key]
        return (
          <div
            key={key}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.25rem] items-center gap-2 @max-[15rem]:grid-cols-[minmax(0,1fr)_4.25rem]"
          >
            <Tooltip>
              <TooltipTrigger render={<span className="truncate text-body text-fg-secondary" />}>
                {label}
              </TooltipTrigger>
              <TooltipContent side="left">{title}</TooltipContent>
            </Tooltip>
            <Slider
              aria-label={label}
              className="@max-[15rem]:order-last @max-[15rem]:col-span-2"
              min={min}
              max={max}
              step={step}
              // one thumb: the shared Slider draws a thumb per array entry, and a bare number as a range
              value={[Math.min(max, Math.max(min, value))]}
              onValueChange={(v) => {
                const next = sliderValue(v)
                if (next !== undefined) preview(key, next)
              }}
              onValueCommitted={(v) => {
                const next = sliderValue(v)
                if (next !== undefined) commit(key, next)
              }}
            />
            <NumberField
              label={label}
              value={value}
              digits={digits}
              handle={false}
              onCommit={(v) => commit(key, v)}
              {...(unit === undefined ? {} : { unit })}
              {...(format === undefined ? {} : { format })}
              {...(parse === undefined ? {} : { parse })}
            />
          </div>
        )
      })}
      {!mapLighting && (
        <p className="mt-1 text-body text-fg-tertiary">
          The viewport is using studio lights. Turn on View › Map lighting to see these.
        </p>
      )}
    </div>
  )
}
