/**
 * Export and Play's one write into the game's maps folder (docs/PROJECTS.md § Export and Play): a saved project map is
 * exported, or exported and raced, and what main won't write over without asking (`ExportRefusal`) opens its dialog.
 * The dialogs' answers write again through it, for the same intent. Export to game and Play on the open map, which
 * save it first, are in `exportPlay`.
 */
import { ExportRefusal } from "@ballest/contracts"
import { Effect } from "effect"
import { mapLabelOf } from "../../domain/factory"
import { playWithoutPluginNotice, RESOLVED_BY_PLAY } from "../../domain/gameLink"
import { type ExportOptions, Platform, type PlayResult } from "../../services/Platform"
import { type PublishedDraft, useEditor } from "../store"
import { run } from "./run"
import { notifyNotice, refreshProject, revealIn } from "./shared"

/** What a write into the game is for: Export to game, or Play (the export, then the plugin races the map). */
export type ExportIntent = PublishedDraft["from"]

/** Export and Play write over nothing they weren't told to: a published map's draft and a changed export ask first. */
export const ASK_FIRST: ExportOptions = { replacePublished: false, overwriteChanged: false }

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
    const outdated = plugin.status === "outdated"
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

/** Opens the dialog that asks about what main wouldn't write over; its answer goes on with the same `intent`. */
const askFirst = (intent: ExportIntent, refusal: ExportRefusal, options: ExportOptions) =>
  ExportRefusal.match(refusal, {
    Published: ({ file, publishedFileId }) =>
      useEditor.getState().openDialog({ id: "replacePublished", name: file.name, publishedFileId, from: intent }),
    ChangedInGame: ({ file }) =>
      useEditor.getState().openDialog({
        id: "overwriteChanged",
        name: file.name,
        from: intent,
        replacePublished: options.replacePublished
      })
  })

/**
 * Copies a saved project map into the game's maps folder, and for Play has the plugin race it (the game starts if it
 * isn't running). A published map's draft there asks first, and so does an export the game changed since the last
 * export. The plugin manager only races maps never published, so Play of a published map offers to save a new draft
 * of it instead (the `newDraft` dialog).
 */
export const writeToGame = Effect.fn("writeToGame")(
  function*(intent: ExportIntent, fileName: string, options: ExportOptions) {
    const platform = yield* Platform
    const result = intent === "play"
      ? yield* platform.play(fileName, options)
      : yield* platform.exportMap(fileName, options)
    switch (result._tag) {
      case "Published":
      case "ChangedInGame":
        askFirst(intent, result, options)
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
    }
  }
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
 * The overwriteChanged dialog's Back up and overwrite: Export (or Play) writes over the game's changed copy after all;
 * that copy goes to the backups, as everything Export writes over does.
 */
export const overwriteChangedEffect = Effect.suspend(() => {
  const { dialog: changed, closeDialog } = useEditor.getState()
  closeDialog()
  if (changed?.id !== "overwriteChanged") return Effect.void
  const { from, name, replacePublished } = changed
  return writeToGame(from, name, { replacePublished, overwriteChanged: true })
})

export const overwriteChangedExport = () => run(overwriteChangedEffect)
