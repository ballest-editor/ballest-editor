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
import { type ReactNode, useState } from "react"

/** One searchable setting. `group` is a sub-heading inside the category (keybind sections). */
export interface SettingsRow<C extends string> {
  readonly id: string
  readonly category: C
  readonly group?: string
  readonly label: string
  readonly description?: string
  /** Description shown as a hover tooltip on the label instead of under it. */
  readonly tooltip?: boolean
  /** More text the search matches (e.g. the choices inside the control). */
  readonly keywords?: string
  readonly disabled?: boolean
  /** Differs from its default; `reset` puts it back. */
  readonly modified: boolean
  readonly reset: () => void
  /** The control goes under the label at full width instead of beside it. */
  readonly wide?: boolean
  readonly control: ReactNode
}

export interface SettingsCategoryInfo<C extends string> {
  readonly id: C
  readonly label: string
  readonly icon: Icon
}

function ResetButton({ row }: { readonly row: SettingsRow<string> }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("size-6 text-muted-foreground", !row.modified && "invisible")}
            onClick={row.reset}
            aria-label="Reset to default"
            tabIndex={row.modified ? 0 : -1}
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
  return (
    <div className="group/row relative flex min-h-9 flex-col gap-2 py-1 pl-3">
      {row.modified && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "absolute left-0 size-1.5 -translate-y-1/2 rounded-full bg-primary",
                  row.wide ? "top-4" : "top-1/2"
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
              <ResetButton row={row} />
            </div>
            <div className="pr-8 pb-1">{row.control}</div>
          </>
        )
        : (
          <div className="flex min-h-7 items-center gap-4">
            {text}
            <div className="flex shrink-0 items-center gap-2">
              {row.control}
              <ResetButton row={row} />
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
  /** For screen readers: what these settings are. */
  readonly description: string
  readonly categories: ReadonlyArray<SettingsCategoryInfo<C>>
  readonly category: C
  readonly onCategoryChange: (category: C) => void
  readonly rows: ReadonlyArray<SettingsRow<C>>
  /** Resets the shown category; without it the footer has no reset button. */
  readonly onResetCategory?: (category: C) => void
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
      `${r.label} ${r.description ?? ""} ${r.group ?? ""} ${r.keywords ?? ""} ${labelOf(r.category)}`
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

  const modifiedIn = (category: C) => props.rows.some((r) => r.category === category && r.modified)
  const { onResetCategory } = props

  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && props.busy !== true && props.onClose()}>
      <DialogContent className="flex h-[min(80vh,720px)] w-full gap-0 overflow-hidden p-0 sm:max-w-4xl" showCloseButton>
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r bg-muted/30 p-3">
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
          {props.categories.map(({ id, label, icon: CategoryIcon }) => {
            const hits = hitsPerCategory.get(id) ?? 0
            const active = searching ? scope === id : props.category === id
            return (
              <Button
                key={id}
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
                <span className="flex-1 text-left">{label}</span>
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
            )
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b px-5 py-3">
            <Breadcrumb>
              <BreadcrumbList className="text-sm">
                <BreadcrumbItem>
                  <DialogTitle className="font-normal text-muted-foreground">{props.title}</DialogTitle>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                {searching && (
                  <>
                    <BreadcrumbItem>Search</BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-medium">
                    {searching ? `“${query.trim()}”` : labelOf(props.category)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <DialogDescription className="sr-only">{props.description}</DialogDescription>
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
            className={cn("flex border-t px-5 py-3", onResetCategory === undefined ? "justify-end" : "justify-between")}
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
            <Button onClick={props.onClose} disabled={props.busy === true}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
