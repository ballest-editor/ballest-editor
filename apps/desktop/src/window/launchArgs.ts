import { Option } from "effect"

const PROJECT_FLAG = "--project="

/** The argument that starts a window on `project`. */
export const projectArgOf = (project: string) => `${PROJECT_FLAG}${project}`

/** The folder a `--project=<path>` on the command line names, as given; `Projects` decides whether to take it. */
export const parseProjectArg = (argv: ReadonlyArray<string>): Option.Option<string> =>
  Option.fromUndefinedOr(argv.find((arg) => arg.startsWith(PROJECT_FLAG) && arg.length > PROJECT_FLAG.length)).pipe(
    Option.map((arg) => arg.slice(PROJECT_FLAG.length))
  )

/**
 * The flags a new window keeps from this one: `--no-sandbox` is what lets some Linux desktops run an AppImage at all.
 * Not this window's project, and not its DevTools port, which only one process can hold.
 */
export const inheritedFlags = (argv: ReadonlyArray<string>): ReadonlyArray<string> =>
  argv.slice(1).filter((arg) =>
    arg.startsWith("--") && !arg.startsWith("--project") && !arg.startsWith("--remote-debugging-port")
  )
