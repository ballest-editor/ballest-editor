import { IconChevronRight } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { notices } from "virtual:third-party-notices"

/** Licence files are wrapped for a terminal: their paragraphs read better wrapped by the list's width. */
const reflow = (text: string) => text.replace(/(?<!\n)\n(?!\n)/g, " ")

/** One package: its name, version and licence, opening on its licence text. */
function Notice({ notice }: { readonly notice: (typeof notices)[number] }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/notice flex h-8 w-full cursor-pointer items-center gap-2 rounded-control px-2 text-left transition-colors hover:bg-foreground/6">
        <IconChevronRight className="size-3.5 shrink-0 text-fg-secondary transition-transform group-aria-expanded/notice:rotate-90" />
        <span className="min-w-0 truncate">{notice.name}</span>
        <span className="min-w-0 flex-1 truncate text-caption text-fg-tertiary">{notice.version}</span>
        <Badge variant="neutral" className="shrink-0">{notice.license}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-1 py-2 pr-2 pl-7.5 text-caption text-fg-secondary">
          {notice.author !== null && <p>{notice.author}</p>}
          {notice.text === null
            ? <p>This package has no licence file: see {notice.homepage ?? "its npm page"}.</p>
            : <p className="wrap-anywhere whitespace-pre-wrap">{reflow(notice.text)}</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Help › About › Open-source licences. A module of its own, so the texts load when the list opens. */
export default function ThirdPartyNotices() {
  return (
    <ScrollArea className="h-[min(60vh,480px)]">
      <div className="flex flex-col pr-3">
        {notices.map((notice) => <Notice key={notice.name} notice={notice} />)}
      </div>
    </ScrollArea>
  )
}
