@echo off
chcp 65001 >nul
title 疊疊高樓
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js 26.12.1，請先安裝：https://nodejs.org/
  pause
  exit /b 1
)

node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) process.exit(1)"
if errorlevel 1 (
  echo 需要 Node.js 26.12.1 或更新的 26.x 修補版本。
  for /f %%V in ('node --version') do echo 目前版本：%%V
  echo 請安裝 Node.js 26.12.1：https://nodejs.org/
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo 第一次執行，安裝套件中...
  call npm install
)
start "" http://localhost:3090
call npm start
pause
