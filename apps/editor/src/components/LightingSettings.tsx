import { Label } from "@workspace/ui/components/label"
import { Slider } from "@workspace/ui/components/slider"
import { useShallow } from "zustand/react/shallow"
import { formatTimeOfDay, type Lighting, LIGHTING_RANGES, lightingOf } from "../domain/sunlight"
import { shownLighting, useEditor } from "../editor/store"
import { NumberField } from "./NumberField"

/** One control per slider in the game's World Settings › lighting, labelled as the game labels them. */
const CONTROLS: ReadonlyArray<{
  readonly key: keyof Lighting
  readonly label: string
  readonly title: string
  readonly step: number
  readonly digits: number
}> = [
  { key: "timeOfDay", label: "Time of day", title: "Hours, 0–24: sunrise at 6, noon overhead", step: 0.05, digits: 2 },
  { key: "brightness", label: "Sunlight", title: "The sun's brightness", step: 0.05, digits: 2 },
  { key: "angle", label: "Light rotation", title: "The sun's compass direction (yaw, degrees)", step: 1, digits: 1 }
]

const sliderValue = (value: number | ReadonlyArray<number>): number | undefined =>
  typeof value === "number" ? value : value[0]

/**
 * The map's sun, edited like the game's World Settings panel: a slider over the game's
 * range plus a number field that takes any value (new maps save sunlight 12, above the
 * game's slider). Dragging previews live in the viewport; each release is one undo step.
 */
export function LightingSettings() {
  const shown = useEditor(useShallow(shownLighting))
  const mapLighting = useEditor((s) => s.settings.appearance.mapLighting)

  const committed = () => lightingOf(useEditor.getState().doc.map.worldSettings)
  const preview = (key: keyof Lighting, value: number | null) =>
    useEditor.getState().setLightingPreview(value === null ? null : { ...committed(), [key]: value })
  const commit = (key: keyof Lighting, value: number) => {
    const { setLighting, setLightingPreview } = useEditor.getState()
    setLightingPreview(null)
    setLighting({ ...committed(), [key]: value })
  }

  return (
    <div className="flex flex-col gap-3">
      {CONTROLS.map(({ key, label, title, step, digits }) => {
        const { min, max } = LIGHTING_RANGES[key]
        const value = shown[key]
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-muted-foreground" title={title}>
                {label}
                {key === "timeOfDay" && (
                  <span className="font-mono text-xs text-foreground tabular-nums">{formatTimeOfDay(value)}</span>
                )}
              </Label>
              <div className="w-24">
                <NumberField
                  label={label}
                  value={value}
                  step={step}
                  digits={digits}
                  onCommit={(v) => commit(key, v)}
                  onScrub={(v) => preview(key, v)}
                />
              </div>
            </div>
            <Slider
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={Math.min(max, Math.max(min, value))}
              onValueChange={(v) => {
                const next = sliderValue(v)
                if (next !== undefined) preview(key, next)
              }}
              onValueCommitted={(v) => {
                const next = sliderValue(v)
                if (next !== undefined) commit(key, next)
              }}
            />
          </div>
        )
      })}
      {!mapLighting && (
        <p className="text-xs text-muted-foreground">
          The viewport is using studio lights. Turn on View › Map lighting to see these.
        </p>
      )}
    </div>
  )
}
