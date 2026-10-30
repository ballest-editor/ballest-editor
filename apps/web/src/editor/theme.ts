/** Resolves the appearance theme setting ("system" follows the OS) and tracks OS changes. */
import { useSyncExternalStore } from "react"
import type { Settings } from "../domain/Settings"

export type Theme = Settings["appearance"]["theme"]

const DARK_QUERY = "(prefers-color-scheme: dark)"

export const isDarkTheme = (theme: Theme, systemDark: boolean): boolean =>
  theme === "dark" || (theme === "system" && systemDark)

/**
 * Calls `apply` with the resolved theme now and whenever the OS preference changes.
 * Returns the unsubscribe function (for a React effect cleanup).
 */
export const watchResolvedTheme = (theme: Theme, apply: (dark: boolean) => void): () => void => {
  const media = window.matchMedia(DARK_QUERY)
  const run = () => apply(isDarkTheme(theme, media.matches))
  run()
  media.addEventListener("change", run)
  return () => media.removeEventListener("change", run)
}

const subscribeSystemDark = (onChange: () => void) => {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
const systemDark = () => window.matchMedia(DARK_QUERY).matches

/** Whether `theme` resolves to dark, following the OS preference live for "system". */
export const useDarkTheme = (theme: Theme): boolean =>
  isDarkTheme(theme, useSyncExternalStore(subscribeSystemDark, systemDark, () => true))
