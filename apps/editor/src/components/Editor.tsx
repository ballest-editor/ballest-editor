import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { useEffect, useRef } from "react"
import { importFile, loadCatalog, loadKeybinds, loadMaterials, loadSettings } from "../editor/actions"
import { commands } from "../editor/commands"
import { warmCatalog } from "../editor/preload"
import { sceneRegistry } from "../editor/sceneRegistry"
import { useEditor } from "../editor/store"
import { watchResolvedTheme } from "../editor/theme"
import { useActionKeys } from "../editor/useActionKeys"
import { Viewport } from "../editor/Viewport"
import { ExportDialog } from "./ExportDialog"
import { Inspector } from "./Inspector"
import { NewMapDialog } from "./NewMapDialog"
import { Palette } from "./Palette"
import { SettingsDialog } from "./SettingsDialog"
import { SidePanel } from "./SidePanel"
import { TopBar } from "./TopBar"

if (import.meta.env.DEV) {
  // Dev-only handle for poking at the scene from the console / browser automation.
  Object.assign(globalThis, { __ballest: { sceneRegistry, useEditor } })
}

/**
 * Chrome buttons are for the mouse: after a pointer click they give focus back, so a
 * later Space/Enter can't re-trigger them and editor keybinds keep working.
 */
const useBlurButtonsAfterClick = () =>
  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      const button = e.target instanceof Element ? e.target.closest("button") : null
      if (button?.closest("[role=dialog]") === null) requestAnimationFrame(() => button.blur())
    }
    document.addEventListener("pointerup", onPointerUp)
    return () => document.removeEventListener("pointerup", onPointerUp)
  }, [])

/** Applies the theme setting to <html> (the ui preset styles `.dark`). */
const useTheme = () => {
  const theme = useEditor((s) => s.settings.appearance.theme)
  useEffect(() => watchResolvedTheme(theme, (dark) => document.documentElement.classList.toggle("dark", dark)), [theme])
}

export function Editor() {
  const dialog = useEditor((s) => s.dialog)
  const settingsCategory = useEditor((s) => s.settingsCategory)
  const setSettingsCategory = useEditor((s) => s.setSettingsCategory)
  const close = useEditor((s) => s.closeDialog)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    commands.openImport = () => fileInput.current?.click()
    return () => {
      commands.openImport = () => {}
    }
  }, [])

  useActionKeys()
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
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <SidePanel id="palette" side="left" defaultWidth={260} minWidth={180} maxWidth={560}>
            <Palette />
          </SidePanel>
          <div className="min-w-0 flex-1">
            <Viewport />
          </div>
          <SidePanel id="inspector" side="right" defaultWidth={300} minWidth={220} maxWidth={640}>
            <Inspector />
          </SidePanel>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".balledit,.ballmap,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file !== undefined) void importFile(file)
        }}
      />
      <NewMapDialog open={dialog === "new"} onClose={close} />
      <ExportDialog open={dialog === "export"} onClose={close} />
      <SettingsDialog
        open={dialog === "settings"}
        category={settingsCategory}
        onCategoryChange={setSettingsCategory}
        onClose={close}
      />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
