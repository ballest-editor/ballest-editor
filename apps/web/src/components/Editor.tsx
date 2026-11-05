import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { useEffect } from "react"
import { MOTION_SCALE } from "../domain/Settings"
import {
  checkExports,
  followNotifications,
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
  setWindowTheme,
  showToasts
} from "../editor/actions"
import { warmCatalog } from "../editor/preload"
import { sceneRegistry } from "../editor/sceneRegistry"
import { type Dialog, useEditor, useOpenMapLabel } from "../editor/store"
import { watchResolvedTheme } from "../editor/theme"
import { useActionKeys } from "../editor/useActionKeys"
import { Dock } from "./dock/Dock"
import { blurChromeAfterClick } from "./dock/popoutWindow"
import { GameLinkDialog } from "./GameLinkDialog"
import { ImportClashDialog } from "./ImportClashDialog"
import { KeybindCheatSheet } from "./KeybindCheatSheet"
import { NameMapDialog } from "./NameMapDialog"
import { NewMapDialog } from "./NewMapDialog"
import { NewProjectDialog } from "./NewProjectDialog"
import { OverwriteChangedDialog } from "./OverwriteChangedDialog"
import { ProjectChooser } from "./ProjectChooser"
import { ProjectSettingsDialog } from "./ProjectSettingsDialog"
import { RecoverDialog } from "./RecoverDialog"
import { ReplacePublishedDialog } from "./ReplacePublishedDialog"
import { SettingsDialog } from "./SettingsDialog"
import { StatusBar } from "./StatusBar"
import { TopBar } from "./TopBar"
import { WhereToOpenDialog } from "./WhereToOpenDialog"

if (import.meta.env.DEV) {
  // Dev-only handle for poking at the scene from the console / browser automation.
  Object.assign(globalThis, { __ballest: { sceneRegistry, useEditor } })
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

/** The window title: the open map, marked while it has unsaved changes. */
const useDocumentTitle = () => {
  const label = useOpenMapLabel()
  const dirty = useEditor((s) => s.dirty)
  useEffect(() => {
    document.title = `${dirty ? "• " : ""}${label} — Ballest Editor`
  }, [label, dirty])
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
 * Back from the game (or anywhere) the window gets the focus: the in-game editor may have saved a map meanwhile, so the
 * exports are checked (docs/PROJECTS.md § Sync). A browser has none to check.
 */
const useCheckExportsOnFocus = () =>
  useEffect(() => {
    const check = () => void checkExports()
    window.addEventListener("focus", check)
    return () => window.removeEventListener("focus", check)
  }, [])

export function Editor() {
  const dialog = useEditor((s): Dialog | null => s.dialog?.id ?? null)
  const settingsCategory = useEditor((s) => s.settingsCategory)
  const setSettingsCategory = useEditor((s) => s.setSettingsCategory)
  const close = useEditor((s) => s.closeDialog)

  useActionKeys()
  useDocumentTitle()
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
  useEffect(() => showToasts(), [])
  useEffect(() => followNotifications(), [])
  useEffect(() => {
    // The viewport holds its first reveal until these have settled (see Viewport.tsx).
    void Promise.all([loadCatalog(), loadMaterials(), loadSettings()]).then(() => useEditor.getState().finishBoot())
    void loadKeybinds()
    void loadPlatform()
  }, [])
  useEffect(() => followUpdates(), [])
  useEffect(() => followViewLayouts(), [])
  useEffect(() => followPlaySessions(), [])
  useCheckExportsOnFocus()

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <TopBar />
        <Dock />
        <StatusBar />
      </div>
      <NewMapDialog open={dialog === "new"} onClose={close} />
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
      <NewProjectDialog open={dialog === "newProject"} onClose={close} />
      <WhereToOpenDialog open={dialog === "whereToOpen"} onClose={close} />
      <ProjectChooser />
      <ReplacePublishedDialog open={dialog === "replacePublished"} onClose={close} />
      <OverwriteChangedDialog open={dialog === "overwriteChanged"} onClose={close} />
      <ImportClashDialog open={dialog === "importClash"} onClose={close} />
      <RecoverDialog open={dialog === "recover"} onClose={close} />
      <SettingsDialog
        open={dialog === "settings"}
        category={settingsCategory}
        onCategoryChange={setSettingsCategory}
        onClose={close}
      />
      <KeybindCheatSheet />
      {/* clear of the status bar */}
      <Toaster position="bottom-right" offset={{ bottom: 40 }} />
    </TooltipProvider>
  )
}
