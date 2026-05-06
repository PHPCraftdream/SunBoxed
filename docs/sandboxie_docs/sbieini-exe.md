# SbieIni.exe — Sandboxie Configuration Management

Path: `"C:\Program Files\Sandboxie-Plus\SbieIni.exe"`

SbieIni.exe is the CLI utility for reading and modifying the `Sandboxie.ini` configuration file.

## Syntax

```
SbieIni.exe <command> [flags] <section> [setting] [value]
```

---

## Read Commands

### query — basic query

```bash
# List all sections (boxes, global settings, etc.)
SbieIni.exe query *

# All settings for a specific box
SbieIni.exe query DefaultBox *

# Value of a specific setting
SbieIni.exe query DefaultBox RecoverFolder

# Global settings
SbieIni.exe query GlobalSettings *
```

### queryex — extended query

```bash
# Expand variables (full paths instead of %VAR%)
SbieIni.exe queryex /expand DefaultBox RecoverFolder

# Only active (enabled) boxes
SbieIni.exe queryex /boxes *
```

| Flag | Description |
|------|-------------|
| `/expand` | Expand variables to full paths |
| `/boxes` | Show only enabled boxes |

---

## Write Commands

### set — set/change a value

```bash
# Set a value
SbieIni.exe set DefaultBox AutoRecover n

# Create a new box (minimum required setting)
SbieIni.exe set MyNewBox Enabled y
```

For multi-value settings, `set` **replaces all values** with the given one.

### append — add a value (for multi-value settings)

```bash
# Add a template
SbieIni.exe append DefaultBox Template RoboForm

# Add a recovery folder
SbieIni.exe append DefaultBox RecoverFolder "C:\Users\Me\Documents"
```

### insert — insert a value

```bash
SbieIni.exe insert DefaultBox Template SomeName
```

### delete — remove a value

```bash
# Delete a specific value from a multi-value setting
SbieIni.exe delete DefaultBox RecoverFolder "C:\Old\Path"
```

**Important**: `delete` requires the explicit value to remove. Calling `delete <box> <setting>` without a value does NOT clear the setting — it silently fails.

---

## Write Flags

| Flag | Description |
|------|-------------|
| `/passwd:password` | Specify configuration password (if set). Empty `/passwd:` prompts interactively |
| `/drv` | Route changes through the driver/service API for immediate sync |

---

## Important Notes

- Values with spaces must be wrapped in double quotes: `"value with spaces"`
- In batch files, escape variables: `%%VAR%%` instead of `%VAR%`
- Do not write while the configuration file is locked by another process
- After changes, run `Start.exe /reload` to apply
- `/drv` ensures immediate driver state synchronization

---

## Example: Full Box Creation Cycle

```bash
SBIE="C:/Program Files/Sandboxie-Plus"

# 1. Create box
"$SBIE/SbieIni.exe" set MyBox Enabled y

# 2. Set storage path (optional)
"$SBIE/SbieIni.exe" set MyBox FileRootPath "D:\Sandboxes\MyBox"

# 3. Add recovery folders
"$SBIE/SbieIni.exe" append MyBox RecoverFolder "C:\Users\Me\Downloads"
"$SBIE/SbieIni.exe" append MyBox RecoverFolder "C:\Users\Me\Documents"

# 4. Apply template
"$SBIE/SbieIni.exe" append MyBox Template BlockPorts

# 5. Reload configuration
"$SBIE/Start.exe" /reload

# 6. Verify settings
"$SBIE/SbieIni.exe" query MyBox *
```
