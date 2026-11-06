import { Button } from "@workspace/ui/components/button"
import { ColorPicker, ColorSwatch } from "@workspace/ui/components/color-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

/**
 * A colour setting that can be automatic (null): a swatch of the colour in use, opening the
 * same picker as the item colour properties, with a way back to automatic.
 */
export function ColorSetting({ className = "w-40", ...props }: {
  readonly label: string
  readonly value: string | null
  /** The colour automatic currently resolves to. */
  readonly auto: string
  readonly onChange: (value: string | null) => void
  readonly className?: string
}) {
  const shown = props.value ?? props.auto
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${props.label}: ${props.value ?? `automatic (${props.auto})`}`}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-2 rounded-control border border-border/70 bg-input px-2 text-body transition-colors duration-150 ease-out hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
          className
        )}
      >
        <ColorSwatch color={shown} />
        <span className={cn("tabular-nums", props.value === null && "text-fg-tertiary")}>{shown}</span>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-56 gap-2">
        <ColorPicker value={shown} onCommit={props.onChange} />
        <Button variant="outline" size="sm" disabled={props.value === null} onClick={() => props.onChange(null)}>
          Use automatic
        </Button>
      </PopoverContent>
    </Popover>
  )
}
