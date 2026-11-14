/**
 * The approximation dialog's settings: the method and what most runs change (the piece budget, the search time), then
 * everything else under Advanced. Each method shows only the settings it reads.
 */
import { Button } from "@workspace/ui/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import {
  type ApproximateSettings,
  FEWER,
  FEWER_MORE,
  type Method,
  METHODS,
  methods,
  type PieceSettings,
  type PlateSettings,
  SEARCH_SECONDS_MAX
} from "../../domain/approximate/settings"
import { type ShapeKind, shapeKinds, SHAPES } from "../../domain/approximate/shapes"
import { PREFAB_ITEMS } from "../../domain/gameRules"
import { SHAPE_COLORS } from "../../editor/approximate/ApproximatePreview"
import { DisclosureChevron } from "../SnapParameters"
import { Field, OneSlider, type Option, Segmented, SwitchRow } from "./controls"

const METHOD_OPTIONS: ReadonlyArray<Option<Method>> = methods.map((value) => ({ value, label: METHODS[value].label }))

const SWEEP_OPTIONS: ReadonlyArray<Option<number>> = [0, 1, 2, 3].map((value) => ({
  value,
  label: value === 0 ? "Off" : `${value} ${value === 1 ? "sweep" : "sweeps"}`
}))

/** Pieces only: how much look a shorter run may give up (`PieceSettings.fewer`), from none to the most offered. */
const FEWER_OPTIONS: ReadonlyArray<Option<number>> = [
  { value: 0, label: "Off" },
  { value: FEWER, label: "Some" },
  { value: FEWER_MORE, label: "More" }
]

/** A slider from 0 to 1 over `min` to `max`, evenly in the logarithm. */
const logScale = (min: number, max: number) => ({
  of: (t: number) => Math.round(min * (max / min) ** t),
  slider: (value: number) => Math.log(value / min) / Math.log(max / min)
})

/** Pieces: up to what a prefab holds. */
const BUDGET = logScale(5, PREFAB_ITEMS.max)

interface PanelProps {
  readonly settings: ApproximateSettings
  readonly onChange: (settings: ApproximateSettings) => void
  /** A voxel's side in cm at the settings' resolution; undefined until a model is read. */
  readonly voxel: number | undefined
  /** How many pieces the method made before the budget cut them, where it ranks them. */
  readonly total: number | undefined
}

const voxels = (count: number, voxel: number | undefined) =>
  `${count} voxels${voxel === undefined ? "" : ` · ${Math.round(count * voxel)} cm`}`

function Resolution({ onChange, settings, voxel }: PanelProps) {
  return (
    <Field
      label="Resolution"
      value={`${settings.resolution} voxels${voxel === undefined ? "" : ` · ${Math.round(voxel)} cm`}`}
      hint={METHODS[settings.method].plates
        ? "The grid that repairs the surface and checks hidden piece geometry. The piece budget sets the visible detail."
        : "Voxels along the longest side. Higher follows the model more closely and uses more pieces."}
    >
      <OneSlider
        label="Resolution"
        min={4}
        max={128}
        step={1}
        value={settings.resolution}
        onChange={(resolution) => onChange({ ...settings, resolution })}
      />
    </Field>
  )
}

function Budget({ onChange, settings, total }: PanelProps) {
  const { method } = settings
  return (
    <Field
      label="Piece budget"
      value={method === "boxes" && total !== undefined
        ? `${Math.min(settings.budget, total)} of ${total}`
        : `${settings.budget} max`}
      hint={METHODS[method].plates
        ? "The most pieces the result may use. Plates fit a whole low-poly model to it, so a new budget fits again."
        : method === "piecesOnly"
        ? "The fit stops here, or sooner once no piece adds anything, and the polish may drop some. Lower shows the fit's first pieces at once."
        : "Keeps the largest pieces first, so lowering it drops the smallest without fitting again."}
    >
      <OneSlider
        label="Piece budget"
        min={0}
        max={1}
        step={0.005}
        value={BUDGET.slider(settings.budget)}
        onChange={(v) => onChange({ ...settings, budget: BUDGET.of(v) })}
      />
    </Field>
  )
}

/** The seconds of mesh search (plates) or polish (pieces only), and whether pieces follow the model's symmetries. */
function Search({ onChange, settings }: PanelProps) {
  const plated = METHODS[settings.method].plates
  return (
    <>
      <Field
        label={plated ? "Mesh search" : "Polish"}
        value={settings.searchSeconds === 0 ? "Off" : `${settings.searchSeconds} s${plated ? " max" : ""}`}
        hint={plated
          ? "Moves faces toward missing details and compares the rendered pieces after each edit. Longer looks better; Off shows the first fit."
          : "Moves, stretches, turns and drops pieces while the result looks more like the model. Off shows the fit alone."}
      >
        <OneSlider
          label={plated ? "Mesh search time" : "Polish time"}
          min={0}
          max={SEARCH_SECONDS_MAX}
          step={5}
          value={settings.searchSeconds}
          onChange={(searchSeconds) => onChange({ ...settings, searchSeconds })}
        />
      </Field>
      <SwitchRow
        label="Symmetry"
        hint={plated
          ? "Where the model is mirror symmetric, a mesh symmetric in the same plane is fitted too. Kept unless it looks clearly worse than the free one."
          : "Where the model is mirror or turn symmetric, pieces come in matching images. Kept only where that looks no worse than free pieces. Needs polish."}
        checked={settings.symmetry}
        onChange={(symmetry) => onChange({ ...settings, symmetry })}
      />
    </>
  )
}

function PlateFields({ onChange, plates }: {
  readonly plates: PlateSettings
  readonly onChange: (patch: Partial<PlateSettings>) => void
}) {
  return (
    <>
      <Field
        label="Flatness"
        value={`${plates.flatness}°`}
        hint="How far a face may turn from its patch and still share its plates. Higher makes bigger, flatter patches."
      >
        <OneSlider
          label="Flatness"
          min={2}
          max={30}
          step={1}
          value={plates.flatness}
          onChange={(flatness) => onChange({ flatness })}
        />
      </Field>
      <Field
        label="Thickness"
        value={plates.thickness === 0 ? "Automatic" : `${plates.thickness} cm`}
        hint="The most a rectangular patch may be thick. Automatic also lets flat regions span the model's depth; curved faces use shallow triangular plates."
      >
        <OneSlider
          label="Thickness"
          min={0}
          max={300}
          step={5}
          value={plates.thickness}
          onChange={(thickness) => onChange({ thickness })}
        />
      </Field>
    </>
  )
}

function PieceFields({ onChange, pieces, voxel }: {
  readonly pieces: PieceSettings
  readonly voxel: number | undefined
  readonly onChange: (patch: Partial<PieceSettings>) => void
}) {
  return (
    <>
      <Field label="Shapes" hint="Which pieces the fit may use.">
        <ToggleGroup
          multiple
          aria-label="Shapes"
          value={[...pieces.kinds]}
          onValueChange={(value) => {
            const kinds = shapeKinds.filter((kind) => value.includes(kind))
            if (kinds.length > 0) onChange({ kinds })
          }}
          className="flex-wrap"
        >
          {shapeKinds.map((kind: ShapeKind) => (
            <ToggleGroupItem key={kind} value={kind}>
              <span aria-hidden className="size-2 rounded-full" style={{ background: SHAPE_COLORS[kind] }} />
              {SHAPES[kind].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Field
        label="Outside penalty"
        value={`${pieces.outsidePenalty.toFixed(2)}×`}
        hint="What a voxel of piece one voxel past the tolerance costs against one inside the model; further out costs more. Higher stays inside the outline."
      >
        <OneSlider
          label="Outside penalty"
          min={0.5}
          max={16}
          step={0.5}
          value={pieces.outsidePenalty}
          onChange={(outsidePenalty) => onChange({ outsidePenalty })}
        />
      </Field>
      <Field
        label="Tolerance"
        value={voxels(pieces.tolerance, voxel)}
        hint="How far past the model's surface a piece may reach for free. Above 0 the pieces swell by about that much."
      >
        <OneSlider
          label="Tolerance"
          min={0}
          max={3}
          step={0.25}
          value={pieces.tolerance}
          onChange={(tolerance) => onChange({ tolerance })}
        />
      </Field>
      <Field
        label="Smallest piece"
        value={voxels(pieces.minSize, voxel)}
        hint="No side of a piece is shorter than this, so the budget isn't spent on specks."
      >
        <OneSlider
          label="Smallest piece"
          min={1}
          max={6}
          step={0.5}
          value={pieces.minSize}
          onChange={(minSize) => onChange({ minSize })}
        />
      </Field>
      <Field
        label="Refinement"
        hint="Sweeps after the fit: each re-fits every piece against the rest, drops pieces the others can make up for, and swaps a piece's shape where another fits better."
      >
        <Segmented
          label="Refinement sweeps"
          value={pieces.sweeps}
          options={SWEEP_OPTIONS}
          onChange={(sweeps) => onChange({ sweeps })}
        />
      </Field>
      <SwitchRow
        label="No spill"
        hint="No piece reaches past the model's voxels, so pieces fall short of the outline rather than bulge past it, as voxels do."
        checked={pieces.noSpill}
        onChange={(noSpill) => onChange({ noSpill })}
      />
      <SwitchRow
        label="Turn pieces"
        hint="Let pieces turn to any angle. Off keeps them square to the axes."
        checked={pieces.rotation}
        onChange={(rotation) => onChange({ rotation })}
      />
      <Field label="Seed" hint="The same seed and settings give the same fit.">
        <div className="flex gap-2">
          <Input
            aria-label="Seed"
            inputMode="numeric"
            value={String(pieces.seed)}
            onChange={(event) => {
              const seed = Number.parseInt(event.target.value, 10)
              if (Number.isFinite(seed)) onChange({ seed })
            }}
          />
          <Button variant="outline" onClick={() => onChange({ seed: Math.floor(Math.random() * 1e6) })}>
            Reroll
          </Button>
        </div>
      </Field>
    </>
  )
}

export function ApproximateSettingsPanel(props: PanelProps) {
  const { onChange, settings, voxel } = props
  const { budget, pieces, plates: plated } = METHODS[settings.method]
  const setPieces = (patch: Partial<PieceSettings>) =>
    onChange({ ...settings, pieces: { ...settings.pieces, ...patch } })
  const setPlates = (patch: Partial<PlateSettings>) =>
    onChange({ ...settings, plates: { ...settings.plates, ...patch } })
  // The grid is all a voxel method has to set its detail by; for the rest it is a detail of how the model is read.
  const gridFirst = !pieces && !plated
  return (
    <>
      <Field label="Method" hint={METHODS[settings.method].hint}>
        <Segmented
          label="Method"
          wrap
          value={settings.method}
          options={METHOD_OPTIONS}
          onChange={(method) => onChange({ ...settings, method })}
        />
      </Field>
      {gridFirst && <Resolution {...props} />}
      {budget && <Budget {...props} />}
      {(pieces || plated) && <Search {...props} />}
      {settings.method === "mixed" && (
        <Field
          label="Primitives"
          value={settings.plates.primitives === 0 ? "Off" : `${Math.round(settings.plates.primitives * 100)}%`}
          hint="How readily a sphere, half sphere, capsule, cylinder, cone or cube stands in for a stretch of the surface that follows one, freeing its plates for the rest. 50% takes one where it clearly looks better; 100% even where it looks a little worse."
        >
          <OneSlider
            label="Primitives weight"
            min={0}
            max={1}
            step={0.25}
            value={settings.plates.primitives}
            onChange={(primitives) => setPlates({ primitives })}
          />
        </Field>
      )}
      {pieces && (
        <Field
          label="Fewer pieces"
          hint="Starts the polish from the fewest of the fit's first pieces that look about as good as all of them. More gives up a little likeness for fewer pieces; Off keeps the best-looking run. Needs polish."
        >
          <Segmented
            label="Fewer pieces"
            value={settings.pieces.fewer}
            options={FEWER_OPTIONS}
            onChange={(fewer) => setPieces({ fewer })}
          />
        </Field>
      )}
      <Collapsible className="flex flex-col gap-4">
        <CollapsibleTrigger className="group/disclosure flex min-h-7 cursor-pointer items-center gap-2 rounded-control px-1 text-left text-body-strong focus-ring hover:bg-hover">
          Advanced
          <DisclosureChevron />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4">
          {!gridFirst && <Resolution {...props} />}
          {plated && <PlateFields plates={settings.plates} onChange={setPlates} />}
          {pieces && <PieceFields pieces={settings.pieces} voxel={voxel} onChange={setPieces} />}
          <SwitchRow
            label="Fill thin parts"
            hint="Count every voxel the surface passes through as solid, so open sheets and thin parts show."
            checked={settings.fillThin}
            onChange={(fillThin) => onChange({ ...settings, fillThin })}
          />
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
