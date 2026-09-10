@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Signaling Pathway Simulator - BUILD
echo   typecheck -^> bundle -^> smoke test
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

rem ---- 3. The real work: npm run check ----
echo.
echo [*] Running: npm run check
echo.
call npm run check
if errorlevel 1 (
    echo.
    echo [FAILED] Something went wrong - read the errors above.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   BUILD OK
echo   Game file is in: dist\
echo   Open the .html in a browser to play.
echo ==========================================
echo.
pause
