/**
 * A map's difficulty and Workshop tags: `levelData.levelDifficulty` and
 * `levelData.mapTags.gameplayTags`, as the game's publish screen sets them. Names come
 * from the shipping exe (`EBallgameDifficulty`, `MapTags.UGCTags.Difficulty`) and the
 * English locres; see docs/FORMAT.md, "Difficulty and tags".
 *
 * Tags the editor doesn't know (the old ungrouped `MapTags.UGCTags.<tag>` form, anything a
 * later game version adds) are never touched: edits only add or remove the tags below.
 */
import type { LevelData } from "./MapFile"

/** Every map the game writes with tags lists this first. */
export const MAP_TYPE_TAG = "UGCTypes.Map"

const UGC_TAGS = "MapTags.UGCTags"

/**
 * The five difficulties, easiest first: `level` is the `EBallgameDifficulty` name written to
 * `levelDifficulty`, `tag` the leaf of `MapTags.UGCTags.Difficulty.<tag>`.
 */
export const DIFFICULTIES = [
  { tag: "beginner", level: "Beginner" },
  { tag: "medium", level: "Medium" },
  { tag: "advanced", level: "Advanced" },
  { tag: "expert", level: "Expert" },
  { tag: "baller", level: "Baller" }
] as const

export type Difficulty = (typeof DIFFICULTIES)[number]["tag"]

/** The publish screen's tag groups, in its order; `group` is the tag's middle segment. */
export const TAG_GROUPS = [
  {
    group: "Gameplay",
    tags: [
      "balance",
      "climb",
      "downhill",
      "endurance",
      "flow",
      "mini",
      "ninja",
      "out and back",
      "pathfinding",
      "practice",
      "precision",
      "puzzle",
      "RPG",
      "speed",
      "tech",
      "troll"
    ]
  },
  { group: "Mood", tags: ["day", "night", "sunrise", "sunset"] },
  { group: "Routes", tags: ["multiple", "single", "symmetrical"] },
  { group: "Props", tags: ["rubber", "vents"] }
] as const

export type TagGroup = (typeof TAG_GROUPS)[number]["group"]

export const tagNameOf = (group: TagGroup | "Difficulty", tag: string): string => `${UGC_TAGS}.${group}.${tag}`

// Gameplay tags are FNames, which compare without case.
const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const DIFFICULTY_TAGS = DIFFICULTIES.map((d) => tagNameOf("Difficulty", d.tag))
const isDifficultyTag = (name: string) => DIFFICULTY_TAGS.some((tag) => sameTag(tag, name))

const KNOWN_TAGS: ReadonlyArray<string> = [
  MAP_TYPE_TAG,
  ...DIFFICULTY_TAGS,
  ...TAG_GROUPS.flatMap(({ group, tags }) => tags.map((tag) => tagNameOf(group, tag)))
]

type Tags = LevelData["mapTags"]["gameplayTags"]

const tagsOf = (levelData: LevelData): Tags => levelData.mapTags.gameplayTags

/** The level data with its tag list put through `edit`. */
const editTags = (levelData: LevelData, edit: (tags: Tags) => Tags): LevelData => {
  const { mapTags } = levelData
  return { ...levelData, mapTags: { ...mapTags, gameplayTags: edit(mapTags.gameplayTags) } }
}

/** Adds `name` at the end, and the map type tag first when it is missing (as the game writes them). */
const appendTag = (tags: Tags, name: string): Tags => [
  ...(tags.some((t) => sameTag(t.tagName, MAP_TYPE_TAG)) ? [] : [{ tagName: MAP_TYPE_TAG }]),
  ...tags,
  { tagName: name }
]

/**
 * The difficulty from the map's first difficulty tag; undefined when it has none. Published
 * maps keep `levelDifficulty` at "Beginner" whatever the tag says, so the tag is what counts.
 */
export const difficultyOf = (levelData: LevelData): Difficulty | undefined => {
  const tag = tagsOf(levelData).find((t) => isDifficultyTag(t.tagName))
  return DIFFICULTIES.find((d) => tag !== undefined && sameTag(tag.tagName, tagNameOf("Difficulty", d.tag)))?.tag
}

/**
 * Sets `levelDifficulty` and the matching difficulty tag. The new tag takes the place of the
 * first existing one, and any others are dropped: a map has one difficulty.
 */
export const withDifficulty = (levelData: LevelData, difficulty: Difficulty): LevelData => {
  const entry = DIFFICULTIES.find((d) => d.tag === difficulty) ?? DIFFICULTIES[0]
  const name = tagNameOf("Difficulty", entry.tag)
  const replace = (tags: Tags): Tags => {
    const first = tags.findIndex((t) => isDifficultyTag(t.tagName))
    return first < 0
      ? appendTag(tags, name)
      : tags.flatMap((t, i) => i === first ? [{ ...t, tagName: name }] : isDifficultyTag(t.tagName) ? [] : [t])
  }
  return { ...editTags(levelData, replace), levelDifficulty: entry.level }
}

export const hasTag = (levelData: LevelData, name: string): boolean =>
  tagsOf(levelData).some((t) => sameTag(t.tagName, name))

/** Adds (at the end) or removes a tag; every other tag keeps its place. */
export const withTag = (levelData: LevelData, name: string, on: boolean): LevelData => {
  if (hasTag(levelData, name) === on) return levelData
  return editTags(
    levelData,
    (tags) => on ? appendTag(tags, name) : tags.filter((t) => !sameTag(t.tagName, name))
  )
}

/** Tags the editor has no control for, in file order. They are kept as they are. */
export const unknownTags = (levelData: LevelData): ReadonlyArray<string> =>
  tagsOf(levelData).map((t) => t.tagName).filter((name) => !KNOWN_TAGS.some((known) => sameTag(known, name)))
