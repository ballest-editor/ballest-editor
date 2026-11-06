import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@workspace/ui/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
    ? defaultValue
    : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn(
        "data-horizontal:w-full data-vertical:h-full data-disabled:pointer-events-none data-disabled:opacity-40",
        className
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-foreground/15 select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block size-3.5 shrink-0 rounded-full border-2 border-primary bg-white shadow-sm ring-primary/30 transition-shadow select-none after:absolute after:-inset-2 focus-ring-within hover:ring-3 active:ring-3 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

/** A slider's value from its change events: base-ui reports a number, or an array for range sliders. */
const sliderValue = (value: number | ReadonlyArray<number>): number | undefined =>
  typeof value === "number" ? value : value[0]

export { Slider, sliderValue }
