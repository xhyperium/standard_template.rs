# shell.nix — infra.rs 非 flake 开发环境（向后兼容）
#
# 使用:
#   nix-shell          # 进入开发 shell
#   nix-shell --run "make ci"

{ pkgs ? import <nixpkgs> { } }:

let
  starshipWtScript = pkgs.writeShellScriptBin "starship-wt" ''
    exec ${./scripts/starship-wt.mjs}
  '';

  starshipWtConfig = pkgs.writeText "starship-wt.toml" ''
    [custom.wt]
    description = "infra.rs Git Worktree"
    command = "${starshipWtScript}/bin/starship-wt"
    when = "${starshipWtScript}/bin/starship-wt"
    format = "[$symbol$output]($style)"
    style = "bold cyan"
    symbol = "⛓️  "

    [directory]
    truncation_length = 3
    truncate_to_repo = true
  '';

in pkgs.mkShell {
  buildInputs = with pkgs; [
    rustup
    cargo-nextest
    cargo-deny
    starship
  ];

  shellHook = ''
    export STARSHIP_CONFIG="${starshipWtConfig}"
    eval "$(${./scripts/worktree-activate.mjs})" 2>/dev/null || true
    echo "infra.rs dev shell — Starship worktree module enabled"
  '';

  STARSHIP_CONFIG = "${starshipWtConfig}";
}
