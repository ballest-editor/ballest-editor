import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { useEffect } from "react"
import { MOTION_SCALE } from "../domain/Settings"
import {
  checkExports,
  checkPrefabsNow,
  followGameWrites,
  followNotifications,
  followOpenTabs,
  followPageErrors,
  followPlaySessions,
  followUnloadRequests,
  followUpdates,
  followViewLayouts,
  holdsUnload,
  loadCatalog,
  loadKeybinds,
  loadMaterials,
  loadPlatform,
  loadSettings,
  setWindowTheme
} from "../editor/actions"
import { warmCatalog } from "../editor/preload"
import { sceneRegistry } from "../editor/sceneRegistry"
import { APP_TITLE, type Dialog, isChooserRequired, useEditor, windowTitleOf } from "../editor/store"
import { watchResolvedTheme } from "../editor/theme"
import { useActionKeys } from "../editor/useActionKeys"
import { AboutDialog } from "./AboutDialog"
import { Dock } from "./dock/Dock"
import { blurChromeAfterClick } from "./dock/popoutWindow"
import { ChooserSkeleton, startsOnChooser } from "./EditorSkeleton"
import { FeedbackDialog } from "./FeedbackDialog"
import { GameLinkDialog } from "./GameLinkDialog"
import { ImportClashDialog } from "./ImportClashDialog"
import { KeybindCheatSheet } from "./KeybindCheatSheet"
import { NameMapDialog } from "./NameMapDialog"
import { NewProjectDialog } from "./NewProjectDialog"
import { DeletePrefabDialog, RenamePrefabDialog, SavePrefabDialog } from "./PrefabDialogs"
import { ProjectChooser } from "./ProjectChooser"
import { ProjectSettingsDialog } from "./ProjectSettingsDialog"
import { RecoverDialog } from "./RecoverDialog"
import { RecoverUnsavedDialog } from "./RecoverUnsavedDialog"
import { ReplaceInGameDialog } from "./ReplaceInGameDialog"
import { ReplacePublishedDialog } from "./ReplacePublishedDialog"
import { SettingsDialog } from "./SettingsDialog"
import { StatusBar } from "./StatusBar"
import { SyncConflictDialog } from "./SyncConflictDialog"
import { Toasts } from "./Toasts"
import { TopBar } from "./TopBar"
import { WhereToOpenDialog } from "./WhereToOpenDialog"

if (import.meta.env.DEV) {
  // Dev-only handle for poking at the scene from the console / browser automation.
  Object.assign(globalThis, { __ballest: { sceneRegistry, useEditor } })
  void import("./driveHook").then(({ installDriveHook }) => installDriveHook())
}

/** Applies the theme setting to <html> (the ui preset styles `.dark`), and to the desktop window's controls. */
const useTheme = () => {
  const theme = useEditor((s) => s.settings.appearance.theme)
  useEffect(() =>
    watchResolvedTheme(theme, (dark) => {
      document.documentElement.classList.toggle("dark", dark)
      void setWindowTheme(dark)
    }), [theme])
}

/** The animation speed setting onto <html>: `--motion` scales every transition and animation (globals.css). */
const useMotion = () => {
  const motion = useEditor((s) => s.settings.appearance.motion)
  useEffect(() => {
    document.documentElement.style.setProperty("--motion", String(MOTION_SCALE[motion]))
  }, [motion])
}

/** The OS window's title (`windowTitleOf`). `waitingToChoose`: the start screen is coming, so nothing is open yet. */
const useDocumentTitle = (waitingToChoose: boolean) => {
  const title = useEditor((s) => waitingToChoose ? APP_TITLE : windowTitleOf(s))
  useEffect(() => {
    document.title = title
  }, [title])
}

/**
 * While the map has unsaved edits the page holds a window close or a reload (`beforeunload`). A browser then asks with
 * its own dialog; the desktop window tells the page, which asks Save / Don't save / Cancel and then closes or reloads.
 */
const useUnsavedGuard = () =>
  useEffect(() => {
    const hold = (e: BeforeUnloadEvent) => {
      if (!holdsUnload()) return
      e.preventDefault()
      // A held unload may yet be cancelled, and dockview closes popped-out panels' windows on this same event.
      e.stopImmediatePropagation()
    }
    window.addEventListener("beforeunload", hold)
    const stop = followUnloadRequests()
    return () => {
      window.removeEventListener("beforeunload", hold)
      stop()
    }
  }, [])

/**
 * Back from the game (or anywhere) the window gets the focus: the in-game editor may have saved a map or a prefab
 * meanwhile, so the exports (docs/PROJECTS.md § Sync) and the prefabs are checked. A browser has only its own to check.
 */
const useCheckExportsOnFocus = () =>
  useEffect(() => {
    const check = () => {
      void checkExports()
      void checkPrefabsNow()
    }
    window.addEventListener("focus", check)
    return () => window.removeEventListener("focus", check)
  }, [])

export function Editor() {
  const dialog = useEditor((s): Dialog | null => s.dialog?.id ?? null)
  const settingsCategory = useEditor((s) => s.settingsCategory)
  const setSettingsCategory = useEditor((s) => s.setSettingsCategory)
  const close = useEditor((s) => s.closeDialog)
  const choosing = useEditor(isChooserRequired)
  const waitingToChoose = useEditor((s) => s.project === null) && startsOnChooser()

  useActionKeys()
  useDocumentTitle(waitingToChoose)
  useUnsavedGuard()
  useTheme()
  useMotion()
  useEffect(() => blurChromeAfterClick(document), [])

  // Background-warm the glb cache for every palette piece once the catalog is in.
  const catalog = useEditor((s) => s.catalog)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  useEffect(
    () => (catalog === null || catalogIndex === null ? undefined : warmCatalog(catalog.catalog, catalogIndex)),
    [catalog, catalogIndex]
  )

  // Before the startup loads, so a failing one is toasted and kept.
  useEffect(() => followNotifications(), [])
  useEffect(() => {
    // The viewport holds its first reveal until these have settled (see Viewport.tsx).
    const booted = Promise.all([loadCatalog(), loadMaterials(), loadSettings()]).then(() =>
      useEditor.getState().finishBoot()
    )
    void loadKeybinds()
    // instances wait for the catalog as well as the map, which either may bring last
    void Promise.all([booted, loadPlatform()]).then(followOpenTabs)
  }, [])
  useEffect(() => followUpdates(), [])
  useEffect(() => followPageErrors(), [])
  useEffect(() => followViewLayouts(), [])
  useEffect(() => followPlaySessions(), [])
  useEffect(() => followGameWrites(), [])
  useCheckExportsOnFocus()

  return (
    <TooltipProvider>
      {choosing ?
        <ProjectChooser /> :
        waitingToChoose ?
        <ChooserSkeleton /> :
        (
          <div className="flex h-svh flex-col bg-background text-foreground">
            <TopBar />
            <Dock />
            <StatusBar />
          </div>
        )}
      <NameMapDialog mode="saveAs" open={dialog === "saveAs"} onClose={close} />
      <NameMapDialog mode="rename" open={dialog === "rename"} onClose={close} />
      <NameMapDialog mode="duplicate" open={dialog === "duplicate"} onClose={close} />
      <NameMapDialog mode="newDraft" open={dialog === "newDraft"} onClose={close} />
      <ProjectSettingsDialog
        open={dialog === "projectSettings" || dialog === "mapSettings"}
        page={dialog === "mapSettings" ? "openMap" : "project"}
        onClose={close}
      />
      <GameLinkDialog open={dialog === "gameLink"} onClose={close} />
      <AboutDialog open={dialog === "about"} onClose={close} />
      <FeedbackDialog open={dialog === "feedback"} onClose={close} />
      <NewProjectDialog open={dialog === "newProject"} onClose={close} />
      <WhereToOpenDialog open={dialog === "whereToOpen"} onClose={close} />
      <ReplacePublishedDialog open={dialog === "replacePublished"} onClose={close} />
      <ReplaceInGameDialog open={dialog === "replaceInGame"} onClose={close} />
      <SyncConflictDialog open={dialog === "syncConflict"} onClose={close} />
      <ImportClashDialog open={dialog === "importClash"} onClose={close} />
      <RecoverDialog open={dialog === "recover"} onClose={close} />
      <RecoverUnsavedDialog open={dialog === "recoverUnsaved"} onClose={close} />
      <SettingsDialog
        open={dialog === "settings"}
        category={settingsCategory}
        onCategoryChange={setSettingsCategory}
        onClose={close}
      />
      <SavePrefabDialog open={dialog === "savePrefab"} onClose={close} />
      <RenamePrefabDialog open={dialog === "renamePrefab"} onClose={close} />
      <DeletePrefabDialog open={dialog === "deletePrefab"} onClose={close} />
      <KeybindCheatSheet />
      <Toasts />
    </TooltipProvider>
  )
}
