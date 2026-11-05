/**
 * Prefabs in the editor (docs/DESKTOP.md § Prefabs): the two tiers in the store, placing a prefab, saving a selection as
 * one, a definition's tab and the instances of it in the open maps.
 */
import type { PrefabInfo, PrefabRef, PrefabTier } from "@ballest/contracts"
import { Effect } from "effect"
import { PREFAB_ITEMS, PREFAB_REFUSALS } from "../../domain/gameRules"
import { exactSelectedGroup } from "../../domain/groupSelection"
import { isPlayerStart } from "../../domain/MapFile"
import {
  itemOfPrefab,
  mapOfPrefab,
  prefabOfItems,
  prefabOfTab,
  prefabSourcesOf,
  spawnFrameOf
} from "../../domain/prefab"
import type { PrefabFile } from "../../domain/PrefabFile"
import { definitionOf } from "../../domain/prefabInstance"
import { flatStructure, freshKeys, withPrefabLink } from "../../domain/structure"
import { MapCodec } from "../../services/MapCodec"
import { Platform, PlatformError } from "../../services/Platform"
import { sceneRegistry } from "../sceneRegistry"
import { type PrefabDocument, selectedIndices, tabStateOf, tabWithPrefab, useEditor } from "../store"
import { followDefinitions, instancesInTab, readDefinition } from "./prefabFollow"
import { run } from "./run"

const TIERS: ReadonlyArray<PrefabTier> = ["user", "project"]

const sameRef = (a: PrefabRef, b: PrefabRef) => a.tier === b.tier && a.name === b.name

/** A notice in the words a failure of this kind takes: it stops the action, and `run` shows it. */
const refused = (message: string) => new PlatformError({ message })

/** Both tiers into the store; answers the prefabs that are new or whose file changed since the last look. */
const listPrefabs = Effect.gen(function*() {
  const platform = yield* Platform
  const lists = yield* Effect.forEach(TIERS, (tier) => platform.listPrefabs(tier))
  const prefabs = lists.flat()
  const known = useEditor.getState().prefabs
  useEditor.getState().setPrefabs(prefabs)
  return prefabs.filter((info) => known.find((other) => sameRef(other, info))?.hash !== info.hash)
})

/** A definition's tab reads a file that changed behind it again, unless it has edits, which say so instead. */
const reloadDefinitionTabs = Effect.fn("reloadDefinitionTabs")(function*(changed: ReadonlyArray<PrefabInfo>) {
  for (const info of changed) {
    const s = useEditor.getState()
    const tabId = tabWithPrefab(s, info)
    const tab = tabId === undefined ? undefined : tabStateOf(s, tabId)
    if (tabId === undefined || tab?.document.kind !== "prefab" || tab.document.hash === info.hash) continue
    if (tab.dirty) {
      s.notify("info", `${info.name} changed on disk`, {
        kind: "prefabChangedOnDisk",
        body: "Its tab has unsaved edits. Saving writes over the file, and the version on disk goes to the backups."
      })
    } else yield* loadDefinition(info, { tabId })
  }
})

/**
 * Looks at both tiers again: what the game wrote, or anything else, is taken up by the tabs of those definitions and
 * the instances of them in the open maps. Called at startup, on focus, after Play and after a write of the app's own.
 */
export const checkPrefabs = Effect.gen(function*() {
  const changed = yield* listPrefabs
  yield* reloadDefinitionTabs(changed)
  yield* followDefinitions(useEditor.getState().tabIds, changed)
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't look at the prefabs", error)))

export const checkPrefabsNow = () => run(checkPrefabs)

/** The catalog is in: instances can follow what startup found (`followDefinitions` waits for it). */
export const followOpenTabs = () =>
  run(Effect.suspend(() => {
    const { prefabs, tabIds } = useEditor.getState()
    return followDefinitions(tabIds, prefabs)
  }))

const decoded = Effect.fnUntraced(function*(ref: PrefabRef) {
  const read = yield* (yield* Platform).readPrefab(ref)
  const prefab = yield* MapCodec.use((codec) => codec.decodePrefab(read.text, useEditor.getState().catalogIndex))
  return { prefab, read }
})

const needsCatalog = Effect.suspend(() => {
  const { catalogIndex } = useEditor.getState()
  return catalogIndex === null ? Effect.fail(refused("The catalog is still loading.")) : Effect.succeed(catalogIndex)
})

/**
 * Places a prefab the way `spawnprefab` does: in front of the active pane's camera, its items selected as one group. In
 * a map the group is an instance; a definition's tab has no place for a link, so there it is a plain group.
 */
export const placePrefabEffect = Effect.fn("placePrefabEffect")(function*(ref: PrefabRef) {
  const catalog = yield* needsCatalog
  const { prefab, read } = yield* decoded(ref)
  const definition = definitionOf(prefab, read, catalog)
  const frame = spawnFrameOf(definition.items, sceneRegistry.viewRay(), catalog)
  const s = useEditor.getState()
  const items = prefab.items.map((item) => itemOfPrefab(item, frame, catalog))
  s.placeGroup(items, ref.name, s.document.kind === "map" ? definition.link : undefined)
})

export const placePrefab = (ref: PrefabRef) => run(placePrefabEffect(ref))

/** Writes `prefab`, in the game's layout, then lets everything that depends on it follow. */
const writePrefab = Effect.fnUntraced(function*(ref: PrefabRef, prefab: PrefabFile, replace: boolean) {
  const text = yield* MapCodec.use((codec) => codec.encodePrefab(prefab, useEditor.getState().catalogIndex))
  return yield* (yield* Platform).writePrefab({ ...ref, text, replace })
})

/** What Save selection as prefab… would refuse about the selection, as the game says it; undefined when it can go. */
const selectionPrefabProblem = (): string | undefined => {
  const s = useEditor.getState()
  const items = selectedIndices(s).flatMap((index) => s.doc.map.items[index] ?? [])
  if (items.length < PREFAB_ITEMS.min || items.length > PREFAB_ITEMS.max) return PREFAB_REFUSALS.selection
  return items.some(isPlayerStart) ? PREFAB_REFUSALS.playerStart : undefined
}

/** Edit › Save selection as prefab…: names it in a dialog, unless the game would refuse the selection whatever the name. */
export const startSavePrefab = () => {
  const { notify, openDialog } = useEditor.getState()
  const problem = selectionPrefabProblem()
  if (problem === undefined) openDialog({ id: "savePrefab" })
  else notify("error", problem, { kind: "prefabRefused" })
}

/**
 * Edit › Save selection as prefab…: a prefab of the selected items, in selection order, with the frame the game would
 * make. Saving changes nothing in the map. `replace` writes over a prefab of that name.
 */
export const saveSelectionAsPrefabEffect = Effect.fn("saveSelectionAsPrefabEffect")(
  function*(ref: PrefabRef, replace: boolean) {
    const problem = selectionPrefabProblem()
    if (problem !== undefined) return yield* refused(problem)
    const s = useEditor.getState()
    const items = selectedIndices(s).flatMap((index) => s.doc.map.items[index] ?? [])
    const group = exactSelectedGroup(s.doc.structure.tree, s.selectedIds, s.enteredGroupId)
    yield* writePrefab(ref, prefabOfItems(items, s.catalogIndex, group?.name), replace)
    yield* checkPrefabs
    s.notify("info", `Saved the prefab ${ref.name}`, { kind: "prefabSaved" })
  }
)

export const saveSelectionAsPrefab = (ref: PrefabRef, replace: boolean) =>
  run(saveSelectionAsPrefabEffect(ref, replace))

/** Reads a definition into a tab: the one `into` names, or a new one. */
const loadDefinition = Effect.fnUntraced(function*(ref: PrefabRef, into: "newTab" | { readonly tabId: string }) {
  const catalog = yield* needsCatalog
  const { prefab, read } = yield* decoded(ref)
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
  const file = { name: `${ref.name}.json`, path: read.path }
  useEditor.getState().loadMap(map, file, undefined, {
    document,
    into,
    loaded: { ids, structure: flatStructure(ids) }
  })
})

/** Opens a definition: the tab that has it comes forward, else it opens in a new one, like a map. */
export const openPrefabEffect = Effect.fn("openPrefabEffect")(function*(ref: PrefabRef) {
  const open = tabWithPrefab(useEditor.getState(), ref)
  if (open === undefined) yield* loadDefinition(ref, "newTab")
  else useEditor.getState().activateTab(open)
})

export const openPrefab = (ref: PrefabRef) => run(openPrefabEffect(ref))

/**
 * Save on a definition's tab: its items back into the prefab's file, and the instances of it in the open maps follow.
 * What the game would refuse stops here with the game's words, and the tab keeps its edits. A tab that lost its file to
 * a switch of projects writes a new prefab in the project now in use.
 */
export const savePrefabTab = Effect.gen(function*() {
  const { doc, document, file, tabId } = useEditor.getState()
  if (document.kind !== "prefab") return
  const { name, sources, tier } = document
  const prefab = prefabOfTab(document.file, doc.map.items, doc.ids, sources)
  const info = yield* writePrefab({ tier, name }, prefab, file !== null)
  useEditor.getState().markPrefabSaved(
    tabId,
    doc,
    { ...document, file: prefab, hash: info.hash, sources: prefabSourcesOf(prefab, doc.map.items, doc.ids) },
    { name: `${name}.json`, path: info.path }
  )
  yield* checkPrefabs
  useEditor.getState().notify("info", `Saved the prefab ${name}`, { kind: "prefabSaved" })
})

/** The first of `<name>_2`, `<name>_3`, ... that the tier doesn't have. */
const copyNameOf = (name: string, tier: PrefabTier) => {
  const taken = new Set(useEditor.getState().prefabs.filter((p) => p.tier === tier).map((p) => p.name))
  const base = name.replace(/_\d+$/, "").slice(0, 60)
  for (let n = 2;; n++) {
    const copy = `${base}_${n}`
    if (!taken.has(copy)) return copy
  }
}

/** Copies a prefab's file into `tier` under `name`. */
const copyPrefab = Effect.fnUntraced(function*(from: PrefabRef, to: PrefabRef) {
  const platform = yield* Platform
  const { text } = yield* platform.readPrefab(from)
  yield* platform.writePrefab({ ...to, text, replace: false })
  yield* checkPrefabs
})

/** Duplicate: a copy beside it, under the next free name. */
export const duplicatePrefab = (ref: PrefabRef) =>
  run(copyPrefab(ref, { tier: ref.tier, name: copyNameOf(ref.name, ref.tier) }))

/** Copy to project, Copy to user: the same name in the other tier, which fails when that has one. */
export const copyPrefabToTier = (ref: PrefabRef, tier: PrefabTier) => run(copyPrefab(ref, { tier, name: ref.name }))

/** Rename: the file moves, its tab goes with it, and so do the instances of it in the open maps. */
export const renamePrefabEffect = Effect.fn("renamePrefabEffect")(function*(ref: PrefabRef, to: string) {
  const info = yield* (yield* Platform).renamePrefab({ tier: ref.tier, from: ref.name, to })
  const s = useEditor.getState()
  const tabId = tabWithPrefab(s, ref)
  const tab = tabId === undefined ? undefined : tabStateOf(s, tabId)
  if (tabId !== undefined && tab?.document.kind === "prefab") {
    s.setTabDocument(tabId, { ...tab.document, name: to }, { name: `${to}.json`, path: info.path })
  }
  for (const id of s.tabIds) {
    const instances = instancesInTab(id, ref)
    s.editTabDoc(id, (doc) => {
      const structure = instances.reduce(
        (current, { id: group, prefab }) => withPrefabLink(current, group, { ...prefab, name: to }) ?? current,
        doc.structure
      )
      return structure === doc.structure ? undefined : { ...doc, structure }
    })
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
  const s = useEditor.getState()
  const tabId = tabWithPrefab(s, ref)
  const tab = tabId === undefined ? undefined : tabStateOf(s, tabId)
  if (tabId !== undefined && tab !== undefined) s.setTabDocument(tabId, tab.document, null)
  yield* checkPrefabs
})

export const deletePrefab = (ref: PrefabRef) => run(deletePrefabEffect(ref))

export const revealPrefabs = (tier: PrefabTier) =>
  run(
    Effect.gen(function*() {
      yield* (yield* Platform).revealPrefabs(tier)
    })
  )

/** The Inspector's and the Outline's Update on one instance in the active tab: it takes the definition as it is now. */
export const updateInstance = (groupId: string, ref: PrefabRef) =>
  run(
    Effect.gen(function*() {
      const definition = yield* readDefinition(ref)
      const { tabId, updateInstances } = useEditor.getState()
      updateInstances(tabId, [groupId], definition)
    })
  )

/** Detach on one instance in the active tab: it stays a group, and no longer follows anything. */
export const detachInstance = (groupId: string) => {
  const { detachInstances, tabId } = useEditor.getState()
  detachInstances(tabId, [groupId])
}

/** The instances of `ref` that didn't follow it, by tab: what its report's buttons act on. */
const editedInstances = (ref: PrefabRef) => {
  const s = useEditor.getState()
  const current = s.prefabs.find((info) => sameRef(info, ref))?.hash
  return s.tabIds.flatMap((tabId) => {
    const stale = instancesInTab(tabId, ref).filter(({ prefab }) => prefab.hash !== current)
    return stale.length === 0 ? [] : [{ tabId, ids: stale.map(({ id }) => id) }]
  })
}

/** The report's Update: the instances that didn't follow are replaced with the definition, where they stand. */
export const updateEditedInstances = (ref: PrefabRef) =>
  run(
    Effect.gen(function*() {
      const definition = yield* readDefinition(ref)
      for (const { ids, tabId } of editedInstances(ref)) useEditor.getState().updateInstances(tabId, ids, definition)
    })
  )

/** The report's Detach: the instances that didn't follow keep their items as plain groups. */
export const detachEditedInstances = (ref: PrefabRef) => {
  for (const { ids, tabId } of editedInstances(ref)) useEditor.getState().detachInstances(tabId, ids)
}
