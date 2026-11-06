import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

/** Labelled values in two columns, the labels as wide as the longest. */
export const Facts = ({ children }: { readonly children: ReactNode }) => (
  <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-body">{children}</dl>
)

/** A row of `Facts`, as tall as an icon button so a row with one lines up with the rest; `dense`, as tall as its text. */
export function Fact({ label, dense = false, children }: {
  readonly label: string
  readonly dense?: boolean
  readonly children: ReactNode
}) {
  return (
    <div className="contents">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className={cn("flex min-w-0 items-center gap-1", !dense && "min-h-6")}>{children}</dd>
    </div>
  )
}
