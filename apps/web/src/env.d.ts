import type { DesktopBridge } from "@ballest/contracts"

declare global {
  interface ImportMetaEnv {
    /** Base URL of the published meshes and textures (set by vite.config.ts from web-assets.json), else unset. */
    readonly VITE_ASSETS_BASE?: string
  }

  interface Window {
    /** The desktop app's preload bridge; undefined in a browser. */
    readonly ballest?: DesktopBridge
  }
}
