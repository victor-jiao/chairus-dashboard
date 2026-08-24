@echo off
title TikTok Dashboard - GitHub Sync
cd /d "%~dp0"

set "PATH=C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\mingw64\bin;C:\Program Files\Git\cmd;%PATH%"
set "GIT_EXEC_PATH=C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\mingw64\bin"

echo [1/3] Adding files...
git -c safe.directory=* add .

echo [2/3] Committing changes...
git -c safe.directory=* commit -m "update dashboard data"

echo [3/3] Pushing to GitHub...
git -c safe.directory=* push -u origin main

echo.
if %ERRORLEVEL% equ 0 (
    echo ====================================================
    echo  SUCCESS: Uploaded to GitHub successfully!
    echo ====================================================
) else (
    echo ====================================================
    echo  FAILED: Please check the error message above.
    echo ====================================================
)
echo.
pause