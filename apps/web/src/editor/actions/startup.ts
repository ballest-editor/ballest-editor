/** What the app loads at startup (the catalog, materials, settings, keybinds, the platform) and the updater. */
import { Effect, Stream } from "effect"
import type { Keybinds } from "../../domain/Keybinds"
import type { Settings } from "../../domain/Settings"
import { CatalogLoader } from "../../services/CatalogLoader"
import { KeybindStore } from "../../services/KeybindStore"
import { MaterialLibrary } from "../../services/MaterialLibrary"
import { Platform } from "../../services/Platform"
import { SettingsStore } from "../../services/SettingsStore"
import { useEditor } from "../store"
import { loadUsageStatsEffect } from "./feedback"
import { checkGameLinkEffect, findCreatorEffect } from "./gameLink"
import { followOpenMapEffect, openStartingMap } from "./maps"
import { checkPrefabs } from "./prefabs"
import { offerRecovery } from "./recovery"
import { followRecovery } from "./recoverySnapshots"
import { run, runUntilCleanup } from "./run"
import { refreshProject } from "./shared"
import { checkExportsEffect } from "./sync"
import { leavingFor } from "./unsaved"

export const loadCatalog = () =>
  run(
    Effect.gen(function*() {
      const loaded = yield* CatalogLoader.use((loader) => loader.load)
      useEditor.getState().setCatalog(loaded)
    })
  )

export const loadMaterials = () =>
  run(
    Effect.gen(function*() {
      const { paint, surfaces, table } = yield* MaterialLibrary.use((library) => library.load)
      useEditor.getState().setMaterials(table, paint, surfaces)
    })
  )

export const loadSettings = () =>
  run(
    Effect.gen(function*() {
      useEditor.getState().setSettings(yield* SettingsStore.use((store) => store.load))
    })
  )

/** Applies immediately, then persists. */
export const saveSettings = (settings: Settings) => {
  useEditor.getState().setSettings(settings)
  return run(
    Effect.gen(function*() {
      const store = yield* SettingsStore
      yield* store.save(settings)
    })
  )
}

/** Changes some fields of one settings section (snapping, appearance...), then persists. */
export const updateSettings = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => {
  const { settings } = useEditor.getState()
  return saveSettings({ ...settings, [section]: { ...settings[section], ...patch } })
}

/** Stored (or default) keybinds, with the game's defaults they were derived from, into the editor. */
const applyKeybinds = (source: "load" | "reset") =>
  run(
    Effect.gen(function*() {
      const store = yield* KeybindStore
      const { keybinds, defaults } = yield* store[source]
      useEditor.getState().setKeybinds(keybinds, defaults)
    })
  )

export const loadKeybinds = () => applyKeybinds("load")

export const saveKeybinds = (keybinds: Keybinds) =>
  run(
    Effect.gen(function*() {
      yield* KeybindStore.use((store) => store.save(keybinds))
      useEditor.getState().setKeybinds(keybinds)
    })
  )

export const resetKeybinds = () => applyKeybinds("reset")

/** The resolved theme to the desktop window's controls; cosmetic, so a failure is only logged. */
export const setWindowTheme = (dark: boolean) =>
  run(
    Effect.flatMap(Effect.service(Platform), (platform) => platform.setWindowTheme(dark)).pipe(
      Effect.catch((error) => Effect.logWarning("Couldn't recolour the window controls", error))
    )
  )

/**
 * What the platform offers, the project with its maps (desktop) and the creator name it finds, into the store, then
 * the map to start on (`openStartingMap`). A browser, which has no project, keeps its one map.
 */
export const loadPlatform = () =>
  run(
    Effect.gen(function*() {
      const { capabilities, runtimeVersions } = yield* Platform
      useEditor.getState().setCapabilities(capabilities)
      useEditor.getState().setRuntimeVersions(runtimeVersions)
      yield* refreshProject
      const startRefused = useEditor.getState().project?.startRefused ?? null
      if (startRefused !== null) useEditor.getState().notify("error", startRefused, { kind: "projectRefused" })
      yield* findCreatorEffect
      yield* checkPrefabs
      if (capabilities.projects) {
        yield* openStartingMap
        yield* followOpenMapEffect
        yield* followRecovery
      }
      if (capabilities.exportToGame) yield* checkGameLinkEffect
      yield* checkExportsEffect
      yield* loadUsageStatsEffect
      // last: a dialog that opens takes another's place, and this is the one not to miss
      yield* offerRecovery
    })
  )

/** The desktop updater's state into the store, now and on every change; a browser's has none. */
export const followUpdateState = Effect.gen(function*() {
  const platform = yield* Platform
  yield* platform.updates.pipe(Stream.runForEach((state) => Effect.sync(() => useEditor.getState().setUpdate(state))))
})

/** Follows the updater (`followUpdateState`) until the returned function is called: a React effect's cleanup. */
export const followUpdates = () => runUntilCleanup(followUpdateState, "Stopped following the updater")

const updateStep = (step: "checkForUpdates" | "downloadUpdate" | "installUpdate") =>
  Effect.flatMap(Effect.service(Platform), (platform) => platform[step])

/** Checks for a newer release now; the store follows what it found, and whether the check ran to its end. */
export const checkForUpdates = async () => {
  const { setUpdateChecked } = useEditor.getState()
  setUpdateChecked(false)
  setUpdateChecked((await run(updateStep("checkForUpdates").pipe(Effect.as(true)))) === true)
}

/** Starts downloading the release on offer; the pill follows its progress. */
export const downloadUpdate = () => run(updateStep("downloadUpdate"))

/** Quits, installs the downloaded release and starts it; unsaved edits are lost (the update pill says so first). */
export const installUpdate = () => run(leavingFor(updateStep("installUpdate")))
