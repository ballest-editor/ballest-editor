import { IconChevronDown } from "@tabler/icons-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { createContext, type ReactNode, useContext, useState } from "react"
import { updateSettings } from "../editor/actions"
import { useEditor } from "../editor/store"
import { THUMBNAIL_TILE } from "./PieceThumbnail"

/**
 * The Inspector's layout, which every one of its sections is built from (docs/design/ui-system.md § Inspector): a stack
 * of sections with a line between each, a header that opens and closes its section, and rows with their label in a
 * column at the left.
 */

/** Whether this is inside a section's content, so a section here takes its parent's padding rather than adding its own. */
const Nested = createContext(false)

/** The Inspector's sections, one after another with a line across the panel between each. */
export const SectionStack = ({ children }: { readonly children: ReactNode }) => {
  const nested = useContext(Nested)
  return (
    <div className={cn("flex flex-col divide-y divide-border", nested && "-mb-4 border-t")}>
      {children}
    </div>
  )
}

/** Every section that can be closed, by the name its open state is kept under in settings. */
export type SectionId =
  | "transform"
  | "pivot"
  | "connectsAt"
  | "paint"
  | "properties"
  | "details"
  | "contents"
  | "instance"
  | "chain"
  | "groupItems"
  | "mapInfo"
  | "lighting"
  | "prefabInfo"

const useSectionOpen = (id: SectionId, defaultOpen: boolean) => {
  const sections = useEditor((s) => s.settings.panels.inspectorSections)
  const set = (open: boolean) => {
    const next: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(sections)) if (key !== id) next[key] = value
    if (open !== defaultOpen) next[id] = open
    void updateSettings("panels", { inspectorSections: next })
  }
  return [sections[id] ?? defaultOpen, set] as const
}

const SECTION_TITLE = "min-w-0 truncate text-body-strong text-foreground"

/** A header's right-hand side: icon buttons, a hint, a short status. Clicks here never open or close the section. */
const HeaderAside = ({ children }: { readonly children: ReactNode }) => (
  <div className="-mr-1 flex shrink-0 items-center gap-0.5 text-caption text-fg-tertiary">{children}</div>
)

/**
 * A section of the Inspector: a 36px header, its title at the left and `actions` at the right, then its content. The
 * header opens and closes it, kept in settings under `id`. With no content, it is only its header, `actions` there
 * saying why (Paint on a piece the game doesn't paint). `className` goes on the content, whose rows sit 12px apart.
 */
export function Section({ id, title, actions, defaultOpen = true, className, children }: {
  readonly id: SectionId
  readonly title: ReactNode
  readonly actions?: ReactNode
  readonly defaultOpen?: boolean
  readonly className?: string
  readonly children?: ReactNode
}) {
  const nested = useContext(Nested)
  const [open, setOpen] = useSectionOpen(id, defaultOpen)
  const padding = nested ? "" : "px-3"
  const aside = actions === undefined ? null : <HeaderAside>{actions}</HeaderAside>
  if (children === undefined || children === null || children === false) {
    return (
      <section className={cn("flex h-9 items-center justify-between gap-2", padding)}>
        <h3 className={SECTION_TITLE}>{title}</h3>
        {aside}
      </section>
    )
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<section />} className="flex min-w-0 flex-col">
      <div className={cn("flex h-9 items-center gap-2", padding)}>
        <CollapsibleTrigger className="group/section -ml-1 flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-control px-1 text-left transition-colors focus-ring hover:bg-hover active:bg-pressed">
          <h3 className={SECTION_TITLE}>{title}</h3>
          <IconChevronDown className="size-3.5 shrink-0 text-fg-tertiary transition-transform group-hover/section:text-fg-secondary group-data-[panel-open]/section:rotate-0 -rotate-90" />
        </CollapsibleTrigger>
        {aside}
      </div>
      <CollapsibleContent className={cn("flex min-w-0 flex-col gap-3 pb-4", padding, className)}>
        <Nested.Provider value>{children}</Nested.Provider>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The top of the Inspector: what's selected (or open), before any section. Not a section, so it never closes. */
export const IdentityBlock = ({ children }: { readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-3 px-3 pt-3 pb-4">{children}</div>
)

/** The tile at the left of an identity: a piece's picture or a glyph, on the same tile the Pieces panel draws. */
export const IDENTITY_TILE = cn(
  "grid size-10 shrink-0 place-items-center rounded-surface text-fg-secondary",
  THUMBNAIL_TILE
)

/** What's selected, by name: its tile, its name and what kind of thing it is, and its actions at the right. */
export function Identity({ tile, title, subtitle, actions }: {
  readonly tile: ReactNode
  readonly title: ReactNode
  readonly subtitle?: ReactNode
  readonly actions?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {tile}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center">{title}</div>
        {subtitle !== undefined && <div className="truncate text-caption text-fg-tertiary">{subtitle}</div>}
      </div>
      {actions !== undefined && <div className="-mr-1 flex shrink-0 items-center gap-0.5 self-start">{actions}</div>}
    </div>
  )
}

/** An identity's name, read-only. */
export const IdentityName = ({ children }: { readonly children: ReactNode }) => (
  <span className="min-w-0 truncate text-title" title={typeof children === "string" ? children : undefined}>
    {children}
  </span>
)

/**
 * An identity's name that edits in place: it reads as the title until pointed at, then as a field. Enter or leaving it
 * commits, Escape puts it back. An empty name commits as `""`; what that means is the owner's to say.
 */
export function InlineName({ value, placeholder, label, onCommit }: {
  readonly value: string
  readonly placeholder?: string
  readonly label: string
  readonly onCommit: (name: string) => void
}) {
  // An edit in progress; otherwise the field shows the name.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft.trim())
    setDraft(null)
  }
  return (
    <Input
      aria-label={label}
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
      className="-ml-1.5 h-7 w-[calc(100%+0.375rem)] border-transparent bg-transparent px-1.5 text-title shadow-none transition-colors placeholder:text-foreground hover:border-border/70 hover:bg-input focus-visible:border-border/70 focus-visible:bg-input dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
    />
  )
}

/** A row's label: the type every label in the Inspector's left column takes. */
export const FIELD_LABEL = "text-label text-fg-secondary"

/** The left column's width: wide enough for most labels on one line, narrow enough to leave a slider room. */
const ROW = "grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-2"

/**
 * One row of a section: its label in the left column, its control in the rest. `hint` is what the label's tooltip says.
 * `trailing` is a slot at the far right, for a reset; a section that has one gives every row one, so the controls line up.
 */
export function FieldRow({ label, htmlFor, hint, trailing, align = "center", children }: {
  readonly label: ReactNode
  readonly htmlFor?: string
  readonly hint?: ReactNode
  readonly trailing?: ReactNode
  readonly align?: "center" | "start"
  readonly children: ReactNode
}) {
  const labelClass = cn(FIELD_LABEL, "line-clamp-2 min-w-0 break-words", align === "start" && "self-start pt-1.5")
  const text = htmlFor === undefined
    ? <span className={labelClass}>{label}</span>
    : <Label htmlFor={htmlFor} className={labelClass}>{label}</Label>
  return (
    <div className={cn(ROW, trailing !== undefined && "grid-cols-[6rem_minmax(0,1fr)_1.5rem]")}>
      {hint === undefined ? text : (
        <Tooltip>
          <TooltipTrigger render={<span className="flex min-w-0" />}>{text}</TooltipTrigger>
          <TooltipContent side="left" className="max-w-60 flex-col items-start">{hint}</TooltipContent>
        </Tooltip>
      )}
      <div className={cn("flex min-h-7 min-w-0 items-center gap-1", align === "start" && "self-start")}>{children}</div>
      {trailing}
    </div>
  )
}
