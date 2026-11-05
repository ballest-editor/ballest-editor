/** What the page says about the updater outside the status bar, which only shows a release on offer. */
import type { UpdateState } from "@ballest/contracts"

/** Whether a check can start: main ignores one while a check runs, or once a release is on offer. */
export const canCheckForUpdates = (state: UpdateState): boolean => state.status === "idle" || state.status === "error"

/** Beside the version in the status bar; null when there's nothing to say, or the update pill is saying it. */
export const updateStatusOf = (state: UpdateState, checked: boolean): string | null => {
  switch (state.status) {
    case "checking":
      return "Checking for updates…"
    case "error":
      return checked ? "Couldn't check for updates" : null
    case "idle":
      return checked ? "Up to date" : null
    default:
      return null
  }
}

/** The running version and where the updater is. `checked`: a check the user asked for has finished. */
export const updateSummaryOf = (state: UpdateState, checked: boolean): string => {
  const version = `Ballest Editor ${state.currentVersion}.`
  switch (state.status) {
    case "disabled":
      return `${version} ${state.message ?? "Updates are off."}`
    case "idle":
      return checked ? `${version} This is the latest version.` : version
    case "checking":
      return `${version} Checking for updates…`
    case "error":
      return `${version} Couldn't check for updates. Check your connection and try again.`
    case "available":
    case "downloading":
    case "ready":
      return `${version} ${state.availableVersion ?? "A new version"} is available: see the status bar.`
  }
}
