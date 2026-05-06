# SunBoxed — Sandboxie CLI Isolation Proxy

Run any CLI command in a Sandboxie container where the app can **only write to the current directory**. Everything else (system files, AppData, registry, temp) goes to an overlay that persists between runs.

Built for running AI coding agents (Claude Code, Codex, etc.) with `--dangerously-skip-permissions` safely.

### Why this saves tokens

AI coding agents like Claude Code spend tokens on permission requests: every file write, every shell command triggers a confirmation round-trip. With `--dangerously-skip-permissions` the agent works autonomously — but that's risky on a bare system.

SunBoxed makes it safe: the agent runs with full permissions **inside a sandbox**, so:
- **No permission prompts** — the agent doesn't waste tokens asking "can I write this file?"
- **No MCP/tool overhead** — no need to load safety-wrapper tools into the agent's context window
- **Faster iterations** — the agent acts immediately instead of waiting for approval
- **Safe to experiment** — worst case, `sunboxed /snap restore` rolls back CWD to a saved state

### Interactive TUI support

SunBoxed includes a TCP relay that creates a ConPTY inside the sandbox, allowing **full interactive TUI apps** (Claude Code, vim, htop) to work in your current terminal. This solves the fundamental problem where Sandboxie's kernel driver blocks `setRawMode`/`SetConsoleMode` for sandboxed processes.

When you run `sunboxed claude` in a terminal, it automatically:
1. Starts a PTY host inside the sandbox (via node-pty)
2. Connects it to your terminal via a localhost TCP relay
3. Authenticates with a per-session 128-char token
4. Forwards all input/output transparently (including Ctrl keys, resize, alternate screen)

### Security model

SunBoxed uses Sandboxie-Plus for isolation, which is designed to protect against **accidental damage** — a coding agent doing `rm -rf /`, writing to wrong directories, corrupting system files, etc.

**This is NOT a security boundary against targeted attacks.** Sandboxie is not designed to contain malware actively trying to escape the sandbox. Do not use SunBoxed as protection against untrusted/hostile code — use a VM or container for that.

The TCP relay binds to `127.0.0.1` only (not accessible from network) and requires a cryptographically random auth token generated per session.

## Requirements

- Windows 10/11
- [Sandboxie-Plus](https://sandboxie-plus.com/) v1.x installed at `C:\Program Files\Sandboxie-Plus\`
- Node.js 18+
- `node-pty` (installed automatically as a dependency; required for interactive/TUI mode)

## Install

### Via npm (recommended)

```cmd
npm install -g sunboxed
```

This installs `sunboxed` and `cc75` commands globally.

### Via npx (no install)

```cmd
npx sunboxed node build.js
```

### From source

```cmd
git clone https://github.com/PHPCraftdream/SunBoxed.git
cd SunBoxed
npm install

:: Add to current user's PATH
scripts\sunboxed-install-user.cmd

:: Or system-wide (requires admin)
scripts\sunboxed-install-system.cmd
```

## Usage

```cmd
sunboxed <command> [args...]        Run command in sandbox
sunboxed /reset                     Clear overlay for current directory
sunboxed /snap create <name>        Save CWD snapshot
sunboxed /snap list                 List snapshots with dates
sunboxed /snap restore <name>       Restore CWD to snapshot
sunboxed /snap delete <name>        Delete snapshot
```

### Flags

| Flag | Effect |
|------|--------|
| `/net-block` | Block all network access (see [note on localhost](#known-limitations)) |
| `/readonly` | CWD is also sandboxed (read-only analysis) |
| `/no-pty` | Disable ConPTY relay (force hidden window mode) |
| `/show` | Show command window (default: hidden in non-TTY mode) |
| `/tty` | Launch in a separate terminal emulator (WezTerm/WT) |
| `/allow:<path>` | Only allow writes to specific subdirs (relative to CWD) |
| `/deny:<path>` | Block all access to specific files/dirs (relative to CWD) |

### Examples

```cmd
:: Run node script, only CWD writable
sunboxed node build.js

:: Interactive TUI app in sandbox (auto-detects terminal)
sunboxed claude

:: Only allow writes to src/ and dist/
sunboxed /allow:src /allow:dist -- node build.js

:: Block network + protect .env
sunboxed /net-block /deny:.env node app.js

:: Read-only analysis (no writes anywhere on real disk)
sunboxed /readonly node analyze.js

:: Claude Code in sandbox (pinned version)
cc75

:: Snapshot before risky agent run, restore if needed
sunboxed /snap create before-refactor
sunboxed claude
sunboxed /snap restore before-refactor
```

## How It Works

```
D:\projects\
├── myapp\              ← CWD, direct read/write (OpenFilePath)
└── .sbox\
    └── myapp\          ← overlay (sandboxed writes land here)
        ├── drive\      ← virtual filesystem
        ├── user\       ← virtual user profile
        └── RegHive     ← virtual registry
```

Each directory gets its own Sandboxie box (name derived from SHA-256 hash of the full CWD path — collision-free) with hardened config:
- `ConfigLevel=99` — no auto-templates
- `Template=BlockPorts` — blocks SMB (ports 137-445)
- `BlockNetworkFiles=y` — blocks network shares
- `OpenIpcPath=*` / `OpenPipePath=*` — allows IPC (required for relay)
- SandMan GUI killed on each run (nag popup prevention)

### Execution modes

| Condition | Mode | How |
|-----------|------|-----|
| stdin is TTY + node-pty available | **Relay** | TCP localhost, ConPTY inside sandbox |
| stdin is pipe / no node-pty | **Hidden** | `Start.exe /hide_window /wait` |
| `/tty` flag | **Terminal** | Opens WezTerm/WT inside sandbox |
| `/show` flag | **Visible** | `Start.exe /wait` (visible window) |

Overlay persists between runs — the app sees its own previously written files on next launch (cascading reads). Use `sunboxed /reset` to start fresh.

### Snapshots

Snapshots save a copy of **CWD only** (your project files). They do not capture the sandbox overlay (AppData, registry, temp written by the sandboxed app). For a full rollback:

```cmd
sunboxed /snap restore <name>    :: restore project files
sunboxed /reset                  :: clear sandbox overlay
```

Stored at `..\.sbox\<dirname>\__snapshots__\<name>\`. Excludes `.git`, `node_modules`, `__pycache__` automatically.

**Warning:** `.git` is excluded from snapshots. If the sandboxed agent made local commits that haven't been pushed, `snap restore` will not revert them (and won't lose them either). Use `git reflog` or `git reset` separately if needed.

## Known Limitations

- **Not a security boundary.** Sandboxie protects against accidents, not targeted sandbox-escape exploits. See [Security model](#security-model).
- **`/net-block` does not block localhost.** Loopback connections (127.0.0.1, localhost) remain accessible. The relay itself uses localhost TCP. A sandboxed agent can still reach local services like Docker, Ollama, databases, or MCP servers. This is usually desirable for AI agents but worth knowing.
- **GlobalSettings templates are inherited.** Sandboxie's global compatibility templates (Edge_Fix, OfficeLicensing, etc.) are inherited by all boxes. These operate on RPC/COM ports, not filesystem paths, and do not weaken filesystem isolation — but we cannot strip them per-box.
- **SandMan is killed on every run.** If you use SandMan.exe for other sandboxes, SunBoxed will close it.
- **Snapshots exclude `.git`.** Unpushed local commits survive `snap restore` (they're in `.git` which is untouched), but the working tree is rolled back.

## Running Tests

```bash
npm test
```

6 test suites: filesystem isolation, network blocking, overlay persistence, per-directory boxes, snapshots, TCP relay.

## Sandboxie Reference

Low-level Sandboxie CLI documentation: [docs/sandboxie_docs/](docs/sandboxie_docs/)

## License

[GPL-3.0](LICENSE) — same as [Sandboxie-Plus](https://github.com/sandboxie-plus/Sandboxie).
