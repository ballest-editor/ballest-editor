/**
 * What the last session left unsaved (docs/DESKTOP.md § Recovery): offering it at launch, and bringing it back as
 * unsaved edits or letting it go. `recoverySnapshots` keeps it on disk meanwhile.
 */
import { Effect } from "effect"
import { counted } from "../../domain/groupSelection"
import { type RecoveredTab, RECOVERY_MAP_HASH } from "../../domain/recovery"
import { loadStructure } from "../../domain/sidecar"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { type OpenFile, type PrefabDocument, type TabTarget, tabWithFile, tabWithPrefab, useEditor } from "../store"
import { ownRecoveryKeys, syncRecovery } from "./recoverySnapshots"
import { run } from "./run"
import { fileOf, refreshProject, showMap } from "./shared"
import { unlessCancelledIn } from "./unsaved"

/** A snapshot this version can read, or none: it stays on disk, as what it holds may be all there is of it. */
const decodeEntry = Effect.fnUntraced(function*({ key, text }: { readonly key: string; readonly text: string }) {
  return yield* MapCodec.use((codec) => codec.decodeRecovery(text)).pipe(
    Effect.map((snapshot): ReadonlyArray<RecoveredTab> => [{ key, snapshot }]),
    Effect.catch((error) => Effect.as(Effect.logWarning(`Ignoring the recovery snapshot ${key}`, error.message), []))
  )
})

/**
 * Asks about the tabs another session left unsaved, newest first. Each belongs to its project, so it waits for that
 * project to open; a tab from Untitled Project has none, and any project takes it in.
 */
export const offerRecovery = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.projects) return
  const own = ownRecoveryKeys()
  const entries = (yield* platform.listRecovery).filter(({ key }) => !own.has(key))
  const decoded = (yield* Effect.forEach(entries, decodeEntry)).flat()
  const here = useEditor.getState().project?.current?.path ?? null
  const tabs = decoded
    .filter(({ snapshot }) => snapshot.project === null || snapshot.project === here)
    .toSorted((a, b) => b.snapshot.editedAt.localeCompare(a.snapshot.editedAt))
  if (tabs.length > 0) useEditor.getState().openDialog({ id: "recoverUnsaved", tabs })
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't look for unsaved edits to recover", error)))

/** Opens a snapshot's definition as unsaved edits. Its file, if it had one, is where Save goes, gone or not. */
const showDefinition = (
  { snapshot }: RecoveredTab,
  prefab: NonNullable<RecoveredTab["snapshot"]["prefab"]>,
  into: TabTarget
) => {
  const { map, sidecar, file, fresh } = snapshot
  const document: PrefabDocument = {
    kind: "prefab",
    tier: prefab.tier,
    name: prefab.name,
    hash: prefab.hash,
    file: prefab.file,
    sources: new Map(prefab.sources.map(({ key, ...source }) => [key, source]))
  }
  const loaded = loadStructure(map, RECOVERY_MAP_HASH, sidecar, useEditor.getState().catalogIndex)
  useEditor.getState().loadMap(map, file, undefined, { document, dirty: true, fresh, into, loaded })
}

/** Opens a snapshot's map as unsaved edits of the project map it came from, or of no file if that has gone. */
const showRecoveredMap = Effect.fnUntraced(function*({ snapshot }: RecoveredTab, into: TabTarget) {
  const { backup, file, map, sidecar } = snapshot
  const inProject = useEditor.getState().projectMaps.find((m) => m.fileName === file?.name)
  const openFile: OpenFile | null = inProject === undefined ? null : fileOf(inProject)
  const loaded = loadStructure(map, RECOVERY_MAP_HASH, sidecar, useEditor.getState().catalogIndex)
  yield* showMap(map, openFile, { dirty: true, backup, into, loaded })
})

/** The tab that has a snapshot's file open. A definition's file name is only its tier's, so that goes by the two. */
const tabOfSnapshot = ({ snapshot: { file, prefab } }: RecoveredTab) => {
  if (file === null) return undefined
  const s = useEditor.getState()
  return prefab === null ? tabWithFile(s, file.name) : tabWithPrefab(s, prefab)
}

/** Shows a snapshot in its file's tab when one has it open, asking about that tab's edits first, else a new tab. */
const restoreTab = (tab: RecoveredTab, restored: Array<RecoveredTab>) => {
  const show = Effect.fnUntraced(function*(open: boolean) {
    const into = open ? "active" : "newTab"
    const { prefab } = tab.snapshot
    if (prefab === null) yield* showRecoveredMap(tab, into)
    else showDefinition(tab, prefab, into)
    restored.push(tab)
  })
  return Effect.suspend(() => unlessCancelledIn(tabOfSnapshot(tab), "recover", show))
}

/**
 * Restore: each tab comes back as unsaved edits, and its old snapshot goes once the new tab has its own, so at no point
 * is the only copy in memory.
 */
export const restoreUnsavedEffect = Effect.gen(function*() {
  const { dialog, closeDialog } = useEditor.getState()
  if (dialog?.id !== "recoverUnsaved") return
  closeDialog()
  yield* refreshProject
  const restored: Array<RecoveredTab> = []
  yield* Effect.forEach(dialog.tabs, (tab) => restoreTab(tab, restored), { discard: true })
  yield* syncRecovery
  const platform = yield* Platform
  yield* Effect.forEach(restored, ({ key }) => platform.removeRecovery(key), { discard: true })
  useEditor.getState().notify(
    "info",
    `Restored ${counted(restored.length, "tab")} with unsaved edits`,
    { kind: "unsavedRestored", body: "Save keeps them. Their undo history didn't come back." }
  )
})

export const restoreUnsaved = () => run(restoreUnsavedEffect)

/** Discard: the snapshots go for good, and nothing else changes. */
export const discardUnsavedEffect = Effect.gen(function*() {
  const { dialog, closeDialog } = useEditor.getState()
  if (dialog?.id !== "recoverUnsaved") return
  closeDialog()
  const platform = yield* Platform
  yield* Effect.forEach(dialog.tabs, ({ key }) => platform.removeRecovery(key), { discard: true })
})

export const discardUnsaved = () => run(discardUnsavedEffect)
