import { IconChevronRight } from "@tabler/icons-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import type { ReactNode } from "react"

/** A section that starts closed, for what most people never need; its contents aren't mounted until it opens. */
export function Disclosure({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/disclosure -ml-1 flex h-6 cursor-pointer items-center gap-0.5 rounded-control pr-1 text-caption uppercase tracking-wider text-fg-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <IconChevronRight className="size-4 transition-transform group-data-[panel-open]/disclosure:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}
