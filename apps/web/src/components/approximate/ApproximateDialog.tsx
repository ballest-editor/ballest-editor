/**
 * Tools › Approximate 3D model (beta, Settings › Beta): turns a 3D file into a prefab of catalog pieces
 * (docs/APPROXIMATE.md). Choose a file and a method, and the fit reruns in a worker as the settings change; Open as
 * prefab puts the result in a new prefab tab.
 */
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { useId, useRef, useState } from "react"
import { type ApproximateSettings, DEFAULT_SETTINGS, METHODS } from "../../domain/approximate/settings"
import { PREFAB_ITEMS } from "../../domain/gameRules"
import { approximationPrefabProblem, openApproximationAsPrefab } from "../../editor/actions"
import { ApproximatePreview, type PreviewView } from "../../editor/approximate/ApproximatePreview"
import { MODEL_EXTENSIONS, type UpAxis } from "../../editor/approximate/loadModel"
import { type ModelFile, useApproximation, useModelFile } from "../../editor/approximate/useApproximation"
import { useEditor } from "../../editor/store"
import { ApproximateSettingsPanel } from "./ApproximateSettingsPanel"
import { ApproximateStats } from "./ApproximateStats"
import { Field, type Option, Segmented } from "./controls"

const VIEW_OPTIONS: ReadonlyArray<Option<PreviewView>> = [
  { value: "overlay", label: "Overlay" },
  { value: "pieces", label: "Pieces" },
  { value: "side", label: "Side by side" },
  { value: "model", label: "Model" },
  { value: "voxels", label: "Voxels" }
]

const UP_OPTIONS: ReadonlyArray<Option<UpAxis>> = [{ value: "y", label: "Y up" }, { value: "z", label: "Z up" }]

/** The smallest longest side offered, in cm. */
const SIZE_MIN = 10

/** The file, which way is up in it, and how big it is to be. */
function ModelFields({ source }: { readonly source: ModelFile }) {
  const { error, file, model, size } = source
  const input = useRef<HTMLInputElement>(null)
  const [sizeText, setSizeText] = useState(String(size))
  return (
    <>
      <Field
        label="Model"
        hint={file === null
          ? `${MODEL_EXTENSIONS.join(", ")}. A .gltf must have its buffers embedded.`
          : error ?? (model === null ? "Reading…" : `${model.triangleCount.toLocaleString()} triangles`)}
      >
        <input
          ref={input}
          type="file"
          className="hidden"
          accept={MODEL_EXTENSIONS.join(",")}
          onChange={(event) => {
            source.choose(event.target.files?.[0])
            event.target.value = ""
          }}
        />
        <Button variant="outline" onClick={() => input.current?.click()} className="justify-start truncate">
          {file?.name ?? "Choose a file…"}
        </Button>
      </Field>
      <Field label="Up axis" hint="Which way is up in the file. glTF, OBJ and FBX use Y; STL, PLY and 3MF Z.">
        <Segmented label="Up axis" value={source.up} options={UP_OPTIONS} onChange={source.setUp} />
      </Field>
      <Field label="Longest side" hint="In cm. A Cube is 1000 cm on a side.">
        <Input
          aria-label="Longest side in cm"
          inputMode="numeric"
          value={sizeText}
          onChange={(event) => setSizeText(event.target.value)}
          onBlur={() => {
            const next = Number(sizeText)
            if (Number.isFinite(next) && next >= SIZE_MIN) source.setSize(next)
            else setSizeText(String(size))
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
        />
      </Field>
    </>
  )
}

export default function ApproximateDialog({ onClose, open }: { readonly open: boolean; readonly onClose: () => void }) {
  const source = useModelFile()
  const { file, model } = source
  const [settings, setSettings] = useState<ApproximateSettings>(DEFAULT_SETTINGS)
  const [view, setView] = useState<PreviewView>("overlay")
  const [colorByShape, setColorByShape] = useState(false)
  const [dragging, setDragging] = useState(false)
  const colorId = useId()
  const { placements, run, total } = useApproximation(model, source.modelKey, settings, open)
  const problem = useEditor((s) => approximationPrefabProblem(s, placements))
  // While a run is under way only the one thing no setting here will fix is worth saying: too many pieces.
  const note = run.status === "done"
    ? problem ?? "Opens in a new prefab tab; save it from there."
    : placements.length > PREFAB_ITEMS.max
    ? problem
    : undefined

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[88vh] flex-col sm:max-w-[min(1400px,96vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Approximate 3D model
            <Badge>Beta</Badge>
          </DialogTitle>
          <DialogDescription>
            Builds a prefab of Cube, Sphere, Half Sphere, Capsule, Cylinder, Cone and Pyramid pieces shaped like a 3D
            file: try a GLB from Sketchfab or Poly Pizza, or an STL from Printables.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[22rem_minmax(0,1fr)] gap-4">
          <div className="flex min-h-0 flex-col gap-4 overflow-x-hidden overflow-y-auto pr-2">
            <ModelFields source={source} />
            <ApproximateSettingsPanel
              settings={settings}
              onChange={setSettings}
              voxel={model === null ? undefined : source.size / settings.resolution}
              total={total}
            />
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            <div
              className={cn(
                "relative min-h-0 flex-1 overflow-hidden rounded-control ring-1",
                dragging ? "ring-primary" : "ring-edge"
              )}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                source.choose(event.dataTransfer.files[0])
              }}
            >
              {model === null
                ? (
                  <div className="flex h-full items-center justify-center text-fg-tertiary">
                    {file === null ? "Drop a 3D file here, or choose one." : source.error ?? "Reading…"}
                  </div>
                )
                : (
                  <ApproximatePreview
                    triangles={model.triangles}
                    modelKey={`${model.name}-${source.up}`}
                    placements={placements}
                    grid={run.status === "done" ? run.grid : null}
                    view={view}
                    colorByShape={colorByShape}
                    uniformPaint={METHODS[settings.method].plates}
                  />
                )}
              <div className="pointer-events-none absolute top-2 left-2 max-w-72">
                <ApproximateStats run={run} />
              </div>
              <div className="absolute top-2 right-2 flex flex-col items-end gap-2">
                <Segmented label="View" value={view} options={VIEW_OPTIONS} onChange={setView} />
                <div
                  className="flex items-center gap-2 rounded-control bg-popover/90 px-2 py-1 text-caption ring-1 ring-edge"
                  title="Preview only. The prefab paints every piece smooth White, as the preview shows with this off."
                >
                  <label htmlFor={colorId}>Colour by shape</label>
                  <Switch id={colorId} checked={colorByShape} onCheckedChange={setColorByShape} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <span className="text-caption text-fg-tertiary">{note}</span>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button
                disabled={run.status !== "done" || problem !== undefined || model === null}
                onClick={() => model !== null && openApproximationAsPrefab(model.name, placements)}
              >
                Open as prefab
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
