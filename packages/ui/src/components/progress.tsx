import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "@workspace/ui/lib/utils"

/** A determinate bar, all spans so it can sit inside a button. `barClassName` styles the part that fills. */
function Progress({
  className,
  barClassName,
  ...props
}: Omit<ProgressPrimitive.Root.Props, "render" | "children"> & { readonly barClassName?: string }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      render={<span />}
      className={cn("block h-1 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Track render={<span />} className="block size-full">
        <ProgressPrimitive.Indicator
          render={<span />}
          className={cn("block h-full bg-primary transition-[width]", barClassName)}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
