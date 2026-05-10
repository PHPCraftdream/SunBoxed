# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-05-10

### Changed — pivoted from Sandboxie-Plus to Docker

The Sandboxie-Plus wrapper (`sunboxed`) has been retired in favour of a Docker-based isolation layer. The Sandboxie variant lives on at the `sandboxie-final` tag and the `sandboxie-archive` branch.

Reasons:
- Sandboxie's kernel driver kept blocking ConPTY handshakes (`SetConsoleMode` EPERM); the TCP relay workaround was fragile across terminals.
- `OpenPipePath=*` matched filesystem paths and broke isolation guarantees.
- Container namespaces are cross-platform; Sandboxie is Windows-only.
- Corporate VPN endpoint security drivers (Cisco Secure Client, Zscaler) hijack UDP:53 at the kernel level — there was no way to route around this from a Sandboxie process. The new DoH-proxy-in-container approach handles it cleanly.

### Added

- **`sundocked`** — bare Docker wrapper: one long-lived container per `(directory, image)`, CWD bind-mounted as `/work`, persistent home as `/root`. Subcommands: `shell` / `exec` / `cc` / `install` / `start` / `stop` / `restart` / `reset` / `list` / `status` / `service add|remove|start|stop|status|list|logs` / `wait-for` / `recipe` / `recipes`. Recipe presets for nginx+php-fpm, postgres, redis.
- **`sundocked-cc`** — one-shot Claude Code launcher; `sundocked cc` with `cc` auto-injected.
- **`sundohed`** — `sundocked` + an in-container DoH proxy bootstrapped on every container start. Bypasses kernel-level UDP:53 hijacks transparently — no per-domain `--add-host` whitelist needed.
- **`sundohed-cc`** — one-shot Claude Code launcher with the DoH proxy.
- **Go DoH proxy** (`dns-proxy/main.go`, ~250 lines): listens UDP:53 + TCP:53 on 127.0.0.1; forwards via HTTPS to 11 hostname-based upstreams (Cloudflare / Google / Quad9 / AdGuard / Mullvad / AliDNS) with hardcoded IPs in a custom `net.Dialer` so TLS SNI matches the real provider hostname. Mozilla CA bundle embedded — works on minimal images without `ca-certificates`. Per-upstream availability stats with stable-sort reordering. Ships as static `linux-amd64` and `linux-arm64` binaries (~6 MB each).
- **Hook API** in `bin/sundocked.js` (`setHooks` + `module.exports`) so wrappers extend container lifecycle without forking.
- **Ktav 0.3.0 config** at `..\.sundocked\<dirname>\config.ktav` — image, ports, env, services, network mode. Hand-editable.

### Removed

- `bin/sunboxed.js`, `bin/sunboxed-host.js`
- `scripts/sunboxed.cmd`, `scripts/cc121.cmd`, `scripts/cc75.cmd`
- `tests/` (entire Sandboxie test suite, 60+ assertions across 6 suites)
- `docs/research.md`, `docs/sandboxie_docs/` (Sandboxie CLI reference)
- `node-pty` dependency (was only used by `sunboxed-host.js`)
- `--add-host` hijack-detection machinery (`DEFAULT_BYPASS_HOSTS`, `dohResolve`, `detectDnsHijack`, `buildAddHostFlags`, `extraHosts`) — superseded by the in-container DoH proxy.

### Renamed

- npm package: `sunboxed` → `sundohed`. The repo URL stays `github.com/PHPCraftdream/SunBoxed` for continuity.

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
