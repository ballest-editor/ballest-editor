import { createRootRoute, Link, Outlet } from "@tanstack/react-router"

// The document (title, the saved panel widths) is index.html; main.tsx mounts the router.
export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <p className="p-8">
      Not found. The editor is at{" "}
      <Link className="underline" to="/">
        /
      </Link>.
    </p>
  )
})
