# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SunBoxed — a CMD wrapper that runs CLI commands inside Sandboxie-Plus containers with strict filesystem isolation. Primary use case: running AI coding agents safely with `--dangerously-skip-permissions`.

## Structure

```
scripts/
├── sunboxed.cmd          — main tool (flags, per-dir boxes, hardening)
├── cc75.cmd              — Claude Code 2.1.75 shortcut
├── sunboxed-install-user.cmd      — add scripts/ to user PATH
└── sunboxed-install-system.cmd    — add scripts/ to system PATH (admin)
tests/
├── run-all.js            — test runner (npm test)
├── helpers.js            — shared test utilities
├── test-fs-isolation.js  — CWD, parent, readonly, allow, deny
├── test-network.js       — /net-block
├── test-overlay.js       — persistence, /reset
├── test-box-per-dir.js   — per-dir boxes, cross-dir isolation, hardening
└── test-snapshots.js     — create, list, restore, delete, duplicates, exclusions
docs/
└── sandboxie_docs/       — Sandboxie CLI reference (Start.exe, SbieIni.exe, etc.)
```

## Running Tests

```bash
npm test    # 40 assertions across 5 suites
```

## How sunboxed.cmd Works

1. Derives box name from SHA-256 hash of full CWD path via PowerShell (collision-free; fallback to dirname if PS unavailable)
2. Computes overlay path: `..\.sbox\<dirname>`
3. Hardens box: `ConfigLevel=99`, `Template=BlockPorts`, `BlockNetworkFiles=y`
4. Clears dynamic settings (OpenFilePath, ClosedFilePath, BlockNetworkConnect)
5. Applies flags (/allow, /deny, /readonly, /net-block)
6. `Start.exe /reload` then runs command via `Start.exe /box:<name> /silent /hide_window /wait`
7. `Start.exe /terminate` after completion

## Key Sandboxie Gotchas

- **delete requires explicit value**: `SbieIni.exe delete BOX Setting` without a value silently fails. Must query values first, then delete each by value.
- **set replaces multi-value**: `SbieIni.exe set BOX Template X` replaces ALL Template entries with one. Use `append` for additional values.
- **ConfigLevel=99**: prevents auto-template addition on `/reload`. Setting it to 0 causes Sandboxie to RE-ADD all templates.
- **MSYS2 path munging**: `/reload` becomes `C:/Program Files/Git/reload` when called from Git Bash. Always use inside `.cmd` files or route through `cmd //c`.
- **/silent on all Start.exe calls**: suppresses GUI error MessageBox dialogs that `>nul` cannot catch.
- **GlobalSettings templates**: inherited by all boxes, but only affect RPC/COM (not filesystem paths). Safe to ignore for CLI use.
