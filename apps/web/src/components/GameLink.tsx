import {
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconFolderOpen,
  IconPencil,
  IconRefresh
} from "@tabler/icons-react"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ComponentType, Fragment, useState } from "react"
import {
  anythingMissing,
  type GameFolderKind,
  type GameLinkFix,
  type GameLinkRow,
  gameLinkRows,
  type GameLinkRowState,
  pathCrumbs,
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
import { type SettingsCategory, useCreator, useEditor } from "../editor/store"
import { CopyPathAction, PathAction } from "./PathText"
import type { SettingsRow } from "./SettingsShell"

const ICONS: Record<GameLinkRowState, ComponentType<{ readonly className?: string }>> = {
  ok: IconCircleCheck,
  missing: IconCircleX,
  optional: IconCircleDashed,
  waiting: IconCircleDashed
}

/** The theme's status colours. Each falls back to a token that is always there, so a row never loses its icon. */
const TONES: Record<GameLinkRowState, string> = {
  ok: "text-status-ok-foreground",
  missing: "text-status-warn-foreground",
  optional: "text-status-neutral-foreground",
  waiting: "text-status-neutral-foreground"
}

/** On the label's line: the icon is 16px, the line 20px. */
function StateIcon({ state }: { readonly state: GameLinkRowState }) {
  const Icon = ICONS[state]
  return <Icon className={cn("mt-0.5 size-4 shrink-0", TONES[state])} />
}

/**
 * A row's fix. On a row that is fine it is an icon button, which changes what was found; on one that isn't it says what
 * it does, filled when the row is missing and quiet on the optional plugin manager, since nothing is wrong without it.
 */
function FixButton({ fix, state }: { readonly fix: GameLinkFix; readonly state: GameLinkRowState }) {
  const openDialog = useEditor((s) => s.openDialog)
  const [busy, setBusy] = useState(false)
  const found = state === "ok"
  switch (fix._tag) {
    case "ChooseFolder":
      return found
        ? (
          <PathAction
            label="Choose folder…"
            icon={IconPencil}
            onClick={() => void chooseGameLinkFolder(fix.which)}
          />
        )
        : (
          <Button
            variant={state === "missing" ? "default" : "outline"}
            onClick={() => void chooseGameLinkFolder(fix.which)}
          >
            Choose folder…
          </Button>
        )
    case "OpenPluginDocs":
      return <Button variant="outline" onClick={() => void openExternalLink(PLUGIN_MANAGER_URL)}>Install docs</Button>
    case "InstallPlugin":
      return (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void installPlugin().finally(() => setBusy(false))
          }}
        >
          {fix.label}
        </Button>
      )
    case "EditCreator": {
      const edit = () => openDialog({ id: "settings", category: "general" })
      return found
        ? <PathAction label="Change in Settings › General" icon={IconPencil} onClick={edit} />
        : <Button onClick={edit}>Set name…</Button>
    }
  }
}

/** The folder a row's Choose folder… or Change… picks, whose refusal shows on that row. */
const chosenFolder = (row: GameLinkRow): GameFolderKind | null => {
  for (const fix of row.fixes) if (fix._tag === "ChooseFolder") return fix.which
  return null
}

/** A row's folder as a trail of its names, the whole path in the tooltip. */
function PathCrumbs({ path }: { readonly path: string }) {
  const crumbs = pathCrumbs(path)
  return (
    <Tooltip>
      <TooltipTrigger render={<Breadcrumb className="w-fit max-w-full min-w-0" aria-label={path} />}>
        <BreadcrumbList className="flex-nowrap gap-1 text-caption text-fg-tertiary">
          {crumbs.map((crumb, index) => (
            // the trail so far, because a path can name a folder twice
            <Fragment key={crumbs.slice(0, index + 1).join("/")}>
              {index > 0 && <BreadcrumbSeparator>›</BreadcrumbSeparator>}
              <BreadcrumbItem className="min-w-0">
                <span className="truncate">{crumb}</span>
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </TooltipTrigger>
      <TooltipContent className="break-all">{path}</TooltipContent>
    </Tooltip>
  )
}

/** Copy, Reveal and the row's fixes, in one line at the right of the row. */
function RowActions({ row }: { readonly row: GameLinkRow }) {
  const { path, reveal } = row
  return (
    <>
      {path !== null && <CopyPathAction path={path} />}
      {reveal !== null && (
        <PathAction
          label="Reveal in file manager"
          icon={IconFolderOpen}
          onClick={() => void revealGamePath(reveal)}
        />
      )}
      {row.fixes.map((fix) => <FixButton key={fix._tag} fix={fix} state={row.state} />)}
    </>
  )
}

const useGameLinkRows = (): ReadonlyArray<GameLinkRow> => {
  const paths = useEditor((s) => s.gamePaths)
  const plugin = useEditor((s) => s.pluginStatus)
  const creator = useCreator()
  return gameLinkRows(paths, plugin, creator)
}

/** What the Game link dialog says over its rows: looking, all there, or what is still needed. */
export function useGameLinkSummary(): string {
  const rows = useGameLinkRows()
  const looking = useEditor((s) => s.gamePaths === null || s.pluginStatus === null)
  if (looking) return "Looking for the game…"
  return anythingMissing(rows)
    ? "Export, Open game and Play need these."
    : "Everything Export and Open game need is here."
}

const KEYWORDS =
  "steam proton install folder path UserSavedMaps maps plugins plugin manager ballest-editor-link editor plugin play update version"

/**
 * Settings › Game (docs/DESKTOP.md § Game link), the Game link's home: the game's install, its maps folder, the creator
 * name, the plugin manager and the editor plugin, each a settings row with its state, its status in one line, its path
 * as a breadcrumb under that, and Copy, Reveal and its fix at the right. A folder chosen here has the row's reset, which
 * looks up the one Steam knows about.
 */
export function useGameLinkSettings(): ReadonlyArray<SettingsRow<SettingsCategory>> {
  const rows = useGameLinkRows()
  const pathProblem = useEditor((s) => s.gamePathProblem)
  return rows.map((row) => {
    const { note, path, reset } = row
    const problem = pathProblem !== null && pathProblem.which === chosenFolder(row) ? pathProblem.message : null
    return {
      id: `game-${row.id}`,
      category: "game",
      icon: <StateIcon state={problem === null ? row.state : "missing"} />,
      label: row.label,
      description: problem === null ? row.status : <span className="text-destructive">{problem}</span>,
      ...(note !== null && { info: note }),
      ...(path !== null && { detail: <PathCrumbs path={path} /> }),
      keywords: `${KEYWORDS} ${row.title} ${path ?? ""}`,
      changes: {
        modified: reset !== null,
        reset: () => {
          if (reset !== null) void resetGamePaths([reset])
        }
      },
      control: <RowActions row={row} />
    }
  })
}

/** The rows that are missing, each with what is wrong. Empty when the dialog opens with everything found. */
export function MissingGameLinkRows() {
  const missing = useGameLinkRows().filter((row) => row.state === "missing")
  if (missing.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {missing.map((row) => (
        <li key={row.id} className="flex items-start gap-2">
          <StateIcon state={row.state} />
          <div className="flex min-w-0 flex-col">
            <span className="text-body-strong">{row.label}</span>
            <span className="text-caption text-fg-tertiary">{row.title}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Looks the folders, the plugin and the creator up again. */
export function CheckAgainButton() {
  return (
    <Button variant="secondary" onClick={() => void refreshGameLink()}>
      <IconRefresh data-icon="inline-start" />
      Check again
    </Button>
  )
}
