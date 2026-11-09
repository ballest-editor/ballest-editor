import { ERROR_TEXT_LIMIT } from "@ballest/contracts"

/** Who runs the app: their home folder and login name, the two things an error's text most often gives away. */
export interface ScrubContext {
  readonly home: string
  readonly user: string
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The installed app's own files: `…/resources/app.asar/main.cjs` becomes `<app>/main.cjs`. */
const APP_ASAR = /(?:[A-Za-z]:)?[\\/][^"'()<>\n]*?[\\/]resources[\\/]app\.asar((?:[\\/][^\s"'()<>:]+)*)/g

/** A map or prefab file's name after a folder (it may have spaces), or standing alone (it can't). */
const MAP_AFTER_FOLDER = /([\\/])[^\\/\n"'<>]*\.(?:balledit|ballmap|ballprefab)\b/g
const MAP_ALONE = /[^\s\\/"'<>]+\.(?:balledit|ballmap|ballprefab)\b/g

/**
 * An absolute path that starts a word: everything but its last segment goes. `~/…`, `<app>/…` and URLs (`file:///`,
 * `ballest://`) don't start with a separator or a drive, so they stay.
 */
const ABSOLUTE_PATH = /(?<=^|[\s("'=])(?:[A-Za-z]:)?(?:[\\/][^\s\\/"'()<>:]+)+([\\/])([^\s\\/"'()<>:]+)/g

/** A login name shorter than this is too likely to be an ordinary word to scrub. */
const MIN_USER_LENGTH = 3

/**
 * An error's message or stack with what could identify the user taken out (docs/DESKTOP.md § Feedback and usage
 * statistics): the home folder becomes `~`, the login name `<user>`, map and prefab file names `<map>`, other absolute
 * paths keep only their last segment, and the installed app's own files are `<app>/…`. Then cut to `ERROR_TEXT_LIMIT`.
 */
export const scrubErrorText = (text: string, { home, user }: ScrubContext): string => {
  let out = text.replace(APP_ASAR, (_, rest: string) => `<app>${rest.replaceAll("\\", "/")}`)
  if (home.length > 1) {
    const anySlash = home.split(/[\\/]+/).map(escape).join("[\\\\/]+")
    out = out.replace(new RegExp(`${anySlash}(?![\\w.-])`, "gi"), "~")
  }
  out = out.replace(MAP_AFTER_FOLDER, "$1<map>").replace(MAP_ALONE, "<map>")
  out = out.replace(ABSOLUTE_PATH, (_, separator: string, last: string) => `<path>${separator}${last}`)
  if (user.length >= MIN_USER_LENGTH) out = out.replace(new RegExp(`\\b${escape(user)}\\b`, "gi"), "<user>")
  return out.length > ERROR_TEXT_LIMIT ? `${out.slice(0, ERROR_TEXT_LIMIT - 1)}…` : out
}
