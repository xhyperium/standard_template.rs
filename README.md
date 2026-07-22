# stdio_template.rs

A template for Rust **stdio-based programs**, pre-configured with the standard
[infra.rs](https://github.com/xhyperium/infra.rs) management toolchain.

Use **"Use this template"** on GitHub to bootstrap a new project, then rename
the crate and adjust the cache prefix key.

## What's included

| Area | File(s) |
|------|---------|
| CI | `.github/workflows/ci-rust.yml`, `constitution.yml` |
| Issue / PR templates | `.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS` |
| Formatting & lint | `rustfmt.toml`, `clippy.toml`, `.editorconfig`, `.markdownlint.json` |
| Dependency audit | `deny.toml` (cargo-deny) |
| Toolchain | `rust-toolchain.toml`, `.lsp.json`, `.cargo/config.toml` |
| Dev shell | `flake.nix`, `shell.nix` |
| Shortcuts | `Makefile` |

## Quick start

```bash
# Build, test, lint, audit (mirrors CI)
make ci

# Or run individual gates
make build      # cargo build --all-features
make test       # cargo test --all-features
make fmt-check  # cargo fmt --all -- --check
make lint       # cargo clippy --all-targets --all-features -- -D warnings
make deny       # cargo deny check
```

## Customizing for a new project

1. Rename the crate in `Cargo.toml` (`[package].name`).
2. Update `rust-toolchain.toml` / `Cargo.toml` `rust-version` if you need a
   different MSRV — and keep the `ci-rust.yml` **MSRV** job in sync.
3. Update the cache prefix in both workflows: change
   `env.RUST_CACHE_PREFIX_KEY` in `.github/workflows/ci-rust.yml` and
   `.github/workflows/constitution.yml`.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.
