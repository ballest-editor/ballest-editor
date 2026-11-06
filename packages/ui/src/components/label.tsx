import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-body leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-fg-disabled peer-disabled:cursor-not-allowed peer-disabled:text-fg-disabled",
        className
      )}
      {...props}
    />
  )
}

export { Label }
