import type { ReactNode } from "react"

/** A section with nothing to list: one line, centred, and what to do about it underneath if there is anything. */
export function EmptySection({ children, line }: { readonly children?: ReactNode; readonly line: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-1 text-center">
      <p className="text-body text-fg-tertiary">{line}</p>
      {children}
    </div>
  )
}
