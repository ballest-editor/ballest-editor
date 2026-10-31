import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { useEffect } from "react"
import {
  followUnloadRequests,
  followUpdates,
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
import { useEditor } from "../editor/store"
import { watchResolvedTheme } from "../editor/theme"
import { useActionKeys } from "../editor/useActionKeys"
import { Viewport } from "../editor/Viewport"
import { ImportClashDialog } from "./ImportClashDialog"
import { Inspector } from "./Inspector"
import { KeybindCheatSheet } from "./KeybindCheatSheet"
import { MapSettingsDialog } from "./MapSettingsDialog"
import { NameMapDialog } from "./NameMapDialog"
import { NewMapDialog } from "./NewMapDialog"
import { Palette } from "./Palette"
import { RecoverDialog } from "./RecoverDialog"
import { ReplacePublishedDialog } from "./ReplacePublishedDialog"
import { SettingsDialog } from "./SettingsDialog"
import { SidePanel } from "./SidePanel"
import { TopBar } from "./TopBar"
import { ViewportControls } from "./ViewControls"

if (import.meta.env.DEV) {
  // Dev-only handle for poking at the scene from the console / browser automation.
  Object.assign(globalThis, { __ballest: { sceneRegistry, useEditor } })
}

/**
 * Chrome buttons are for the mouse: after a pointer click they give focus back, so a
 * later Space/Enter can't re-trigger them and editor keybinds keep working. Not in dialogs,
 * nor in the menu bar: its menus open in the next frame and would close on the blur (they
 * hand focus back themselves when they close).
 */
const useBlurButtonsAfterClick = () =>
  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      const button = e.target instanceof Element ? e.target.closest("button") : null
      if (button?.closest("[role=dialog], [role=menubar]") === null) requestAnimationFrame(() => button.blur())
    }
    document.addEventListener("pointerup", onPointerUp)
    return () => document.removeEventListener("pointerup", onPointerUp)
  }, [])

/** Applies the theme setting to <html> (the ui preset styles `.dark`), and to the desktop window's controls. */
const useTheme = () => {
  const theme = useEditor((s) => s.settings.appearance.theme)
  useEffect(() =>
    watchResolvedTheme(theme, (dark) => {
      document.documentElement.classList.toggle("dark", dark)
      void setWindowTheme(dark)
    }), [theme])
}

/** The window title: the open file, marked while it has unsaved changes. */
const useDocumentTitle = () => {
  const name = useEditor((s) => s.file?.name ?? "Untitled")
  const dirty = useEditor((s) => s.dirty)
  useEffect(() => {
    document.title = `${dirty ? "• " : ""}${name} — Ballest Editor`
  }, [name, dirty])
}

/**
 * While the map has unsaved edits the page holds a window close or a reload (`beforeunload`). A browser then asks with
 * its own dialog; the desktop window tells the page, which asks Save / Don't save / Cancel and then closes or reloads.
 */
const useUnsavedGuard = () =>
  useEffect(() => {
    const hold = (e: BeforeUnloadEvent) => {
      if (holdsUnload()) e.preventDefault()
    }
    window.addEventListener("beforeunload", hold)
    const stop = followUnloadRequests()
    return () => {
      window.removeEventListener("beforeunload", hold)
      stop()
    }
  }, [])

export function Editor() {
  const dialog = useEditor((s) => s.dialog)
  const settingsCategory = useEditor((s) => s.settingsCategory)
  const setSettingsCategory = useEditor((s) => s.setSettingsCategory)
  const close = useEditor((s) => s.closeDialog)

  useActionKeys()
  useDocumentTitle()
  useUnsavedGuard()
  useTheme()
  useBlurButtonsAfterClick()

  // Background-warm the glb cache for every palette piece once the catalog is in.
  const catalog = useEditor((s) => s.catalog)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  useEffect(
    () => (catalog === null || catalogIndex === null ? undefined : warmCatalog(catalog.catalog, catalogIndex)),
    [catalog, catalogIndex]
  )

  useEffect(() => {
    // The viewport holds its first reveal until these have settled (see Viewport.tsx).
    void Promise.all([loadCatalog(), loadMaterials(), loadSettings()]).then(() => useEditor.getState().finishBoot())
    void loadKeybinds()
    void loadPlatform()
  }, [])
  useEffect(() => followUpdates(), [])

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <SidePanel id="palette" side="left" defaultWidth={260} minWidth={180} maxWidth={560}>
            <Palette />
          </SidePanel>
          <div className="min-w-0 flex-1">
            <Viewport controls={ViewportControls} />
          </div>
          <SidePanel id="inspector" side="right" defaultWidth={300} minWidth={220} maxWidth={640}>
            <Inspector />
          </SidePanel>
        </div>
      </div>
      <NewMapDialog open={dialog === "new"} onClose={close} />
      <NameMapDialog mode="saveAs" open={dialog === "saveAs"} onClose={close} />
      <NameMapDialog mode="rename" open={dialog === "rename"} onClose={close} />
      <NameMapDialog mode="duplicate" open={dialog === "duplicate"} onClose={close} />
      <MapSettingsDialog open={dialog === "mapSettings"} onClose={close} />
      <ReplacePublishedDialog open={dialog === "replacePublished"} onClose={close} />
      <ImportClashDialog open={dialog === "importClash"} onClose={close} />
      <RecoverDialog open={dialog === "recover"} onClose={close} />
      <SettingsDialog
        open={dialog === "settings"}
        category={settingsCategory}
        onCategoryChange={setSettingsCategory}
        onClose={close}
      />
      <KeybindCheatSheet />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
