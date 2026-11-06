import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

/** A field here holds names, numbers and filters, never prose, so it doesn't spellcheck or offer past entries. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      spellCheck={false}
      autoComplete="off"
      className={cn(
        "h-7 w-full min-w-0 rounded-control border border-border/70 bg-input px-2 py-0.5 text-body transition-colors focus-ring placeholder:text-fg-tertiary disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-fg-disabled disabled:placeholder:text-fg-disabled aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
