// The probe map (docs/DRIVER.md § Probe maps): one fixed draft in every slot's UserSavedMaps, written at prepare so
// the game lists it at launch, and overwritten before each open with whatever pieces a probe needs. The game reads
// the file when the map is opened from the Create page, so the content can change between opens without a restart.
// `levelData.userLevelName` has to match the file's name: the game opens the map by that name, not by the file.

const PROBE_NAME = "driver probe"
export const PROBE_CREATOR = "driver"
export const PROBE_FILE = `Map_LevelEditorMain&${PROBE_NAME}_${PROBE_CREATOR}.balledit`
/**
 * What `openmap` looks for to open the probe. The host matches only the first word of its argument, and `driver probe`
 * would match `driver`, which also finds the `driver probe_<player>` copy an editor save leaves beside the probe.
 */
export const PROBE_FRAGMENT = `probe_${PROBE_CREATOR}`

export interface ProbeItem {
  /** A class path as the catalog and map files write them (with or without the BlueprintGeneratedClass wrapper). */
  readonly classPath: string
  readonly location?: readonly [number, number, number]
  /** A unit quaternion x, y, z, w (default: none). */
  readonly rotation?: readonly [number, number, number, number]
  readonly scale?: readonly [number, number, number]
}

const ZERO = { x: 0, y: 0, z: 0 }
const STILL = { pitch: 0, yaw: 0, roll: 0 }
const START = "/Game/MapItems/PlayerStart/MP_PlayerStart.MP_PlayerStart_C"
const START_SCALE = 0.276538

const wrap = (classPath: string) =>
  classPath.startsWith("/Script/") ? classPath : `/Script/Engine.BlueprintGeneratedClass'${classPath}'`

const item = (p: ProbeItem) => {
  const [x, y, z] = p.location ?? [0, 0, 0]
  const [qx, qy, qz, qw] = p.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = p.scale ?? [1, 1, 1]
  return {
    actorToSpawn: wrap(p.classPath),
    itemTransform: {
      rotation: { x: qx, y: qy, z: qz, w: qw },
      translation: { x, y, z },
      scale3D: { x: sx, y: sy, z: sz }
    },
    meshComponents: [],
    bIsBaseItem: false,
    boolProperties: [],
    floatProperties: [],
    intProperties: [],
    textProperties: [],
    nameProperties: [],
    stringProperties: []
  }
}

/** The start the game needs, far enough from the origin that a probe piece at the origin is clear of it. */
export const PROBE_START: ProbeItem = {
  classPath: START,
  location: [-3000, -3000, 0],
  scale: [START_SCALE, START_SCALE, START_SCALE]
}

/** The map JSON: the start and `pieces`, with the world settings a fresh draft has. */
export const probeMap = (pieces: ReadonlyArray<ProbeItem>): string =>
  `${
    JSON.stringify({
      worldSettings: {
        directionalLight: { timeOfDay: 7.3, brightness: 12 },
        metaData: [{
          title: "Ballest Editor",
          descriptor: "the game driver's probe map; overwritten before every probe"
        }],
        levelData: {
          systemLevelName: "Map_LevelEditorMain",
          userLevelName: `${PROBE_NAME}_${PROBE_CREATOR}`,
          levelDifficulty: "Beginner",
          levelDescription: "",
          uploaderOnlyLevelPreviewImagePath: "",
          bValidated: false,
          mapTags: { gameplayTags: [] },
          medalTimesByIndex: [0],
          createdAt: "2026.01.01-00.00.00",
          creatorName: PROBE_CREATOR,
          levelDisplayName: PROBE_NAME,
          levelPublishedFileId: -1
        },
        skylightIntensity: 1,
        directionalLightAngle: -20.6
      },
      items: [PROBE_START, ...pieces].map(item),
      // No groups, no pivots, no saved camera: the editor starts where it likes.
      editorState: {
        version: 1,
        groups: [],
        pivots: [],
        bHasCamera: false,
        cameraLocation: ZERO,
        cameraRotation: STILL
      }
    })
  }\n`

/** Quaternion x, y, z, w of pitch, yaw, roll in degrees, as UE composes them (yaw about Z, pitch about Y, roll about X). */
export const quaternion = (pitch: number, yaw: number, roll: number): readonly [number, number, number, number] => {
  const half = Math.PI / 360
  const [sp, cp] = [Math.sin(pitch * half), Math.cos(pitch * half)]
  const [sy, cy] = [Math.sin(yaw * half), Math.cos(yaw * half)]
  const [sr, cr] = [Math.sin(roll * half), Math.cos(roll * half)]
  return [
    cr * sp * sy - sr * cp * cy,
    -cr * sp * cy - sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy
  ]
}
