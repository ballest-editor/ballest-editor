#!/usr/bin/env bash
# Extract Ballest level-editor piece meshes (glb), assets/catalog.json, keybinds.json, materials.json + textures, registry.json.
#
#   nix run .#extract -- [GAME_DIR] [options]        (or: nix develop -c tools/extract/run.sh ...)
#
# GAME_DIR  default: ~/.local/share/Steam/steamapps/common/Ballest of Them All (read only, never written)
# Options:
#   --out DIR          assets dir to write pieces/ and catalog.json into (default: $PWD/assets)
#   --samples DIR      map samples (.ballmap/.balledit), repeatable (default: $PWD/samples)
#   --paks-copy DIR    where to copy the game's paks (default: /tmp/ballest-paks)
#   --usmap FILE       use this .usmap instead of downloading the pinned Fortnite one
#   --pieces-only      only export meshes referenced by pieces (skip the rest of /Game/Maps/_GENERATED/PC)
#   --tex-max N        max texture size in px for assets/textures (default 2048; largest mip <= N)
#   --keep-work        keep the temp work dir (classes.json, meshes.json, logs)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$HOME/.local/share/Steam/steamapps/common/Ballest of Them All"
OUT="$PWD/assets"
SAMPLES=()
PAKS_COPY="/tmp/ballest-paks"
USMAP=""
PIECES_ONLY=0
KEEP_WORK=0
TEX_MAX=2048
while (($#)); do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --samples) SAMPLES+=("$2"); shift 2 ;;
    --paks-copy) PAKS_COPY="$2"; shift 2 ;;
    --usmap) USMAP="$2"; shift 2 ;;
    --pieces-only) PIECES_ONLY=1; shift ;;
    --keep-work) KEEP_WORK=1; shift ;;
    --tex-max) TEX_MAX="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) GAME_DIR="$1"; shift ;;
  esac
done
((${#SAMPLES[@]})) || SAMPLES=("$PWD/samples/Workshop" "$PWD/samples/UserSavedMaps")
OUT="$(realpath -m "$OUT")"
PAKS_SRC="$GAME_DIR/Ballest/Content/Paks"
[[ -f "$PAKS_SRC/Ballest-Windows.utoc" ]] || { echo "no Ballest-Windows.utoc under $PAKS_SRC" >&2; exit 1; }
case "$(realpath -m "$PAKS_COPY")/" in "$(realpath -m "$GAME_DIR")"/*) echo "--paks-copy must be outside the game dir" >&2; exit 1 ;; esac

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/ballest-editor"
export BALLEST_WORK="$CACHE/extract"
WORK="$(mktemp -d /tmp/ballest-extract.XXXXXX)"
((KEEP_WORK)) || trap 'rm -rf "$WORK"' EXIT
log() { printf '\033[1m[extract]\033[0m %s\n' "$*" >&2; }

# 1. Copy the containers (never open the game's files for writing). -u/-p: reruns only copy changed files.
log "copying paks -> $PAKS_COPY"
mkdir -p "$PAKS_COPY"
cp -u -p "$PAKS_SRC"/*.pak "$PAKS_SRC"/*.utoc "$PAKS_SRC"/*.ucas "$PAKS_COPY"/

# 2. Downloads (data only, each in its own dir).
#    Oodle: CUE4Parse fetches liboodle-data-shared.so from github.com/WorkingRobot/OodleUE (pinned release).
#    usmap: Fortnite 42.40 mappings; engine classes match UE 5.8 except the props patched in Program.cs.
mkdir -p "$CACHE/downloads/oodle" "$CACHE/downloads/usmap"
OODLE="$CACHE/downloads/oodle/liboodle-data-shared.so"
if [[ -z "$USMAP" ]]; then
  USMAP="$CACHE/downloads/usmap/fortnite-42.40-CL-59086525_br.usmap"
  USMAP_URL="https://data.uedb.dev/mappings/68e81c124aa6fb8d44971988/++Fortnite+Release-42.40-CL-59086525_br.usmap"
  USMAP_SHA256="f40dbfb95a312ce38adfb1013ef9f24badabfec0e37ecf902dfea393832aebad"
  if [[ ! -f "$USMAP" ]]; then
    log "downloading usmap"
    curl -fsSL -o "$USMAP.part" "$USMAP_URL" && mv "$USMAP.part" "$USMAP"
  fi
  echo "$USMAP_SHA256  $USMAP" | sha256sum -c --quiet - || { echo "usmap checksum mismatch" >&2; exit 1; }
fi

# 3. Build the CUE4Parse tool.
log "building extractor"
BIN="$(bash "$here/build.sh")"
extract() { dotnet "$BIN.dll" "$@" --paks "$PAKS_COPY" --oodle "$OODLE" --usmap "$USMAP"; }

# 4. Samples + item registry -> classes -> component templates -> mesh list -> glb -> catalog.
node "$here/scan-samples.mjs" --out "$WORK" "${SAMPLES[@]}"
# Item registry: palette (content browser data), recipe-registry refs, BP_BaseItem hierarchy.
log "building item registry"
mkdir -p "$OUT"
extract imports --prefix Ballest/Content --props Ballest/Content/LevelEditor/Playback/DA_UGCPlaybackRecipeRegistry \
  --out "$WORK/imports.json" 2>"$WORK/imports.log" || { tail -20 "$WORK/imports.log" >&2; exit 1; }
extract dump --prefix Ballest/Content/LevelEditor/PackageAssets/MultiplayerLevelEditor/UI/Data/ContentBrowser \
  --out "$WORK/palette-dump.json" 2>"$WORK/palette.log" || { tail -20 "$WORK/palette.log" >&2; exit 1; }
node "$here/build-registry.mjs" "$WORK" "$OUT"
node "$here/build-catalog.mjs" classes "$WORK" "$OUT"
log "exporting palette thumbnails"
mkdir -p "$WORK/thumbs"
extract textures --list "$WORK/thumbs.txt" --tex-dir "$WORK/thumbs" --tex-max 256 --flat --out "$WORK/thumbs.json" \
  2>"$WORK/thumbs.log" || { tail -20 "$WORK/thumbs.log" >&2; exit 1; }
rm -rf "$OUT/thumbs"
cp -r "$WORK/thumbs" "$OUT/thumbs"
log "resolving blueprint classes"
extract classes --classes "$WORK/classes.txt" --report "$WORK/classes.json" 2>"$WORK/classes.log" || { tail -20 "$WORK/classes.log" >&2; exit 1; }
node "$here/build-catalog.mjs" meshes "$WORK"
include=(--include-dir Ballest/Content/Maps/_GENERATED/PC)
((PIECES_ONLY)) && include=()
log "exporting meshes"
mkdir -p "$WORK/pieces"
extract export --meshes "$WORK/meshes.txt" "${include[@]}" --out "$WORK/pieces" --report "$WORK/meshes.json" 2>"$WORK/export.log" || { tail -20 "$WORK/export.log" >&2; exit 1; }
grep '^\[export\]' "$WORK/export.log" >&2 || true

mkdir -p "$OUT"
rm -rf "$OUT/pieces"
cp -r "$WORK/pieces" "$OUT/pieces"
node "$here/build-catalog.mjs" catalog "$WORK" "$OUT"

# 5. Default keybinds (Enhanced Input assets + DefaultInput.ini + level-editor widgets).
log "dumping input assets"
extract dump --prefix Ballest/Content/Core/Input --prefix Ballest/Plugins/SKGMultiplayerLevelEditor \
  --prefix Ballest/Content/UI/LevelEditor --prefix Ballest/Content/LevelEditor/PlayerController \
  --prefix Ballest/Content/LevelEditor/PackageAssets/MultiplayerLevelEditor/UI \
  --prefix Ballest/Content/UI/MainMenu/Pages/WBP_2_Settings \
  --prefix Ballest/Content/Core/SaveSystem/Settings/CameraSettings/DT_CameraSettingsPresets \
  --file Ballest/Config/DefaultInput.ini --out "$WORK/input-dump.json" 2>"$WORK/input.log" || { tail -20 "$WORK/input.log" >&2; exit 1; }
node "$here/build-keybinds.mjs" "$WORK/input-dump.json" "$OUT/keybinds.json"
# All English game strings (Localization/Game/en/Game.locres): { namespace: { key: text } }.
extract locres --file Ballest/Content/Localization/Game/en/Game.locres --out "$OUT/strings.json" 2>>"$WORK/input.log"

# 6. Materials: every material referenced by samples + catalog, parent chains, textures -> PNG.
log "exporting materials and textures"
node "$here/build-materials.mjs" list "$WORK" "$OUT"
mkdir -p "$WORK/textures"
extract materials --list "$WORK/materials.txt" --out "$WORK/materials-dump.json" --tex-dir "$WORK/textures" --tex-max "$TEX_MAX" \
  2>"$WORK/materials.log" || { tail -20 "$WORK/materials.log" >&2; exit 1; }
rm -rf "$OUT/textures"
cp -r "$WORK/textures" "$OUT/textures"
node "$here/build-materials.mjs" build "$WORK" "$OUT"

# 7. Sanity checks.
node "$here/verify.mjs" "$OUT/pieces/Maps/_GENERATED/PC/SM_500.glb" "$OUT/pieces/Maps/_GENERATED/PC/SM_Start_Fixed.glb" >&2
node "$here/verify.mjs" --materials "$OUT" >&2
log "assets/pieces: $(find "$OUT/pieces" -name '*.glb' | wc -l) glb, $(du -sh "$OUT/pieces" | cut -f1)"
log "assets/textures: $(find "$OUT/textures" -name '*.png' | wc -l) png, $(du -sh "$OUT/textures" | cut -f1)"
((KEEP_WORK)) && log "work dir kept: $WORK"
exit 0
