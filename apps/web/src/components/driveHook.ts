/**
 * What the app driver (tools/app-driver) calls in the page. Dev only: `Editor.tsx` imports this behind
 * `import.meta.env.DEV`, so no production bundle holds it. Everything here is a call into the app's own actions and
 * store, so a state is reached the way the app itself gets there.
 */
import { DOCUMENTS_PANEL } from "../domain/dockLayout"
import { RECOVERY_MAP_HASH, type RecoverySnapshot } from "../domain/recovery"
import { sidecarOf } from "../domain/sidecar"
import type { ViewLayoutKind } from "../domain/viewLayout"
import { openMapText } from "../editor/actions"
import { gameTime } from "../editor/materials"
import { sceneRegistry } from "../editor/sceneRegistry"
import { type DialogState, type SettingsCategory, useEditor } from "../editor/store"
import { dockApi, popOutPanel, togglePanel } from "./dock/dockControl"
import { viewIds } from "./viewIds"

/** Where the shaders' clock is held for a capture: the glows and the air would otherwise differ in every picture. */
const PINNED_GAME_TIME = 600

const pinGameTime = () => {
  Object.defineProperty(gameTime, "value", { get: () => PINNED_GAME_TIME, set: () => {} })
}

const merged = (base: unknown, patch: unknown): unknown =>
  typeof base === "object" && base !== null && typeof patch === "object" && patch !== null && !Array.isArray(patch)
    ? Object.fromEntries(
      [...Object.keys(base), ...Object.keys(patch)].map((key) => [
        key,
        key in patch ? merged(Reflect.get(base, key), Reflect.get(patch, key)) : Reflect.get(base, key)
      ])
    )
    : patch

const hook = {
  views: viewIds,
  pinGameTime,
  /** Merges a part of the settings over the current ones, for this run only. */
  settings: (patch: unknown) => {
    const { settings, setSettings } = useEditor.getState()
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a driver's patch over valid settings, for a test run
    setSettings(merged(settings, patch) as typeof settings)
  },
  openMap: openMapText,
  /** Selects the first `count` items whose JSON holds `match`; the empty string matches every item. */
  select: (match: string, count = 1) => {
    const { doc, select } = useEditor.getState()
    const keys = doc.ids.filter((_, i) => JSON.stringify(doc.map.items[i]).includes(match)).slice(0, count)
    select(keys)
    return keys.length
  },
  enterGroup: (groupId: string | null) => useEditor.getState().enterGroup(groupId),
  openDialog: (dialog: DialogState) => useEditor.getState().openDialog(dialog),
  /** The import clash dialog over the open map: its payload holds a decoded map, which JSON can't carry here. */
  importClash: (fileName: string) => {
    const { doc, openDialog } = useEditor.getState()
    openDialog({ id: "importClash", source: `/tmp/${fileName}`, fileName, text: "", map: doc.map })
  },
  /** The recovery dialog with the open map as what was left unsaved: its payload holds a decoded map too. */
  recoverUnsaved: (label: string) => {
    const { doc, openDialog } = useEditor.getState()
    const snapshot: RecoverySnapshot = {
      formatVersion: 1,
      editedAt: new Date().toISOString(),
      project: null,
      label,
      file: null,
      fresh: false,
      backup: false,
      map: doc.map,
      sidecar: sidecarOf(doc.map, doc.ids, doc.structure, RECOVERY_MAP_HASH),
      prefab: null
    }
    openDialog({ id: "recoverUnsaved", tabs: [{ key: "app-driver", snapshot }] })
  },
  openSettings: (category: SettingsCategory) => {
    useEditor.getState().setSettingsCategory(category)
    useEditor.getState().openDialog({ id: "settings", category })
  },
  panes: (kind: ViewLayoutKind) => useEditor.getState().setViewLayoutKind(kind),
  togglePanel,
  closePanels: () => {
    for (const panel of dockApi()?.panels ?? []) if (panel.id !== DOCUMENTS_PANEL) togglePanel(panel.id)
  },
  popOut: (id: string) => {
    const panel = dockApi()?.getPanel(id)
    if (panel !== undefined) popOutPanel(panel)
  },
  /** A value from the store by dotted path, for a state's measurements. */
  store: (path: string): unknown =>
    path.split(".").reduce<unknown>(
      (value, key) => typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined,
      useEditor.getState()
    ),
  scene: () => ({
    objects: sceneRegistry.objects.size,
    children: sceneRegistry.itemsRoot?.children.length ?? 0
  })
}

export type DriveHook = typeof hook

export const installDriveHook = (): void => {
  Object.assign(globalThis, { __ballestDrive: hook })
}
