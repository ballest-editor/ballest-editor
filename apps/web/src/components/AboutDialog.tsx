import { LICENSE_URL, RELEASES_URL, REPOSITORY_URL } from "@ballest/contracts"
import { IconCheck, IconCopy } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui/components/dialog"
import { useState } from "react"
import { copyText, openExternalLink } from "../editor/actions"
import { useUpdateState } from "../editor/store"
import { HeroBand } from "./HeroBand"
import { Logo } from "./Logo"

/** The running version, and a button that copies it for a bug report: it says so until the pointer or focus leaves it. */
function VersionLine({ version }: { readonly version: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-secondary tabular-nums">Version {version}</span>
      <Button
        variant="outline"
        onClick={() => void copyText(version).then((done) => setCopied(done === true))}
        onPointerLeave={() => setCopied(false)}
        onBlur={() => setCopied(false)}
      >
        {copied ? <IconCheck data-icon="inline-start" /> : <IconCopy data-icon="inline-start" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

/** A web link in the dialog's text, opened in the default browser. */
function ExternalLink({ children, url }: { readonly children: string; readonly url: string }) {
  return (
    <button
      type="button"
      className="rounded-control underline underline-offset-3 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void openExternalLink(url)}
    >
      {children}
    </button>
  )
}

/** Help › About. The version comes from the updater, so a browser, which has none, leaves that line out. */
export function AboutDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const update = useUpdateState()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 p-0">
        <HeroBand className="p-dialog">
          <div className="flex items-center gap-3">
            <Logo className="size-10 shrink-0" />
            <DialogTitle>Ballest Editor</DialogTitle>
          </div>
        </HeroBand>
        <div className="flex flex-col gap-3 p-dialog">
          <DialogDescription className="text-fg-secondary">A map editor for Ballest of Them All.</DialogDescription>
          {update !== null && <VersionLine version={update.currentVersion} />}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-fg-secondary">
            <ExternalLink url={RELEASES_URL}>Release notes</ExternalLink>
            <ExternalLink url={REPOSITORY_URL}>GitHub repository</ExternalLink>
          </div>
          <p className="text-fg-tertiary">
            MIT licence, see <ExternalLink url={LICENSE_URL}>LICENSE</ExternalLink>.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
