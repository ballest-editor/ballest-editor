/**
 * The lists of the welcome window and the project overview, after VS Code's Welcome page: a Start list of actions, each
 * with its key, and lists capped at a few rows with More… for the rest. The arrow keys move between rows, Enter opens.
 */
import { cn } from "@workspace/ui/lib/utils"
import { type KeyboardEvent, type ReactElement, type ReactNode, useState } from "react"
import { KeyChip } from "./KeyChip"
import { SectionTitle } from "./SectionTitle"

/** How many rows a list shows before More…. */
export const LIST_CAP = 5

/**
 * Up and Down move the focus to the row above or below: the button the row is. A row that holds a form instead, as New
 * project's does, is passed over.
 */
const moveBetweenRows = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
  const rows = [...event.currentTarget.children].flatMap((row) => {
    const button = row.querySelector<HTMLButtonElement>(":scope > button")
    return button === null ? [] : [button]
  })
  const at = rows.findIndex((button) => button === document.activeElement)
  const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)]
  if (at < 0 || next === undefined) return
  event.preventDefault()
  next.focus()
}

/** A titled section of a start page; `action` sits at the right of its title. */
export function StartSection({ action, children, className, title }: {
  readonly title: string
  readonly children: ReactNode
  readonly action?: ReactNode
  readonly className?: string
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <SectionTitle>{title}</SectionTitle>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A list of start actions or rows, moved through with the arrow keys. */
export function StartList({ children }: { readonly children: ReactNode }) {
  return <ul className="-mx-2 flex flex-col gap-0.5" onKeyDown={moveBetweenRows}>{children}</ul>
}

/** One start action: its icon, its name and, when it has one, its key. */
export function StartAction({ binding, disabled = false, icon, label, onClick, title }: {
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
  readonly binding?: string | undefined
  readonly disabled?: boolean
  readonly title?: string
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        title={title}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left transition-colors focus-ring enabled:hover:bg-hover enabled:active:bg-pressed disabled:text-fg-disabled [&>svg]:size-4 [&>svg]:shrink-0 enabled:[&>svg]:text-primary"
        onClick={onClick}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {binding !== undefined && <KeyChip binding={binding} />}
      </button>
    </li>
  )
}

/** `rows` in a `StartList`, the first `LIST_CAP` of them until More…; `empty` when there are none. */
export function CappedList({ empty, rows }: { readonly rows: ReadonlyArray<ReactElement>; readonly empty: ReactNode }) {
  const [all, setAll] = useState(false)
  if (rows.length === 0) return empty
  const hidden = rows.length - LIST_CAP
  return (
    <StartList>
      {all ? rows : rows.slice(0, LIST_CAP)}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            className="h-7 rounded-control px-2 text-fg-secondary transition-colors focus-ring hover:bg-hover hover:text-foreground"
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `More… (${hidden})`}
          </button>
        </li>
      )}
    </StartList>
  )
}
