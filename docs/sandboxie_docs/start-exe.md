# Start.exe — Process and Sandbox Management

Path: `"C:\Program Files\Sandboxie-Plus\Start.exe"`

Start.exe is the main CLI tool for working with sandboxes. Communicates directly with the SbieSvc service.

## Syntax

```
Start.exe [/box:SandboxName] [flags...] <program|command>
```

If `/box:` is omitted, `DefaultBox` is used.

---

## Running Programs

```bash
# Run a program in a sandbox
Start.exe /box:MyBox "C:\path\to\program.exe"

# Default browser
Start.exe /box:MyBox default_browser

# Default email client
Start.exe /box:MyBox mail_agent

# Program selection dialog
Start.exe /box:MyBox run_dialog

# Start menu inside sandbox
Start.exe /box:MyBox start_menu

# Sandbox selection dialog
Start.exe /box:__ask__ program.exe
```

---

## Launch Flags

| Flag | Description |
|------|-------------|
| `/box:BoxName` | Target sandbox (default: `DefaultBox`) |
| `/box:__ask__` | Show sandbox selection dialog |
| `/silent` | Suppress error popup windows |
| `/wait` | Wait for program to finish, return its exit code |
| `/hide_window` | Hide the launched program's window |
| `/elevate` | Run with administrator privileges (UAC) |
| `/fake_admin` | Mark process as pseudo-administrator |
| `/force_children` or `/fcp` | Force child processes into the sandbox |
| `/keep_alive` | Monitor and restart program on crash (inside box only) |
| `/uac_prompt` | Trigger secure UAC prompt |

---

## Environment Variables

```bash
# Set a variable (no spaces)
Start.exe /box:MyBox /env:MY_VAR=value program.exe

# Value with spaces
Start.exe /box:MyBox /env:MY_VAR="value with spaces" program.exe

# Refresh environment (inside box only)
Start.exe /env:=Refresh
```

---

## Process Management

```bash
# Terminate all processes in a sandbox
Start.exe /box:MyBox /terminate

# Terminate all processes in ALL sandboxes
Start.exe /terminate_all

# List PIDs of processes in a sandbox
Start.exe /box:MyBox /listpids
```

---

## Sandbox Management

```bash
# Delete sandbox contents (with confirmation)
Start.exe /box:MyBox delete_sandbox

# Delete sandbox contents silently
Start.exe /box:MyBox delete_sandbox_silent

# Phased deletion
Start.exe /box:MyBox delete_sandbox_phase1
Start.exe /box:MyBox delete_sandbox_phase2

# Reload Sandboxie.ini (after changes via SbieIni.exe)
Start.exe /reload
```

---

## Encrypted Boxes (v1.11.0+)

```bash
# Mount encrypted box
Start.exe /box:EncBox /key:MyPassword /mount

# Mount with root protection
Start.exe /box:EncBox /key:MyPassword /mount_protected

# Unmount
Start.exe /box:EncBox /unmount

# Unmount all encrypted boxes
Start.exe /unmount_all
```

---

## Forced Programs Mode

```bash
# Run a program OUTSIDE the sandbox (bypass forced programs)
Start.exe /dfp "C:\path\to\program.exe"
Start.exe /disable_force "C:\path\to\program.exe"

# Temporarily disable forced programs globally
Start.exe disable_force
```

---

## Other Commands

```bash
# Mount a registry hive copy
Start.exe mount_hive

# Request service to start GUI agent
Start.exe run_sbie_ctrl

# Pass arguments to agent/service
Start.exe open_agent
Start.exe open_agent:param
```

---

## Exit Codes

- `0` — success
- Non-zero — error (specific codes depend on operation)
- With `/wait` — returns the launched program's exit code
