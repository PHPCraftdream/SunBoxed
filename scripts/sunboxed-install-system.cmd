@echo off
:: install-system.cmd — add scripts/ to system PATH (requires admin)

net session >nul 2>nul
if errorlevel 1 (
    echo ERROR: Run as Administrator.
    exit /b 1
)

set "SCRIPTS_DIR=%~dp0"
:: Remove trailing backslash
set "SCRIPTS_DIR=%SCRIPTS_DIR:~0,-1%"

echo %PATH% | findstr /i /c:"%SCRIPTS_DIR%" >nul 2>nul
if not errorlevel 1 (
    echo Already in system PATH: %SCRIPTS_DIR%
    exit /b 0
)

for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
setx /M PATH "%SYS_PATH%;%SCRIPTS_DIR%" >nul
echo Added to system PATH: %SCRIPTS_DIR%
echo Restart your terminal to apply.
