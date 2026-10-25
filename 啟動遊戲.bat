@echo off
chcp 65001 >nul
title 疊疊高樓
cd /d "%~dp0"
if not exist node_modules (
  echo 第一次執行，安裝套件中...
  call npm install
)
start "" http://localhost:3090
call npm start
pause
