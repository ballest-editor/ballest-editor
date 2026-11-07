/**
 * Recovery snapshots (docs/DESKTOP.md § Recovery): every tab with unsaved edits has its document kept on disk, a moment
 * behind the edits, until those edits are saved or given up. A window that goes away with no chance to ask (a crash, a
 * kill, a dev restart) leaves them for the next launch to offer.
 */
import { Effect, Semaphore } from "effect"
import { RECOVERY_MAP_HASH, type RecoverySnapshot } from "../../domain/recovery"
import { sidecarOf } from "../../domain/sidecar"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { type EditorState, isUnsavedTab, tabLabelOf, type TabState, tabStateOf, tabsWhere, useEditor } from "../store"

/**
 * A snapshot waits for the edits to pause, as a 5,000-piece map takes about 250 ms to encode, and for no longer than
 * the most: what a crash can still lose.
 */
const SNAPSHOT_PAUSE_MS = 1000
const SNAPSHOT_MOST_MS = 5000

/** What a tab's snapshot was made from; a tab whose fields are these has nothing new to keep. */
type Sources = Pick<TabState, "doc" | "document" | "file" | "snap"> & { readonly project: string | null }

/** Tabs with a snapshot, by id: its key, and what it holds once it is written. */
const kept = new Map<string, { readonly key: string; readonly sources: Sources | null }>()

/** One at a time: a write still running would otherwise land after the remove meant to follow it. */
const lock = Semaphore.makeUnsafe(1)

/** Set once the page is leaving with every tab answered for: from then on nothing is kept. */
let dropped = false

/** The snapshots of this page's tabs, which the page isn't to offer itself. */
export const ownRecoveryKeys = (): ReadonlySet<string> => new Set([...kept.values()].map(({ key }) => key))

const projectOf = (s: EditorState) => s.project?.current?.path ?? null

const snapshotOf = (tab: TabState, project: string | null): RecoverySnapshot => {
  const { doc, document, file } = tab
  return {
    formatVersion: 1,
    editedAt: tab.editedAt ?? new Date().toISOString(),
    project,
    label: tabLabelOf(tab),
    file,
    fresh: tab.fresh,
    backup: tab.backup,
    map: doc.map,
    sidecar: sidecarOf(doc.map, doc.ids, doc.structure, RECOVERY_MAP_HASH, tab.snap),
    prefab: document.kind === "map"
      ? null
      : {
        tier: document.tier,
        name: document.name,
        hash: document.hash,
        file: document.file,
        sources: [...document.sources].map(([key, source]) => ({ key, ...source }))
      }
  }
}

const isCurrent = (sources: Sources | null | undefined, tab: TabState, project: string | null) =>
  sources?.doc === tab.doc && sources.document === tab.document && sources.file === tab.file &&
  sources.snap === tab.snap && sources.project === project

/** Makes the snapshots on disk what the tabs hold now: a tab's goes with its edits, and a changed tab's is rewritten. */
export const syncRecovery = lock.withPermit(Effect.gen(function*() {
  if (dropped) return
  const platform = yield* Platform
  const s = useEditor.getState()
  const project = projectOf(s)
  const unsaved = new Set(tabsWhere(s, isUnsavedTab))
  for (const [tabId, { key }] of kept) {
    if (unsaved.has(tabId)) continue
    kept.delete(tabId)
    yield* platform.removeRecovery(key)
  }
  for (const tabId of unsaved) {
    const tab = tabStateOf(s, tabId)
    const known = kept.get(tabId)
    if (tab === undefined || isCurrent(known?.sources, tab, project)) continue
    const key = known?.key ?? crypto.randomUUID()
    // the key first, so a look at what other sessions left never takes this for one of theirs
    kept.set(tabId, { key, sources: null })
    const text = yield* MapCodec.use((codec) => codec.encodeRecovery(snapshotOf(tab, project)))
    yield* platform.writeRecovery({ key, text })
    const { doc, document, file, snap } = tab
    kept.set(tabId, { key, sources: { doc, document, file, snap, project } })
  }
}))

/** Lets every snapshot of this page go, and keeps none from now on: the page is leaving with nothing left to lose. */
export const dropRecovery = lock.withPermit(Effect.gen(function*() {
  dropped = true
  const platform = yield* Platform
  const keys = [...kept.values()].map(({ key }) => key)
  kept.clear()
  yield* Effect.forEach(keys, (key) => platform.removeRecovery(key), { discard: true })
}))

/** Whether a tab with a snapshot no longer has anything to lose: it was saved, undone or closed. */
const anyWentClean = (s: EditorState) =>
  [...kept.keys()].some((tabId) => {
    const tab = tabStateOf(s, tabId)
    return tab === undefined || !isUnsavedTab(tab)
  })

/**
 * Keeps the snapshots up to date from now on. Edits are written once they pause, in one go however many came, and a
 * snapshot whose tab is clean again goes at once: a window closed right after a Save has nothing to offer next launch.
 * The returned function stops it and forgets this page's snapshots, leaving them on disk, as a crash does.
 */
export const followRecovery = Effect.gen(function*() {
  const runFork = Effect.runForkWith(yield* Effect.context<Platform | MapCodec>())
  let timer: ReturnType<typeof setTimeout> | undefined
  /** When the oldest edit no snapshot holds yet was made. */
  let waitingSince: number | undefined
  const sync = () => {
    waitingSince = undefined
    runFork(syncRecovery.pipe(Effect.catch((error) => Effect.logWarning("Couldn't keep the unsaved edits", error))))
  }
  const unsubscribe = useEditor.subscribe((s, before) => {
    const same = s.doc === before.doc && s.parkedTabs === before.parkedTabs && s.tabIds === before.tabIds &&
      s.file === before.file && s.document === before.document && s.dirty === before.dirty &&
      s.snap === before.snap &&
      projectOf(s) === projectOf(before)
    if (same) return
    const now = Date.now()
    waitingSince ??= now
    clearTimeout(timer)
    const left = waitingSince + SNAPSHOT_MOST_MS - now
    timer = setTimeout(sync, anyWentClean(s) ? 0 : Math.min(SNAPSHOT_PAUSE_MS, left))
  })
  return () => {
    unsubscribe()
    clearTimeout(timer)
    kept.clear()
    dropped = false
  }
})
