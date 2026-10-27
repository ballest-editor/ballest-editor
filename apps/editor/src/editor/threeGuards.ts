/**
 * `instanceof THREE.Mesh` narrows to `Mesh<any, any, any>`; these guards keep three's
 * default type parameters so geometry and material stay typed.
 */
import * as THREE from "three"

export const isMesh = (object: THREE.Object3D): object is THREE.Mesh => object instanceof THREE.Mesh

export const isLine = (object: THREE.Object3D): object is THREE.Line => object instanceof THREE.Line
