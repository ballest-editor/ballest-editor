import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type PointerEvent, type ReactNode, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { skyColorAt } from "../domain/sky"
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

/** Where a slider sits in its row: under its label and field when the row would leave it too short. */
const SLIDER_PLACE = "@max-[15rem]:order-last @max-[15rem]:col-span-2"

/** The shared Slider's thumb, which stays inside the track: its centre travels the track less one thumb. */
const THUMB_PX = 14

/** How far along its travel the pointer is over a slider, 0 to 1. */
const travelAt = (event: PointerEvent<HTMLElement>): number => {
  const { left, width } = event.currentTarget.getBoundingClientRect()
  return Math.min(1, Math.max(0, (event.clientX - left - THUMB_PX / 2) / (width - THUMB_PX)))
}

/**
 * Time of day's slider: hovering its track shows, above the thumb, the sky at the time under the pointer. Only this
 * slider has one, because the sky doesn't change with the sun's brightness or rotation.
 */
function SkyPreview({ thumb, children }: {
  /** Where the thumb is along its travel, 0 to 1. */
  readonly thumb: number
  readonly children: ReactNode
}) {
  const { max, min } = LIGHTING_RANGES.timeOfDay
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    // The track is 4px tall, too thin to find by hovering: the padding makes the target the thumb's height and more.
    <div
      className={`relative -my-2 py-2 ${SLIDER_PLACE}`}
      onPointerMove={(event) => setHovered(min + travelAt(event) * (max - min))}
      onPointerLeave={() => setHovered(null)}
    >
      {children}
      {hovered !== null && (
        <div
          aria-hidden
          data-slot="sky-swatch"
          className="pointer-events-none absolute bottom-full z-10 mb-0.5 size-6 -translate-x-1/2 rounded-control border border-border shadow-sm"
          style={{
            backgroundColor: skyColorAt(hovered),
            left: `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${thumb})`
          }}
        />
      )}
    </div>
  )
}

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
        const thumbValue = Math.min(max, Math.max(min, value))
        const slider = (
          <Slider
            aria-label={label}
            min={min}
            max={max}
            step={step}
            // one thumb: the shared Slider draws a thumb per array entry, and a bare number as a range
            value={[thumbValue]}
            onValueChange={(v) => {
              const next = sliderValue(v)
              if (next !== undefined) preview(key, next)
            }}
            onValueCommitted={(v) => {
              const next = sliderValue(v)
              if (next !== undefined) commit(key, next)
            }}
          />
        )
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
            {key === "timeOfDay"
              ? <SkyPreview thumb={(thumbValue - min) / (max - min)}>{slider}</SkyPreview>
              : <div className={SLIDER_PLACE}>{slider}</div>}
            <NumberField
              label={label}
              value={value}
              digits={digits}
              handle={false}
              onCommit={(v) => commit(key, v)}
              unit={unit}
              format={format}
              parse={parse}
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
