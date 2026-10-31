import type { UpdateState } from "@ballest/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from "@workspace/ui/components/popover"
import { downloadUpdate, installUpdate } from "../editor/actions"
import { useEditor, useUpdateState } from "../editor/store"

/** What the pill says in each state that has something to offer; the others show nothing. */
const pillLabel = (state: UpdateState): string | null => {
  switch (state.status) {
    case "available":
      return state.message === null ? "Update available" : "Update failed"
    case "downloading":
      return `Downloading ${Math.floor(state.downloadPercent ?? 0)}%`
    case "ready":
      return "Restart to update"
    default:
      return null
  }
}

function DownloadProgress({ percent }: { readonly percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Download progress"
      aria-valuenow={Math.floor(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  )
}

/**
 * The desktop updater in the status bar (docs/DESKTOP.md § Packaging and release): "Update available", then the
 * download's progress, then "Restart to update". Its popover has the release notes and the next step. Nothing in a
 * browser, or while there is no newer release.
 */
export function UpdatePill() {
  const state = useUpdateState()
  const dirty = useEditor((s) => s.dirty)
  const label = state === null ? null : pillLabel(state)
  if (state === null || label === null) return null

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={state.status === "downloading" ? "outline" : "default"}
            size="xs"
            className="rounded-full px-2.5 tabular-nums"
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <PopoverHeader>
          <PopoverTitle>Ballest Editor {state.availableVersion}</PopoverTitle>
          <PopoverDescription>You have {state.currentVersion}.</PopoverDescription>
        </PopoverHeader>
        {state.releaseNotes !== null && (
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{state.releaseNotes}</p>
        )}
        {state.message !== null && <p className="text-destructive">{state.message}</p>}
        {state.status === "available" && (
          <Button className="self-end" onClick={() => void downloadUpdate()}>
            {state.message === null ? "Download" : "Try again"}
          </Button>
        )}
        {state.status === "downloading" && <DownloadProgress percent={state.downloadPercent ?? 0} />}
        {state.status === "ready" && (
          <>
            {dirty && <p>The map has unsaved changes. Save it first, or they are lost when the editor restarts.</p>}
            <Button
              className="self-end"
              variant={dirty ? "destructive" : "default"}
              onClick={() => void installUpdate()}
            >
              {dirty ? "Discard changes and restart" : "Restart"}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
