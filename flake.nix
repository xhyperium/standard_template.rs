# flake.nix — infra.rs Nix 开发环境
#
# 使用:
#   nix develop          # 进入开发 shell（含 Rust 工具链 + Starship + wt 模块）
#   nix build .#starship-wt  # 构建独立的 Starship wt 模块
#
# 依赖:
#   - Nix 2.8+ with flakes enabled
#   - rust-overlay (for Rust toolchain)

{
  description = "infra.rs — Rust infrastructure workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
          targets = [ "x86_64-unknown-linux-gnu" ];
        };

        # Starship worktree 模块：在 prompt 中显示 infra.rs worktree 状态
        starshipWtModule = pkgs.writeShellScriptBin "starship-wt" ''
          exec ${./scripts/starship-wt.mjs}
        '';

        # Starship 配置（含 worktree 自定义模块）
        starshipWtConfig = pkgs.writeText "starship-wt.toml" ''
          [custom.wt]
          description = "infra.rs Git Worktree"
          command = "${starshipWtModule}/bin/starship-wt"
          when = "${starshipWtModule}/bin/starship-wt"
          format = "[$symbol$output]($style)"
          style = "bold cyan"
          symbol = "⛓️  "

          format = """
          $custom\
          $directory\
          $git_branch\
          $git_status\
          $fill\
          $cmd_duration\
          $line_break\
          $character\
          """
        '';

      in {
        # ── Dev Shell ──────────────────────

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            rustToolchain
            cargo-nextest
            cargo-deny
            cargo-llvm-cov
            cargo-machete
            starship
            just
          ];

          shellHook = ''
            # 启用 Rust 工具链
            export RUST_BACKTRACE=1

            # Starship 集成
            export STARSHIP_CONFIG="${starshipWtConfig}"
            export STARSHIP_CACHE="$TMPDIR/starship-cache"

            # Worktree 别名
            eval "$(${./scripts/worktree-activate.mjs})"

            echo ""
            echo "  infra.rs dev shell"
            echo "  Rust:   $(rustc --version 2>/dev/null || echo not found)"
            echo "  Starship worktree module: 已启用"
            echo ""
          '';

          # 传递给 shells within this shell
          STARSHIP_CONFIG = "${starshipWtConfig}";
        };

        # ── Packages ───────────────────────

        packages.starship-wt = starshipWtModule;

        # ── Home Manager 模块 ──────────────

        homeManagerModules.default = { config, lib, pkgs, ... }: {
          options.infra-rs.starship-wt = {
            enable = lib.mkEnableOption "infra.rs Starship worktree module";
          };

          config = lib.mkIf config.infra-rs.starship-wt.enable {
            home.packages = [ starshipWtModule ];

            programs.starship = {
              enable = true;
              settings = lib.recursiveUpdate (builtins.fromTOML (builtins.readFile ./starship.toml)) {
                custom.wt.command = "${starshipWtModule}/bin/starship-wt";
                custom.wt.when = "${starshipWtModule}/bin/starship-wt";
              };
            };
          };
        };

        # ── NixOS Module ──────────────────

        nixosModules.default = { config, lib, pkgs, ... }: {
          options.services.infra-rs-dev = {
            enable = lib.mkEnableOption "infra.rs development environment";
          };

          config = lib.mkIf config.services.infra-rs-dev.enable {
            environment.systemPackages = [ starshipWtModule ];
          };
        };
      });
}
