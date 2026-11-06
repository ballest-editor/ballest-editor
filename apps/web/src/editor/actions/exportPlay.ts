/**
 * Export to game and Play on the open map (docs/PROJECTS.md § Export and Play, docs/DESKTOP.md § Play): both copy its
 * project file, so unsaved edits are saved first and a map with no file yet is named first; then `writeToGame`.
 */
import { Effect } from "effect"
import { isNeverPublished } from "../../domain/edits"
import { gameLoadProblems } from "../../domain/limits"
import { ExportValidationError } from "../../services/errors"
import { gameMapOf, PREFAB_TAB_STAYS_HERE, useEditor } from "../store"
import { ASK_FIRST, type ExportIntent, writeToGame } from "./gameWrite"
import { withProjectMapOpen } from "./project"
import { run } from "./run"
import { duplicateMapEffect, withSavedOpenMap } from "./save"

/**
 * Export to game or Play on the open map. The plugin manager only races maps never published, so Play of a published
 * map's draft offers to save a new draft of it instead (the `newDraft` dialog). The file is checked here as well as
 * on Save: an imported `.balledit` is copied byte for byte, and a map with no edits goes to the game as it is, so
 * neither passes through `MapExporter`, and the game opens a blank map for a file it refuses. The character limit is
 * about the file's own text, which this decoded map isn't, so main checks that on the bytes it copies (`MapExports`).
 */
const writeOpenMapToGame = (intent: ExportIntent) =>
  Effect.suspend(() => {
    const { catalogIndex, doc, document, openDialog } = useEditor.getState()
    if (document.kind === "prefab") return Effect.fail(new ExportValidationError({ message: PREFAB_TAB_STAYS_HERE }))
    const problems = gameLoadProblems(gameMapOf(doc, catalogIndex), catalogIndex)
    if (problems.length > 0) return Effect.fail(new ExportValidationError({ message: problems.slice(0, 3).join(" ") }))
    return intent === "play" && !isNeverPublished(doc.map.worldSettings.levelData.levelPublishedFileId)
      ? Effect.sync(() => openDialog({ id: "newDraft" }))
      : withSavedOpenMap((fileName) => writeToGame(intent, fileName, ASK_FIRST))
  })

/**
 * Export to game: writes the map into the game's UserSavedMaps folder under the game's file name, where the in-game
 * editor lists it. The export is a copy of the project file, so unsaved edits are saved first. A map with no file yet
 * is named first.
 */
export const exportToGameEffect = writeOpenMapToGame("export")

export const exportToGame = () => run(exportToGameEffect)

/**
 * Play: Export to game (saving unsaved edits first, naming a map with no file yet), then the plugin races it in the
 * game, which starts if it isn't running. A published map's draft offers to save a new draft of it instead.
 */
export const playEffect = writeOpenMapToGame("play")

export const playMap = () => run(playEffect)

/** The Project panel's Export to game on a map: opened first, then exported as the open map is. */
export const exportProjectMapFromPanel = (fileName: string) => withProjectMapOpen(fileName, exportToGameEffect)

/** The Project panel's Play on a map: opened first, then played as the open map is. */
export const playProjectMapFromPanel = (fileName: string) => withProjectMapOpen(fileName, playEffect)

/** The newDraft dialog's answer: a copy of the map that was never published, under a new name; then Play races it. */
export const playAsNewDraft = (displayName: string, creatorName: string, replace = false) =>
  run(duplicateMapEffect(displayName, creatorName, replace, true).pipe(Effect.andThen(playEffect)))
