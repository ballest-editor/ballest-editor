/** Finds the `*.states.ts` files. They sit beside the views they show, and nothing keeps a list of them. */
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { repoRoot } from "./session.ts"
import type { State } from "./state.ts"

export interface LoadedState extends State {
  readonly id: string
  readonly file: string
}

export const loadStates = async (): Promise<ReadonlyArray<LoadedState>> => {
  const root = path.join(repoRoot, "apps/web/src")
  const files = fs.readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".states.ts")
  )
  const loaded = await Promise.all(
    files.sort().map(async (file) => {
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- a state file's default export, typed where it's written
      const module: { readonly default: Readonly<Record<string, State>> } = await import(
        pathToFileURL(path.join(root, file)).href
      )
      return Object.entries(module.default).map(([id, state]) => ({ ...state, id, file: `apps/web/src/${file}` }))
    })
  )
  return loaded.flat()
}

/** The states a run's filters leave: by id, or by a view they show. */
export const pickStates = (
  states: ReadonlyArray<LoadedState>,
  ids: ReadonlyArray<string>,
  views: ReadonlyArray<string>
): ReadonlyArray<LoadedState> => {
  if (ids.length === 0 && views.length === 0) return states
  const unknown = ids.filter((id) => !states.some((state) => state.id === id))
  if (unknown.length > 0) throw new Error(`no state ${unknown.join(", ")}`)
  return states.filter((state) => ids.includes(state.id) || state.views.some((view) => views.includes(view)))
}
