/** What the page says about the updater outside the status bar, which only shows a release on offer. */
import type { UpdateState } from "@ballest/contracts"

/** Why a check can't start, or null when it can: main ignores one while a check runs, or once a release is on offer. */
export const updateCheckBlockedBy = (state: UpdateState): string | null => {
  switch (state.status) {
    case "idle":
    case "error":
      return null
    case "disabled":
      return state.message ?? "Updates are off."
    case "checking":
      return "Already checking for updates."
    case "available":
    case "downloading":
    case "ready":
      return `${state.availableVersion ?? "A new version"} is available: see the status bar.`
  }
}

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
