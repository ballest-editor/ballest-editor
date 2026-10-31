/**
 * The creator name: the in-game name the game writes into every map's `creatorName` and file name. The game uses the
 * Steam persona name, so the desktop app finds that (or, without Steam's login file, the creator of the maps already in
 * the maps folder); Settings › General can replace it.
 */
import { Option } from "effect"
import { isValidName, NAME_RULE } from "./factory"

/** Where a creator name was found on this machine (`FoundCreator` in @ballest/contracts). */
export interface FoundCreator {
  readonly name: string
  readonly source: "steam" | "mapsFolder"
}

/** The creator in use and where it comes from, as Settings and the Game link checklist show it. */
export interface Creator {
  /** The name as found or typed; "" when there is none. */
  readonly name: string
  /** `user`: typed in Settings. `none`: nothing typed and nothing found. */
  readonly source: FoundCreator["source"] | "user" | "none"
  /** Whether `name` can go into a map's file name (`isValidName`). */
  readonly valid: boolean
}

/** The creator to use: the one typed in Settings (`setting`, null when none was), else the one found. */
export const creatorOf = (setting: string | null, found: Option.Option<FoundCreator>): Creator => {
  if (setting !== null) return { name: setting.trim(), source: "user", valid: isValidName(setting.trim()) }
  return Option.match(found, {
    onNone: () => ({ name: "", source: "none", valid: false }),
    onSome: ({ name, source }) => ({ name, source, valid: isValidName(name) })
  })
}

/** The creator's name when a map can use it, else "" (the user is asked for one). */
export const usableCreatorName = (creator: Creator): string => creator.valid ? creator.name : ""

const SOURCE_LABELS = { steam: "Steam", mapsFolder: "your maps" } as const

/** "From Steam", "From your maps": where a found name came from, for the row that shows it. */
export const foundCreatorLabel = (source: FoundCreator["source"]): string => `From ${SOURCE_LABELS[source]}`

const FOUND_AS = { steam: "Your Steam name", mapsFolder: "The creator of your maps" } as const

/** Why a found or typed name can't be used, for Settings to show instead of using it; none when it can. */
export const creatorProblem = (creator: Creator): Option.Option<string> => {
  if (creator.valid || creator.name === "") return Option.none()
  return Option.some(
    creator.source === "user" || creator.source === "none"
      ? `A map file name allows ${NAME_RULE}.`
      : `${
        FOUND_AS[creator.source]
      }, "${creator.name}", has characters a map file name can't have (${NAME_RULE}). Type the name to use instead.`
  )
}
