/** Resolves the appearance theme setting ("system" follows the OS) and tracks OS changes. */
import { useSyncExternalStore } from "react"
import type { Settings } from "../domain/Settings"

export type Theme = Settings["appearance"]["theme"]

const DARK_QUERY = "(prefers-color-scheme: dark)"

const subscribeSystemDark = (onChange: () => void) => {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
const isSystemDark = () => window.matchMedia(DARK_QUERY).matches

const isDarkTheme = (theme: Theme, systemDark: boolean): boolean =>
  theme === "dark" || (theme === "system" && systemDark)

/**
 * Calls `apply` with the resolved theme now and whenever the OS preference changes.
 * Returns the unsubscribe function (for a React effect cleanup).
 */
export const watchResolvedTheme = (theme: Theme, apply: (dark: boolean) => void): () => void => {
  const run = () => apply(isDarkTheme(theme, isSystemDark()))
  run()
  return subscribeSystemDark(run)
}

/** Whether `theme` resolves to dark, following the OS preference live for "system". */
export const useDarkTheme = (theme: Theme): boolean =>
  isDarkTheme(theme, useSyncExternalStore(subscribeSystemDark, isSystemDark, () => true))
