import type { ReleaseNoteBlock, ReleaseNoteList, ReleaseNoteSpan } from "@ballest/contracts"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import { openExternalLink } from "../editor/actions"

/** A link in the notes: opens in the browser (desktop: the default one), never in the window. */
function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      className="text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
      onClick={(e) => {
        e.preventDefault()
        void openExternalLink(href)
      }}
    >
      {children}
    </a>
  )
}

/**
 * Each item with a React key made from its content (the notes have no ids), numbered when the same content repeats.
 */
function keyed<A>(items: ReadonlyArray<A>): ReadonlyArray<readonly [string, A]> {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const content = JSON.stringify(item)
    const repeat = seen.get(content) ?? 0
    seen.set(content, repeat + 1)
    return [`${repeat}:${content}`, item] as const
  })
}

function Span({ span }: { readonly span: ReleaseNoteSpan }) {
  let node: ReactNode = span.text
  if (span.code) node = <code className="rounded bg-muted px-1 py-px font-mono text-[0.9em]">{node}</code>
  if (span.emphasis) node = <em>{node}</em>
  if (span.strong) node = <strong className="font-semibold text-foreground">{node}</strong>
  return span.href === null ? node : <ExternalLink href={span.href}>{node}</ExternalLink>
}

function Spans({ spans }: { readonly spans: ReadonlyArray<ReleaseNoteSpan> }) {
  return keyed(spans).map(([key, span]) => <Span key={key} span={span} />)
}

function List({ list, nested = false }: { readonly list: ReleaseNoteList; readonly nested?: boolean }) {
  const Tag = list.ordered ? "ol" : "ul"
  return (
    <Tag
      className={cn(
        "flex flex-col gap-1 pl-4 marker:text-muted-foreground",
        list.ordered ? "list-decimal" : "list-disc",
        nested && "mt-1"
      )}
    >
      {keyed(list.items).map(([key, item]) => (
        <li key={key} className="pl-0.5">
          <Spans spans={item.spans} />
          {keyed(item.lists).map(([subKey, sub]) => <List key={subKey} list={sub} nested />)}
        </li>
      ))}
    </Tag>
  )
}

/** The popover's title is the release, so the body's own headings sit below it: h1 renders as h3. */
const HEADINGS = { 1: "h3", 2: "h4", 3: "h5", 4: "h6" } as const

function Block({ block }: { readonly block: ReleaseNoteBlock }) {
  switch (block._tag) {
    case "Heading": {
      const Tag = HEADINGS[block.level]
      return (
        <Tag
          className={cn(
            "font-semibold text-foreground not-first:mt-1",
            block.level <= 2 ? "text-[0.8125rem]" : "text-xs"
          )}
        >
          <Spans spans={block.spans} />
        </Tag>
      )
    }
    case "Paragraph":
      return (
        <p className="whitespace-pre-line">
          <Spans spans={block.spans} />
        </p>
      )
    case "List":
      return <List list={block} />
    case "Code":
      return (
        <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[0.6875rem] text-foreground">
          {block.text}
        </pre>
      )
  }
}

/**
 * A release's notes (`UpdateState.releaseNotes`): the headings, paragraphs, lists, code and links main kept of its
 * GitHub release body, as text styles; nothing in them is HTML.
 */
export function ReleaseNotes({ blocks }: { readonly blocks: ReadonlyArray<ReleaseNoteBlock> }) {
  return (
    <div className="flex flex-col gap-2 leading-relaxed break-words text-muted-foreground">
      {keyed(blocks).map(([key, block]) => <Block key={key} block={block} />)}
    </div>
  )
}
