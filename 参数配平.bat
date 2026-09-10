@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Signaling Pathway Simulator - BALANCE
echo   compile -^> run 5 scenarios
echo ==========================================
echo.

rem ---- 1. Node.js installed? ----
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this machine.
    echo.
    echo   Please install Node.js 18 or newer from:
    echo       https://nodejs.org
    echo   then double-click this file again.
    echo.
    pause
    exit /b 1
)

rem ---- 2. First run on a new machine? install deps ----
if not exist "node_modules" (
    echo [*] node_modules not found - installing dependencies.
    echo     ^(one-time step, needs internet, may take a minute^)
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check your network / proxy.
        pause
        exit /b 1
    )
)

rem ---- 3. ALWAYS recompile first ----
echo.
echo [*] Recompiling TypeScript -^> build\
echo     ^(balance.mjs reads the compiled output, not the .ts sources,
echo      so skipping this step would show you stale numbers^)
echo.
call npm run build:ts
if errorlevel 1 (
    echo.
    echo [FAILED] TypeScript compile error - read the errors above.
    pause
    exit /b 1
)

rem ---- 4. Run the balance scenarios ----
echo.
echo [*] Running: node tools\balance.mjs
echo.
node tools\balance.mjs
if errorlevel 1 (
    echo.
    echo [FAILED] balance.mjs crashed.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   DONE - scroll up to read the tables
echo ==========================================
echo.
pause
