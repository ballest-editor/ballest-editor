import type { DesktopBridge } from "@ballest/contracts"

declare global {
  interface Window {
    /** The desktop app's preload bridge; undefined in a browser. */
    readonly ballest?: DesktopBridge
  }
}
