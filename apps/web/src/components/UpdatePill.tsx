import type { UpdateState } from "@ballest/contracts"
import { IconAlertTriangle, IconArrowDown, IconExternalLink, IconRefresh } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger
} from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useRef } from "react"
import { formatDate } from "../domain/time"
import { downloadUpdate, installUpdate, openExternalLink } from "../editor/actions"
import { useEditor, useUpdateState } from "../editor/store"
import { ReleaseNotes } from "./ReleaseNotes"

/** The states the pill shows; the others (no newer release, or updates off) show nothing. */
type Offer = "available" | "failed" | "downloading" | "ready"

const offerOf = (state: UpdateState): Offer | null => {
  switch (state.status) {
    case "available":
      return state.message === null ? "available" : "failed"
    case "downloading":
    case "ready":
      return state.status
    default:
      return null
  }
}

const percentOf = (state: UpdateState) => Math.floor(state.downloadPercent ?? 0)

const tooltipOf = (offer: Offer, state: UpdateState): string => {
  const version = state.availableVersion ?? "A new version"
  switch (offer) {
    case "available":
      return `Ballest Editor ${version} is available`
    case "failed":
      return `Couldn't download ${version}`
    case "downloading":
      return `Downloading ${version}: ${percentOf(state)}%`
    case "ready":
      return `${version} is downloaded. Restart to install it`
  }
}

/** A ring that fills with the download, at icon size. */
function ProgressRing({ percent }: { readonly percent: number }) {
  const radius = 5.5
  const circumference = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r={radius} fill="none" strokeWidth="2" className="stroke-muted-foreground/25" />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)}
        className="stroke-primary transition-[stroke-dashoffset]"
      />
    </svg>
  )
}

function PillFace({ offer, state }: { readonly offer: Offer; readonly state: UpdateState }) {
  switch (offer) {
    case "available":
      return (
        <>
          <span className="relative">
            <IconArrowDown className="size-3.5" />
            <span className="absolute -top-px -right-px size-1.5 rounded-full bg-primary ring-2 ring-card" />
          </span>
          Update
        </>
      )
    case "failed":
      return (
        <>
          <IconAlertTriangle className="size-3.5 text-destructive" />
          Update failed
        </>
      )
    case "downloading":
      return (
        <>
          <ProgressRing percent={state.downloadPercent ?? 0} />
          <span className="text-muted-foreground">{percentOf(state)}%</span>
        </>
      )
    case "ready":
      return (
        <>
          <IconRefresh className="size-3.5" />
          Restart to update
        </>
      )
  }
}

function DownloadProgress({ percent }: { readonly percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label="Download progress"
        aria-valuenow={Math.floor(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-8 text-right text-muted-foreground tabular-nums">{Math.floor(percent)}%</span>
    </div>
  )
}

/** The bottom of the popover, always in view: the release page and the next step. */
function Actions({ state, dirty }: { readonly state: UpdateState; readonly dirty: boolean }) {
  const { releaseUrl } = state
  return (
    <div className="flex flex-col gap-2 border-t px-3 py-2.5">
      {state.message !== null && <p className="text-destructive">{state.message}</p>}
      {state.status === "ready" && dirty && (
        <p>The map has unsaved changes. Save it first, or they are lost when the editor restarts.</p>
      )}
      {state.status === "downloading" && <DownloadProgress percent={state.downloadPercent ?? 0} />}
      <div className="flex min-h-7 items-center justify-end gap-2">
        {releaseUrl !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto -ml-2 text-muted-foreground"
            onClick={() => void openExternalLink(releaseUrl)}
          >
            View on GitHub
            <IconExternalLink data-icon="inline-end" />
          </Button>
        )}
        {state.status === "available" && (
          <Button onClick={() => void downloadUpdate()}>
            {state.message === null ? "Download" : "Try again"}
          </Button>
        )}
        {state.status === "ready" && (
          <Button
            variant={dirty ? "destructive" : "default"}
            onClick={() => void installUpdate()}
          >
            {dirty ? "Discard changes and restart" : "Restart"}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * The desktop updater at the right of the status bar (docs/DESKTOP.md § Packaging and release): a quiet "Update" with
 * a dot once a newer release is out, a ring while it downloads, and an accented "Restart to update" once it is on
 * disk. Its popover has what's new in the release and the next step. Nothing in a browser, or while there is no newer
 * release.
 */
export function UpdatePill() {
  const state = useUpdateState()
  const dirty = useEditor((s) => s.dirty)
  const offer = state === null ? null : offerOf(state)
  if (state === null || offer === null) return null

  return <Pill state={state} offer={offer} dirty={dirty} />
}

function Pill(
  { state, offer, dirty }: { readonly state: UpdateState; readonly offer: Offer; readonly dirty: boolean }
) {
  // Opening lands on the notes, so they scroll from the keyboard and no link inside them looks selected.
  const notes = useRef<HTMLDivElement>(null)
  const released = state.releaseDate === null ? null : `Released ${formatDate(state.releaseDate)}`
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          delay={500}
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className={cn(
                    "h-5 gap-1 px-1.5 text-xs font-normal tabular-nums",
                    offer === "ready" &&
                      "bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground aria-expanded:bg-primary/85 aria-expanded:text-primary-foreground"
                  )}
                />
              }
            />
          }
        >
          <PillFace offer={offer} state={state} />
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipOf(offer, state)}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" initialFocus={notes} className="w-96 gap-0 p-0">
        <div className="flex flex-col gap-0.5 px-3 pt-3 pb-2.5">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase">What's new</p>
          <PopoverTitle>Ballest Editor {state.availableVersion}</PopoverTitle>
          <PopoverDescription>
            {released === null ? `You have ${state.currentVersion}` : `${released} · You have ${state.currentVersion}`}
          </PopoverDescription>
        </div>
        <div
          ref={notes}
          tabIndex={0}
          aria-label="Release notes"
          className="max-h-[min(50vh,22rem)] overflow-y-auto border-t px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset dark:scheme-dark"
        >
          {state.releaseNotes === null
            ? <p className="text-muted-foreground">This release has no notes.</p>
            : <ReleaseNotes blocks={state.releaseNotes} />}
        </div>
        <Actions state={state} dirty={dirty} />
      </PopoverContent>
    </Popover>
  )
}
