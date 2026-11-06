import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cn } from "@workspace/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding text-body-strong whitespace-nowrap transition-all select-none focus-ring active:not-aria-[haspopup]:scale-[0.97] active:not-aria-[haspopup]:shadow-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-primary hover:lift-primary active:press-primary",
        outline:
          "border-border shadow-sm hover:bg-hover hover:text-foreground active:bg-pressed disabled:text-fg-disabled disabled:opacity-100 aria-expanded:bg-hover aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:lift-secondary active:press-secondary aria-expanded:lift-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-hover hover:text-foreground active:bg-pressed disabled:text-fg-disabled disabled:opacity-100 aria-expanded:bg-hover aria-expanded:text-foreground",
        destructive: "bg-destructive/12 text-destructive hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline disabled:text-fg-disabled disabled:opacity-100"
      },
      size: {
        default:
          "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs:
          "h-5 gap-1 px-2 text-caption has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm:
          "h-6 gap-1 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        // An icon button holds a 16px icon, whatever size its caller gave it.
        "icon-sm": "size-6 [&_svg]:size-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
