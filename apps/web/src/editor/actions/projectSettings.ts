/**
 * Project settings' Save (docs/DESKTOP.md § Project settings): writes what the dialog buffered. A map in a tab is edited
 * there, as one undo step, and saved when the tab is; any other map goes through the save path.
 */
import { Effect } from "effect"
import { setLevelData } from "../../domain/edits"
import type { MapFile } from "../../domain/MapFile"
import { mapPrefsKeyOf } from "../../domain/MapPrefs"
import {
  changesLevelData,
  type MapDraft,
  type MapEntryId,
  type MapEntryTarget,
  type SettingsBuffer,
  targetOf,
  withMapDraft,
  withoutMap,
  withoutProjectName
} from "../../domain/settingsBuffer"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { tabWithFile, useEditor } from "../store"
import { nameProjectEffect, patchProjectMapEffect, projectMapSettingsEffect, renameProjectEffect } from "./maps"
import { notifyFailure, run } from "./run"
import { saveTabPrefs } from "./shared"

const tabOf = (target: MapEntryTarget): string | undefined => {
  const s = useEditor.getState()
  switch (target._tag) {
    case "OpenMap":
      return s.tabId
    case "Tab":
      return target.tabId
    case "File":
      return tabWithFile(s, target.fileName)
  }
}

/** A map no tab has open: its file patched (a new name moves it), and its prefs under the name it ends up with. */
const saveProjectMapDraft = Effect.fn("saveProjectMapDraft")(function*(
  fileName: string,
  draft: MapDraft,
  patch: (map: MapFile) => MapFile
) {
  const { map, prefs } = yield* projectMapSettingsEffect(fileName)
  const saved = changesLevelData(draft) ? yield* patchProjectMapEffect(fileName, patch) : undefined
  const moved = saved !== undefined && saved.fileName !== fileName
  if (moved || draft.exportOnSave !== undefined) {
    const { exportOnSave: wasOn, ...rest } = prefs
    const on = draft.exportOnSave ?? wasOn === true
    yield* MapPrefsStore.use((store) =>
      store.save(mapPrefsKeyOf(patch(map)), on ? { ...rest, exportOnSave: on } : rest)
    )
  }
  return moved ? saved.fileName : undefined
})

/** Saves one entry's draft; the map's new file name when that moved it. */
const saveMapDraft = Effect.fn("saveMapDraft")(function*(entry: MapEntryId, draft: MapDraft, savedCreator: string) {
  const patch = (map: MapFile) => setLevelData(map, withMapDraft(map.worldSettings.levelData, draft, savedCreator))
  const target = targetOf(entry)
  const tabId = tabOf(target)
  if (tabId !== undefined) {
    const { editTabMap, patchTab } = useEditor.getState()
    if (changesLevelData(draft)) editTabMap(tabId, patch)
    if (draft.exportOnSave !== undefined) patchTab(tabId, { exportOnSave: draft.exportOnSave })
    yield* saveTabPrefs(tabId)
    return undefined
  }
  return target._tag === "File" ? yield* saveProjectMapDraft(target.fileName, draft, patch) : undefined
})

const saveProjectName = (name: string) =>
  useEditor.getState().project?.current == null ? nameProjectEffect({ name }) : renameProjectEffect(name)

/** Whether `effect` worked; a failure is told, and doesn't stop what comes after it. */
const attempted = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map((value) => ({ done: true as const, value })),
    Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause)).pipe(Effect.as({ done: false as const })))
  )

/**
 * Writes the buffer, the project's name first, then each map. Answers what is left of it, which is what failed, and the
 * maps whose file moved.
 */
export const saveProjectSettingsEffect = Effect.fn("saveProjectSettingsEffect")(function*(
  buffer: SettingsBuffer,
  savedCreator: string
) {
  let left = buffer
  const moved = new Map<MapEntryId, string>()
  if (buffer.projectName !== undefined) {
    const name = yield* attempted(saveProjectName(buffer.projectName))
    if (name.done) left = withoutProjectName(left)
  }
  for (const [entry, draft] of buffer.maps) {
    const saved = yield* attempted(saveMapDraft(entry, draft, savedCreator))
    if (!saved.done) continue
    left = withoutMap(left, entry)
    if (saved.value !== undefined) moved.set(entry, saved.value)
  }
  return { left, moved }
})

export const saveProjectSettings = (buffer: SettingsBuffer, savedCreator: string) =>
  run(saveProjectSettingsEffect(buffer, savedCreator))
