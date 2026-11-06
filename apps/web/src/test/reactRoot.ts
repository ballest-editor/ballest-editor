import { afterEach, beforeEach } from "@effect/vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { vi } from "vitest"

class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** A React root on a fresh element for each test in a jsdom file, with what jsdom lacks and Base UI's popups ask for. */
export const reactRootPerTest = () => {
  const host = document.createElement("div")
  const mounted = { host, root: createRoot(host) }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    // jsdom lays nothing out and animates nothing, and Base UI's positioner and scroll area watch for both
    vi.stubGlobal("ResizeObserver", NoObserver)
    vi.stubGlobal("IntersectionObserver", NoObserver)
    Element.prototype.getAnimations = () => []
    mounted.host = document.body.appendChild(document.createElement("div"))
    mounted.root = createRoot(mounted.host)
  })
  afterEach(() => {
    act(() => mounted.root.unmount())
    mounted.host.remove()
    vi.unstubAllGlobals()
  })
  return mounted
}
