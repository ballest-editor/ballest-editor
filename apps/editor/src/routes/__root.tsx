import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import appCss from "@workspace/ui/globals.css?url"
import type { ReactNode } from "react"
import { panelWidthsScript } from "../components/SidePanel"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ballest Editor" }
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [{ children: panelWidthsScript }]
  }),
  component: RootComponent,
  notFoundComponent: () => <p className="p-8">Not found. The editor is at <a className="underline" href="/">/</a>.</p>
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    // panelWidthsScript sets style on <html> before hydration.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="overflow-hidden">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
