@echo off
setlocal enabledelayedexpansion
:: cc75.cmd — Claude Code 2.1.75 in a Sandboxie container
:: Only CWD is writable directly, everything else goes to overlay.
:: Pass sunboxed flags before -- to customize isolation.
::
:: Usage:
::   cc75                           Run with full CWD access
::   cc75 /deny:.env                Block .env file access
::   cc75 /net-block                No network access
::   cc75 /allow:src /allow:tests   Only allow writes to src/ and tests/

:: Separate sbox flags from claude-code args
set "SBOX_FLAGS="
set "CC_ARGS="

:parse
if "%~1"=="" goto :run
set "A=%~1"
if /i "!A:~0,1!"=="/" (
    if defined SBOX_FLAGS (set "SBOX_FLAGS=!SBOX_FLAGS! %1") else (set "SBOX_FLAGS=%1")
    shift & goto :parse
)
if defined CC_ARGS (set "CC_ARGS=!CC_ARGS! %1") else (set "CC_ARGS=%1")
shift & goto :parse

:run
call "%~dp0sunboxed.cmd" %SBOX_FLAGS% -- cmd /c npx --yes @anthropic-ai/claude-code@2.1.75 --dangerously-skip-permissions %CC_ARGS%
