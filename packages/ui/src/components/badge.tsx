import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "@workspace/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-caption whitespace-nowrap transition-all focus-ring [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        neutral: "bg-status-neutral text-status-neutral-foreground",
        ok: "bg-status-ok text-status-ok-foreground",
        warn: "bg-status-warn text-status-warn-foreground",
        destructive: "bg-destructive/12 text-destructive"
      }
    },
    defaultVariants: {
      variant: "neutral"
    }
  }
)

function Badge({
  className,
  variant = "neutral",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className)
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant
    }
  })
}

export { Badge, badgeVariants }
