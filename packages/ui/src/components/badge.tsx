import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "@workspace/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-caption whitespace-nowrap transition-all focus-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "bg-selected text-foreground [a]:hover:lift-selected [a]:active:press-selected",
        secondary:
          "bg-status-neutral text-status-neutral-foreground [a]:hover:lift-status-neutral [a]:active:press-status-neutral",
        neutral:
          "bg-status-neutral text-status-neutral-foreground [a]:hover:lift-status-neutral [a]:active:press-status-neutral",
        ok: "bg-status-ok text-status-ok-foreground [a]:hover:lift-status-ok [a]:active:press-status-ok",
        warn: "bg-status-warn text-status-warn-foreground [a]:hover:lift-status-warn [a]:active:press-status-warn",
        destructive: "bg-destructive/12 text-destructive [a]:hover:bg-destructive/20",
        outline: "border-border text-foreground [a]:hover:bg-hover [a]:active:bg-pressed",
        ghost: "hover:bg-hover hover:text-fg-secondary active:bg-pressed",
        link: "text-primary underline-offset-4 hover:underline"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

function Badge({
  className,
  variant = "default",
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
