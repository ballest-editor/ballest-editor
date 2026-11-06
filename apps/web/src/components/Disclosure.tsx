import { IconChevronRight } from "@tabler/icons-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import { EYEBROW } from "./SectionTitle"

/** A section that starts closed, for what most people never need; its contents aren't mounted until it opens. */
export function Disclosure({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          "group/disclosure -ml-1 flex h-6 cursor-pointer items-center gap-0.5 rounded-control pr-1 transition-colors focus-ring hover:text-foreground",
          EYEBROW
        )}
      >
        <IconChevronRight className="size-4 transition-transform group-data-[panel-open]/disclosure:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-5 pt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}
