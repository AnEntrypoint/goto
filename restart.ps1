Get-Process -Id 26052 -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
Set-Location "C:\Users\user\Downloads\goto\server"
npm start
