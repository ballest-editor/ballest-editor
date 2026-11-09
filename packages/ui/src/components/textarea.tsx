import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

/** A field for prose, which does spellcheck: feedback's message. It looks like `Input`, several lines tall. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full min-w-0 resize-y rounded-control border border-border/70 bg-input px-2 py-1 text-body transition-colors focus-ring placeholder:text-fg-tertiary disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-fg-disabled disabled:placeholder:text-fg-disabled aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
