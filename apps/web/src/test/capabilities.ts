import type { PlatformCapabilities } from "../services/Platform"

/** What each build can do, for tests that draw the menus or the panels for one of them. */
export const DESKTOP: PlatformCapabilities = {
  projects: true,
  exportToGame: true,
  launchGame: true,
  play: true,
  updates: true,
  feedback: true,
  site: true
}

export const BROWSER: PlatformCapabilities = {
  projects: false,
  exportToGame: false,
  launchGame: false,
  play: false,
  updates: false,
  feedback: false,
  site: false
}
