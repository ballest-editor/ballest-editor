import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cn } from "@workspace/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-control text-body-strong whitespace-nowrap transition-all focus-ring hover:bg-hover hover:text-foreground active:scale-[0.97] active:bg-pressed disabled:pointer-events-none disabled:text-fg-disabled aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:hover:lift-selected aria-pressed:active:press-selected dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-border bg-transparent"
      },
      size: {
        default: "h-7 min-w-7 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        sm:
          "h-6 min-w-6 px-2 text-caption has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
