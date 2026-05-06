# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SunBoxed — a Node.js CLI tool that runs commands inside Sandboxie-Plus containers with strict filesystem isolation. Primary use case: running AI coding agents safely with `--dangerously-skip-permissions`.

## Structure

```
bin/
├── sunboxed.js           — main logic: arg parsing, sandbox config, relay, snapshots
├── sunboxed-host.js      — PTY host (runs INSIDE sandbox, creates ConPTY via node-pty)
└── cc75.js               — Claude Code 2.1.75 shortcut
scripts/
├── sunboxed.cmd          — thin wrapper: calls node bin/sunboxed.js
├── cc75.cmd              — thin wrapper: calls node bin/cc75.js
├── sunboxed-install-user.cmd      — add scripts/ to user PATH
└── sunboxed-install-system.cmd    — add scripts/ to system PATH (admin)
tests/
├── run-all.js            — test runner (npm test)
├── helpers.js            — shared test utilities
├── test-fs-isolation.js  — CWD, parent, readonly, allow, deny
├── test-network.js       — /net-block
├── test-overlay.js       — persistence, /reset
├── test-box-per-dir.js   — per-dir boxes, cross-dir isolation, hardening
├── test-snapshots.js     — create, list, restore, delete, duplicates, exclusions
└── test-relay.js         — TCP relay: auth, output, setRawMode, exit codes
docs/
├── research.md           — findings from building the relay solution
└── sandboxie_docs/       — Sandboxie CLI reference (Start.exe, SbieIni.exe, etc.)
```

## Running Tests

```bash
npm test    # 6 suites: fs-isolation, network, overlay, box-per-dir, snapshots, relay
```

Single suite: `node tests/test-relay.js`

## Architecture

### Relay (interactive TUI mode)

When stdin is a TTY and node-pty is available, sunboxed uses a TCP relay:

```
User's terminal
    ↓ raw stdin/stdout
sunboxed.js (runRelay) — TCP client, outside sandbox
    ↓ JSON-lines over TCP localhost (auth token per session)
sunboxed-host.js — PTY host, INSIDE sandbox
    ↓ node-pty ConPTY
cmd.exe /c <command> — target command (setRawMode works!)
```

This solves the core problem: Sandboxie's kernel driver blocks SetConsoleMode for sandboxed processes, but ConPTY created inside the sandbox is not affected.

### Hidden mode (non-interactive)

When stdin is not a TTY (piped, CI), sunboxed uses `Start.exe /hide_window /wait` via a temp .cmd file.

### How sunboxed.js Works

1. Derives box name from SHA-256 hash of full CWD path (collision-free)
2. Computes overlay path: `..\.sbox\<dirname>`
3. Kills SandMan GUI (prevents nag popups)
4. Hardens box: `ConfigLevel=99`, `Template=BlockPorts`, `BlockNetworkFiles=y`, `OpenIpcPath=*`, `OpenPipePath=*`
5. Clears dynamic settings (OpenFilePath, ClosedFilePath, BlockNetworkConnect)
6. Applies flags (/allow, /deny, /readonly, /net-block)
7. `Start.exe /reload` then launches command via relay or hidden mode
8. `Start.exe /terminate` after completion

## Key Sandboxie Gotchas

- **delete requires explicit value**: `SbieIni.exe delete BOX Setting` without a value silently fails. Must query values first, then delete each by value.
- **set replaces multi-value**: `SbieIni.exe set BOX Template X` replaces ALL Template entries with one. Use `append` for additional values.
- **ConfigLevel=99**: prevents auto-template addition on `/reload`. Setting it to 0 causes Sandboxie to RE-ADD all templates.
- **MSYS2 path munging**: `/reload` becomes `C:/Program Files/Git/reload` when called from Git Bash. Always route through `.cmd` files.
- **Start.exe from Node.js**: doesn't reliably sandbox when called via `spawnSync`. Must use temp `.cmd` files executed by `cmd.exe`.
- **setRawMode EPERM**: Sandboxie blocks SetConsoleMode for sandboxed processes. Solved by ConPTY relay (sunboxed-host.js).
- **GlobalSettings templates**: inherited by all boxes, but only affect RPC/COM (not filesystem paths). Safe to ignore.
