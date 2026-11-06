import { nextFreeName } from "./factory"

/** A project folder's name, as New project and the first Save accept it; main checks the same (`Projects.createNew`). */
export { isProjectName } from "@ballest/contracts"

/** The project name the first Save offers: "My Maps", numbered past the projects it would clash with (any case). */
export const defaultProjectNameOf = (taken: ReadonlyArray<string>): string => {
  const names = new Set(taken.map((name) => name.toLowerCase()))
  return nextFreeName("My Maps", (name) => names.has(name.toLowerCase()))
}
