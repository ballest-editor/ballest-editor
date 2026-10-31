import { Option } from "effect"

/**
 * Valve's text KeyValues (VDF), the format of `libraryfolders.vdf` and `appmanifest_*.acf`: quoted (or bare) keys,
 * each followed by a quoted string or a `{ … }` block, `//` comments. Keys are case-insensitive, so lookups go through
 * `vdfGet`.
 */
export interface VdfObject {
  readonly [key: string]: string | VdfObject
}

type Token =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "open" }
  | { readonly kind: "close" }

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", "\"": "\"" }

/**
 * Every character belongs to one alternative: space, a `//` comment, a brace, a quoted string, a bare token
 * (`#include`, or an unquoted key or value), or a quote that never closes.
 */
const TOKEN = /\s+|\/\/[^\n]*|([{}])|"((?:[^"\\]|\\.)*)"|([^\s"{}]+)|(")/g

/** The tokens of `text`, or none when a quoted string runs off the end. */
const tokenize = (text: string): Option.Option<ReadonlyArray<Token>> => {
  const tokens: Array<Token> = []
  for (const [, brace, quoted, bare, unterminated] of text.matchAll(TOKEN)) {
    if (unterminated !== undefined) return Option.none()
    if (brace !== undefined) tokens.push(brace === "{" ? { kind: "open" } : { kind: "close" })
    else if (quoted !== undefined) {
      tokens.push({ kind: "string", value: quoted.replace(/\\(.)/g, (_, c: string) => ESCAPES[c] ?? `\\${c}`) })
    } else if (bare !== undefined) tokens.push({ kind: "string", value: bare })
  }
  return Option.some(tokens)
}

/** Parses a KeyValues document; none when it is malformed (unbalanced braces, a key without a value). */
export const parseVdf = (text: string): Option.Option<VdfObject> =>
  Option.flatMap(tokenize(text), (tokens) => {
    let i = 0
    /** The entries up to the matching `}` (or the end, at the top level). */
    const block = (topLevel: boolean): VdfObject | undefined => {
      const out: Record<string, string | VdfObject> = {}
      for (let key = tokens[i++]; key !== undefined; key = tokens[i++]) {
        if (key.kind === "close") return topLevel ? undefined : out
        if (key.kind === "open") return undefined
        const value = tokens[i++]
        if (value === undefined || value.kind === "close") return undefined
        if (value.kind === "string") out[key.value] = value.value
        else {
          const inner = block(false)
          if (inner === undefined) return undefined
          out[key.value] = inner
        }
      }
      return topLevel ? out : undefined
    }
    return Option.fromUndefinedOr(block(true))
  })

/** The value under `key`, matched case-insensitively like Steam does. */
export const vdfGet = (object: VdfObject, key: string): string | VdfObject | undefined => {
  const lower = key.toLowerCase()
  const found = Object.keys(object).find((k) => k.toLowerCase() === lower)
  return found === undefined ? undefined : object[found]
}

const vdfObject = (value: string | VdfObject | undefined): VdfObject | undefined =>
  typeof value === "object" ? value : undefined

/**
 * The library folders `libraryfolders.vdf` lists. Current Steam writes `"0" { "path" "…" … }`; older versions wrote
 * `"1" "D:\\SteamLibrary"` next to settings such as `"TimeNextStatsReport"`, so only numbered keys count.
 */
export const libraryFoldersOf = (text: string): ReadonlyArray<string> =>
  Option.match(parseVdf(text), {
    onNone: () => [],
    onSome: (root) => {
      const folders = vdfObject(vdfGet(root, "libraryfolders"))
      if (folders === undefined) return []
      return Object.entries(folders).flatMap(([key, value]) => {
        if (!/^\d+$/.test(key)) return []
        const path = typeof value === "string" ? value : vdfGet(value, "path")
        return typeof path === "string" && path.length > 0 ? [path] : []
      })
    }
  })

/** `AppState.installdir` of an app manifest: the folder under `steamapps/common`. */
export const installDirOf = (text: string): Option.Option<string> =>
  Option.flatMap(parseVdf(text), (root) => {
    const state = vdfObject(vdfGet(root, "AppState"))
    const dir = state === undefined ? undefined : vdfGet(state, "installdir")
    return typeof dir === "string" && dir.length > 0 ? Option.some(dir) : Option.none()
  })

/** A Steam user's 64-bit id: the key of each entry in `loginusers.vdf`. */
const STEAM_ID = /^\d+$/

/**
 * The display name (`PersonaName`) of the account Steam last logged in with, from `config/loginusers.vdf`: the user
 * marked `MostRecent "1"`, else the one with the newest `Timestamp` (Steam on Linux writes no `MostRecent`). None when
 * the file lists nobody with a name. Not trimmed: the caller checks the name as the game would write it.
 */
export const personaNameOf = (text: string): Option.Option<string> =>
  Option.flatMap(parseVdf(text), (root) => {
    const users = vdfObject(vdfGet(root, "users"))
    if (users === undefined) return Option.none()
    const named = Object.entries(users).flatMap(([id, user]) => {
      if (!STEAM_ID.test(id) || typeof user !== "object") return []
      const name = vdfGet(user, "PersonaName")
      if (typeof name !== "string" || name.length === 0) return []
      const timestamp = Number(vdfGet(user, "Timestamp"))
      return [{
        name,
        mostRecent: vdfGet(user, "MostRecent") === "1",
        timestamp: Number.isFinite(timestamp) ? timestamp : 0
      }]
    })
    const mostRecent = named.find((user) => user.mostRecent)
    if (mostRecent !== undefined) return Option.some(mostRecent.name)
    const newest = named.reduce<(typeof named)[number] | undefined>(
      (best, user) => best === undefined || user.timestamp > best.timestamp ? user : best,
      undefined
    )
    return Option.fromUndefinedOr(newest?.name)
  })
