{
  description = "ballest-editor: map editor for Ballest of Them All (asset extraction toolchain)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Pinned CUE4Parse source (UE 5.8 IoStore + StaticMesh parser). Not a flake.
    cue4parse = {
      url = "github:FabianFG/CUE4Parse/df14b992d6d503c9d39e693af415fee5e1961de9";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, cue4parse }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # directx-shader-compiler: dxc disassembles the cooked shaders (tools/extract/src/shaders.ts).
      toolsFor = pkgs: with pkgs; [ dotnet-sdk_10 nodejs_22 pnpm curl coreutils findutils gnugrep gnused directx-shader-compiler ];
      # liboodle-data-shared.so (downloaded at runtime by CUE4Parse) links libstdc++.
      libPathFor = pkgs: pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          # libavif: avifenc for tools/compress.
          packages = toolsFor pkgs ++ [ pkgs.libavif ];
          CUE4PARSE_SRC = "${cue4parse}";
          LD_LIBRARY_PATH = libPathFor pkgs;
          DOTNET_CLI_TELEMETRY_OPTOUT = "1";
          DOTNET_NOLOGO = "1";
        };
      });

      packages = forAll (pkgs: {
        # tools/compress builds this when avifenc isn't on PATH, so encodes follow flake.lock.
        libavif = pkgs.libavif;
        extract = pkgs.writeShellApplication {
          name = "ballest-extract";
          runtimeInputs = toolsFor pkgs;
          text = ''
            export CUE4PARSE_SRC="${cue4parse}"
            export LD_LIBRARY_PATH="${libPathFor pkgs}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
            exec bash ${./tools/extract}/run.sh "$@"
          '';
        };
      });

      apps = forAll (pkgs: {
        extract = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.extract}/bin/ballest-extract";
        };
      });
    };
}
