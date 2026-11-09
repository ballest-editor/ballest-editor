import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import type { Connector } from "../domain/Catalog"
import { defaultSpotOf, SPOT_IDS, SPOT_NAMES, type SpotId, spotsOf } from "../domain/connectorSpots"
import { showConnectSpot } from "../editor/actions"
import { useEditor } from "../editor/store"
import { InfoHint } from "./InfoHint"
import { Section, SectionTitle } from "./SectionTitle"

const NO_CONNECTORS: ReadonlyArray<Connector> = []

/** One end's spots as the cap lays them out, looking out of the end: a 3 by 3 grid, the corners empty for a round cap. */
function EndSpots({ itemKey, end, connector, chosen }: {
  readonly itemKey: string
  readonly end: number
  readonly connector: Connector
  readonly chosen: SpotId | undefined
}) {
  const setConnectAt = useEditor((s) => s.setConnectAt)
  const offered = new Set(spotsOf(connector).map(({ id }) => id))
  const pressed = chosen ?? defaultSpotOf(connector)
  const label = `End ${end + 1}`
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-body text-fg-secondary">{label}</span>
        <span className="truncate text-caption text-fg-tertiary">
          {connector.profile}
          {pressed !== undefined && ` · ${SPOT_NAMES[pressed]}`}
        </span>
      </div>
      <ToggleGroup
        aria-label={`${label} connects at`}
        value={pressed === undefined ? [] : [pressed]}
        onValueChange={(value) => {
          const next = SPOT_IDS.find((id) => value.includes(id))
          if (next !== undefined) setConnectAt(itemKey, end, next) // clicking the pressed spot keeps it
        }}
        onPointerLeave={() => showConnectSpot(itemKey, end, null)}
        className="grid shrink-0 grid-cols-3"
      >
        {SPOT_IDS.map((id) =>
          offered.has(id)
            ? (
              <Tooltip key={id}>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem
                      value={id}
                      aria-label={SPOT_NAMES[id]}
                      className="w-6 min-w-0 px-0"
                      onPointerEnter={() => showConnectSpot(itemKey, end, id)}
                      onFocus={() => showConnectSpot(itemKey, end, id)}
                      onBlur={() => showConnectSpot(itemKey, end, null)}
                    />
                  }
                >
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                </TooltipTrigger>
                <TooltipContent side="left">{SPOT_NAMES[id]}</TooltipContent>
              </Tooltip>
            )
            : <span key={id} aria-hidden className="size-6" />
        )}
      </ToggleGroup>
    </div>
  )
}

/**
 * Where on each of a piece's ends it connects to others (docs/SNAPPING.md § Connectors): a corner, the middle of a side
 * or the centre of its cap, as seen looking out of the end. Hovering a spot rings it in the viewport. Shown for one
 * selected item whose piece has ends with caps.
 */
export function ConnectsAtSection({ itemKey }: { readonly itemKey: string }) {
  const connectors = useEditor((s) => {
    const item = s.doc.map.items[s.doc.ids.indexOf(itemKey)]
    return item === undefined
      ? NO_CONNECTORS
      : s.catalogIndex?.pieceByClass.get(item.actorToSpawn)?.connectors ?? NO_CONNECTORS
  })
  const chosen = useEditor(useShallow((s) => s.doc.structure.items.get(itemKey)?.connectAt ?? {}))
  // a ring left by a hover goes with the section
  useEffect(() => () => showConnectSpot(itemKey, 0, null), [itemKey])
  const ends = connectors.flatMap((connector, end) =>
    connector.cap === undefined ? [] : [{ connector, end, id: `end-${end}` }]
  )
  if (ends.length === 0) return null
  return (
    <Section>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Connects at</SectionTitle>
        <InfoHint>
          Where on each end this piece joins others, looking out of the end. Joined ends meet at their chosen spots.
        </InfoHint>
      </div>
      <div className="flex flex-col gap-2">
        {ends.map(({ connector, end, id }) => (
          <EndSpots key={id} itemKey={itemKey} end={end} connector={connector} chosen={chosen[String(end)]} />
        ))}
      </div>
    </Section>
  )
}
