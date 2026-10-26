import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { useEffect, useRef, useState } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { importFile, loadCatalog, loadKeybinds, loadMaterials, loadSettings } from "../editor/actions"
import { warmCatalog } from "../editor/preload"
import { commands, type Dialog, type SettingsCategory } from "../editor/commands"
import { sceneRegistry } from "../editor/sceneRegistry"
import { useEditor } from "../editor/store"
import { useActionKeys } from "../editor/useActionKeys"
import { Viewport } from "../editor/Viewport"
import { Inspector } from "./Inspector"
import { SettingsDialog } from "./SettingsDialog"
import { NewMapDialog } from "./NewMapDialog"
import { Palette } from "./Palette"
import { TopBar } from "./TopBar"

if (import.meta.env.DEV) {
  // Dev-only handle for poking at the scene from the console / browser automation.
  Object.assign(globalThis, { __ballest: { sceneRegistry, useEditor } })
}

export const LAYOUT_STORAGE_ID = "ballest-editor.layout.v1"

/**
 * Chrome buttons are for the mouse: after a pointer click they give focus back, so a
 * later Space/Enter can't re-trigger them and editor keybinds keep working.
 */
const useBlurButtonsAfterClick = () =>
  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      const button = e.target instanceof Element ? e.target.closest("button") : null
      if (button !== null && button.closest("[role=dialog]") === null) requestAnimationFrame(() => button.blur())
    }
    document.addEventListener("pointerup", onPointerUp)
    return () => document.removeEventListener("pointerup", onPointerUp)
  }, [])

/** Applies the theme setting to <html> (the ui preset styles `.dark`). */
const useTheme = () => {
  const theme = useEditor((s) => s.settings.appearance.theme)
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches))
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])
}

export function Editor() {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general")
  const fileInput = useRef<HTMLInputElement>(null)
  const layout = useDefaultLayout({ id: LAYOUT_STORAGE_ID, storage: localStorage })

  commands.openDialog = (next, category) => {
    if (category !== undefined) setSettingsCategory(category)
    setDialog(next)
  }
  commands.openImport = () => fileInput.current?.click()
  commands.dialogOpen = () => dialog !== null

  useActionKeys()
  useTheme()
  useBlurButtonsAfterClick()

  // Background-warm the glb cache for every palette piece once the catalog is in.
  const catalog = useEditor((s) => s.catalog)
  useEffect(() => (catalog === null ? undefined : warmCatalog(catalog.catalog)), [catalog])

  useEffect(() => {
    void loadCatalog()
    void loadMaterials()
    void loadKeybinds()
    void loadSettings()
  }, [])

  const close = () => setDialog(null)

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <TopBar />
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          <ResizablePanel id="palette" defaultSize="18" minSize={180} maxSize="40">
            <Palette />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="viewport" minSize={320}>
            <Viewport />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="inspector" defaultSize="22" minSize={220} maxSize="45">
            <Inspector />
          </ResizablePanel>
        </ResizablePanelGroup>
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
