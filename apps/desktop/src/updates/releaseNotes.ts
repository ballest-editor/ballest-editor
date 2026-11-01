// GitHub's HTML release body → the few blocks the update popover renders (`ReleaseNoteBlock` in packages/contracts).
// Everything outside a short allowlist is unwrapped to its text, and script-like elements are dropped with their
// content, so the page gets plain data: nothing in the notes can run or load.
import type { ReleaseNoteBlock, ReleaseNoteItem, ReleaseNoteList, ReleaseNoteSpan } from "@ballest/contracts"
import { Option } from "effect"
import { parseExternalUrl } from "../electron/ElectronShell"

/** The most text the notes keep; the rest is cut at a block and marked with an ellipsis. */
export const MAX_NOTES_LENGTH = 4000

/** Lists nested deeper than this continue the deepest one. */
const MAX_LIST_DEPTH = 4

/** Elements whose content is not text to show; they go with everything in them. */
const DROPPED = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "noscript",
  "template",
  "textarea",
  "select",
  "svg",
  "math",
  "title",
  "head",
  "video",
  "audio",
  "canvas"
])

/** Elements that separate blocks of text but aren't kept themselves. */
const BOUNDARIES = new Set([
  "p",
  "div",
  "blockquote",
  "section",
  "article",
  "details",
  "summary",
  "table",
  "tr",
  "dl",
  "dt",
  "dd",
  "hr",
  "figure",
  "figcaption"
])

const HEADING_LEVELS: Readonly<Record<string, 1 | 2 | 3 | 4>> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 4, h6: 4 }

type Mark = "strong" | "emphasis" | "code"

const MARKS: Readonly<Record<string, Mark>> = {
  strong: "strong",
  b: "strong",
  em: "emphasis",
  i: "emphasis",
  code: "code",
  kbd: "code",
  samp: "code",
  tt: "code"
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }

const decodeEntity = (entity: string): string => {
  const code = entity.startsWith("#x") || entity.startsWith("#X")
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith("#")
    ? Number.parseInt(entity.slice(1), 10)
    : Number.NaN
  if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code)
  return ENTITIES[entity.toLowerCase()] ?? `&${entity};`
}

const decodeEntities = (text: string): string =>
  text.replace(/&([a-z]+|#\d+|#x[\da-f]+);/gi, (_, entity: string) => decodeEntity(entity))

const hrefOf = (attributes: string): string | null => {
  const match = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes)
  const raw = match?.[1] ?? match?.[2] ?? match?.[3]
  return raw === undefined ? null : Option.getOrNull(parseExternalUrl(decodeEntities(raw).trim()))
}

interface Format {
  readonly strong: boolean
  readonly emphasis: boolean
  readonly code: boolean
  readonly href: string | null
}

interface Run extends Format {
  text: string
}

interface ItemBuilder {
  readonly runs: Array<Run>
  readonly lists: Array<ListBuilder>
}

interface ListBuilder {
  readonly _tag: "List"
  readonly ordered: boolean
  readonly items: Array<ItemBuilder>
}

type BlockBuilder =
  | { readonly _tag: "Heading"; readonly level: 1 | 2 | 3 | 4; readonly runs: Array<Run> }
  | { readonly _tag: "Paragraph"; readonly runs: Array<Run> }
  | ListBuilder
  | { readonly _tag: "Code"; text: string }

const sameFormat = (a: Format, b: Format) =>
  a.strong === b.strong && a.emphasis === b.emphasis && a.code === b.code && a.href === b.href

/** Leading and trailing white space off a block's text, empty runs out. */
const spansOf = (runs: ReadonlyArray<Run>): ReadonlyArray<ReleaseNoteSpan> => {
  const spans = runs.map(({ text, ...format }) => ({ ...format, text: text.replace(/[ \t]*\n[ \t]*/g, "\n") }))
  const first = spans[0]
  if (first !== undefined) first.text = first.text.trimStart()
  const last = spans.at(-1)
  if (last !== undefined) last.text = last.text.trimEnd()
  return spans.filter((span) => span.text !== "")
}

const listOf = (list: ListBuilder): ReleaseNoteList | null => {
  const items = list.items.flatMap((item): Array<ReleaseNoteItem> => {
    const spans = spansOf(item.runs)
    const lists = item.lists.flatMap((nested) => listOf(nested) ?? [])
    return spans.length === 0 && lists.length === 0 ? [] : [{ spans, lists }]
  })
  return items.length === 0 ? null : { _tag: "List", ordered: list.ordered, items }
}

const blockOf = (block: BlockBuilder): ReleaseNoteBlock | null => {
  switch (block._tag) {
    case "Heading":
    case "Paragraph": {
      const spans = spansOf(block.runs)
      if (spans.length === 0) return null
      return block._tag === "Heading" ? { _tag: "Heading", level: block.level, spans } : { _tag: "Paragraph", spans }
    }
    case "List":
      return listOf(block)
    case "Code": {
      const text = block.text.replace(/^\n/, "").trimEnd()
      return text === "" ? null : { _tag: "Code", text }
    }
  }
}

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][a-z\d-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<|[^<]+/gi

/**
 * The structure of an HTML release body: headings (h5 and h6 as h4), paragraphs, lists, code blocks, and in their
 * text bold, italics, code and http(s) links. `br` is a line break; any other element is unwrapped to its text, and
 * script, style, iframe and the like are dropped with what is in them, as is every image. At most `MAX_NOTES_LENGTH`
 * characters of text.
 */
export const htmlToBlocks = (html: string): ReadonlyArray<ReleaseNoteBlock> => {
  const blocks: Array<BlockBuilder> = []
  /** The open lists, outermost first. */
  const lists: Array<ListBuilder> = []
  /** The heading or paragraph that text at the top level goes into; null starts a paragraph. */
  let open: Extract<BlockBuilder, { runs: Array<Run> }> | null = null
  /** Inside `pre`: its text so far. */
  let pre: { text: string } | null = null
  const marks: Array<{ readonly tag: string; readonly mark: Mark | "link"; readonly href: string | null }> = []
  /** What is left of `MAX_NOTES_LENGTH`; `cut` once it ran out. */
  const budget = { left: MAX_NOTES_LENGTH, cut: false }

  const format = (): Format => ({
    strong: marks.some((m) => m.mark === "strong"),
    emphasis: marks.some((m) => m.mark === "emphasis"),
    code: pre !== null || marks.some((m) => m.mark === "code"),
    href: marks.findLast((m) => m.mark === "link")?.href ?? null
  })

  const currentItem = (): ItemBuilder | null => {
    const list = lists.at(-1)
    if (list === undefined) return null
    const item = list.items.at(-1)
    if (item !== undefined) return item
    const started: ItemBuilder = { runs: [], lists: [] }
    list.items.push(started)
    return started
  }

  const runsForText = (): Array<Run> => {
    const item = currentItem()
    if (item !== null) return item.runs
    if (open === null) {
      open = { _tag: "Paragraph", runs: [] }
      blocks.push(open)
    }
    return open.runs
  }

  /** Spends the budget on `text`, cut short with an ellipsis once it runs out. */
  const spend = (text: string): string => {
    if (text.length <= budget.left) {
      budget.left -= text.length
      return text
    }
    budget.cut = true
    return `${text.slice(0, Math.max(0, budget.left - 1)).trimEnd()}…`
  }

  /** Appends text as it should read: `collapse` turns white space into single spaces, as HTML does outside `pre`. */
  const append = (raw: string, collapse = pre === null) => {
    if (budget.cut) return
    if (pre !== null && lists.length === 0) {
      pre.text += spend(raw)
      return
    }
    const runs = runsForText()
    const previous = runs.at(-1)
    let text = collapse ? raw.replace(/\s+/g, " ") : raw
    if (collapse && text.startsWith(" ") && (previous === undefined || /\s$/.test(previous.text))) {
      text = text.slice(1)
    }
    if (text === "") return
    text = spend(text)
    const current = format()
    if (previous !== undefined && sameFormat(previous, current)) previous.text += text
    else runs.push({ ...current, text })
  }

  /** Ends the paragraph or heading at the top level; in a list item, a space between its parts. */
  const boundary = () => {
    if (lists.length > 0) append(" ", true)
    else open = null
  }

  const openBlock = (block: BlockBuilder) => {
    open = null
    blocks.push(block)
  }

  const openList = (ordered: boolean) => {
    const deepest = lists.at(-1)
    // Too deep: its items continue the deepest list.
    if (deepest !== undefined && lists.length >= MAX_LIST_DEPTH) return deepest
    const list: ListBuilder = { _tag: "List", ordered, items: [] }
    const item = currentItem()
    if (item === null) openBlock(list)
    else item.lists.push(list)
    return list
  }

  const startTag = (tag: string, attributes: string) => {
    const mark = MARKS[tag]
    if (mark !== undefined) {
      marks.push({ tag, mark, href: null })
      return
    }
    if (tag === "a") {
      marks.push({ tag, mark: "link", href: hrefOf(attributes) })
      return
    }
    if (tag === "br") {
      append("\n", false)
      return
    }
    if (BOUNDARIES.has(tag)) {
      boundary()
      return
    }
    const level = HEADING_LEVELS[tag]
    if (level !== undefined) {
      if (lists.length > 0) append(" ", true)
      else {
        open = { _tag: "Heading", level, runs: [] }
        blocks.push(open)
      }
      return
    }
    if (tag === "ul" || tag === "ol") {
      lists.push(openList(tag === "ol"))
      return
    }
    if (tag === "li") {
      // An item outside any list starts a bulleted one.
      let list = lists.at(-1)
      if (list === undefined) {
        list = openList(false)
        lists.push(list)
      }
      list.items.push({ runs: [], lists: [] })
      return
    }
    if (tag === "pre") {
      if (lists.length > 0) {
        // In a list item its text goes into the item, as code.
        append(" ", true)
        pre = { text: "" }
      } else {
        const code = { _tag: "Code" as const, text: "" }
        openBlock(code)
        pre = code
      }
    }
  }

  const endTag = (tag: string) => {
    if (MARKS[tag] !== undefined || tag === "a") {
      const index = marks.findLastIndex((m) => m.tag === tag)
      if (index >= 0) marks.splice(index, 1)
      return
    }
    if (BOUNDARIES.has(tag) || HEADING_LEVELS[tag] !== undefined) {
      boundary()
      return
    }
    if (tag === "ul" || tag === "ol") {
      lists.pop()
      return
    }
    if (tag === "pre") {
      pre = null
      boundary()
    }
  }

  const tokens = new RegExp(TOKEN.source, TOKEN.flags)
  for (let match = tokens.exec(html); match !== null && !budget.cut; match = tokens.exec(html)) {
    const [token, slash, name, attributes = ""] = match
    if (name === undefined) {
      if (!token.startsWith("<!--")) append(decodeEntities(token))
      continue
    }
    const tag = name.toLowerCase()
    if (slash === "/") {
      endTag(tag)
      continue
    }
    const selfClosing = attributes.trimEnd().endsWith("/")
    if (DROPPED.has(tag)) {
      if (selfClosing) continue
      const close = new RegExp(`</${tag}\\s*>`, "gi")
      close.lastIndex = tokens.lastIndex
      tokens.lastIndex = close.exec(html) === null ? html.length : close.lastIndex
      continue
    }
    if (selfClosing && tag !== "br" && tag !== "hr") continue
    startTag(tag, attributes)
  }

  return blocks.flatMap((block) => blockOf(block) ?? [])
}

/** A body with no markup at all (a generic feed's notes): paragraphs at blank lines, its line breaks kept. */
export const textToBlocks = (text: string): ReadonlyArray<ReleaseNoteBlock> => {
  const blocks: Array<ReleaseNoteBlock> = []
  let budget = MAX_NOTES_LENGTH
  for (const paragraph of text.split(/\n[ \t]*\n/)) {
    let body = paragraph.split("\n").map((line) => line.trim()).filter((line) => line !== "").join("\n")
    if (body === "") continue
    const cut = body.length > budget
    if (cut) body = `${body.slice(0, Math.max(0, budget - 1)).trimEnd()}…`
    budget -= body.length
    blocks.push({
      _tag: "Paragraph",
      spans: [{ text: body, strong: false, emphasis: false, code: false, href: null }]
    })
    if (cut) break
  }
  return blocks
}

/** HTML when it has any markup, else plain text. */
export const releaseNotesToBlocks = (body: string): ReadonlyArray<ReleaseNoteBlock> =>
  /<\/?[a-z][^>]*>|&(?:[a-z]+|#\d+|#x[\da-f]+);/i.test(body) ? htmlToBlocks(body) : textToBlocks(body)
