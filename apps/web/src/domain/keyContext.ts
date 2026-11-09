/**
 * Where a keybind works (docs/design/keybinding-contexts.md). Every action declares a `When`: the drags it is live in,
 * the tools, and the platforms. The editor reads the matching `KeyContext` off its state when a key or button comes,
 * and only the bindings whose `When` matches are considered. Two bindings on one chord are fine when their conditions
 * can't both hold, which is how Ctrl flies down with nothing dragged and turns snapping off during a move.
 */

/** What is being dragged, if anything. One at a time. */
const drags = ["none", "camera", "move", "turn", "scale", "place", "stroke", "scrub"] as const
export type Drag = (typeof drags)[number]

/** The drags that change the map: "while dragging" in Settings' words. Looking and a number field's scrub aren't. */
const mapDrags: ReadonlyArray<Drag> = ["move", "turn", "scale", "place", "stroke"]

export const tools = ["select", "translate", "rotate", "scale", "repeat", "paint"] as const
export type Tool = (typeof tools)[number]

export const platforms = ["desktop", "browser"] as const
export type Platform = (typeof platforms)[number]

/** A condition: every field set has to hold, each as "any of". A field left unset holds always, except `drag`, which unset means "nothing dragged". */
export interface When {
  readonly drag?: ReadonlyArray<Drag>
  readonly tool?: ReadonlyArray<Tool>
  readonly platform?: ReadonlyArray<Platform>
}

/** The editor's state, as far as keybinds care. */
export interface KeyContext {
  readonly drag: Drag
  readonly tool: Tool
  readonly platform: Platform
}

export const dragsOf = (when: When): ReadonlyArray<Drag> => when.drag ?? ["none"]
const toolsOf = (when: When): ReadonlyArray<Tool> => when.tool ?? tools
const platformsOf = (when: When): ReadonlyArray<Platform> => when.platform ?? platforms

/** Does `when` hold in `ctx`? */
export const matches = (when: When, ctx: KeyContext): boolean =>
  dragsOf(when).includes(ctx.drag) && toolsOf(when).includes(ctx.tool) && platformsOf(when).includes(ctx.platform)

const intersect = <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean => a.some((x) => b.includes(x))
const subset = <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean => a.every((x) => b.includes(x))

/** Can `a` and `b` hold at once? Then two bindings on one chord with these conditions contend. */
export const overlaps = (a: When, b: When): boolean =>
  intersect(dragsOf(a), dragsOf(b)) && intersect(toolsOf(a), toolsOf(b)) && intersect(platformsOf(a), platformsOf(b))

/** Does `a` hold only where `b` does? Equal conditions are within each other. */
export const within = (a: When, b: When): boolean =>
  subset(dragsOf(a), dragsOf(b)) && subset(toolsOf(a), toolsOf(b)) && subset(platformsOf(a), platformsOf(b))

/** Does `when` need a drag to be under way? Nothing fires such an action from a key by itself. */
export const needsDrag = (when: When): boolean => !dragsOf(when).includes("none")

/**
 * How narrow a condition is, for which of two matching bindings wins: a field set counts, and `drag` only when it
 * excludes "none", so a key that also works during a drag isn't narrower than one that doesn't.
 */
export const specificity = (when: When): number =>
  (needsDrag(when) ? 1 : 0) + (when.tool === undefined ? 0 : 1) + (when.platform === undefined ? 0 : 1)

const DRAG_WORDS: Readonly<Record<Drag, string>> = {
  none: "nothing is dragged",
  camera: "looking",
  move: "moving",
  turn: "turning",
  scale: "scaling",
  place: "placing",
  stroke: "painting",
  scrub: "scrubbing"
}

const TOOL_WORDS: Readonly<Record<Tool, string>> = {
  select: "Select",
  translate: "Move",
  rotate: "Rotate",
  scale: "Scale",
  repeat: "Repeat",
  paint: "Paint"
}

const PLATFORM_WORDS: Readonly<Record<Platform, string>> = { desktop: "Desktop app", browser: "Browser" }

const list = (words: ReadonlyArray<string>, joiner: string): string =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} ${joiner} ${words.at(-1)}`

/**
 * The condition in Settings' words: "While moving", "While dragging", "Paint tool", "Desktop app", joined with commas.
 * Empty for a key that works with nothing dragged, in every tool, everywhere, and for one that also works while
 * dragging: that it does is the action's description's to say.
 */
export const describeWhen = (when: When): string => {
  const parts: Array<string> = []
  const drag = dragsOf(when)
  if (!drag.includes("none")) {
    const moving: ReadonlyArray<Drag> = drag.filter((d) => d !== "none")
    const whole = mapDrags.every((d) => moving.includes(d)) && moving.every((d) => mapDrags.includes(d))
    parts.push(whole ? "While dragging" : `While ${list(moving.map((d) => DRAG_WORDS[d]), "or")}`)
  }
  if (when.tool !== undefined) {
    parts.push(`${list(when.tool.map((t) => TOOL_WORDS[t]), "and")} tool${when.tool.length > 1 ? "s" : ""}`)
  }
  if (when.platform !== undefined && when.platform.length < platforms.length) {
    parts.push(when.platform.map((p) => PLATFORM_WORDS[p]).join(" or "))
  }
  return parts.join(", ")
}
