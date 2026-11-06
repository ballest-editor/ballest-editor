import { type Icon, IconInfoCircle, IconRestore, IconSearch } from "@tabler/icons-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { Fragment, type ReactNode, useState } from "react"

/** The page or scope that's open in the sidebar: the selection's wash, which a hover doesn't change. */
const SELECTED = "bg-primary/12 text-foreground hover:bg-primary/12"

/** One searchable setting. `group` is a sub-heading inside the category (keybind sections). */
export interface SettingsRow<C extends string> {
  readonly id: string
  readonly category: C
  readonly group?: string
  readonly label: string
  /** One short line under the label; a string is searched too, a node needs `keywords` for that. */
  readonly description?: ReactNode
  /** The mechanics behind the short line, in the tooltip of an info icon beside the label; a string is searched too. */
  readonly info?: ReactNode
  /** A status icon before the label. The control then sits on the label's line, not centred on the row. */
  readonly icon?: ReactNode
  /** Description shown as a hover tooltip on the label instead of under it. */
  readonly tooltip?: boolean
  /** More text the search matches (e.g. the choices inside the control). */
  readonly keywords?: string
  readonly disabled?: boolean
  /**
   * For settings with a default: whether it differs (a dot marks the row and its category)
   * and how to put it back. Rows without one (things the user writes, like a map's name)
   * get neither.
   */
  readonly changes?: { readonly modified: boolean; readonly reset: () => void }
  /** A row-specific action shown where the reset button goes (e.g. "Clear"). */
  readonly action?: ReactNode
  /** The control goes under the label at full width instead of beside it. */
  readonly wide?: boolean
  readonly control: ReactNode
}

export interface SettingsCategoryInfo<C extends string> {
  readonly id: C
  readonly label: string
  readonly icon: Icon
  /** A heading the nav shows above the first category of each section ("Maps"). */
  readonly section?: string
}

const isModified = (row: SettingsRow<string>): boolean => row.changes?.modified === true

function ResetButton({ modified, reset }: NonNullable<SettingsRow<string>["changes"]>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-fg-secondary", !modified && "invisible")}
            onClick={reset}
            aria-label="Reset to default"
            tabIndex={modified ? 0 : -1}
          />
        }
      >
        <IconRestore />
      </TooltipTrigger>
      <TooltipContent side="left">Reset to default</TooltipContent>
    </Tooltip>
  )
}

function InfoTip({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="-my-0.5 text-fg-tertiary" aria-label={`About ${label}`} />
        }
      >
        <IconInfoCircle />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">{children}</TooltipContent>
    </Tooltip>
  )
}

function RowView({ row }: { readonly row: SettingsRow<string> }) {
  const name = (
    <span className={cn("text-body-strong", row.disabled && "text-fg-disabled")}>
      {row.label}
    </span>
  )
  const label = row.info == null ? name : (
    <span className="flex items-center gap-0.5">
      {name}
      <InfoTip label={row.label}>{row.info}</InfoTip>
    </span>
  )
  const text = (
    <div className="flex min-w-0 flex-1 flex-col">
      {row.tooltip && row.description !== undefined
        ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="w-fit cursor-help underline decoration-dotted decoration-fg-tertiary/50 underline-offset-4" />
              }
            >
              {label}
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">{row.description}</TooltipContent>
          </Tooltip>
        )
        : label}
      {!row.tooltip && row.description !== undefined && (
        <span className={cn("text-caption text-fg-tertiary", row.disabled && "text-fg-disabled")}>
          {row.description}
        </span>
      )}
    </div>
  )
  const trailing = row.action ?? (row.changes && <ResetButton {...row.changes} />)
  return (
    // The same padding above and below every row, so they sit evenly in their group; a wide control (a field, the tag
    // chips) has an edge of its own, so it gets a little more room below than text does.
    <div
      className={cn("group/row relative flex flex-col gap-2.5 py-3 pl-3", row.wide && row.control != null && "pb-4")}
    >
      {isModified(row) && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "absolute left-1 size-1.5 -translate-y-1/2 rounded-full bg-fg-tertiary",
                  row.wide ? "top-[1.3rem]" : "top-1/2"
                )}
                aria-label="Changed from default"
              />
            }
          />
          <TooltipContent side="left">Changed from default</TooltipContent>
        </Tooltip>
      )}
      {row.wide
        ? (
          <>
            <div className="flex items-start gap-4">
              {text}
              {trailing}
            </div>
            {/* Clear of the reset button's column; a row-specific action takes its place instead. */}
            {row.control != null && (
              <div className={cn(row.changes && row.action === undefined && "pr-8")}>{row.control}</div>
            )}
          </>
        )
        : (
          <div className={cn("flex min-h-7 gap-6", row.icon == null ? "items-center" : "items-start")}>
            {row.icon == null ? text : (
              <div className="flex min-w-0 flex-1 items-start gap-2">
                {row.icon}
                {text}
              </div>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {row.control}
              {trailing}
            </div>
          </div>
        )}
    </div>
  )
}

/**
 * Desktop-style settings: category nav with search on the left, the category's rows on the
 * right, a footer with an optional "reset category" and Done. Changes apply as they are made.
 */
export function SettingsShell<C extends string>(props: {
  readonly open: boolean
  readonly onClose: () => void
  /** The dialog's name, the first breadcrumb ("Settings", "Project settings"). */
  readonly title: string
  /** The breadcrumbs between the title and the page ("Harbor Loop"): the shell draws every separator. A search has its own. */
  readonly crumbs?: ReadonlyArray<string>
  /** For screen readers: what these settings are. */
  readonly description: string
  readonly categories: ReadonlyArray<SettingsCategoryInfo<C>>
  readonly category: C
  readonly onCategoryChange: (category: C) => void
  readonly rows: ReadonlyArray<SettingsRow<C>>
  /** Resets the shown category; without it the footer has no reset button, and searching hides the button. */
  readonly onResetCategory?: (category: C) => void
  /** What the shown category adds to the footer, before Done (Check again); searching shows no category, so not then. */
  readonly footerAction?: ReactNode
  /** Keeps the dialog open and Done disabled (e.g. while a keybind is being captured). */
  readonly busy?: boolean
}) {
  const [query, setQuery] = useState("")
  /** While searching, a category narrows the results; null shows every match. */
  const [scope, setScope] = useState<C | null>(null)
  const labelOf = (category: C) => props.categories.find((c) => c.id === category)?.label ?? category

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  const searching = terms.length > 0
  const matches = (r: SettingsRow<C>) =>
    terms.every((t) =>
      `${r.label} ${typeof r.description === "string" ? r.description : ""} ${
        typeof r.info === "string" ? r.info : ""
      } ${r.group ?? ""} ${r.keywords ?? ""} ${labelOf(r.category)}`
        .toLowerCase()
        .includes(t)
    )
  const matched = searching ? props.rows.filter(matches) : []
  const hitsPerCategory = new Map<C, number>()
  for (const r of matched) hitsPerCategory.set(r.category, (hitsPerCategory.get(r.category) ?? 0) + 1)
  const visible = searching
    ? matched.filter((r) => scope === null || r.category === scope)
    : props.rows.filter((r) => r.category === props.category)

  // Group: by category when searching, then by sub-group (keybind sections).
  const groups: Array<{ key: string; title: string | undefined; rows: Array<SettingsRow<C>> }> = []
  for (const row of visible) {
    const title = searching
      ? [labelOf(row.category), row.group].filter(Boolean).join(" › ")
      : row.group
    const last = groups.at(-1)
    if (last !== undefined && last.title === title) last.rows.push(row)
    else groups.push({ key: `${row.category}-${title ?? ""}`, title, rows: [row] })
  }

  // What the right side is showing. Base UI measures a scroll area when its viewport resizes, not when its content does,
  // so each page gets its own: a short page after a long one would otherwise keep the long one's scrollbar.
  const page = searching ? `search:${scope ?? ""}:${query}` : `category:${props.category}`

  const trail = searching ? ["Search"] : props.crumbs ?? []

  const modifiedIn = (category: C) => props.rows.some((r) => r.category === category && isModified(r))
  const { onResetCategory } = props

  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && props.busy !== true && props.onClose()}>
      <DialogContent className="flex h-[min(80vh,720px)] w-full gap-0 overflow-hidden p-0 sm:max-w-4xl" showCloseButton>
        <nav className="flex w-56 shrink-0 flex-col bg-muted/30 p-3">
          <div className="relative mb-2">
            <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-secondary" />
            <Input
              className="pl-7"
              placeholder="Search settings"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setScope(null)
              }}
              aria-label="Search settings"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {/* the search stays put; the categories scroll when there are more than fit (a project with many maps) */}
          <ScrollArea className="-mx-3 min-h-0 flex-1">
            <div className="flex flex-col gap-1 px-3 pb-px">
              {searching && (
                <Button
                  variant="ghost"
                  className={cn("justify-between", scope === null && SELECTED)}
                  onClick={() => setScope(null)}
                >
                  <span>All results</span>
                  <span className="text-caption text-fg-tertiary tabular-nums">{matched.length}</span>
                </Button>
              )}
              {props.categories.map(({ id, label, icon: CategoryIcon, section }, i) => {
                const hits = hitsPerCategory.get(id) ?? 0
                const active = searching ? scope === id : props.category === id
                const heading = section !== undefined && section !== props.categories[i - 1]?.section
                return (
                  <Fragment key={id}>
                    {heading && (
                      <div className="mt-2 px-2 pb-0.5 text-caption uppercase tracking-wider text-fg-secondary">
                        {section}
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      className={cn("justify-start", active && SELECTED)}
                      disabled={searching && hits === 0}
                      onClick={() => {
                        if (searching) setScope(id)
                        else props.onCategoryChange(id)
                      }}
                      data-category={id}
                    >
                      <CategoryIcon />
                      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                      {searching
                        ? hits > 0 && (
                          <span className="rounded-full bg-muted px-1.5 text-caption text-fg-secondary tabular-nums">
                            {hits}
                          </span>
                        )
                        : modifiedIn(id) && (
                          <span className="size-1.5 rounded-full bg-fg-tertiary" aria-label="Has changed settings" />
                        )}
                    </Button>
                  </Fragment>
                )
              })}
            </div>
          </ScrollArea>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="px-dialog py-3">
            <Breadcrumb>
              <BreadcrumbList className="text-title">
                <BreadcrumbItem>
                  <DialogTitle className="text-fg-secondary">{props.title}</DialogTitle>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                {trail.map((crumb) => (
                  <Fragment key={crumb}>
                    <BreadcrumbItem className="min-w-0">
                      <span className="truncate">{crumb}</span>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </Fragment>
                ))}
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">
                    {searching ? `“${query.trim()}”` : labelOf(props.category)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <DialogDescription className="sr-only">{props.description}</DialogDescription>
          </div>
          <ScrollArea key={page} className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-dialog py-3">
              {groups.map((group) => (
                <section key={group.key} className="flex flex-col">
                  {group.title !== undefined && group.title !== "" && (
                    <h3 className="mb-1 text-caption uppercase tracking-wider text-fg-secondary">{group.title}</h3>
                  )}
                  <div className="flex flex-col rounded-surface bg-muted/40 pr-3">
                    {group.rows.map((row) => <RowView key={row.id} row={row} />)}
                  </div>
                </section>
              ))}
              {groups.length === 0 && <p className="text-body text-fg-tertiary">No settings match.</p>}
            </div>
          </ScrollArea>
          <div className="flex px-dialog py-3">
            {/* Search results span every category, and a reset names one: it comes back with the page. */}
            {onResetCategory !== undefined && !searching && (
              <Button
                variant="ghost"
                className="text-fg-secondary"
                onClick={() => onResetCategory(props.category)}
                disabled={!modifiedIn(props.category)}
              >
                Reset {labelOf(props.category).toLowerCase()} to defaults
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {!searching && props.footerAction}
              <Button onClick={props.onClose} disabled={props.busy === true}>Done</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
