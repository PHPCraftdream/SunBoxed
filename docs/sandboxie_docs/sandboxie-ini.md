# Sandboxie.ini — Configuration File Format

## File Location

Sandboxie looks for `Sandboxie.ini` in the following order:
1. Windows folder: `C:\Windows\Sandboxie.ini`
2. Install folder: `C:\Program Files\Sandboxie-Plus\Sandboxie.ini`

---

## File Structure

The file uses INI format with three types of sections:

### 1. [GlobalSettings] — global settings

Apply to all sandboxes and users.

```ini
[GlobalSettings]
FileRootPath=C:\Sandbox\%USER%\%SANDBOX%
```

### 2. [BoxName] — per-box settings

One section per sandbox. Name: up to 32 characters, letters and digits only.

```ini
[DefaultBox]
Enabled=y
AutoRecover=y
RecoverFolder=C:\Users\Me\Documents
RecoverFolder=C:\Users\Me\Downloads
Template=BlockPorts
```

### 3. [UserSettings_XXXXXXXX] — user settings

Track UI state per user.

```ini
[UserSettings_Default]
; Default settings for all users

[UserSettings_Portable]
; For portable version — applies to everyone
```

---

## Key Box Settings

### Basic

| Setting | Value | Description |
|---------|-------|-------------|
| `Enabled` | `y` / `n` | Whether box is enabled |
| `FileRootPath` | path | Where to store sandbox files |
| `AutoRecover` | `y` / `n` | Auto-recover files |
| `RecoverFolder` | path | Folders for recovery (multiple allowed) |
| `Template` | name | Apply a settings template (multiple allowed) |

### Path Access Control

| Setting | Effect |
|---------|--------|
| `OpenFilePath` | Full read/write access, bypasses sandbox entirely |
| `ClosedFilePath` | No access at all (blocks read and write) |
| `ReadFilePath` | Read-only access (writes blocked) |
| `WriteFilePath` | Copy-on-write (writes go to sandbox) |

### Path Variables

| Variable | Expands to |
|----------|-----------|
| `%USER%` | Current username |
| `%SANDBOX%` | Sandbox name |
| `%SBIEHOME%` | Sandboxie install folder |

---

## Editing Rules

- Manual editing is allowed, but using `SbieIni.exe` is recommended
- After manual edits, run `Start.exe /reload`
- Multi-value settings (RecoverFolder, Template) — each value on a separate line with the same key
- Box names: letters and digits only, max 32 characters

---

## Example File

```ini
[GlobalSettings]
FileRootPath=C:\Sandbox\%USER%\%SANDBOX%

[DefaultBox]
Enabled=y
AutoRecover=y
RecoverFolder=C:\Users\User\Documents
RecoverFolder=C:\Users\User\Downloads
RecoverFolder=C:\Users\User\Desktop

[IsolatedBrowser]
Enabled=y
FileRootPath=D:\Sandboxes\Browser
Template=BlockPorts
AutoRecover=n

[TestBox]
Enabled=y
FileRootPath=D:\Sandboxes\Test
```
