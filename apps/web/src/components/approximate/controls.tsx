/** The approximation dialog's rows: a labelled field, a switch, a slider and a pick of one of a few. */
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { type ReactNode, useId } from "react"

export function Field({ children, hint, label, value }: {
  readonly children: ReactNode
  readonly hint?: ReactNode
  readonly label: string
  readonly value?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-strong">{label}</span>
        {value !== undefined && <span className="text-caption text-fg-secondary tabular-nums">{value}</span>}
      </div>
      {children}
      {hint !== undefined && <p className="text-caption text-fg-tertiary">{hint}</p>}
    </div>
  )
}

export function SwitchRow({ checked, hint, label, onChange }: {
  readonly checked: boolean
  readonly hint: string
  readonly label: string
  readonly onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-body-strong">{label}</label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      <p className="text-caption text-fg-tertiary">{hint}</p>
    </div>
  )
}

/** A slider of one value, kept inside its range. */
export function OneSlider({ label, max, min, onChange, step, value }: {
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly onChange: (value: number) => void
}) {
  return (
    <Slider
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={[Math.min(max, Math.max(min, value))]}
      onValueChange={(v) => {
        const next = sliderValue(v)
        if (next !== undefined) onChange(next)
      }}
    />
  )
}

export interface Option<V> {
  readonly value: V
  readonly label: ReactNode
}

/** One of `options`, as a row of toggles; picking the one that is on leaves it on. */
export function Segmented<V extends string | number>({ label, onChange, options, value, wrap = false }: {
  readonly label: string
  readonly value: V
  readonly options: ReadonlyArray<Option<V>>
  readonly onChange: (value: V) => void
  readonly wrap?: boolean
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[String(value)]}
      onValueChange={(picked) => {
        const next = options.find((option) => picked.includes(String(option.value)))
        if (next !== undefined) onChange(next.value)
      }}
      {...(wrap && { className: "flex-wrap" })}
    >
      {options.map((option) => (
        <ToggleGroupItem key={String(option.value)} value={String(option.value)}>{option.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
