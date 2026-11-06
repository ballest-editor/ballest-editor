import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

const TRACK = "M-8 18C70 18 96 104 176 104S300 74 368 26"

/** A stretch of track with the ball on it. The track is `--primary` and the ball `--accent`, so both follow the theme. */
function TrackArt() {
  return (
    <svg
      viewBox="0 0 360 120"
      fill="none"
      aria-hidden
      // fades in from the left: the track has to end somewhere, and that keeps it off the text
      className="pointer-events-none absolute inset-y-0 right-0 h-full text-primary [mask-image:linear-gradient(to_right,transparent,black_40%)]"
    >
      <path d={TRACK} stroke="currentColor" strokeWidth="14" strokeLinecap="round" opacity="0.45" />
      <path d={TRACK} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="252" cy="72" r="13" className="fill-accent" />
    </svg>
  )
}

/** The colour behind the logo on the start screen and in About: a wash of the theme's two colours, and the track. */
export function HeroBand({ children, className }: { readonly children: ReactNode; readonly className: string }) {
  return (
    <div
      className={cn("relative overflow-hidden bg-linear-to-br from-primary/30 via-primary/10 to-accent/20", className)}
    >
      <TrackArt />
      <div className="relative">{children}</div>
    </div>
  )
}
