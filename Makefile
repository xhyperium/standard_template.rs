# stdio_template.rs Makefile

.PHONY: help
help: ## Show help
	@echo "stdio_template.rs — Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ── Rust Toolchain ────────────────────────

.PHONY: build test fmt lint doc clean
build: ## Build (--all-features)
	@cargo build --all-features

test: ## Run all tests
	@cargo test --all-features

fmt: ## Format all code
	@cargo fmt --all

fmt-check: ## Check formatting (no modify)
	@cargo fmt --all -- --check

lint: ## Run clippy (-D warnings)
	@cargo clippy --all-targets --all-features -- -D warnings

doc: ## Build docs (including private items)
	@cargo doc --no-deps --document-private-items

clean: ## Clean build artifacts
	@cargo clean

# ── Security Audit ────────────────────────

.PHONY: deny audit
deny: ## Run cargo-deny security audit
	@cargo deny check

audit: ## Run cargo-audit vulnerability scan
	@cargo audit

# ── Common Targets ────────────────────────

.PHONY: ci update
ci: fmt-check lint test deny ## CI simulation (run all gates locally)

update: ## Update dependencies
	@cargo update
