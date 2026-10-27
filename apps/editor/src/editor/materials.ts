/**
 * three.js materials for game materials, cached per material object path, plus a texture
 * cache. Base-colour textures are sRGB; normal and ORM textures stay linear. Anything
 * unknown renders with one shared neutral grey material.
 */
import * as THREE from "three"
import { lookupMaterial, type MaterialSpec, type MaterialTable, NEUTRAL } from "../domain/Materials"
import { isMesh } from "./threeGuards"

const textureLoader = new THREE.TextureLoader()
const textures = new Map<string, THREE.Texture>()
const materials = new Map<string, THREE.MeshStandardMaterial>()

const textureUrl = (path: string) => (path.startsWith("/") ? path : `/assets/${path}`)

const loadTexture = (path: string, colorSpace: THREE.ColorSpace, onError: () => void): THREE.Texture => {
  const key = `${colorSpace}|${path}`
  const cached = textures.get(key)
  if (cached !== undefined) return cached
  // Without a DOM (unit tests) there's no image loader; keep an empty texture.
  const texture = typeof document === "undefined"
    ? new THREE.Texture()
    : textureLoader.load(textureUrl(path), undefined, undefined, () => {
      textures.delete(key)
      onError()
    })
  texture.colorSpace = colorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  textures.set(key, texture)
  return texture
}

const build = (
  spec: Omit<MaterialSpec, "path"> & { readonly path?: string },
  table: MaterialTable | null
): THREE.MeshStandardMaterial => {
  // Per-texture sRGB flags from materials.json; base colour defaults to sRGB, data maps to linear.
  const colorSpaceOf = (png: string, fallback: THREE.ColorSpace) => {
    const srgb = table?.textureSrgb.get(png)
    return srgb === undefined ? fallback : srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  }
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(...spec.baseColor, THREE.LinearSRGBColorSpace),
    metalness: spec.metallic,
    roughness: spec.roughness,
    emissive: new THREE.Color().setRGB(...spec.emissive, THREE.LinearSRGBColorSpace),
    // Two-sided only where the game material says so (glass panes and other open meshes).
    side: spec.twoSided ? THREE.DoubleSide : THREE.FrontSide
  })
  material.name = spec.path ?? "neutral"
  if (spec.translucent) {
    material.transparent = true
    material.opacity = spec.opacity
    material.depthWrite = false
  }
  const drop = (slot: "map" | "normalMap" | "roughnessMap" | "metalnessMap" | "aoMap" | "emissiveMap") => () => {
    material[slot] = null
    material.needsUpdate = true
  }
  if (spec.baseColorTexture !== undefined) {
    material.map = loadTexture(spec.baseColorTexture, colorSpaceOf(spec.baseColorTexture, THREE.SRGBColorSpace), drop("map"))
  }
  if (spec.normalTexture !== undefined) {
    material.normalMap = loadTexture(spec.normalTexture, THREE.NoColorSpace, drop("normalMap"))
    material.normalScale.set(1, -1) // UE normal maps use DirectX green (-Y)
  }
  if (spec.ormTexture !== undefined) {
    const orm = loadTexture(spec.ormTexture, THREE.NoColorSpace, () => {
      drop("roughnessMap")()
      drop("metalnessMap")()
    })
    material.roughnessMap = orm // G channel
    material.metalnessMap = orm // B channel
  }
  if (spec.emissiveTexture !== undefined) {
    material.emissiveMap = loadTexture(spec.emissiveTexture, colorSpaceOf(spec.emissiveTexture, THREE.SRGBColorSpace), drop("emissiveMap"))
    if (spec.emissive.every((c) => c === 0)) material.emissive.setRGB(1, 1, 1)
  }
  return material
}

let neutral: THREE.MeshStandardMaterial | undefined
export const neutralMaterial = (): THREE.MeshStandardMaterial => (neutral ??= build(NEUTRAL, null))

/** The cached material for a game material path (class-qualified or bare), or neutral grey. */
export const materialFor = (table: MaterialTable | null, path: string | undefined): THREE.MeshStandardMaterial => {
  const spec = lookupMaterial(table, path)
  if (spec === undefined) return neutralMaterial()
  const cached = materials.get(spec.path)
  if (cached !== undefined) return cached
  const material = build(spec, table)
  materials.set(spec.path, material)
  return material
}

/** UE slot index of a glb primitive: `extras.ueMaterialIndex`, else the "<i>:<slot>" material name. */
export const slotIndexOf = (mesh: THREE.Mesh): number => {
  const fromExtras: unknown = mesh.geometry.userData["ueMaterialIndex"]
  if (typeof fromExtras === "number") return fromExtras
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const fromMaterialExtras: unknown = material?.userData["ueMaterialIndex"]
  if (typeof fromMaterialExtras === "number") return fromMaterialExtras
  const match = /^(\d+):/.exec(material?.name ?? "")
  return match ? Number(match[1]) : 0
}

/** Assigns game materials to every primitive under `root` by UE slot index. */
export const applySlotMaterials = (
  root: THREE.Object3D,
  table: MaterialTable | null,
  slotMaterials: ReadonlyArray<string | undefined>
): void =>
  root.traverse((object) => {
    if (isMesh(object)) object.material = materialFor(table, slotMaterials[slotIndexOf(object)])
  })
