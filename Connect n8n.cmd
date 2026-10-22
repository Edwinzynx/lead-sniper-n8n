@echo off
title Connect n8n to Lead Sniper setup
echo This saves your n8n API key encrypted for your Windows user.
echo The key is not sent anywhere by this helper.
echo.
powershell.exe -NoProfile -Command "$ErrorActionPreference = 'Stop'; $directory = Join-Path $env:LOCALAPPDATA 'LeadSniper'; [IO.Directory]::CreateDirectory($directory) | Out-Null; $secret = Read-Host 'Paste the n8n API key (input is hidden)' -AsSecureString; if ($secret.Length -eq 0) { throw 'No key entered' }; $encrypted = ConvertFrom-SecureString -SecureString $secret; [IO.File]::WriteAllText((Join-Path $directory 'n8n-api-key.dpapi'), $encrypted); Write-Host ''; Write-Host 'Connection key saved securely. Return to the chat and say: ready.'"
echo.
pause
