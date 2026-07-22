# flake.nix — stdio_template.rs Nix dev shell
#
# Usage:
#   nix develop          # enter dev shell (Rust toolchain + CI tools)
#   nix build            # (no packages; devShell only)
#
# Requires:
#   - Nix 2.8+ with flakes enabled
#   - rust-overlay (for Rust toolchain)

{
  description = "stdio_template.rs — Rust stdio program template";

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

      in {
        # ── Dev Shell ──────────────────────

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            rustToolchain
            cargo-nextest
            cargo-deny
            cargo-llvm-cov
            cargo-machete
            just
          ];

          shellHook = ''
            export RUST_BACKTRACE=1
            echo ""
            echo "  stdio_template.rs dev shell"
            echo "  Rust: $(rustc --version 2>/dev/null || echo not found)"
            echo ""
          '';
        };
      });
}
