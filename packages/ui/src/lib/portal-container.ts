import { createContext, useContext } from "react"

/**
 * Where menus, selects, popovers and tooltips portal to: the page's body unless a provider says otherwise. A panel
 * popped out into a window of its own provides that window's body, or its popups would open in the main window.
 */
export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined)

export const usePortalContainer = (): HTMLElement | undefined => useContext(PortalContainerContext)
