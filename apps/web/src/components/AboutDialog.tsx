import { LICENSE_URL, RELEASES_URL, REPOSITORY_URL, type UpdateState } from "@ballest/contracts"
import { IconCheck, IconChevronLeft, IconCopy } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui/components/dialog"
import { lazy, Suspense, useState } from "react"
import { buildInfo } from "virtual:build-info"
import { buildInfoText } from "../domain/buildInfo"
import { updateCheckBlockedBy, updateCheckLine } from "../domain/updates"
import { checkForUpdates, copyText, openExternalLink } from "../editor/actions"
import { useEditor, useUpdateState } from "../editor/store"
import { useNow } from "../editor/useNow"
import { HeroBand } from "./HeroBand"
import { Logo } from "./Logo"

const ThirdPartyNotices = lazy(() => import("./ThirdPartyNotices"))

/** Facts for a bug report in a mono block, and a button that copies them: it says so until the pointer or focus leaves it. */
function BuildInfo({ version }: { readonly version: string | null }) {
  const versions = useEditor((s) => s.runtimeVersions)
  const [copied, setCopied] = useState(false)
  const text = buildInfoText({
    ...buildInfo,
    version,
    electron: versions?.electron ?? null,
    chromium: versions?.chrome ?? null
  })
  return (
    <div className="flex items-start justify-between gap-2 rounded-surface bg-muted p-2.5">
      <pre className="min-w-0 overflow-x-auto font-mono text-caption text-fg-secondary">{text}</pre>
      <Button
        variant="outline"
        onClick={() => void copyText(text).then((done) => setCopied(done === true))}
        onPointerLeave={() => setCopied(false)}
        onBlur={() => setCopied(false)}
      >
        {copied ? <IconCheck data-icon="inline-start" /> : <IconCopy data-icon="inline-start" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

/** Check for updates, with what the updater last found beside it. A browser has no updater, so no row. */
function UpdateRow({ state }: { readonly state: UpdateState }) {
  const now = useNow()
  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        className="shrink-0"
        disabled={updateCheckBlockedBy(state) !== null}
        onClick={() => void checkForUpdates()}
      >
        Check for updates
      </Button>
      {/* a failed check's reason is a raw network error, too long for the line */}
      <span role="status" className="min-w-0 text-fg-tertiary" title={state.message ?? undefined}>
        {updateCheckLine(state, now)}
      </span>
    </div>
  )
}

/** A link in the dialog's text. */
function TextLink({ children, onClick }: { readonly children: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-control underline underline-offset-3 focus-ring hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** A web link in the dialog's text, opened in the default browser. */
const ExternalLink = ({ children, url }: { readonly children: string; readonly url: string }) => (
  <TextLink onClick={() => void openExternalLink(url)}>{children}</TextLink>
)

/** The list in the dialog's place, back to the rest with one click. */
function LicencesPage({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex flex-col gap-2 p-dialog">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Back to About" onClick={onBack}>
          <IconChevronLeft />
        </Button>
        <h3 className="text-title">Open-source licences</h3>
      </div>
      <Suspense fallback={<p className="py-8 text-center text-fg-tertiary">Loading…</p>}>
        <ThirdPartyNotices />
      </Suspense>
    </div>
  )
}

/** Help › About. The version comes from the updater, so a browser, which has none, leaves that line out. */
export function AboutDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const update = useUpdateState()
  const [licences, setLicences] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && setLicences(false)}
    >
      <DialogContent className="gap-0 p-0">
        <HeroBand className="p-dialog">
          <div className="flex items-center gap-3">
            <Logo className="size-10 shrink-0" />
            <DialogTitle>Ballest Editor</DialogTitle>
          </div>
        </HeroBand>
        {licences ? <LicencesPage onBack={() => setLicences(false)} /> : (
          <div className="flex flex-col gap-3 p-dialog">
            <DialogDescription className="text-fg-secondary">A map editor for Ballest of Them All.</DialogDescription>
            <BuildInfo version={update?.currentVersion ?? null} />
            {update !== null && <UpdateRow state={update} />}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-fg-secondary">
              <ExternalLink url={RELEASES_URL}>Release notes</ExternalLink>
              <ExternalLink url={REPOSITORY_URL}>GitHub repository</ExternalLink>
            </div>
            <p className="text-fg-tertiary">
              MIT licence, see <ExternalLink url={LICENSE_URL}>LICENSE</ExternalLink>
              {" · "}
              <TextLink onClick={() => setLicences(true)}>Open-source licences</TextLink>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
