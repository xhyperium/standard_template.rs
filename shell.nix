# shell.nix — non-flake dev shell for stdio_template.rs (backwards compat)
#
# Usage:
#   nix-shell          # enter dev shell
#   nix-shell --run "make ci"

{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    rustup
    cargo-nextest
    cargo-deny
    cargo-llvm-cov
    cargo-machete
    just
  ];

  shellHook = ''
    echo "stdio_template.rs dev shell"
  '';
}
