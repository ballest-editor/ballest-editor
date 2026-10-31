import { createBrowserHistory, createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
// `vite build` hoists this into a <link> in index.html's head.
import "@workspace/ui/globals.css"
import { routeTree } from "./routeTree.gen"

// The desktop app serves this build from a custom protocol (`ballest://app/`, docs/DESKTOP.md), where routes live
// in the hash; on the web they are real paths. The preload defines `window.ballest` before any page script runs.
const router = createRouter({
  routeTree,
  history: window.ballest === undefined ? createBrowserHistory() : createHashHistory(),
  scrollRestoration: false
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById("root")
if (root === null) throw new Error("index.html has no #root")
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
