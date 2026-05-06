@echo off
:: install-user.cmd — add scripts/ to current user's PATH

set "SCRIPTS_DIR=%~dp0"
set "SCRIPTS_DIR=%SCRIPTS_DIR:~0,-1%"

echo %PATH% | findstr /i /c:"%SCRIPTS_DIR%" >nul 2>nul
if not errorlevel 1 (
    echo Already in user PATH: %SCRIPTS_DIR%
    exit /b 0
)

for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%b"
if not defined USR_PATH (
    setx PATH "%SCRIPTS_DIR%" >nul
) else (
    setx PATH "%USR_PATH%;%SCRIPTS_DIR%" >nul
)
echo Added to user PATH: %SCRIPTS_DIR%
echo Restart your terminal to apply.
