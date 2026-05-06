@echo off
setlocal enabledelayedexpansion

:: ================================================================
:: sunboxed.cmd — run commands inside a Sandboxie container
::
:: Usage:
::   sunboxed [flags] <command> [args...]
::   sunboxed [flags] -- <command> [args...]
::   sunboxed /reset
::
:: Flags:
::   /net-block       Block all network access
::   /readonly        CWD is read-only (writes go to overlay too)
::   /allow:<path>    Only allow writes to these paths (relative to CWD)
::   /deny:<path>     Block all access to these paths (relative to CWD)
::
:: Writes to CWD pass through directly (OpenFilePath) by default.
:: All other writes go to ..\.sbox\<dirname> (overlay)
:: and persist between runs (cascading reads).
:: ================================================================

:: ---- Detect Sandboxie-Plus ----
set "SBIE="
if exist "C:\Program Files\Sandboxie-Plus\Start.exe" set "SBIE=C:\Program Files\Sandboxie-Plus"
if not defined SBIE if exist "C:\Program Files (x86)\Sandboxie-Plus\Start.exe" set "SBIE=C:\Program Files (x86)\Sandboxie-Plus"
if not defined SBIE (
    echo ERROR: Sandboxie-Plus not found.
    echo Install from https://sandboxie-plus.com/
    exit /b 1
)

:: ---- Kill GUI (shows nag popups) ----
taskkill /f /im SandMan.exe >nul 2>nul

:: ---- Derive box name from full CWD path hash (collision-free) ----
for %%I in ("%CD%") do set "DIRNAME=%%~nxI"
set "HASH="
for /f %%h in ('powershell -nop -c "[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes('%CD%'))).Replace('-','').Substring(0,16)" 2^>nul') do set "HASH=%%h"
if defined HASH (
    set "BOX=_SB_!HASH!"
) else (
    :: Fallback if PowerShell unavailable: use dirname (less unique)
    set "BOX=_SB_!DIRNAME!"
    set "BOX=!BOX:~0,32!"
)

if "%~1"=="" goto :usage
if /i "%~1"=="/reset" goto :reset
if /i "%~1"=="/snap" goto :snap

:: ---- Parse flags ----
set "NET_BLOCK=0"
set "READONLY=0"
set "ALLOW_COUNT=0"
set "DENY_COUNT=0"

:parse
if "%~1"=="" goto :usage
if "%~1"=="--" (shift & goto :build_cmd)
if /i "%~1"=="/net-block" (set "NET_BLOCK=1" & shift & goto :parse)
if /i "%~1"=="/readonly" (set "READONLY=1" & shift & goto :parse)
set "ARG=%~1"
if /i "!ARG:~0,7!"=="/allow:" (
    set /a ALLOW_COUNT+=1
    set "ALLOW_!ALLOW_COUNT!=!ARG:~7!"
    shift & goto :parse
)
if /i "!ARG:~0,6!"=="/deny:" (
    set /a DENY_COUNT+=1
    set "DENY_!DENY_COUNT!=!ARG:~6!"
    shift & goto :parse
)

:: ---- Build command from remaining args ----
:build_cmd
set "CMD="
:build_loop
if "%~1"=="" goto :exec
if defined CMD (set "CMD=!CMD! %1") else (set "CMD=%1")
shift
goto :build_loop

:exec
if not defined CMD goto :usage

:: ---- Compute overlay path ----
for %%I in ("%CD%\..") do set "PARENT=%%~fI"
set "OVERLAY=%PARENT%\.sbox\%DIRNAME%"

:: ---- Harden sandbox ----
:: Base settings
"%SBIE%\SbieIni.exe" set %BOX% Enabled y >nul 2>nul
"%SBIE%\SbieIni.exe" set %BOX% FileRootPath "%OVERLAY%" >nul 2>nul
"%SBIE%\SbieIni.exe" set %BOX% ConfigLevel 99 >nul 2>nul
"%SBIE%\SbieIni.exe" set %BOX% BlockNetworkFiles y >nul 2>nul
:: Replace all box-level templates with only BlockPorts (blocks SMB 137-445)
:: Note: GlobalSettings templates (Edge_Fix etc) are inherited and don't affect FS isolation
"%SBIE%\SbieIni.exe" set %BOX% Template BlockPorts >nul 2>nul
:: Clear per-run dynamic settings (delete requires explicit value)
for /f "tokens=*" %%v in ('"%SBIE%\SbieIni.exe" query %BOX% OpenFilePath 2^>nul') do (
    "%SBIE%\SbieIni.exe" delete %BOX% OpenFilePath "%%v" >nul 2>nul
)
for /f "tokens=*" %%v in ('"%SBIE%\SbieIni.exe" query %BOX% ClosedFilePath 2^>nul') do (
    "%SBIE%\SbieIni.exe" delete %BOX% ClosedFilePath "%%v" >nul 2>nul
)
for /f "tokens=*" %%v in ('"%SBIE%\SbieIni.exe" query %BOX% BlockNetworkConnect 2^>nul') do (
    "%SBIE%\SbieIni.exe" delete %BOX% BlockNetworkConnect "%%v" >nul 2>nul
)

:: ---- OpenFilePath ----
if "%READONLY%"=="0" (
    if !ALLOW_COUNT!==0 (
        "%SBIE%\SbieIni.exe" set %BOX% OpenFilePath "%CD%" >nul 2>nul
    ) else (
        for /L %%i in (1,1,!ALLOW_COUNT!) do (
            "%SBIE%\SbieIni.exe" append %BOX% OpenFilePath "%CD%\!ALLOW_%%i!" >nul 2>nul
        )
    )
)

:: ---- ClosedFilePath (deny) ----
if !DENY_COUNT! gtr 0 (
    for /L %%i in (1,1,!DENY_COUNT!) do (
        "%SBIE%\SbieIni.exe" append %BOX% ClosedFilePath "%CD%\!DENY_%%i!" >nul 2>nul
    )
)

:: ---- Network block ----
if "%NET_BLOCK%"=="1" (
    "%SBIE%\SbieIni.exe" set %BOX% BlockNetworkConnect y >nul 2>nul
)

"%SBIE%\Start.exe" /silent /reload >nul 2>nul

:: ---- Run command in sandbox ----
"%SBIE%\Start.exe" /box:%BOX% /silent /hide_window /wait !CMD!
set "EXITCODE=!ERRORLEVEL!"

:: ---- Terminate remaining processes ----
"%SBIE%\Start.exe" /box:%BOX% /silent /terminate >nul 2>nul

exit /b !EXITCODE!

:: ================================================================
:reset
for %%I in ("%CD%\..") do set "PARENT=%%~fI"
set "OVERLAY=%PARENT%\.sbox\%DIRNAME%"

"%SBIE%\SbieIni.exe" set %BOX% Enabled y >nul 2>nul
"%SBIE%\SbieIni.exe" delete %BOX% FileRootPath >nul 2>nul
"%SBIE%\SbieIni.exe" set %BOX% FileRootPath "%OVERLAY%" >nul 2>nul
"%SBIE%\Start.exe" /silent /reload >nul 2>nul
"%SBIE%\Start.exe" /box:%BOX% /silent /terminate >nul 2>nul
"%SBIE%\Start.exe" /box:%BOX% /silent delete_sandbox_silent >nul 2>nul
echo Overlay cleared: %OVERLAY%
exit /b 0

:: ================================================================
:snap
for %%I in ("%CD%\..") do set "PARENT=%%~fI"
set "SNAPDIR=%PARENT%\.sbox\%DIRNAME%\__snapshots__"

if /i "%~2"=="create" goto :snap_create
if /i "%~2"=="list" goto :snap_list
if /i "%~2"=="restore" goto :snap_restore
if /i "%~2"=="delete" goto :snap_delete
echo Usage: sunboxed /snap ^<create^|list^|restore^|delete^> [name]
exit /b 1

:snap_create
if "%~3"=="" (echo ERROR: Specify snapshot name. & exit /b 1)
set "SNAPNAME=%~3"
set "SNAPPATH=%SNAPDIR%\%SNAPNAME%"
if exist "%SNAPPATH%" (echo ERROR: Snapshot "%SNAPNAME%" already exists. & exit /b 1)
mkdir "%SNAPPATH%" >nul 2>nul
robocopy "%CD%" "%SNAPPATH%\data" /MIR /XD .git node_modules .sbox __pycache__ /XF .env.local /NFL /NDL /NJH /NJS /NC /NS /NP >nul 2>nul
:: Save timestamp
echo %DATE% %TIME% > "%SNAPPATH%\created.txt"
echo Snapshot created: %SNAPNAME%
exit /b 0

:snap_list
if not exist "%SNAPDIR%" (echo No snapshots. & exit /b 0)
set "FOUND=0"
for /d %%d in ("%SNAPDIR%\*") do (
    set "FOUND=1"
    set "SNAME=%%~nxd"
    set "SDATE="
    if exist "%%d\created.txt" (
        set /p SDATE=<"%%d\created.txt"
    )
    echo   !SNAME!    !SDATE!
)
if "!FOUND!"=="0" echo No snapshots.
exit /b 0

:snap_restore
if "%~3"=="" (echo ERROR: Specify snapshot name. & exit /b 1)
set "SNAPNAME=%~3"
set "SNAPPATH=%SNAPDIR%\%SNAPNAME%"
if not exist "%SNAPPATH%\data" (echo ERROR: Snapshot "%SNAPNAME%" not found. & exit /b 1)
robocopy "%SNAPPATH%\data" "%CD%" /MIR /XD .git node_modules .sbox __pycache__ /XF .env.local /NFL /NDL /NJH /NJS /NC /NS /NP >nul 2>nul
echo Restored: %SNAPNAME%
exit /b 0

:snap_delete
if "%~3"=="" (echo ERROR: Specify snapshot name. & exit /b 1)
set "SNAPNAME=%~3"
set "SNAPPATH=%SNAPDIR%\%SNAPNAME%"
if not exist "%SNAPPATH%" (echo ERROR: Snapshot "%SNAPNAME%" not found. & exit /b 1)
rmdir /s /q "%SNAPPATH%"
echo Deleted: %SNAPNAME%
exit /b 0

:: ================================================================
:usage
echo SunBoxed — run commands inside a Sandboxie container
echo.
echo Usage:
echo   sunboxed [flags] ^<command^> [args...]
echo   sunboxed [flags] -- ^<command^> [args...]
echo   sunboxed /reset
echo   sunboxed /snap create ^<name^>
echo   sunboxed /snap list
echo   sunboxed /snap restore ^<name^>
echo   sunboxed /snap delete ^<name^>
echo.
echo Flags:
echo   /net-block       Block all network access
echo   /readonly        CWD is read-only (writes go to overlay)
echo   /allow:^<path^>    Only allow writes to specific paths (relative to CWD)
echo   /deny:^<path^>     Block all access to specific paths (relative to CWD)
echo.
echo Current directory (%CD%) is writable by default.
echo All other writes are stored in ..\.sbox\^<dirname^> (overlay).
echo.
echo Examples:
echo   sunboxed cmd /c build.bat
echo   sunboxed /net-block node script.js
echo   sunboxed /allow:src /allow:dist -- node build.js
echo   sunboxed /deny:.env /deny:.git cmd /c app.exe
echo   sunboxed /snap create before-refactor
echo   sunboxed /snap restore before-refactor
exit /b 1
