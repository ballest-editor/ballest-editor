import { IconBoxMultiple, IconFolder, IconLink } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { type ReactNode, useMemo, useState } from "react"
import { counted } from "../domain/groupSelection"
import { formatBoxSize } from "../domain/itemBounds"
import { itemCountOf } from "../domain/mapDiff"
import type { Item } from "../domain/MapFile"
import type { ChainGrowth, GroupNode, PrefabLink } from "../domain/MapSidecar"
import { isSamePrefab } from "../domain/prefab"
import { checkInstance, overriddenMembers, overrideSummary } from "../domain/prefabInstance"
import { findGroup } from "../domain/structure"
import { vecScale } from "../domain/ueMath"
import { type GroupFrame, growthOf } from "../domain/units"
import { detachInstance, openPrefab, resetOverrides, updateInstance } from "../editor/actions"
import { shownGroupFrame, useEditor } from "../editor/store"
import { InfoHint } from "./InfoHint"
import { FIELD_LABEL, FieldRow, Identity, IDENTITY_TILE, IdentityBlock, InlineName, Section } from "./InspectorLayout"
import { NumberField } from "./NumberField"
import { TagInput } from "./TagInput"

/** The tags of `owner`, a group or an item, as a row of its identity. */
function TagsField({ id, owner, tags }: {
  readonly id: string
  readonly owner: string
  readonly tags: ReadonlyArray<string>
}) {
  const setTags = useEditor((s) => s.setTags)
  return (
    <FieldRow label="Tags" htmlFor={id} align="start">
      <TagInput id={id} tags={tags} onChange={(next) => setTags(owner, next)} />
    </FieldRow>
  )
}

/**
 * What kind of group it is, how many items it holds and how much room they take along its own axes (`groupFrameOf`), as
 * shown (live during a drag): the kind of thing in grey under its name, as a piece's category is.
 */
function groupSummaryOf(group: GroupNode, itemCount: number, frame: GroupFrame | undefined): string {
  const kind = group.prefab !== undefined ? "Instance" : group.chain === true ? "Chain" : "Group"
  const count = group.chain === true ? counted(group.children.length, "link") : itemCountOf(itemCount)
  const size = frame === undefined
    ? []
    : [formatBoxSize({ min: vecScale(frame.halfExtents, -1), max: frame.halfExtents })]
  return [kind, count, ...size].join(" · ")
}

/** A group's glyph on its identity's tile, as its Outline row draws it. */
function GroupTile({ group }: { readonly group: GroupNode }) {
  const className = "size-5"
  return (
    <span className={IDENTITY_TILE}>
      {group.prefab !== undefined
        ? <IconBoxMultiple className={className} />
        : group.chain === true
        ? <IconLink className={className} />
        : <IconFolder className={className} />}
    </span>
  )
}

/** A selection that is exactly one group: its name, edited in place, what it holds and how big, and its tags. */
export function GroupIdentity({ group, items, actions }: {
  readonly group: GroupNode
  /** The group's items. */
  readonly items: ReadonlyArray<Item>
  /** The selection's icon buttons. */
  readonly actions: ReactNode
}) {
  const renameGroup = useEditor((s) => s.renameGroup)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const doc = useEditor((s) => s.doc)
  const preview = useEditor((s) => s.preview)
  const frame = useMemo(() => shownGroupFrame({ doc, preview, catalogIndex }, group.id), [
    doc,
    preview,
    catalogIndex,
    group.id
  ])
  const summary = groupSummaryOf(group, items.length, frame)
  return (
    <IdentityBlock>
      <Identity
        tile={<GroupTile group={group} />}
        title={<InlineName label="Group name" value={group.name} onCommit={(name) => renameGroup(group.id, name)} />}
        subtitle={summary}
        actions={actions}
      />
      <TagsField id="group-tags" owner={group.id} tags={group.tags} />
    </IdentityBlock>
  )
}

const GROWTH_CURVES = ["Even", "Linear", "Exponential"] as const
type GrowthCurve = (typeof GROWTH_CURVES)[number]
/** The slider's reach; the field takes any value, short of a compound shrink to nothing. */
const GROWTH_RANGE = { min: -50, max: 100 }
/** Where a growth starts when it's switched on. */
const DEFAULT_GROWTH_PERCENT = 10

const growthFor = (curve: GrowthCurve, percent: number): ChainGrowth | undefined =>
  curve === "Even"
    ? undefined
    : curve === "Linear"
    ? { curve: "linear", percent }
    : { curve: "compound", percent: Math.max(-99, percent) }

/** How many times `x` is, to one decimal place at most. */
const formatTimes = (x: number) => `${Number(x.toFixed(x >= 10 ? 0 : 1))}×`

/**
 * What a growth does to the chain's last link, counted in pieces rather than joints: the joints add up, so even joints
 * already take the last link `links` times as far as the first.
 */
const growthReadout = (growth: ChainGrowth | undefined, links: number): string => {
  let total = 0
  for (let i = 0; i < links; i++) total += growthOf(growth, i)
  return `Link ${links} turns or moves ${formatTimes(total)} as much as link 1.`
}

/**
 * How each joint of a chain compares with the one before when it bends, spreads or stretches (`ChainGrowth`), and what
 * that makes of the last link.
 */
function ChainJointsField({ group, links }: { readonly group: GroupNode; readonly links: number }) {
  const setChainGrowth = useEditor((s) => s.setChainGrowth)
  const { growth } = group
  const curve: GrowthCurve = growth === undefined ? "Even" : growth.curve === "linear" ? "Linear" : "Exponential"
  // the slider's value while it's dragged; the chain takes it when it's let go
  const [dragged, setDragged] = useState<number | null>(null)
  const percent = dragged ?? growth?.percent ?? DEFAULT_GROWTH_PERCENT
  const commit = (next: GrowthCurve, value: number) => {
    setDragged(null)
    setChainGrowth(group.id, growthFor(next, value))
  }
  return (
    <div className="flex @container flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={FIELD_LABEL}>Joints</span>
        <InfoHint>
          How each joint compares with the one before when the chain bends, spreads or stretches. Even: every joint the
          same, so the chain curves evenly. Linear: each joint takes a little more, so the curve tightens steadily.
          Exponential: each joint multiplies, so the curve winds into a spiral. A negative change opens the curve out.
          Under Stretch every link's scale grows by the same rule, so Linear 100% tapers the chain.
        </InfoHint>
      </div>
      <ToggleGroup
        aria-label="Chain joints"
        value={[curve]}
        onValueChange={(value) => {
          const next = GROWTH_CURVES.find((c) => value.includes(c))
          if (next !== undefined && next !== curve) commit(next, percent)
        }}
        className="grid w-full grid-cols-3"
      >
        {GROWTH_CURVES.map((c) => <ToggleGroupItem key={c} value={c} className="min-w-0 px-1">{c}</ToggleGroupItem>)}
      </ToggleGroup>
      {curve !== "Even" && (
        <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2">
          <Slider
            aria-label="Change per joint"
            min={GROWTH_RANGE.min}
            max={GROWTH_RANGE.max}
            step={1}
            // one thumb: the shared Slider draws a thumb per array entry, and a bare number as a range
            value={[Math.min(GROWTH_RANGE.max, Math.max(GROWTH_RANGE.min, percent))]}
            onValueChange={(v) => setDragged(sliderValue(v) ?? null)}
            onValueCommitted={(v) => {
              const next = sliderValue(v)
              if (next !== undefined) commit(curve, next)
            }}
          />
          <NumberField
            label="Change per joint"
            value={percent}
            digits={1}
            handle={false}
            unit="%"
            onCommit={(v) => commit(curve, v)}
          />
        </div>
      )}
      {links >= 2 && (
        <p className="text-body text-fg-tertiary">
          {growthReadout(dragged === null ? growth : growthFor(curve, dragged), links)}
        </p>
      )}
    </div>
  )
}

const HELIX_AXES = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } } as const
type HelixAxis = keyof typeof HELIX_AXES
const HELIX_AXIS_NAMES: ReadonlyArray<HelixAxis> = ["X", "Y", "Z"]
/** The shapes a chain can be laid along, as the picker names them. */
const LAY_SHAPES = { helix: "Helix", straight: "Straight" } as const
type LayShape = keyof typeof LAY_SHAPES
const isLayShape = (value: unknown): value is LayShape => value === "helix" || value === "straight"

/** A helix's fields: the world axis it winds about, and each link's turn about it and climb along it. */
function HelixFields({ axis, turn, rise, onAxis, onTurn, onRise }: {
  readonly axis: HelixAxis
  readonly turn: number
  readonly rise: number
  readonly onAxis: (axis: HelixAxis) => void
  readonly onTurn: (turn: number) => void
  readonly onRise: (rise: number) => void
}) {
  return (
    <>
      <ToggleGroup
        aria-label="Helix axis"
        value={[axis]}
        onValueChange={(value) => {
          const next = HELIX_AXIS_NAMES.find((a) => value.includes(a))
          if (next !== undefined) onAxis(next)
        }}
        className="grid w-full grid-cols-3"
      >
        {HELIX_AXIS_NAMES.map((a) => <ToggleGroupItem key={a} value={a} className="min-w-0 px-1">{a}</ToggleGroupItem>)}
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Turn per link</span>
          <NumberField label="Turn per link" value={turn} digits={1} handle={false} unit="°" onCommit={onTurn} />
        </div>
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Rise per link</span>
          <NumberField label="Rise per link" value={rise} digits={1} handle={false} unit="cm" onCommit={onRise} />
        </div>
      </div>
    </>
  )
}

/**
 * Lays a chain along a shape from its first link (`layChain`), applied when the button is pressed, so the chain stays
 * free to bend after. A shape's fields show under the picker.
 */
function ChainLayField({ group }: { readonly group: GroupNode }) {
  const layChain = useEditor((s) => s.layChain)
  const [shape, setShape] = useState<LayShape>("helix")
  const [axis, setAxis] = useState<HelixAxis>("Z")
  const [turn, setTurn] = useState(30)
  const [rise, setRise] = useState(100)
  const apply = () =>
    layChain(
      group.id,
      shape === "straight" ? { kind: "straight" } : { kind: "helix", axis: HELIX_AXES[axis], turn, rise }
    )
  return (
    <div className="flex @container flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={FIELD_LABEL}>Lay along</span>
        <InfoHint>
          Lays the chain out from its first link along a shape, as one step; the chain stays free to bend after. A bent
          chain is straightened first. Straight lines it up the way its first link points. Helix winds it about a world
          axis: every link turns about the axis from the one before and climbs along it, with no rise a flat ring, and
          growth tightens the turn link by link.
        </InfoHint>
      </div>
      <Select value={shape} items={LAY_SHAPES} onValueChange={(next) => isLayShape(next) && setShape(next)}>
        <SelectTrigger className="w-full" aria-label="Chain shape">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(LAY_SHAPES).map(([value, label]) => <SelectItem key={value} value={value}>{label}
          </SelectItem>)}
        </SelectContent>
      </Select>
      {shape === "helix" && (
        <HelixFields
          axis={axis}
          turn={turn}
          rise={rise}
          onAxis={setAxis}
          onTurn={setTurn}
          onRise={setRise}
        />
      )}
      <Button variant="outline" size="sm" disabled={group.children.length < 2} onClick={apply}>Lay chain</Button>
    </div>
  )
}

/**
 * A chain (docs/design/pivot-modes-and-chains.md § Chains): its links in order, each following the one before, so link
 * by link a turn bends it. Here: how many links, how the joints compare down them, and the chain actions the Outline's
 * menu has.
 */
export function ChainSection({ group }: { readonly group: GroupNode }) {
  const setChain = useEditor((s) => s.setChain)
  const reverseChain = useEditor((s) => s.reverseChain)
  const chainLay = useEditor((s) => s.settings.beta.chainLay)
  const links = group.children.length
  if (group.prefab !== undefined) return null
  if (group.chain !== true) {
    return (
      <Section
        id="chain"
        title="Chain"
        actions={
          <InfoHint>
            In a chain each piece follows the one before, so a turn bends the whole row, link by link.
          </InfoHint>
        }
        className="items-start"
      >
        <Button variant="outline" size="sm" onClick={() => setChain(group.id, true)}>Make chain</Button>
      </Section>
    )
  }
  return (
    <Section
      id="chain"
      title="Chain"
      actions={
        <InfoHint>
          Each link follows the one before, from link 1. Link by link (the period key), a turn bends the chain, a move
          spreads it or stacks a pile, and a scale stretches it with every joint kept closed. Rigid moves it as one
          piece. Joints sets how much each joint takes compared with the one before.
        </InfoHint>
      }
    >
      <p className="text-body text-fg-tertiary">{counted(links, "link")}. Link 1, marked in the view, stays put.</p>
      <ChainJointsField group={group} links={links} />
      {chainLay && <ChainLayField group={group} />}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={links < 2}
          title="Start from the other end"
          onClick={() => reverseChain(group.id)}
        >
          Reverse
        </Button>
        <Button variant="outline" size="sm" onClick={() => setChain(group.id, false)}>Unchain</Button>
      </div>
    </Section>
  )
}

const instanceStatusOf = (found: boolean, current: boolean, unmodified: boolean) => {
  if (!found) return "Its definition has gone. It keeps its items."
  if (current) return unmodified ? "It follows its definition." : "Edited here, so it no longer follows its definition."
  return unmodified ? "Its definition has changed." : "Edited here, and its definition has changed."
}

/** A selection that is exactly one prefab instance: what it is an instance of, and what can be done about it. */
export function InstanceSection({ group, link }: { readonly group: GroupNode; readonly link: PrefabLink }) {
  const doc = useEditor((s) => s.doc)
  const definition = useEditor((s) => s.prefabs.find((p) => isSamePrefab(p, link)))
  const { unmodified } = useMemo(() => checkInstance(doc, group, link), [doc, group, link])
  const overridden = link.overrides?.length ?? 0
  const found = definition !== undefined
  const current = definition?.hash === link.hash
  return (
    <Section id="instance" title="Instance">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-body-strong" title={link.name}>{link.name}</span>
        <span className="text-body text-fg-tertiary">{instanceStatusOf(found, current, unmodified)}</span>
        <span className="text-caption text-fg-tertiary">
          {overridden === 0
            ? "Moving, painting, hiding or setting the properties of its pieces records overrides, which it keeps as it follows its definition."
            : `${counted(overridden, "piece")} ${overridden === 1 ? "overrides" : "override"} its definition.`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={!found || (current && unmodified)}
          onClick={() => void updateInstance(group.id, link)}
        >
          Update
        </Button>
        {overridden > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={!found}
            onClick={() => void resetOverrides(group.id, link)}
          >
            Reset overrides
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => detachInstance(group.id)}>Detach</Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!found}
          onClick={() => void openPrefab({ tier: link.tier, name: link.name })}
        >
          Open definition
        </Button>
      </div>
    </Section>
  )
}

/** One item that is a member of a prefab instance with overrides: what it overrides, and Reset override. */
export function MemberOverrideSection({ itemKey }: { readonly itemKey: string }) {
  const doc = useEditor((s) => s.doc)
  const override = overriddenMembers(doc).get(itemKey)
  const link = override === undefined ? undefined : findGroup(doc.structure.tree, override.groupId)?.prefab
  if (override === undefined || link === undefined) return null
  return (
    <Section id="override" title="Prefab override">
      <span className="text-body text-fg-tertiary">
        Overrides the {overrideSummary(override.fields)} {link.name} gives it. Updates keep it.
      </span>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void resetOverrides(override.groupId, link, [override.member])}
        >
          Reset override
        </Button>
      </div>
    </Section>
  )
}

export function ItemTags({ itemKey }: { readonly itemKey: string }) {
  const tags = useEditor((s) => s.doc.structure.items.get(itemKey)?.tags)
  return <TagsField id="item-tags" owner={itemKey} tags={tags ?? []} />
}
