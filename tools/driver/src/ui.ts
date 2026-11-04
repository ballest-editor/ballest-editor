// The game's UI as data, from the host's `palette` and `widgets` test commands (the fork's ui-dump branch; docs/DRIVER.md
// § The UI as data). Pure parsers over the reply lines, and the diff of the palette against our catalog.

export interface PaletteItem {
  readonly name: string
  readonly classPath: string
}

export interface PaletteCategory {
  readonly index: number
  /** The category's FName, as the game's data keys it. */
  readonly name: string
  /** The header the panel shows. */
  readonly header: string
  /** Tiles the panel built for it (should equal the items). */
  readonly tiles: number
  /** The data asset the category reads. */
  readonly asset: string
  readonly items: ReadonlyArray<PaletteItem>
}

const CATEGORY = /^category (\d+) (.*?) header "(.*)" tiles (\d+) items (\d+)(?: asset (\S+))?$/
const ITEM = /^ {2}(\d+) (.*) (\/\S+)$/

/** The categories in panel order with their items, from the `palette` reply. */
export const parsePalette = (replies: ReadonlyArray<string>): Array<PaletteCategory> => {
  const out: Array<PaletteCategory> = []
  let items: Array<PaletteItem> = []
  for (const line of replies) {
    const c = CATEGORY.exec(line)
    if (c !== null) {
      items = []
      out.push({
        index: Number(c[1]),
        name: c[2] ?? "",
        header: c[3] ?? "",
        tiles: Number(c[4]),
        asset: c[6] ?? "",
        items
      })
      continue
    }
    const i = ITEM.exec(line)
    if (i !== null) items.push({ name: i[2] ?? "", classPath: i[3] ?? "" })
  }
  return out
}

export interface WidgetLine {
  readonly depth: number
  readonly class: string
  readonly name: string
  readonly visibility: string
  readonly enabled: boolean
  /** A text block's or text box's text, a combo box's choice. */
  readonly text?: string
  /** A check box's state. */
  readonly checked?: boolean
  /** A palette tile's piece class. */
  readonly classPath?: string
}

const WIDGET = /^( *)(\S+) (\S+) (visible|collapsed|hidden|hit-test-invisible|self-hit-test-invisible|\?)(.*)$/

/** The widget tree from a `widgets` reply, one entry per widget. */
export const parseWidgets = (replies: ReadonlyArray<string>): Array<WidgetLine> => {
  const out: Array<WidgetLine> = []
  for (const line of replies) {
    if (line.startsWith("widgets ")) continue
    const m = WIDGET.exec(line)
    if (m === null) continue
    const rest = m[5] ?? ""
    const text = /"(.*)"/.exec(rest)?.[1]
    const classPath = / class=(\S+)/.exec(rest)?.[1]
    const entry: WidgetLine = {
      depth: (m[1] ?? "").length / 2,
      class: m[2] ?? "",
      name: m[3] ?? "",
      visibility: m[4] ?? "",
      enabled: !/\bdisabled\b/.test(rest),
      ...(text === undefined ? {} : { text }),
      ...(/\b(?:un)?checked\b/.test(rest) ? { checked: !/\bunchecked\b/.test(rest) } : {}),
      ...(classPath === undefined ? {} : { classPath })
    }
    out.push(entry)
  }
  return out
}

/** What our catalog says about a piece, as far as the palette can check it. */
export interface CatalogPiece {
  readonly objectPath: string
  readonly displayName?: string | null | undefined
  readonly category?: string | null | undefined
  readonly inPalette?: boolean | undefined
}

export interface PaletteDiff {
  /** In the game's palette, not in the catalog at all. */
  readonly missingFromCatalog: ReadonlyArray<PaletteItem & { readonly category: string }>
  /** In the palette, in the catalog, but the catalog says not in the palette. */
  readonly notMarkedInPalette: ReadonlyArray<string>
  /** The catalog says in the palette, the game doesn't show it. */
  readonly goneFromPalette: ReadonlyArray<string>
  /** Same piece, different name or category. */
  readonly renamed: ReadonlyArray<{
    readonly classPath: string
    readonly catalog: { readonly displayName: string; readonly category: string }
    readonly game: { readonly displayName: string; readonly category: string }
  }>
  /** Categories whose tile count differs from their item count: the panel dropped or doubled something. */
  readonly tileMismatch: ReadonlyArray<{ readonly category: string; readonly tiles: number; readonly items: number }>
}

/** The palette as the game builds it against the catalog, by class path. */
export const diffPalette = (
  palette: ReadonlyArray<PaletteCategory>,
  catalog: ReadonlyArray<CatalogPiece>
): PaletteDiff => {
  const byPath = new Map(catalog.map((p) => [p.objectPath, p]))
  const seen = new Set<string>()
  const missingFromCatalog: Array<PaletteItem & { category: string }> = []
  const notMarkedInPalette: Array<string> = []
  const renamed: Array<PaletteDiff["renamed"][number]> = []
  const tileMismatch: Array<PaletteDiff["tileMismatch"][number]> = []
  for (const category of palette) {
    if (category.tiles !== category.items.length) {
      tileMismatch.push({ category: category.header, tiles: category.tiles, items: category.items.length })
    }
    for (const item of category.items) {
      seen.add(item.classPath)
      const piece = byPath.get(item.classPath)
      if (piece === undefined) {
        missingFromCatalog.push({ ...item, category: category.header })
        continue
      }
      if (piece.inPalette !== true) notMarkedInPalette.push(item.classPath)
      const catalogName = piece.displayName ?? ""
      const catalogCategory = piece.category ?? ""
      if (catalogName !== item.name || catalogCategory !== category.header) {
        renamed.push({
          classPath: item.classPath,
          catalog: { displayName: catalogName, category: catalogCategory },
          game: { displayName: item.name, category: category.header }
        })
      }
    }
  }
  const goneFromPalette = catalog.filter((p) => p.inPalette === true && !seen.has(p.objectPath)).map((p) =>
    p.objectPath
  )
  return { missingFromCatalog, notMarkedInPalette, goneFromPalette, renamed, tileMismatch }
}
