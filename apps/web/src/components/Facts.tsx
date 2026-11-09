import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import { FIELD_LABEL } from "./InspectorLayout"

/** Labelled values in two columns, the labels in the Inspector's left column (`FieldRow`), so the two line up. */
export const Facts = ({ children }: { readonly children: ReactNode }) => (
  <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-body">{children}</dl>
)

/** A row of `Facts`, as tall as a field so a row with a button lines up with the rest; `dense`, as tall as its text. */
export function Fact({ label, dense = false, children }: {
  readonly label: string
  readonly dense?: boolean
  readonly children: ReactNode
}) {
  return (
    <div className="contents">
      <dt className={FIELD_LABEL}>{label}</dt>
      <dd className={cn("flex min-w-0 items-center gap-1", !dense && "min-h-7")}>{children}</dd>
    </div>
  )
}
