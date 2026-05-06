# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SunBoxed — a Node.js CLI tool that runs commands inside Sandboxie-Plus containers with strict filesystem isolation. Primary use case: running AI coding agents safely with `--dangerously-skip-permissions`.

## Structure

```
bin/
├── sunboxed.js           — main logic: arg parsing, sandbox config, relay, snapshots
└── sunboxed-host.js      — PTY host (runs INSIDE sandbox, creates ConPTY via node-pty)
scripts/
├── sunboxed.cmd          — thin wrapper: calls node bin/sunboxed.js
├── cc75.cmd              — Claude Code 2.1.75 via sunboxed
├── sunboxed-install-user.cmd      — add scripts/ to user PATH
└── sunboxed-install-system.cmd    — add scripts/ to system PATH (admin)
tests/
├── run-all.js            — test runner (npm test), supports sync + async suites
├── helpers.js            — shared test utilities
├── test-fs-isolation.js  — CWD, parent, readonly, allow, deny, absolute paths, user profile
├── test-network.js       — /net-block
├── test-overlay.js       — persistence, /reset
├── test-box-per-dir.js   — per-dir boxes, cross-dir isolation, hardening
├── test-snapshots.js     — create, list, restore, delete, duplicates, exclusions
└── test-relay.js         — TCP relay: auth, output, setRawMode, exit codes, sandbox marker
docs/
├── research.md           — findings from building the relay solution
└── sandboxie_docs/       — Sandboxie CLI reference (Start.exe, SbieIni.exe, etc.)
```

## Running Tests

```bash
npm test    # 51 assertions across 6 suites, all must pass
```

Single suite: `node tests/test-relay.js`

## Architecture

### Relay mode (default when node-pty available)

All commands route through a TCP relay with ConPTY inside the sandbox:

```
User's terminal
    ↓ raw stdin/stdout (if TTY) or piped (if not)
sunboxed.js (runRelay) — TCP server, outside sandbox
    ↓ JSON-lines over localhost TCP (128-char auth token per session)
sunboxed-host.js — PTY host, INSIDE sandbox
    ↓ node-pty ConPTY
command.exe — target command (direct spawn for .exe, cmd.exe /c for .cmd/.bat)
```

This solves two problems:
1. Sandboxie's kernel driver blocks SetConsoleMode — ConPTY inside sandbox bypasses this
2. Start.exe doesn't reliably sandbox via spawnSync — relay host is always sandboxed

### Fallback hidden mode

Only used when node-pty is unavailable. Uses `Start.exe /hide_window /wait` via temp .cmd file. Less reliable sandboxing.

### How sunboxed.js Works

1. Derives box name from SHA-256 hash of full CWD path (`_SB_<16-char-hex>`)
2. Computes overlay path: `..\.sbox\<dirname>`
3. Kills SandMan GUI (prevents nag popups)
4. Hardens box: `ConfigLevel=99`, `Template=BlockPorts`, `BlockNetworkFiles=y`, `OpenIpcPath=*`
5. Clears stale settings (OpenFilePath, ClosedFilePath, OpenPipePath, BlockNetworkConnect)
6. Applies flags (/allow, /deny, /readonly, /net-block)
7. `Start.exe /reload` then launches command via relay
8. `Start.exe /terminate` after completion

## Key Sandboxie Gotchas

- **`OpenPipePath=*` breaks filesystem isolation**: This wildcard matches file paths too, allowing writes outside CWD to bypass the sandbox. Never use it. `OpenIpcPath=*` alone covers IPC including named pipes.
- **delete requires explicit value**: `SbieIni.exe delete BOX Setting` without a value silently fails. Must query values first, then delete each by value.
- **set replaces multi-value**: `SbieIni.exe set BOX Template X` replaces ALL Template entries with one. Use `append` for additional values.
- **ConfigLevel=99**: prevents auto-template addition on `/reload`. Setting it to 0 causes Sandboxie to RE-ADD all templates.
- **MSYS2 path munging**: `/reload` becomes `C:/Program Files/Git/reload` when called from Git Bash. Always route through `.cmd` files.
- **SbieIni.exe writes to SbieSvc memory, not ini file**: Config changes are applied in memory by the service. The ini file may not reflect current state.
- **setRawMode EPERM**: Sandboxie blocks SetConsoleMode for sandboxed processes. Solved by ConPTY relay (sunboxed-host.js).
- **GlobalSettings templates**: inherited by all boxes, but only affect RPC/COM (not filesystem paths). Safe to ignore.
