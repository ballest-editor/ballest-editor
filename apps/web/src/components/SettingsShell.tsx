import { type Icon, IconRestore, IconSearch } from "@tabler/icons-react"
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

/** One searchable setting. `group` is a sub-heading inside the category (keybind sections). */
export interface SettingsRow<C extends string> {
  readonly id: string
  readonly category: C
  readonly group?: string
  readonly label: string
  /** Under the label; a string is searched too, a node (a path on its own line) needs `keywords` for that. */
  readonly description?: ReactNode
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
            className={cn("size-6 text-muted-foreground", !modified && "invisible")}
            onClick={reset}
            aria-label="Reset to default"
            tabIndex={modified ? 0 : -1}
          />
        }
      >
        <IconRestore className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="left">Reset to default</TooltipContent>
    </Tooltip>
  )
}

function RowView({ row }: { readonly row: SettingsRow<string> }) {
  const label = (
    <span className={cn("text-xs font-medium", row.disabled && "text-muted-foreground")}>
      {row.label}
    </span>
  )
  const text = (
    <div className="flex min-w-0 flex-1 flex-col">
      {row.tooltip && row.description !== undefined
        ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="w-fit cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4" />
              }
            >
              {label}
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">{row.description}</TooltipContent>
          </Tooltip>
        )
        : label}
      {!row.tooltip && row.description !== undefined && (
        <span className={cn("text-[0.7rem] text-muted-foreground", row.disabled && "opacity-60")}>
          {row.description}
        </span>
      )}
    </div>
  )
  const trailing = row.action ?? (row.changes && <ResetButton {...row.changes} />)
  return (
    // The same padding above and below every row, so the dividers sit evenly between them; a wide control (a field, the
    // tag chips) has an edge of its own, so it gets a little more room before the divider than text does.
    <div
      className={cn("group/row relative flex flex-col gap-2.5 py-3 pl-3", row.wide && row.control != null && "pb-4")}
    >
      {isModified(row) && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "absolute left-0 size-1.5 -translate-y-1/2 rounded-full bg-primary",
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
          <div className="flex min-h-7 items-center gap-6">
            {text}
            <div className="flex shrink-0 items-center gap-2">
              {row.control}
              {trailing}
            </div>
          </div>
        )}
    </div>
  )
}

interface SettingsContentProps<C extends string> {
  /** The settings' name, the first breadcrumb ("Settings", "Project settings"). */
  readonly title: string
  readonly categories: ReadonlyArray<SettingsCategoryInfo<C>>
  readonly category: C
  readonly onCategoryChange: (category: C) => void
  readonly rows: ReadonlyArray<SettingsRow<C>>
  /** Resets the shown category; without it the footer has no reset button. */
  readonly onResetCategory?: (category: C) => void
}

/** Category nav with search on the left, the category's rows on the right. Changes apply as they are made. */
function SettingsContent<C extends string>(
  props: SettingsContentProps<C> & {
    /** `title`, as the first breadcrumb: a dialog names itself with it. */
    readonly heading: ReactNode
    /** Under the breadcrumbs, for screen readers. */
    readonly description?: ReactNode
    /** What the footer holds on its right (the dialog's Done). */
    readonly footerEnd?: ReactNode
  }
) {
  const [query, setQuery] = useState("")
  /** While searching, a category narrows the results; null shows every match. */
  const [scope, setScope] = useState<C | null>(null)
  const labelOf = (category: C) => props.categories.find((c) => c.id === category)?.label ?? category

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  const searching = terms.length > 0
  const matches = (r: SettingsRow<C>) =>
    terms.every((t) =>
      `${r.label} ${typeof r.description === "string" ? r.description : ""} ${r.group ?? ""} ${r.keywords ?? ""} ${
        labelOf(r.category)
      }`
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

  const modifiedIn = (category: C) => props.rows.some((r) => r.category === category && isModified(r))
  const { onResetCategory } = props

  return (
    <>
      <nav className="flex w-56 shrink-0 flex-col border-r bg-muted/30 p-3">
        <div className="relative mb-2">
          <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-7"
            placeholder="Search settings"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setScope(null)
            }}
            aria-label="Search settings"
          />
        </div>
        {/* the search stays put; the categories scroll when there are more than fit (a project with many maps) */}
        <ScrollArea className="-mx-3 min-h-0 flex-1">
          <div className="flex flex-col gap-1 px-3 pb-px">
            {searching && (
              <Button
                variant={scope === null ? "secondary" : "ghost"}
                className="justify-between"
                onClick={() => setScope(null)}
              >
                <span>All results</span>
                <span className="text-[0.65rem] text-muted-foreground tabular-nums">{matched.length}</span>
              </Button>
            )}
            {props.categories.map(({ id, label, icon: CategoryIcon, section }, i) => {
              const hits = hitsPerCategory.get(id) ?? 0
              const active = searching ? scope === id : props.category === id
              const heading = section !== undefined && section !== props.categories[i - 1]?.section
              return (
                <Fragment key={id}>
                  {heading && (
                    <div className="mt-2 px-2 pb-0.5 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">
                      {section}
                    </div>
                  )}
                  <Button
                    variant={active ? "secondary" : "ghost"}
                    className={cn("justify-start", searching && hits === 0 && "text-muted-foreground/50")}
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
                        <span className="rounded-full bg-primary/15 px-1.5 text-[0.65rem] text-primary tabular-nums">
                          {hits}
                        </span>
                      )
                      : modifiedIn(id) && (
                        <span className="size-1.5 rounded-full bg-primary" aria-label="Has changed settings" />
                      )}
                  </Button>
                </Fragment>
              )
            })}
          </div>
        </ScrollArea>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b px-5 py-3">
          <Breadcrumb>
            <BreadcrumbList className="text-sm">
              <BreadcrumbItem>
                {props.heading}
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              {searching && (
                <>
                  <BreadcrumbItem>Search</BreadcrumbItem>
                  <BreadcrumbSeparator />
                </>
              )}
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate font-medium">
                  {searching ? `“${query.trim()}”` : labelOf(props.category)}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {props.description}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-5 py-3">
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col">
                {group.title !== undefined && group.title !== "" && (
                  <h3 className="mb-1 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">
                    {group.title}
                  </h3>
                )}
                <div className="flex flex-col divide-y divide-border/50">
                  {group.rows.map((row) => <RowView key={row.id} row={row} />)}
                </div>
              </section>
            ))}
            {groups.length === 0 && <p className="text-xs text-muted-foreground">No settings match.</p>}
          </div>
        </ScrollArea>
        <div
          className={cn(
            "flex border-t px-5 py-3 empty:hidden",
            onResetCategory === undefined ? "justify-end" : "justify-between"
          )}
        >
          {onResetCategory !== undefined && (
            <Button
              variant="outline"
              onClick={() => onResetCategory(props.category)}
              disabled={searching || !modifiedIn(props.category)}
            >
              Reset {labelOf(props.category).toLowerCase()} to defaults
            </Button>
          )}
          {props.footerEnd}
        </div>
      </div>
    </>
  )
}

/** Settings in a dialog (Project settings), with a Done button. */
export function SettingsShell<C extends string>(
  { open, onClose, description, ...content }: SettingsContentProps<C> & {
    readonly open: boolean
    readonly onClose: () => void
    /** For screen readers: what these settings are. */
    readonly description: string
  }
) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="flex h-[min(80vh,720px)] w-full gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton
      >
        <SettingsContent
          {...content}
          heading={<DialogTitle className="font-normal text-muted-foreground">{content.title}</DialogTitle>}
          description={<DialogDescription className="sr-only">{description}</DialogDescription>}
          footerEnd={<Button onClick={onClose}>Done</Button>}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Settings as a page of their own: the Settings panel fills its tab with this. */
export function SettingsPage<C extends string>(props: SettingsContentProps<C>) {
  return (
    <div className="flex h-full min-w-0 bg-background">
      <SettingsContent {...props} heading={<span className="text-muted-foreground">{props.title}</span>} />
    </div>
  )
}
