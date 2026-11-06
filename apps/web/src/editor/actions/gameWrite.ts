/**
 * Export and Play's one write into the game's maps folder (docs/DESKTOP.md § Projects and maps): a saved project map is
 * exported, or exported and raced, and what main won't write over without asking (`ExportRefusal`) opens its dialog.
 * The dialogs' answers write again through it, for the same intent. Export to game and Play on the open map, which
 * save it first, are in `exportPlay`.
 */
import { ExportRefusal } from "@ballest/contracts"
import { Effect, Stream } from "effect"
import { mapLabelOf } from "../../domain/factory"
import {
  openInGameProblem,
  openWithoutPluginNotice,
  playWithoutPluginNotice,
  RESOLVED_BY_PLAY
} from "../../domain/gameLink"
import type { GameWrite } from "../../domain/linkState"
import { type ExportOptions, type OpenInGameResult, Platform, type PlayResult } from "../../services/Platform"
import { type PublishedDraft, useEditor } from "../store"
import { run, runUntilCleanup } from "./run"
import { notifyNotice, refreshProject, revealIn } from "./shared"
import { askSyncConflict } from "./syncConflict"

/**
 * What a write into the game is for: Export to game, Play (the export, then the plugin races the map), or Open in game
 * (the export, then the plugin opens it in the in-game editor).
 */
export type ExportIntent = PublishedDraft["from"]

/** Export and Play write over nothing they weren't told to: a published map's draft and a changed export ask first. */
export const ASK_FIRST: ExportOptions = { replacePublished: false, overwriteChanged: false }

/** `effect` with `write` in the store for the status bar's chip while it runs, whatever way it ends. */
export const showingGameWrite = (write: GameWrite) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.sync(() => useEditor.getState().setGameWrite(write)).pipe(
    Effect.andThen(effect),
    Effect.ensuring(Effect.sync(() => useEditor.getState().setGameWrite(null)))
  )

/** Moves the write under way on to each stage main reports of it, until interrupted. Another window's are not ours. */
export const followGameWritesEffect = Effect.gen(function*() {
  yield* (yield* Platform).gameWriteProgress.pipe(
    Stream.runForEach(({ fileName, stage }) =>
      Effect.sync(() => {
        const { gameWrite, setGameWrite } = useEditor.getState()
        if (gameWrite?.fileName === fileName) setGameWrite({ ...gameWrite, stage })
      })
    )
  )
})

/** Follows the stages main reports (`followGameWritesEffect`) until the returned function is called. */
export const followGameWrites = () =>
  runUntilCleanup(followGameWritesEffect, "Stopped following how far Export and Play have got")

/** Tells how Play went: racing, starting the game to race, or exported only because the plugin can't be reached. */
const notifyPlayed = (fileName: string, played: Extract<PlayResult, { readonly _tag: "Played" }>) => {
  const { notify, resolveNotifications } = useEditor.getState()
  const label = mapLabelOf(fileName)
  const { plugin, sent, launch } = played
  if (launch === "failed") {
    notify("error", `Exported ${label}, but couldn't ask Steam to start the game. Is Steam running?`, {
      kind: "play",
      actions: [revealIn("game")]
    })
  } else if (sent) {
    for (const kind of RESOLVED_BY_PLAY) resolveNotifications(kind)
    const outdated = plugin.status === "outdated" && !plugin.hostTooOld
    notify("info", launch === "running" ? `Racing ${label} in the game` : `Starting the game to race ${label}`, {
      kind: "play",
      ...(launch === "launched" && { body: "The race starts once the game and the plugin manager are up." }),
      ...(outdated && { actions: [{ label: "Update plugin", command: { _tag: "InstallPlugin" } }] })
    })
  } else {
    // the pinned notice is the standing problem, in the inbox; the click still gets its answer
    notify("info", `Exported ${label}, but Play can't race it. The notifications say why.`, { kind: "play" })
    notifyNotice(playWithoutPluginNotice(label, launch === "launched", plugin.status))
  }
}

/**
 * Tells how Open in game went, and keeps which map the in-game editor now has (`openedInGame`). A map the in-game
 * editor refused (`unsaved`) was still exported: the replaceInGame dialog asks whether to replace what's open there.
 */
const notifyOpening = (
  fileName: string,
  opening: Extract<OpenInGameResult, { readonly _tag: "Opening" }>,
  options: ExportOptions
) => {
  const { notify, resolveNotifications, openedInGame, setOpenedInGame, openDialog } = useEditor.getState()
  const label = mapLabelOf(fileName)
  const { launch, outcome, inGame } = opening
  const kind = "openInGame"
  if (launch === "failed") {
    notify("error", `Exported ${label}, but couldn't ask Steam to start the game. Is Steam running?`, {
      kind,
      actions: [revealIn("game")]
    })
    return
  }
  for (const resolved of RESOLVED_BY_PLAY) resolveNotifications(resolved)
  if (outcome === "unsaved") {
    openDialog({ id: "replaceInGame", name: fileName, inGame, replacePublished: options.replacePublished })
    return
  }
  const updating = openedInGame === fileName && launch === "running"
  setOpenedInGame(fileName)
  if (launch === "launched") {
    notify("info", `Starting the game to open ${label} in the in-game editor`, {
      kind,
      body: "It opens once the game and the plugin manager are up."
    })
  } else if (outcome === "opened") {
    notify("info", updating ? `Updated ${label} in the in-game editor` : `Opened ${label} in the in-game editor`, {
      kind
    })
  } else {
    notify("info", `${updating ? "Updating" : "Opening"} ${label} in the in-game editor`, { kind })
  }
}

/** Opens the dialog that asks about what main wouldn't write over; its answer goes on with the same `intent`. */
const askFirst = (intent: ExportIntent, refusal: ExportRefusal, options: ExportOptions) =>
  ExportRefusal.match(refusal, {
    Published: ({ file, publishedFileId }) =>
      Effect.sync(() =>
        useEditor.getState().openDialog({ id: "replacePublished", name: file.name, publishedFileId, from: intent })
      ),
    ChangedInGame: ({ file }) => askSyncConflict(file.name, intent, options.replacePublished)
  })

const writeFor = (platform: Platform["Service"], intent: ExportIntent, fileName: string, options: ExportOptions) => {
  switch (intent) {
    case "play":
      return platform.play(fileName, options)
    case "edit":
      return platform.openInGame(fileName, options)
    case "export":
      return platform.exportMap(fileName, options)
  }
}

/**
 * Copies a saved project map into the game's maps folder, and for Play has the plugin race it, or for Open in game open
 * it in the in-game editor (the game starts if it isn't running). A published map's draft there asks first, and so does
 * an export the game changed since the last export. The plugin manager only races maps never published, so Play of a
 * published map offers to save a new draft of it instead (the `newDraft` dialog). The chip follows it from the copy on
 * (`showingGameWrite`).
 */
export const writeToGame = Effect.fn("writeToGame")(
  function*(intent: ExportIntent, fileName: string, options: ExportOptions) {
    const result = yield* writeFor(yield* Platform, intent, fileName, options)
    switch (result._tag) {
      case "Published":
      case "ChangedInGame":
        yield* askFirst(intent, result, options)
        return
      case "PublishedMap":
        useEditor.getState().openDialog({ id: "newDraft" })
        return
      case "Exported":
        yield* refreshProject
        useEditor.getState().notify("info", `Exported ${mapLabelOf(fileName)} to the game's maps folder`, {
          kind: "mapExported",
          actions: [revealIn("game")]
        })
        return
      case "Played":
        yield* refreshProject
        notifyPlayed(fileName, result)
        return
      case "Opening":
        yield* refreshProject
        notifyOpening(fileName, result, options)
        return
      case "NeedsPlugin": {
        // the pinned notice has the steps; the press itself gets an answer too, or the button looks dead
        const problem = openInGameProblem(result.plugin) ?? "the plugin didn't answer"
        useEditor.getState().notify(
          "error",
          `Can't open ${mapLabelOf(fileName)} in the in-game editor: ${problem[0]?.toLowerCase()}${problem.slice(1)}`,
          { kind: "openInGame", body: "The notifications have the steps." }
        )
        notifyNotice(openWithoutPluginNotice(mapLabelOf(fileName), result.plugin))
      }
    }
  },
  (effect, intent, fileName) => showingGameWrite({ intent, fileName, stage: "copy" })(effect)
)

/** The replacePublished dialog's answer: replace the published map's draft after all, and go on with Export or Play. */
export const replacePublishedDraftEffect = Effect.suspend(() => {
  const { dialog: draft, closeDialog } = useEditor.getState()
  closeDialog()
  return draft?.id === "replacePublished"
    ? writeToGame(draft.from, draft.name, { ...ASK_FIRST, replacePublished: true })
    : Effect.void
})

export const replacePublishedDraft = () => run(replacePublishedDraftEffect)

/**
 * The replaceInGame dialog's Replace in game: Open in game again with `force`, so the plugin replaces the map open in
 * the in-game editor, changed pieces and all. The export already happened: the same bytes go again, which asks nothing.
 */
export const replaceInGameEffect = Effect.suspend(() => {
  const { dialog: unsaved, closeDialog } = useEditor.getState()
  closeDialog()
  if (unsaved?.id !== "replaceInGame") return Effect.void
  return writeToGame("edit", unsaved.name, {
    replacePublished: unsaved.replacePublished,
    overwriteChanged: false,
    force: true
  })
})

export const replaceInGame = () => run(replaceInGameEffect)
