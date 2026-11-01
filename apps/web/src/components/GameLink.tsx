import { IconChevronRight, IconCircleCheck, IconCircleDashed, IconCircleX, IconRefresh } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"
import { type ComponentType, useState } from "react"
import {
  allFound,
  type GameLinkFix,
  type GameLinkRow,
  gameLinkRows,
  type GameLinkRowState,
  PLUGIN_MANAGER_URL
} from "../domain/gameLink"
import {
  chooseGameLinkFolder,
  installPlugin,
  openExternalLink,
  refreshGameLink,
  revealGamePath
} from "../editor/actions"
import { useCreator, useEditor } from "../editor/store"

const ICONS: Record<GameLinkRowState, ComponentType<{ readonly className?: string }>> = {
  ok: IconCircleCheck,
  missing: IconCircleX,
  waiting: IconCircleDashed
}

const TONES: Record<GameLinkRowState, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  missing: "text-destructive",
  waiting: "text-muted-foreground"
}

function StateIcon({ state, className }: { readonly state: GameLinkRowState; readonly className?: string }) {
  const Icon = ICONS[state]
  return <Icon className={cn("size-3.5 shrink-0", TONES[state], className)} />
}

function FixButton({ fix, state }: { readonly fix: GameLinkFix; readonly state: GameLinkRowState }) {
  const openDialog = useEditor((s) => s.openDialog)
  const [busy, setBusy] = useState(false)
  switch (fix._tag) {
    case "ChooseFolder":
      return <Button size="sm" onClick={() => void chooseGameLinkFolder(fix.which)}>Choose folder…</Button>
    case "OpenPluginDocs":
      return <Button size="sm" onClick={() => void openExternalLink(PLUGIN_MANAGER_URL)}>Install docs</Button>
    case "InstallPlugin":
      return (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void installPlugin().finally(() => setBusy(false))
          }}
        >
          {fix.update ? "Update" : "Install"}
        </Button>
      )
    case "EditCreator":
      return (
        <Button
          variant={state === "ok" ? "outline" : "default"}
          size="sm"
          onClick={() => openDialog("settings", "general")}
        >
          {state === "ok" ? "Change…" : "Set name…"}
        </Button>
      )
  }
}

function ChecklistRow({ row }: { readonly row: GameLinkRow }) {
  const problem = useEditor((s) => s.gamePathProblem?.which === row.id ? s.gamePathProblem.message : null)
  const { reveal } = row
  return (
    <li className="grid grid-cols-[auto_7rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2">
      <StateIcon state={problem === null ? row.state : "missing"} className="mt-px" />
      <span className="text-muted-foreground">{row.label}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("font-medium", row.state === "waiting" && "font-normal text-muted-foreground")}>
          {row.title}
        </span>
        {row.note !== null && <span className="text-muted-foreground">{row.note}</span>}
        {row.path !== null && (
          <span
            className="truncate text-left font-mono text-[0.6875rem] text-muted-foreground"
            dir="rtl"
            title={row.path}
          >
            {/* rtl so a long path is cut at its start: the folder itself is at the end */}
            <bdi>{row.path}</bdi>
          </span>
        )}
        {problem !== null && <span className="text-destructive">{problem}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        {reveal !== null && (
          <Button variant="outline" size="sm" onClick={() => void revealGamePath(reveal)}>Reveal</Button>
        )}
        {row.fix !== null && <FixButton fix={row.fix} state={row.state} />}
      </div>
    </li>
  )
}

/** The collapsed row: one mark per item ("✓ game ✓ maps ✓ creator Isaac ✗ plugin manager"). */
function Summary({ rows }: { readonly rows: ReadonlyArray<GameLinkRow> }) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      {rows.map((row) => (
        <span key={row.id} className="inline-flex items-center gap-1 whitespace-nowrap">
          <StateIcon state={row.state} />
          {row.short}
        </span>
      ))}
    </span>
  )
}

/**
 * The Start tab's Game link (docs/PROJECTS.md § Shell, desktop): the game's install, its maps folder, the creator
 * name, the plugin manager and the editor's plugin, each with its path and, when missing, its fix. Expanded on the
 * first launch and while something is missing; once everything is found, one summary row that expands.
 */
export function GameLink() {
  const paths = useEditor((s) => s.gamePaths)
  const plugin = useEditor((s) => s.pluginStatus)
  const firstRun = useEditor((s) => s.gameLink.firstRun)
  const creator = useCreator()
  const rows = gameLinkRows(paths, plugin, creator)
  const looking = paths === null || plugin === null
  const found = allFound(rows)
  // The user's expand / collapse holds until the result changes between all found and not.
  const [choice, setChoice] = useState<{ readonly open: boolean; readonly found: boolean } | null>(null)
  const open = !looking && (choice?.found === found ? choice.open : firstRun || !found)

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setChoice({ open: next, found })}
      render={<section aria-labelledby="start-game-link" className="rounded-lg border" />}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <CollapsibleTrigger
          disabled={looking}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <h2 id="start-game-link" className="shrink-0 text-sm font-medium">Game link</h2>
          {looking
            ? <span className="text-muted-foreground">Looking for the game…</span>
            : open
            ? (
              <span className="text-muted-foreground">
                {found
                  ? "Everything Export, Launch game and Play need is here."
                  : "Export, Launch game and Play need these."}
              </span>
            )
            : <Summary rows={rows} />}
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Check again"
          title="Check again"
          onClick={() => void refreshGameLink()}
        >
          <IconRefresh />
        </Button>
      </div>
      <CollapsibleContent>
        <ul className="flex flex-col border-t py-1">{rows.map((row) => <ChecklistRow key={row.id} row={row} />)}</ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
