// Reading the plugin manager host's log (`host.log`): the test channel answers there, one line per reply, and the
// host's own lines say how far the game has started. Pure functions over the log's text.

export interface LogLine {
  readonly time: string
  readonly level: string
  readonly source: string
  readonly text: string
}

const LINE = /^\[(\d\d:\d\d:\d\d\.\d+)\] \[(\w+)\] \[([^\]]*)\] (.*)$/

/** One log line taken apart, or null for a line that isn't one (a continuation, a blank). */
export const parseLine = (line: string): LogLine | null => {
  const m = LINE.exec(line)
  if (m === null) return null
  return { time: m[1] ?? "", level: m[2] ?? "", source: m[3] ?? "", text: m[4] ?? "" }
}

/** The test channel's replies in a stretch of log text: the `test: ` lines, without that prefix. */
export const replies = (text: string): Array<string> => {
  const out: Array<string> = []
  for (const raw of text.split("\n")) {
    const line = parseLine(raw.replace(/\r$/, ""))
    if (line?.source === "host" && line.text.startsWith("test: ")) out.push(line.text.slice(6))
  }
  return out
}

export type SandboxState = "off" | "starting" | "incomplete" | "complete"

/** What the host has said about its sandbox so far. */
export const sandboxState = (log: string): SandboxState => {
  if (log.includes("sandbox: status on, complete")) return "complete"
  if (log.includes("sandbox: status on, INCOMPLETE")) return "incomplete"
  if (log.includes("sandbox mode is on")) return "starting"
  return "off"
}

/** The main menu is up with the host's footer button: the copy takes commands. */
export const isReady = (log: string): boolean => log.includes("footer button 'plugins' placed")

/** The host version the log opens with. */
export const hostVersion = (log: string): string | null => /plugin host (\S+) starting/.exec(log)?.[1] ?? null

/** The last `n` lines. */
export const tail = (log: string, n: number): Array<string> => {
  const lines = log.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines.slice(Math.max(0, lines.length - n))
}
