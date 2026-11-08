import { viewLayoutKinds } from "../domain/viewLayout"
import { dialogIds, settingsCategories } from "../editor/store"
import { dockPanels } from "./dock/panels"
import { MENU_TITLES } from "./menuModel"

/** The popovers with rows of their own: the viewport's Display and Snap, and the top bar's snap menu. */
const POPOVERS = ["display", "snap", "snapMenu"] as const

/**
 * Every view the app has, read from the registries that make them: what the app driver's coverage is measured against
 * (tools/app-driver/README.md). A view added to one of these needs a state in a `*.states.ts` file.
 */
export const viewIds = (): ReadonlyArray<string> => [
  ...dockPanels.map(({ id }) => `panel:${id}`),
  ...dialogIds.map((id) => `dialog:${id}`),
  ...settingsCategories.map((id) => `settings:${id}`),
  ...MENU_TITLES.map((title) => `menu:${title}`),
  ...viewLayoutKinds.map((kind) => `viewport:${kind}`),
  ...POPOVERS.map((id) => `popover:${id}`)
]
