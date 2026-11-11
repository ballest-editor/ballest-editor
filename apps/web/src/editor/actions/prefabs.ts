/**
 * Prefabs in the editor (docs/DESKTOP.md § Prefabs): the two tiers in the store, placing a prefab, saving a selection as
 * one, a definition's tab and the instances of it in the open maps.
 */
import { prefabFileNameOf, type PrefabInfo, type PrefabRef, PrefabTier, type ProjectMap } from "@ballest/contracts"
import { Effect } from "effect"
import { nextFreeName, nextNumberedName } from "../../domain/factory"
import { PREFAB_ITEMS, PREFAB_REFUSALS } from "../../domain/gameRules"
import { counted, exactSelectedGroup } from "../../domain/groupSelection"
import { itemsBoxOf } from "../../domain/itemBounds"
import { classNameOf, isPlayerStart, type Item } from "../../domain/MapFile"
import { type MapPrefs, prefabSnapKeyOf } from "../../domain/MapPrefs"
import type { PrefabLink } from "../../domain/MapSidecar"
import { frameStanding, NO_BOX, roomOf } from "../../domain/placement"
import {
  freePrefabName,
  isSamePrefab,
  itemOfPrefab,
  mapOfPrefab,
  PREFAB_NEEDS_PROJECT,
  prefabOfItems,
  prefabOfTab,
  prefabSaveProblem,
  prefabSourcesOf,
  selectionLabelOf
} from "../../domain/prefab"
import type { PrefabFile } from "../../domain/PrefabFile"
import { definitionOf, instancesIn, instancesOfPrefab } from "../../domain/prefabInstance"
import { DEFAULT_GROUP_NAME, flatStructure, freshKeys, treeKeys } from "../../domain/structure"
import { MapCodec } from "../../services/MapCodec"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { Platform, PlatformError } from "../../services/Platform"
import { sceneRegistry } from "../sceneRegistry"
import {
  type EditorState,
  inNamedProject,
  NO_TAB_OPEN,
  noTabOpen,
  pickableOf,
  type PrefabDocument,
  selectedIndices,
  tabLabels,
  tabStateOf,
  tabsWhere,
  tabWithPrefab,
  useEditor
} from "../store"
import { followDefinitions, instancesInTab, readDefinition, readPrefabFile, staleInstances } from "./prefabFollow"
import { run } from "./run"

/** Both tiers into the store; answers the prefabs that are new or whose file changed since the last look. */
const listPrefabs = Effect.gen(function*() {
  const platform = yield* Platform
  const lists = yield* Effect.forEach(PrefabTier.literals, (tier) => platform.listPrefabs(tier))
  const prefabs = lists.flat()
  const known = useEditor.getState().prefabs
  useEditor.getState().setPrefabs(prefabs)
  return prefabs.filter((info) => known.find((other) => isSamePrefab(other, info))?.hash !== info.hash)
})

/** The tab that has the definition `ref` open, and what it holds. */
const definitionTab = (ref: PrefabRef) => {
  const s = useEditor.getState()
  const tabId = tabWithPrefab(s, ref)
  const tab = tabId === undefined ? undefined : tabStateOf(s, tabId)
  return tabId === undefined || tab?.document.kind !== "prefab" ? undefined : { tabId, tab, document: tab.document }
}

/** A definition's tab reads a file that changed behind it again, unless it has edits, which say so instead. */
const reloadDefinitionTabs = Effect.fn("reloadDefinitionTabs")(function*(changed: ReadonlyArray<PrefabInfo>) {
  for (const info of changed) {
    const open = definitionTab(info)
    if (open === undefined || open.document.hash === info.hash) continue
    if (open.tab.dirty) {
      useEditor.getState().notify("info", `${info.name} changed on disk`, {
        kind: "prefabChangedOnDisk",
        body: "Its tab has unsaved edits. Saving writes over the file, and the version on disk goes to the backups."
      })
    } else yield* loadDefinition(info, { tabId: open.tabId })
  }
})

/**
 * Looks at both tiers again: what the game wrote, or anything else, is taken up by the tabs of those definitions and
 * the instances of them in the open maps. `saved` is the definition the user just saved: it answers how many of its
 * instances followed, and the caller reports them.
 */
const lookAtPrefabs = (saved?: PrefabRef) =>
  Effect.gen(function*() {
    const changed = yield* listPrefabs
    yield* reloadDefinitionTabs(changed)
    return yield* followDefinitions(useEditor.getState().tabIds, changed, saved)
  }).pipe(Effect.catch((error) => Effect.as(Effect.logWarning("Couldn't look at the prefabs", error), 0)))

/** `lookAtPrefabs`, for startup, focus, after Play and after a write of the app's own. */
export const checkPrefabs = lookAtPrefabs()

export const checkPrefabsNow = () => run(checkPrefabs)

/** The catalog is in: instances can follow what startup found (`followDefinitions` waits for it). */
export const followOpenTabs = () =>
  run(Effect.suspend(() => {
    const { prefabs, tabIds } = useEditor.getState()
    return followDefinitions(tabIds, prefabs)
  }))

const needsCatalog = Effect.suspend(() => {
  const { catalogIndex } = useEditor.getState()
  return catalogIndex === null
    ? Effect.fail(new PlatformError({ message: "The catalog is still loading." }))
    : Effect.succeed(catalogIndex)
})

/**
 * Places a prefab where a palette piece would go, sized by the box around its items, so it lands in view and clear of
 * what's there, its items selected as one group. In a map the group is an instance; a definition's tab has no place for
 * a link, so there it is a plain group.
 */
export const placePrefabEffect = Effect.fn("placePrefabEffect")(function*(ref: PrefabRef) {
  if (noTabOpen(useEditor.getState())) return yield* new PlatformError({ message: NO_TAB_OPEN })
  const catalog = yield* needsCatalog
  const { prefab, read } = yield* readPrefabFile(ref)
  const definition = definitionOf(prefab, read, catalog)
  const box = itemsBoxOf(definition.items, catalog) ?? NO_BOX
  const { height, width } = roomOf(box)
  const frame = frameStanding(box, sceneRegistry.placementPoint(width, height))
  const s = useEditor.getState()
  const items = prefab.items.map((item) => itemOfPrefab(item, frame, catalog))
  s.placeGroup(items, ref.name, s.document.kind === "map" ? definition.link : undefined)
})

export const placePrefab = (ref: PrefabRef) => run(placePrefabEffect(ref))

const writePrefab = Effect.fnUntraced(function*(ref: PrefabRef, prefab: PrefabFile, replace: boolean) {
  const text = yield* MapCodec.use((codec) => codec.encodePrefab(prefab, useEditor.getState().catalogIndex))
  return yield* (yield* Platform).writePrefab({ ...ref, text, replace })
})

const selectedItems = (s: EditorState) => selectedIndices(s).flatMap((index) => s.doc.map.items[index] ?? [])

/**
 * What Save selection as prefab… would refuse about the selection; undefined when it can go. The menu items are off
 * while there is one, and show it.
 */
export const selectionPrefabProblem = (s: EditorState): string | undefined => {
  const items = selectedItems(s)
  if (items.length < PREFAB_ITEMS.min || items.length > PREFAB_ITEMS.max) return PREFAB_REFUSALS.selection
  return items.some(isPlayerStart) ? PREFAB_REFUSALS.playerStart : undefined
}

/**
 * What Save selection as prefab… offers as a name: the group the selection is exactly, unless it never got a name of its
 * own, else what the pieces read as. It is clear of both tiers, so Save doesn't start out as Replace.
 */
export const suggestPrefabName = (s: EditorState): string => {
  const group = exactSelectedGroup(s.doc.structure.tree, s.selectedIds, s.enteredGroupId)
  const label = group === undefined || group.name === DEFAULT_GROUP_NAME
    ? labelOfItems(s, selectedItems(s))
    : group.name
  return freePrefabName(label, new Set(s.prefabs.map(({ name }) => name)))
}

/** What `items` read as: "Kicker pair", "Curve 1 Medium x3". */
const labelOfItems = (s: EditorState, items: ReadonlyArray<Item>) =>
  selectionLabelOf(
    items.map(({ actorToSpawn }) =>
      s.catalogIndex?.pieceByClass.get(actorToSpawn) ?? { className: classNameOf(actorToSpawn) }
    )
  )

/** What a new prefab's first Save offers as a name: what its items read as, clear of its tier's names. */
export const suggestNewPrefabName = (s: EditorState): string => {
  const tier = s.document.kind === "prefab" ? s.document.tier : newPrefabTier(s)
  const taken = new Set(s.prefabs.filter((p) => p.tier === tier).map(({ name }) => name))
  return freePrefabName(labelOfItems(s, s.doc.map.items), taken)
}

/** Edit › Save selection as prefab…: names it in a dialog. */
export const startSavePrefab = () => useEditor.getState().openDialog({ id: "savePrefab" })

/**
 * Edit › Save selection as prefab…: a prefab of the selected items, in selection order, with the frame the game would
 * make. Saving changes nothing in the map. `replace` writes over a prefab of that name.
 */
export const saveSelectionAsPrefabEffect = Effect.fn("saveSelectionAsPrefabEffect")(
  function*(ref: PrefabRef, replace: boolean) {
    const s = useEditor.getState()
    const problem = selectionPrefabProblem(s)
    if (problem !== undefined) return yield* new PlatformError({ message: problem })
    const group = exactSelectedGroup(s.doc.structure.tree, s.selectedIds, s.enteredGroupId)
    yield* writePrefab(ref, prefabOfItems(selectedItems(s), s.catalogIndex, group?.name), replace)
    yield* checkPrefabs
    s.notify("info", `Saved the prefab ${ref.name}`, { kind: "prefabSaved" })
  }
)

export const saveSelectionAsPrefab = (ref: PrefabRef, replace: boolean) =>
  run(saveSelectionAsPrefabEffect(ref, replace))

/** Reads a definition into a tab: the one `into` names, or a new one. */
const loadDefinition = Effect.fnUntraced(function*(ref: PrefabRef, into: "newTab" | { readonly tabId: string }) {
  const catalog = yield* needsCatalog
  const { prefab, read } = yield* readPrefabFile(ref)
  const map = mapOfPrefab(ref.name, prefab, catalog)
  const ids = freshKeys(map.items.length)
  const document: PrefabDocument = {
    kind: "prefab",
    tier: ref.tier,
    name: ref.name,
    file: prefab,
    hash: read.hash,
    sources: prefabSourcesOf(prefab, map.items, ids)
  }
  const file = { name: prefabFileNameOf(ref.name), path: read.path }
  const prefs = yield* MapPrefsStore.use((store) => store.load(prefabSnapKeyOf(ref))).pipe(
    Effect.orElseSucceed((): MapPrefs => ({}))
  )
  useEditor.getState().loadMap(map, file, undefined, {
    document,
    into,
    loaded: { ids, structure: flatStructure(ids), snap: prefs.snap ?? null }
  })
})

/** Opens a definition: the tab that has it comes forward, else it opens in a new one, like a map. */
export const openPrefabEffect = Effect.fn("openPrefabEffect")(function*(ref: PrefabRef) {
  const open = tabWithPrefab(useEditor.getState(), ref)
  if (open === undefined) yield* loadDefinition(ref, "newTab")
  else useEditor.getState().activateTab(open)
})

export const openPrefab = (ref: PrefabRef) => run(openPrefabEffect(ref))

/** What a new prefab's name is until its first Save gives it a file's. */
const NEW_PREFAB_NAME = "Untitled prefab"

/** The tier a new prefab goes in: the project's, and a browser's one tier. */
const newPrefabTier = ({ capabilities }: EditorState): PrefabTier => capabilities.projects ? "project" : "user"

/** Why New prefab is off; undefined when it can go. Untitled Project has no project tier to put it in. */
export const newPrefabProblem = (s: EditorState): string | undefined =>
  newPrefabTier(s) === "project" && !inNamedProject(s) ? PREFAB_NEEDS_PROJECT : undefined

/**
 * New prefab: an empty definition in a tab of its own, as New map is a map's. It asks nothing and writes nothing, and it
 * goes by Untitled prefab until the first Save names it, which the game's two items hold back (`prefabSaveProblem`).
 */
export const newPrefabEffect = Effect.sync(() => {
  const s = useEditor.getState()
  if (newPrefabProblem(s) !== undefined) return
  const taken = new Set(tabLabels(s))
  const name = nextFreeName(NEW_PREFAB_NAME, (label) => taken.has(label))
  const file = prefabOfItems([], s.catalogIndex)
  const document: PrefabDocument = {
    kind: "prefab",
    tier: newPrefabTier(s),
    name,
    file,
    hash: "",
    sources: new Map()
  }
  s.loadMap(mapOfPrefab(name, file, s.catalogIndex), null, undefined, { document, fresh: true, into: "addedTab" })
})

export const startNewPrefab = () => run(newPrefabEffect)

/** A new prefab no Save has named yet (a restored one too): its first Save asks for a name, as a new map's does. */
export const isUntitledPrefab = (s: Pick<EditorState, "document" | "file" | "fresh">): boolean =>
  s.document.kind === "prefab" && s.file === null && s.fresh

/** Fails with the game's words when the open definition has too few items to save. */
export const prefabTabSaveable = Effect.suspend(() => {
  const problem = prefabSaveProblem(useEditor.getState().doc.map.items.length)
  return problem === null ? Effect.void : Effect.fail(new PlatformError({ message: problem }))
})

/**
 * Save on a definition's tab, under `named` or its own name: its items back into the prefab's file, and the instances of
 * it in the open maps follow, in the same step, with one toast for both. What the game would refuse stops here with the
 * game's words, and the tab keeps its edits. A tab that lost its file to a switch of projects writes a new prefab in the
 * project now in use.
 */
const writePrefabTab = (named?: string) =>
  Effect.gen(function*() {
    const { doc, document, file, tabId } = useEditor.getState()
    if (document.kind !== "prefab") return
    yield* prefabTabSaveable
    const { sources, tier } = document
    const name = named ?? document.name
    const prefab = prefabOfTab(document.file, doc.map.items, doc.ids, sources)
    const info = yield* writePrefab({ tier, name }, prefab, file !== null)
    useEditor.getState().markPrefabSaved(
      tabId,
      doc,
      { ...document, name, file: prefab, hash: info.hash, sources: prefabSourcesOf(prefab, doc.map.items, doc.ids) },
      { name: prefabFileNameOf(name), path: info.path }
    )
    const updated = yield* lookAtPrefabs({ tier, name })
    const saved = `Saved the prefab ${name}`
    useEditor.getState().notify("info", updated > 0 ? `${counted(updated, "instance")} updated` : saved, {
      kind: "prefabSaved",
      ...(updated > 0 && { body: saved })
    })
  })

export const savePrefabTab = writePrefabTab()

/** The `namePrefab` dialog's last step: a new prefab's first Save, under `name`, then the dialog's `afterSave`. */
export const saveNewPrefabEffect = (name: string, afterSave: Effect.Effect<void, unknown> = Effect.void) =>
  writePrefabTab(name).pipe(Effect.andThen(afterSave))

export const saveNewPrefab = (name: string, afterSave?: Effect.Effect<void, unknown>) =>
  run(saveNewPrefabEffect(name, afterSave))

/** The first of `<name>_2`, `<name>_3`, ... that the tier doesn't have. */
const copyNameOf = (name: string, tier: PrefabTier) => {
  const taken = new Set(useEditor.getState().prefabs.filter((p) => p.tier === tier).map((p) => p.name))
  return nextNumberedName(name.replace(/_\d+$/, "").slice(0, 60), "_", (copy) => taken.has(copy))
}

const copyPrefab = Effect.fnUntraced(function*(from: PrefabRef, to: PrefabRef) {
  const platform = yield* Platform
  const { text } = yield* platform.readPrefab(from)
  yield* platform.writePrefab({ ...to, text, replace: false })
  yield* checkPrefabs
})

/** Duplicate: a copy beside it, under the next free name. */
export const duplicatePrefab = (ref: PrefabRef) =>
  run(copyPrefab(ref, { tier: ref.tier, name: copyNameOf(ref.name, ref.tier) }))

/** Copy to project, Copy to game: the same name in the other tier, which fails when that has one. */
export const copyPrefabToTier = (ref: PrefabRef, tier: PrefabTier) => run(copyPrefab(ref, { tier, name: ref.name }))

/** Rename: the file moves, its tab goes with it, and so do the instances of it in the open maps. */
export const renamePrefabEffect = Effect.fn("renamePrefabEffect")(function*(ref: PrefabRef, to: string) {
  const info = yield* (yield* Platform).renamePrefab({ tier: ref.tier, from: ref.name, to })
  const s = useEditor.getState()
  const open = definitionTab(ref)
  if (open !== undefined) {
    const file = { name: prefabFileNameOf(to), path: info.path }
    s.patchTab(open.tabId, { document: { ...open.document, name: to }, file })
  }
  for (const tabId of s.tabIds) {
    s.relinkInstances(tabId, instancesInTab(tabId, ref).map(({ id, prefab }) => [id, { ...prefab, name: to }]))
  }
  yield* checkPrefabs
})

export const renamePrefab = (ref: PrefabRef, to: string) => run(renamePrefabEffect(ref, to))

/**
 * Delete: the file goes to the backups. Its tab stays open with no file behind it, and instances of it keep their items
 * and show the definition as gone.
 */
export const deletePrefabEffect = Effect.fn("deletePrefabEffect")(function*(ref: PrefabRef) {
  yield* (yield* Platform).deletePrefab(ref)
  const open = definitionTab(ref)
  if (open !== undefined) useEditor.getState().patchTab(open.tabId, { file: null, savedDoc: null })
  yield* checkPrefabs
})

export const deletePrefab = (ref: PrefabRef) => run(deletePrefabEffect(ref))

export const revealPrefabs = (tier: PrefabTier) =>
  run(Effect.flatMap(Effect.service(Platform), (platform) => platform.revealPrefabs(tier)))

/** The Inspector's and the Outline's Update on one instance in the active tab: it takes the definition as it is now. */
export const updateInstance = (groupId: string, ref: PrefabRef) =>
  run(Effect.map(readDefinition(ref), (definition) => {
    const { tabId, updateInstances } = useEditor.getState()
    updateInstances(tabId, [groupId], definition)
  }))

/**
 * The Prefabs panel's "2 placed": every instance of `ref` in the active tab a click could pick, whole, selected from
 * outside any entered group. One with nothing left to pick (all hidden, locked or isolated out) stays out, as from
 * Select all.
 */
export const selectInstances = (ref: PrefabRef) => {
  const s = useEditor.getState()
  const pickable = pickableOf(s)
  s.enterGroup(null)
  s.select(
    instancesOfPrefab(s.doc.structure.tree, ref).flatMap((instance) => {
      const keys = treeKeys([instance])
      return keys.some(pickable) ? keys : []
    })
  )
}

/** The items of a definition, for its thumbnail; none when it won't read, which needs no saying over a picture. */
export const readDefinitionItems = async (ref: PrefabRef): Promise<ReadonlyArray<Item>> =>
  await run(readDefinition(ref).pipe(Effect.map(({ items }) => items), Effect.orElseSucceed(() => []))) ?? []

/** The tabs whose map holds instances of `ref`, in tab order: the live half of a definition's Used in. */
export const tabsUsingPrefab = (s: EditorState, ref: PrefabRef): ReadonlyArray<string> =>
  tabsWhere(s, (tab) => tab.document.kind === "map" && instancesOfPrefab(tab.doc.structure.tree, ref).length > 0)

/** What each project map's sidecar links to, by file and time: a map is read once until it changes. */
const sidecarLinks = new Map<string, ReadonlyArray<PrefabLink>>()

const linksInProjectMap = Effect.fnUntraced(function*({ fileName, modifiedAt }: ProjectMap) {
  const key = `${fileName}@${modifiedAt}`
  const known = sidecarLinks.get(key)
  if (known !== undefined) return known
  const { sidecar } = yield* (yield* Platform).readMap(fileName)
  const structure = sidecar === null ? null : yield* MapCodec.use((codec) => codec.decodeSidecar(sidecar))
  const links = instancesIn(structure?.tree ?? []).map(({ prefab }) => prefab)
  sidecarLinks.set(key, links)
  return links
})

/**
 * The project maps in `maps` whose file holds instances of `ref`, by file name: the closed half of a definition's Used
 * in, read from their sidecars. A map that won't read is left out.
 */
export const projectMapsUsingPrefabEffect = (ref: PrefabRef, maps: ReadonlyArray<ProjectMap>) =>
  Effect.forEach(maps, (map) =>
    linksInProjectMap(map).pipe(
      Effect.map((links) => links.some((link) => isSamePrefab(link, ref)) ? [map.fileName] : []),
      Effect.orElseSucceed(() => [])
    )).pipe(Effect.map((names) => names.flat()))

export const projectMapsUsingPrefab = async (ref: PrefabRef, maps: ReadonlyArray<ProjectMap>) =>
  await run(projectMapsUsingPrefabEffect(ref, maps)) ?? []

/** Detach on one instance in the active tab: it stays a group, and no longer follows anything. */
export const detachInstance = (groupId: string) => {
  const { relinkInstances, tabId } = useEditor.getState()
  relinkInstances(tabId, [[groupId, undefined]])
}

/** The instances of `ref` that didn't follow it, by tab: what its report's buttons act on. */
const editedInstances = (ref: PrefabRef) => {
  const s = useEditor.getState()
  return staleInstances(s.tabIds, ref, s.prefabs.find((info) => isSamePrefab(info, ref))?.hash)
}

/** The report's Update: the instances that didn't follow are replaced with the definition, where they stand. */
export const updateEditedInstances = (ref: PrefabRef) =>
  run(Effect.map(readDefinition(ref), (definition) => {
    for (const { stale, tabId } of editedInstances(ref)) {
      useEditor.getState().updateInstances(tabId, stale.map(({ id }) => id), definition)
    }
  }))

/** The report's Detach: the instances that didn't follow keep their items as plain groups. */
export const detachEditedInstances = (ref: PrefabRef) => {
  for (const { stale, tabId } of editedInstances(ref)) {
    useEditor.getState().relinkInstances(tabId, stale.map(({ id }) => [id, undefined]))
  }
}
