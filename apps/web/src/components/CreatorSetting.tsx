import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Option } from "effect"
import { type Creator, creatorProblem, type FoundCreator, foundCreatorLabel } from "../domain/creator"
import type { SettingsCategory } from "../editor/store"
import type { SettingsRow } from "./SettingsShell"

const ABOUT = "Your in-game name. Written into every exported map and its file name (letters, digits and spaces)."

const USE_FOUND = { steam: "Use Steam name", mapsFolder: "Use name from maps" } as const

/** Where the name in use came from, then what it is for. */
const describe = (creator: Creator, found: Option.Option<FoundCreator>): string => {
  if (creator.source === "steam" || creator.source === "mapsFolder") {
    return `${foundCreatorLabel(creator.source)}. ${ABOUT}`
  }
  return Option.match(found, {
    onNone: () => ABOUT,
    onSome: ({ name, source }) =>
      creator.source === "user" && creator.name !== name
        ? `${ABOUT} ${foundCreatorLabel(source)}: ${name}.`
        : ABOUT
  })
}

/**
 * Settings › General › Creator name: the name found (the Steam persona name) until the user types another, which then
 * sticks; "Use Steam name" goes back to the one found. A found name a file name can't hold isn't used, and the row
 * says why.
 */
export const creatorSettingsRow = (props: {
  readonly creator: Creator
  /** What Settings holds: the name as typed (untrimmed), or null. */
  readonly setting: string | null
  readonly found: Option.Option<FoundCreator>
  /** The typed name, or null to use the one found. */
  readonly onChange: (creatorName: string | null) => void
}): SettingsRow<SettingsCategory> => {
  const { creator, setting, found, onChange } = props
  const problem = creatorProblem(creator)
  const typed = creator.source === "user"
  return {
    id: "creatorName",
    category: "general",
    label: "Creator name",
    description: describe(creator, found),
    keywords: "steam persona in-game name",
    changes: { modified: typed, reset: () => onChange(null) },
    ...(typed && Option.isSome(found)
      ? {
        action: (
          <Button variant="outline" size="sm" onClick={() => onChange(null)}>
            {USE_FOUND[found.value.source]}
          </Button>
        )
      }
      : {}),
    control: (
      <div className="flex w-56 flex-col gap-1">
        <Input
          value={setting ?? creator.name}
          placeholder="your in-game name"
          aria-invalid={Option.isSome(problem)}
          onChange={(e) => onChange(e.target.value)}
        />
        {Option.isSome(problem) && <span className="text-[0.7rem] text-destructive">{problem.value}</span>}
      </div>
    )
  }
}
