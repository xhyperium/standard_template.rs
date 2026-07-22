# shell.nix — non-flake dev shell for standard_template.rs (backwards compat)
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
    echo "standard_template.rs dev shell"
  '';
}
