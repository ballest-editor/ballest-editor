import { IconCircleCheck, IconCircleDashed, IconCircleX, IconRefresh, IconRestore } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ComponentType, useState } from "react"
import {
  anythingMissing,
  type GameFolderKind,
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
  resetGamePaths,
  revealGamePath
} from "../editor/actions"
import { useCreator, useEditor } from "../editor/store"

const ICONS: Record<GameLinkRowState, ComponentType<{ readonly className?: string }>> = {
  ok: IconCircleCheck,
  missing: IconCircleX,
  optional: IconCircleDashed,
  waiting: IconCircleDashed
}

const TONES: Record<GameLinkRowState, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  missing: "text-destructive",
  optional: "text-muted-foreground",
  waiting: "text-muted-foreground"
}

function StateIcon({ state, className }: { readonly state: GameLinkRowState; readonly className?: string }) {
  const Icon = ICONS[state]
  return <Icon className={cn("size-3.5 shrink-0", TONES[state], className)} />
}

/**
 * A row's fix. Only a missing row's is filled: on a row that is fine it changes what was found (Change…), and the
 * optional plugin manager's is quiet, since nothing is wrong without it.
 */
function FixButton({ fix, state }: { readonly fix: GameLinkFix; readonly state: GameLinkRowState }) {
  const openDialog = useEditor((s) => s.openDialog)
  const [busy, setBusy] = useState(false)
  switch (fix._tag) {
    case "ChooseFolder":
      return (
        <Button
          variant={state === "missing" ? "default" : "outline"}
          size="sm"
          onClick={() => void chooseGameLinkFolder(fix.which)}
        >
          {state === "ok" ? "Change…" : "Choose folder…"}
        </Button>
      )
    case "OpenPluginDocs":
      return (
        <Button variant="outline" size="sm" onClick={() => void openExternalLink(PLUGIN_MANAGER_URL)}>
          Install docs
        </Button>
      )
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
          onClick={() => openDialog({ id: "settings", category: "general" })}
        >
          {state === "ok" ? "Change…" : "Set name…"}
        </Button>
      )
  }
}

/** Back to the folder found through Steam, for one chosen here instead (Settings' reset). */
function ResetButton({ which }: { readonly which: GameFolderKind }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => void resetGamePaths([which])}
            aria-label="Use the folder Steam knows about"
          />
        }
      >
        <IconRestore />
      </TooltipTrigger>
      <TooltipContent>Use the folder Steam knows about</TooltipContent>
    </Tooltip>
  )
}

/** The folder a row's Choose folder… or Change… picks, whose refusal shows on that row. */
const chosenFolder = (row: GameLinkRow): GameFolderKind | null => {
  for (const fix of row.fixes) if (fix._tag === "ChooseFolder") return fix.which
  return null
}

function ChecklistRow({ row, framed }: { readonly row: GameLinkRow; readonly framed: boolean }) {
  const folder = chosenFolder(row)
  const problem = useEditor((s) => s.gamePathProblem?.which === folder ? s.gamePathProblem.message : null)
  const { reveal, reset } = row
  return (
    <li className={cn("grid grid-cols-[auto_7rem_minmax(0,1fr)_auto] items-start gap-x-3 py-2", framed && "px-4")}>
      <StateIcon state={problem === null ? row.state : "missing"} className="mt-px" />
      <span className="text-muted-foreground">{row.label}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "font-medium",
            (row.state === "waiting" || row.state === "optional") && "font-normal text-muted-foreground"
          )}
        >
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
        {row.fixes.map((fix) => <FixButton key={fix._tag} fix={fix} state={row.state} />)}
        {reset !== null && <ResetButton which={reset} />}
      </div>
    </li>
  )
}

/** What the checklist says over its rows: looking, all there, or what is still needed. */
export function useGameLinkSummary(): string {
  const paths = useEditor((s) => s.gamePaths)
  const plugin = useEditor((s) => s.pluginStatus)
  const creator = useCreator()
  if (paths === null || plugin === null) return "Looking for the game…"
  return anythingMissing(gameLinkRows(paths, plugin, creator))
    ? "Export, Launch game and Play need these."
    : "Everything Export and Launch game need is here."
}

/**
 * The Game link checklist's rows (docs/PROJECTS.md § Shell, desktop): the game's install, its maps folder, the creator
 * name, the plugin manager and the editor's plugin, each with its path and, when missing, its fix. A folder can be
 * changed, and one chosen here reset to the one Steam knows about. The plugin manager is optional: only Play needs it.
 * Framed, they are padded for `GameLinkChecklist`'s box; unframed (Settings › Game), they sit flush between dividers
 * like the other settings.
 */
export function GameLinkRows({ framed }: { readonly framed: boolean }) {
  const paths = useEditor((s) => s.gamePaths)
  const plugin = useEditor((s) => s.pluginStatus)
  const creator = useCreator()
  const rows = gameLinkRows(paths, plugin, creator)
  return (
    <ul className={cn("flex flex-col text-xs", framed ? "py-1" : "divide-y divide-border/50")}>
      {rows.map((row) => <ChecklistRow key={row.id} row={row} framed={framed} />)}
    </ul>
  )
}

/** Looks the folders, the plugin and the creator up again. */
export function CheckAgainButton({ size = "sm" }: { readonly size?: "xs" | "sm" }) {
  return (
    <Button variant="ghost" size={size} className="text-muted-foreground" onClick={() => void refreshGameLink()}>
      <IconRefresh data-icon="inline-start" />
      Check again
    </Button>
  )
}

/** The checklist in its own box with Check again under it, as File › Game link… shows it. */
export function GameLinkChecklist() {
  return (
    <div className="flex flex-col rounded-lg border">
      <GameLinkRows framed />
      <div className="flex items-center justify-end border-t px-2 py-1">
        <CheckAgainButton />
      </div>
    </div>
  )
}
