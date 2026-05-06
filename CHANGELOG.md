# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-05-06

### Added
- **TCP relay for interactive TUI apps** — `sunboxed claude` now works in any terminal. A ConPTY host runs inside the sandbox, connected to your terminal via localhost TCP with per-session 128-char auth token.
- **Direct .exe spawn** — resolved executables (.exe) are spawned directly in the PTY without cmd.exe wrapper, providing transparent signal handling.
- **Triple Ctrl+C force exit** — press Ctrl+C 3 times within 2 seconds to force-quit the relay.
- **Relay test suite** — 8 tests covering TCP connection, auth tokens, setRawMode, exit codes, sandbox markers.
- **FS isolation tests** for absolute paths (temp dir, user profile) — verifies sandbox blocks writes to system locations.
- **`/no-pty` flag** — disable ConPTY relay, force hidden window mode.
- Research notes (`docs/research.md`) documenting all findings.

### Fixed
- **`OpenPipePath=*` broke filesystem isolation** — this wildcard matched file paths too, allowing writes outside CWD to bypass the sandbox. Removed; `OpenIpcPath=*` alone covers IPC needs. This was the root cause of all FS isolation test failures since v0.1.0.
- **SIGINT killed relay on Ctrl+C** — now swallowed; Ctrl+C bytes are forwarded to the sandboxed app.
- **Terminal state corruption on exit** — relay now sends escape sequences to restore alternate screen, cursor, and attributes.
- **Relay timeout not cleared** — `clearTimeout` on host connection prevents 15s timeout from killing active sessions.
- **Missing `spawnSync` import in test helpers** — caused test infrastructure failures.

### Changed
- All execution modes (TTY and non-TTY) now route through the relay host when node-pty is available. This ensures consistent sandboxing regardless of how sunboxed is invoked.
- Simplified `cc75.cmd` — one-line direct call to `sunboxed.js`, removed `cc75.js`.
- Box hardening no longer sets `OpenPipePath=*`.
- `configurePaths()` now cleans stale `OpenPipePath` settings from boxes.
- Async test runner supports promise-returning test modules.

### Removed
- `bin/bridge.js` — superseded by `sunboxed-host.js` relay.
- `bin/cc75.js` — replaced by direct `cc75.cmd`.

## [0.1.1] - 2026-05-05

### Fixed
- Renamed install scripts to avoid namespace collision.

## [0.1.0] - 2026-05-05

### Added
- Initial release: CMD wrapper for Sandboxie-Plus isolation.
- Per-directory sandbox boxes with SHA-256 hash naming.
- Flags: `/readonly`, `/allow:<path>`, `/deny:<path>`, `/net-block`.
- CWD snapshots: create, list, restore, delete.
- Hardened box config: `ConfigLevel=99`, `Template=BlockPorts`, `BlockNetworkFiles=y`.
- 5 test suites covering FS isolation, network, overlay, box-per-dir, snapshots.
