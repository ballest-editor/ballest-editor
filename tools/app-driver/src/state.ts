/**
 * How a state is declared, in `*.states.ts` files beside the code they show (tools/app-driver/README.md). Plain data:
 * this file imports nothing, so the app's tests and the driver both load state files without the other's code.
 */

export const THEMES = ["dark", "light"] as const
export const WINDOWS = ["1280x800", "1600x1000", "2560x1440"] as const
export const PANES = ["single", "columns", "rows", "quad"] as const
export const DOCKS = ["default", "bare"] as const

/** What the driver sets before a state's steps. Orthogonal to the steps, so a state can run under any of them. */
export interface Axes {
  readonly theme: (typeof THEMES)[number]
  readonly window: (typeof WINDOWS)[number]
  readonly panes: (typeof PANES)[number]
  /** `bare` closes every panel around the centre group. */
  readonly dock: (typeof DOCKS)[number]
}

export const DEFAULT_AXES: Axes = { theme: "dark", window: "1600x1000", panes: "single", dock: "default" }

export const AXIS_VALUES: { readonly [K in keyof Axes]: ReadonlyArray<Axes[K]> } = {
  theme: THEMES,
  window: WINDOWS,
  panes: PANES,
  dock: DOCKS
}

export type Point = readonly [x: number, y: number]
/** A place on the page: a CSS selector's centre, `text:<a control's exact text>`, or a point in CSS pixels. */
export type Target = string | Point

export type Step =
  | { readonly do: "app"; readonly call: string; readonly args: ReadonlyArray<unknown> }
  | { readonly do: "click"; readonly at: Target; readonly button?: "left" | "right" }
  | { readonly do: "hover"; readonly at: Target }
  | { readonly do: "drag"; readonly from: Target; readonly to: Target; readonly steps?: number }
  | { readonly do: "key"; readonly key: string; readonly code?: string; readonly modifiers?: number }
  | { readonly do: "wheel"; readonly at: Target; readonly deltaY: number }
  | { readonly do: "answerDialog"; readonly path?: string | null; readonly button?: number }
  | { readonly do: "settle" }

/** Steps that call the app through the dev hook: how a state gets to where it starts. */
export const app = {
  settings: (patch: unknown): Step => ({ do: "app", call: "settings", args: [patch] }),
  select: (match: string, count = 1): Step => ({ do: "app", call: "select", args: [match, count] }),
  enterGroup: (groupId: string | null): Step => ({ do: "app", call: "enterGroup", args: [groupId] }),
  openDialog: (dialog: { readonly id: string } & Record<string, unknown>): Step => ({
    do: "app",
    call: "openDialog",
    args: [dialog]
  }),
  importClash: (fileName: string): Step => ({ do: "app", call: "importClash", args: [fileName] }),
  recoverUnsaved: (label: string): Step => ({ do: "app", call: "recoverUnsaved", args: [label] }),
  openSettings: (category: string): Step => ({ do: "app", call: "openSettings", args: [category] }),
  panes: (kind: Axes["panes"]): Step => ({ do: "app", call: "panes", args: [kind] }),
  togglePanel: (id: string): Step => ({ do: "app", call: "togglePanel", args: [id] }),
  popOut: (id: string): Step => ({ do: "app", call: "popOut", args: [id] })
}

/** Real events over the DevTools protocol: for states where the input is the subject. */
export const input = {
  click: (at: Target): Step => ({ do: "click", at }),
  rightClick: (at: Target): Step => ({ do: "click", at, button: "right" }),
  hover: (at: Target): Step => ({ do: "hover", at }),
  drag: (from: Target, to: Target, steps = 8): Step => ({ do: "drag", from, to, steps }),
  key: (key: string, code?: string, modifiers?: number): Step => ({
    do: "key",
    key,
    ...(code === undefined ? {} : { code }),
    ...(modifiers === undefined ? {} : { modifiers })
  }),
  wheel: (at: Target, deltaY: number): Step => ({ do: "wheel", at, deltaY })
}

/** Electron-only steps. `answerDialog` queues the answer for the next native dialog. */
export const desktop = {
  answerDialog: (answer: { readonly path?: string | null; readonly button?: number }): Step => ({
    do: "answerDialog",
    ...answer
  })
}

export const settle = (): Step => ({ do: "settle" })

export type Probe =
  | { readonly probe: "rect"; readonly selector: string; readonly field: "x" | "y" | "width" | "height" }
  | { readonly probe: "text"; readonly selector: string }
  | { readonly probe: "count"; readonly selector: string }
  | { readonly probe: "store"; readonly path: string }
  | { readonly probe: "scene"; readonly field: "objects" | "children" }
  | { readonly probe: "frames"; readonly ms: number }

export const rect = (selector: string, field: "x" | "y" | "width" | "height"): Probe => ({
  probe: "rect",
  selector,
  field
})
export const text = (selector: string): Probe => ({ probe: "text", selector })
export const count = (selector: string): Probe => ({ probe: "count", selector })
export const store = (path: string): Probe => ({ probe: "store", path })
export const scene = (field: "objects" | "children"): Probe => ({ probe: "scene", field })
/** Frame times over `ms`: only graded on a real GPU (`--gpu`), software WebGL says nothing about them. */
export const frames = (ms: number): Probe => ({ probe: "frames", ms })

export interface Check {
  readonly metric: string
  readonly max?: number
  readonly min?: number
  readonly equals?: number | boolean | string | null
}

export interface State {
  /** The views this state shows: the ids `apps/web/src/components/viewIds.ts` makes. */
  readonly views: ReadonlyArray<string>
  /** What is open first: `none`, `map:empty|simple|complex`, `sample:<part of a name>`, `file:<path>`. */
  readonly fixture?: string
  /** `desktop` runs in Electron: for popped-out panels, native dialogs and what a browser doesn't have. */
  readonly target?: "web" | "desktop"
  readonly reach?: ReadonlyArray<Step>
  readonly measure?: Readonly<Record<string, Probe>>
  readonly checks?: ReadonlyArray<Check>
  /** Runs in the light theme too, unless `--smoke`. */
  readonly anchor?: boolean
  /** Other values to run this state under: each runs once, with the other axes at their defaults. */
  readonly axes?: { readonly [K in keyof Axes]?: ReadonlyArray<Axes[K]> }
  /** `bad` reproduces a known bug: it fails until the fix, and doesn't fail the run. */
  readonly kind?: "guard" | "bad"
  /** The issue or PR a state came from. */
  readonly source?: string
  /** Why this state can't run yet. It still counts as coverage, and every summary shows the reason. */
  readonly pending?: string
}

export const states = <const S extends Readonly<Record<string, State>>>(declared: S): S => declared
