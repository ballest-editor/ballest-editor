import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cn } from "@workspace/ui/lib/utils"

function Toggle({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(
        "group/toggle inline-flex items-center justify-center gap-1 rounded-control text-body-strong whitespace-nowrap transition-all focus-ring hover:bg-hover hover:text-foreground active:scale-[0.97] active:bg-pressed disabled:pointer-events-none disabled:text-fg-disabled aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:hover:lift-selected aria-pressed:active:press-selected [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-transparent h-7 min-w-7 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        className
      )}
      {...props}
    />
  )
}

export { Toggle }
