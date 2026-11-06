import {
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconFolderOpen,
  IconFolderSearch,
  IconRefresh,
  IconRestore
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
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
import { PathAction, PathField } from "./PathText"

const ICONS: Record<GameLinkRowState, ComponentType<{ readonly className?: string }>> = {
  ok: IconCircleCheck,
  missing: IconCircleX,
  optional: IconCircleDashed,
  waiting: IconCircleDashed
}

const TONES: Record<GameLinkRowState, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  missing: "text-destructive",
  optional: "text-fg-tertiary",
  waiting: "text-fg-tertiary"
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

/** The folder a row's Choose folder… or Change… picks, whose refusal shows on that row. */
const chosenFolder = (row: GameLinkRow): GameFolderKind | null => {
  for (const fix of row.fixes) if (fix._tag === "ChooseFolder") return fix.which
  return null
}

/**
 * One row, in the settings rows' shape: the state icon, the row's name with what was found (or what is wrong) under
 * it, and its fix as a button at the right. A folder that is there shows as a `PathField` under that, with Reveal,
 * Change and (for one chosen here) reset as the field's icon actions, so the folder rows line up with Project
 * settings' Locations.
 */
function ChecklistRow({ row, framed }: { readonly row: GameLinkRow; readonly framed: boolean }) {
  const folder = chosenFolder(row)
  const problem = useEditor((s) => s.gamePathProblem?.which === folder ? s.gamePathProblem.message : null)
  const { reveal, reset } = row
  const quiet = row.state === "waiting" || row.state === "optional"
  // a folder that is there is changed from its field; its fix button only shows while it is missing
  const inField = row.state === "ok" && row.path !== null ? folder : null
  const buttons = row.fixes.filter((fix) => !(inField !== null && fix._tag === "ChooseFolder"))
  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 py-3",
        framed ? "px-4" : "first:pt-0 last:pb-0",
        row.path !== null && "pb-4 last:pb-1"
      )}
    >
      <div className="flex items-start gap-3">
        <StateIcon state={problem === null ? row.state : "missing"} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-strong">{row.label}</span>
          <span className={cn("text-caption text-fg-tertiary", quiet && "opacity-80")}>
            <span className={cn(!quiet && "text-foreground/80")}>{row.title}</span>
            {row.note !== null && `. ${row.note}`}
          </span>
          {problem !== null && <span className="text-caption text-destructive">{problem}</span>}
        </div>
        {buttons.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {buttons.map((fix) => <FixButton key={fix._tag} fix={fix} state={row.state} />)}
          </div>
        )}
      </div>
      {row.path !== null && (
        <div className="pl-[1.625rem]">
          <PathField
            path={row.path}
            actions={reveal === null && inField === null && reset === null ? undefined : (
              <>
                {reveal !== null && (
                  <PathAction
                    label="Reveal in file manager"
                    icon={IconFolderOpen}
                    onClick={() => void revealGamePath(reveal)}
                  />
                )}
                {inField !== null && (
                  <PathAction
                    label="Choose another folder…"
                    icon={IconFolderSearch}
                    onClick={() => void chooseGameLinkFolder(inField)}
                  />
                )}
                {reset !== null && (
                  <PathAction
                    label="Use the folder Steam knows about"
                    icon={IconRestore}
                    onClick={() => void resetGamePaths([reset])}
                  />
                )}
              </>
            )}
          />
        </div>
      )}
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
    <ul className={cn("flex flex-col divide-y divide-border/50 text-body", framed && "py-1")}>
      {rows.map((row) => <ChecklistRow key={row.id} row={row} framed={framed} />)}
    </ul>
  )
}

/** Looks the folders, the plugin and the creator up again. */
export function CheckAgainButton({ size = "sm" }: { readonly size?: "xs" | "sm" }) {
  return (
    <Button variant="ghost" size={size} className="text-fg-secondary" onClick={() => void refreshGameLink()}>
      <IconRefresh data-icon="inline-start" />
      Check again
    </Button>
  )
}

/** The checklist in its own box with Check again under it, as File › Game link… shows it. */
export function GameLinkChecklist() {
  return (
    <div className="flex min-h-0 flex-col rounded-surface border">
      {/* a column, so its viewport can shrink: the dialog has only a max height, which `size-full` can't resolve */}
      <ScrollArea className="flex min-h-0 flex-1 flex-col">
        <GameLinkRows framed />
      </ScrollArea>
      <div className="flex shrink-0 items-center justify-end border-t px-2 py-1">
        <CheckAgainButton />
      </div>
    </div>
  )
}
