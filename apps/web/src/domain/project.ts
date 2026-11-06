import { nextFreeName } from "./factory"

/** A project folder's name, as New project and the first Save accept it; main checks the same (`Projects.createNew`). */
export { isProjectName } from "@ballest/contracts"

/** What `isProjectName` asks for, shown when a name breaks it. */
export const PROJECT_NAME_RULE = "Letters, digits, spaces, - and _ only."

/** The project name the first Save offers: "My Maps", numbered past the projects it would clash with (any case). */
export const defaultProjectNameOf = (taken: ReadonlyArray<string>): string => {
  const names = new Set(taken.map((name) => name.toLowerCase()))
  return nextFreeName("My Maps", (name) => names.has(name.toLowerCase()))
}

/** The names, in lower case, that more than one of `projects` goes by (any case): a name alone can't tell those apart. */
export const sharedProjectNames = (projects: ReadonlyArray<{ readonly name: string }>): ReadonlySet<string> => {
  const seen = new Set<string>()
  const shared = new Set<string>()
  for (const { name } of projects) {
    const key = name.toLowerCase()
    if (seen.has(key)) shared.add(key)
    seen.add(key)
  }
  return shared
}
