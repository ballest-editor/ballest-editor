// A plugin's info.toml, read the way the plugin manager's host reads it (src/host/plugins.cpp in
// ballest-plugin-manager): the subset of TOML it uses, and its version order.

/** The plugin's folder name in `plugins/`, which the plugin manager uses as its id. */
export const PLUGIN_ID = "ballest-editor-link"
export const MANIFEST = "info.toml"

export interface PluginManifest {
  /** `[meta] version`; the host's default is 0.0.0. */
  readonly version: string
  /** `[script] files`, the scripts the host compiles; the host's default is main.as. */
  readonly files: ReadonlyArray<string>
}

const unquote = (value: string) =>
  value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")
    ? value.slice(1, -1)
    : value

/** `section.key` → raw value. A `#` outside a string starts a comment; later keys win. */
const parseToml = (text: string): ReadonlyMap<string, string> => {
  const out = new Map<string, string>()
  let section = ""
  for (const raw of text.split("\n")) {
    let quoted = false
    let end = raw.length
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "\"") quoted = !quoted
      if (raw[i] === "#" && !quoted) {
        end = i
        break
      }
    }
    const line = raw.slice(0, end).trim()
    if (line.length === 0) continue
    const eq = line.indexOf("=")
    if (line.startsWith("[") && line.endsWith("]")) section = line.slice(1, -1).trim()
    else if (eq !== -1) out.set(`${section}.${line.slice(0, eq).trim()}`, line.slice(eq + 1).trim())
  }
  return out
}

const stringList = (value: string): ReadonlyArray<string> =>
  (value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(unquote)

export const parseManifest = (text: string): PluginManifest => {
  const toml = parseToml(text)
  const version = toml.get("meta.version")
  const files = toml.get("script.files")
  return {
    version: version === undefined ? "0.0.0" : unquote(version),
    files: files === undefined ? ["main.as"] : stringList(files)
  }
}

/** A dot-separated segment's number as C's `atol` reads it: its leading digits, or 0. */
const segmentNumber = (segment: string) => Number(/^\s*[+-]?\d+/.exec(segment)?.[0] ?? 0)

/** The host's `CompareVersions`: dot-separated numbers, a missing one counting as 0. Negative when `a` is older. */
export const compareVersions = (a: string, b: string): number => {
  const as = a.split(".")
  const bs = b.split(".")
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = segmentNumber(as[i] ?? "0")
    const y = segmentNumber(bs[i] ?? "0")
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** A file name a manifest may list for the installer to copy: inside the plugin's folder, no way out of it. */
export const isPluginFileName = (name: string): boolean =>
  name.length > 0 && !/^[\\/]|^[a-z]:/i.test(name) && !name.split(/[\\/]/).some((part) => part === ".." || part === "")
