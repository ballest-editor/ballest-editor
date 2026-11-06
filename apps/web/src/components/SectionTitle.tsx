import type { ReactNode } from "react"

export const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <div className="text-caption uppercase tracking-wider text-fg-secondary dark:text-foreground">{children}</div>
)

/** A block of a panel: blocks sit apart by space alone, with no rule between them, so the titles carry the structure. */
export const Section = ({ children }: { readonly children: ReactNode }) => (
  <section className="flex flex-col gap-3">{children}</section>
)

/** A section's title with its icon buttons at the right, no taller than the title for them. */
export const SectionHeader = ({ title, children }: { readonly title: ReactNode; readonly children: ReactNode }) => (
  <div className="-my-1 flex items-center justify-between gap-2">
    <SectionTitle>{title}</SectionTitle>
    <div className="flex shrink-0 items-center gap-0.5">{children}</div>
  </div>
)
