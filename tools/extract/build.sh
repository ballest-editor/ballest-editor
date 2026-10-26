#!/usr/bin/env bash
# Build the CUE4Parse-based extractor into $WORK/bin. Needs dotnet-sdk 10 and
# CUE4PARSE_SRC (set by `nix develop` / `nix run .#extract`).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${BALLEST_WORK:-${XDG_CACHE_HOME:-$HOME/.cache}/ballest-editor/extract}"
: "${CUE4PARSE_SRC:?CUE4PARSE_SRC not set; run inside nix develop}"
mkdir -p "$WORK"
# Writable copies (the nix store is read-only and dotnet writes obj/ next to sources).
if [[ "$(cat "$WORK/CUE4Parse.src" 2>/dev/null)" != "$CUE4PARSE_SRC" ]]; then
  rm -rf "$WORK/CUE4Parse"
  cp -r --no-preserve=mode,ownership "$CUE4PARSE_SRC" "$WORK/CUE4Parse"
  echo "$CUE4PARSE_SRC" > "$WORK/CUE4Parse.src"
fi
rm -rf "$WORK/BallestExtract"
mkdir -p "$WORK/BallestExtract"
cp --no-preserve=mode,ownership "$here"/cue4/*.cs "$here"/cue4/*.csproj "$WORK/BallestExtract/"
# CUE4PARSE_SKIP_NATIVE: skip the optional C++ natives (Oodle is downloaded at runtime instead).
CUE4PARSE_SKIP_NATIVE=1 dotnet build "$WORK/BallestExtract/BallestExtract.csproj" \
  -c Release -o "$WORK/bin" -nologo -v quiet -clp:ErrorsOnly >&2
echo "$WORK/bin/BallestExtract"
