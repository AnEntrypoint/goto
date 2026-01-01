@echo off
powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force" 2>nul
timeout /t 1 /nobreak >nul
cd server
npm start
