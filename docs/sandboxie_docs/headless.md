# Headless Mode — Running Without GUI

Sandboxie-Plus does not have a dedicated headless mode, but its CLI tools work independently of the GUI (SandMan.exe). All work is performed by the `SbieSvc.exe` service.

---

## Architecture

```
SbieSvc.exe (Windows service)     ← core engine, does all the work
    |
SbieDrv.sys (kernel driver)       ← kernel-level isolation
    |
Start.exe / SbieIni.exe (CLI)    ← command-line management
    |
SandMan.exe (GUI, optional)      ← visual interface only
```

CLI tools communicate directly with `SbieSvc.exe`. GUI is not required.

---

## Running Without GUI

### Option 1: Don't launch SandMan at all

`SbieSvc.exe` is installed as a Windows service and starts automatically. CLI tools work without SandMan:

```bash
# Verify service is running
sc query SbieSvc

# All CLI commands work without GUI
Start.exe /box:MyBox program.exe
SbieIni.exe query *
```

### Option 2: SandMan minimized to tray

If SandMan is needed (e.g., for notifications) but is in the way:

```bash
SandMan.exe -autorun
```

This starts it minimized to the system tray.

### Option 3: Remove SandMan from autostart

Remove the registry key to prevent SandMan from starting at login:

```bash
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "SandboxiePlus_AutoRun" /f
```

The `SbieSvc` service continues running. Manage everything via CLI.

---

## Managing the SbieSvc Service

```bash
# Service status
sc query SbieSvc

# Start service (if stopped)
sc start SbieSvc

# Stop service
sc stop SbieSvc

# Set to auto-start
sc config SbieSvc start=auto
```

---

## Automation Without GUI

### Scheduled task

Via Windows Task Scheduler or cron:

```bash
"C:\Program Files\Sandboxie-Plus\Start.exe" /box:AutoBox /silent /wait "C:\scripts\my_task.exe"
"C:\Program Files\Sandboxie-Plus\Start.exe" /box:AutoBox delete_sandbox_silent
```

### Batch processing script

```bash
#!/bin/bash
SBIE="C:/Program Files/Sandboxie-Plus"

# Create temporary box
"$SBIE/SbieIni.exe" set TempBox Enabled y
"$SBIE/Start.exe" /reload

# Run task
"$SBIE/Start.exe" /box:TempBox /silent /wait "$1"

# Cleanup
"$SBIE/Start.exe" /box:TempBox /terminate
"$SBIE/Start.exe" /box:TempBox delete_sandbox_silent
```

---

## Limitations Without GUI

- Some notifications (SBIE Messages) are only shown through GUI
- `/box:__ask__` and `run_dialog` require GUI
- Encrypted box management via CLI is fully supported (v1.11.0+)
- Forced Programs are managed through `Sandboxie.ini`
- SandMan shows license reminder popups — kill it with `taskkill /f /im SandMan.exe` or remove from autostart
