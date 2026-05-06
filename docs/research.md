# SunBoxed — Research Notes

Findings from building a Sandboxie-based CLI isolation proxy for AI coding agents.

## Core Discovery: Sandboxie + Interactive TUI

**Problem:** Sandboxie's kernel driver (`SbieDrv.sys`) blocks `SetConsoleMode` for all sandboxed processes. This means `setRawMode` fails with `EPERM`, making interactive TUI apps (Claude Code, vim, htop) crash inside a sandbox.

**Solution:** Launch a terminal emulator (WezTerm) **inside** the sandbox. WezTerm creates its own ConPTY, which the sandboxed child process uses instead of the system console. `setRawMode` works on WezTerm's ConPTY because it's within the sandboxed process space.

```
Real Terminal (user's)
    ↓ launches
Start.exe /box:BOX wezterm-gui.exe start --cwd CWD -- cmd /k "command"
    ↓ sandboxed
WezTerm (inside sandbox, creates ConPTY)
    ↓ ConPTY
claude-code (TUI works, setRawMode OK)
```

**What doesn't work:**
- `Start.exe /box:BOX node claude-code` → EPERM (no ConPTY)
- `Start.exe /box:BOX cmd.exe` → cmd opens, but TUI apps inside it get EPERM
- `OpenIpcPath=*`, `OpenPipePath=*`, `OpenFilePath=\Device\ConDrv\*` → none of these fix setRawMode
- `node-pty` (ConPTY) + `ForceProcess` → still EPERM (driver hooks deeper than ConPTY)

**What works:**
- `Start.exe /box:BOX wezterm-gui.exe start --cwd CWD -- cmd /k "npx claude-code"` → full TUI
- Non-interactive scripts: `Start.exe /box:BOX /hide_window /wait node script.js` → works fine

## Start.exe Quirks

### /silent breaks sandboxing

When `Start.exe` is called with `/silent` from certain process contexts (especially via Node.js `spawnSync` or `execSync`), it silently fails to create a sandboxed process. The command returns exit code 0 but the child process runs **unsandboxed**.

**Workaround:** Don't use `/silent` on the run command. Use it only for `/reload` and `/terminate` management calls. For the WezTerm `/tty` mode, `/silent` must be completely absent.

### /silent blocks GUI app launch

For GUI applications (WezTerm, notepad), `/silent` prevents the window from appearing. The process may or may not start, but the user sees nothing.

### Programs must be specified by full path

`Start.exe /box:BOX node script.js` — may run `node` **outside** the sandbox.
`Start.exe /box:BOX "C:\Program Files\nodejs\node.exe" script.js` — correctly sandboxed.

Start.exe doesn't reliably resolve programs via PATH. Always use full executable paths.

### spawnSync vs cmd.exe

Calling `Start.exe` via Node.js `spawnSync()` behaves differently from calling it via `cmd.exe`:

| Method | Sandboxing | Notes |
|--------|-----------|-------|
| BAT file → Start.exe | Works | Original approach, reliable |
| `execSync(cmd, {shell:"cmd.exe"})` | Unreliable | Sometimes sandboxes, sometimes not |
| `spawnSync(Start.exe, args)` | Unreliable | Full path to exe required, /silent breaks it |
| temp .cmd file → cmd.exe /c | Unreliable | Same as execSync |

**Recommendation:** Keep `Start.exe` calls inside `.cmd` files executed by `cmd.exe`. Don't call Start.exe directly from Node.js for sandbox runs.

## SbieIni.exe Quirks

### delete requires explicit value

```
SbieIni.exe delete BOX OpenFilePath              ← FAILS silently
SbieIni.exe delete BOX OpenFilePath "C:\path"    ← works
```

Must query values first, then delete each by value.

### set replaces all values for multi-value settings

```
SbieIni.exe set BOX Template BlockPorts    ← replaces ALL Template entries with one
SbieIni.exe append BOX Template NewOne     ← adds one more
```

### ConfigLevel gotcha

- `ConfigLevel=0` → Sandboxie RE-ADDS all compatibility templates on `/reload` (makes things worse)
- `ConfigLevel=99` → prevents auto-template addition (what we want)

## GlobalSettings templates

Templates in `[GlobalSettings]` are inherited by ALL boxes and cannot be removed per-box. Current global templates:

```
7zipShellEx, WindowsRasMan, WindowsLive, Edge_Fix, OfficeLicensing, Joplin
```

These operate on RPC/COM ports and shell extensions. They do NOT add filesystem `OpenFilePath` entries. Filesystem isolation is not affected.

## MSYS2 / Git Bash path munging

When calling Sandboxie CLI from Git Bash / MSYS2, arguments starting with `/` get converted to Windows paths:

```
/reload     → C:/Program Files/Git/reload
/silent     → C:/Program Files/Git/silent
/box:MyBox  → C:/Program Files/Git/box:MyBox
```

**Workaround:** Always call Sandboxie CLI from `.cmd` files or route through `cmd.exe`. Never call `Start.exe` or `SbieIni.exe` directly from bash.

## GUI apps in Sandboxie

| App | Works | Notes |
|-----|-------|-------|
| cmd.exe | Yes | Title shows [#] prefix |
| notepad.exe | Yes | Basic GUI works |
| WezTerm (wezterm-gui.exe) | Yes | Takes 5-10s to appear, needs `OpenIpcPath=*` |
| WezTerm (wezterm.exe) | Partial | Launcher creates extra console window |
| calc.exe | No | UWP app, not supported by Sandboxie |
| Windows Terminal (wt.exe) | Untested | Should work similarly to WezTerm |

WezTerm requires `OpenIpcPath=*` and `OpenPipePath=*` in the box config to launch inside sandbox.

## Architecture Decision: Hybrid BAT + JS

Pure JS approach failed because `Start.exe` doesn't reliably sandbox when called from Node.js. Pure BAT approach failed because BAT can't handle complex argument quoting.

**Final architecture:**
- `.cmd` entry points — thin wrappers that call Node.js
- `sunboxed.js` — all logic: arg parsing, config, snapshots, terminal detection
- The actual `Start.exe` sandbox run call stays in `.cmd` context
- `/tty` mode launches WezTerm via Start.exe (no /silent, no /wait)

## OpenFilePath behavior

| Setting | Read | Write | Effect |
|---------|------|-------|--------|
| (default, no rule) | Real FS | → Overlay | Standard sandbox |
| `OpenFilePath=PATH` | Real FS | Real FS | Full access, bypasses sandbox |
| `ClosedFilePath=PATH` | Blocked | Blocked | No access at all |
| `ReadFilePath=PATH` | Real FS | Blocked | Read-only |

Parent directory traversal (`..`) from an OpenFilePath is correctly sandboxed — writing to `CWD\..\file` goes to overlay when only CWD is in OpenFilePath.

## Snapshot design

Snapshots use `robocopy /MIR` to copy CWD to `..\.sbox\<dirname>\__snapshots__\<name>\data\`.

Excluded: `.git`, `node_modules`, `.sbox`, `__pycache__`, `.env.local`.

**Important:** `.git` is excluded. Unpushed local commits survive `snap restore` (they're in `.git` which is untouched), but the working tree is rolled back. Use `git reflog` if needed.

Snapshots capture CWD only, not the sandbox overlay. For full rollback: `snap restore` + `/reset`.

## Token savings model

AI coding agents spend tokens on:
1. Permission request round-trips (file write confirmations)
2. MCP/tool overhead in context window (safety wrappers)
3. Waiting for user approval

With SunBoxed + `--dangerously-skip-permissions`:
- No permission prompts → fewer tokens
- No safety tools in context → smaller context window
- Immediate action → faster iterations
- Sandbox catches mistakes → safe to experiment
