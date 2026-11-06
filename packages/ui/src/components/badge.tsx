import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "@workspace/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-caption whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "bg-primary/12 text-foreground [a]:hover:bg-primary/20",
        secondary: "bg-status-neutral text-status-neutral-foreground [a]:hover:bg-status-neutral/80",
        neutral: "bg-status-neutral text-status-neutral-foreground [a]:hover:bg-status-neutral/80",
        ok: "bg-status-ok text-status-ok-foreground [a]:hover:bg-status-ok/80",
        warn: "bg-status-warn text-status-warn-foreground [a]:hover:bg-status-warn/80",
        destructive: "bg-destructive/12 text-destructive focus-visible:ring-destructive/30 [a]:hover:bg-destructive/20",
        outline: "border-border text-foreground [a]:hover:bg-foreground/6",
        ghost: "hover:bg-foreground/6 hover:text-fg-secondary",
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
