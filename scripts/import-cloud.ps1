param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $env:LOCALAPPDATA 'LeadSniper/n8n-api-key.dpapi'
if (-not (Test-Path -LiteralPath $keyFile)) { throw 'Run the Connect n8n helper first.' }
$secureKey = Get-Content -LiteralPath $keyFile -Raw | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $env:LEAD_SNIPER_N8N_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $entry = Join-Path $PSScriptRoot 'import-cloud.cjs'
    if ($Apply) { & node $entry --apply } else { & node $entry }
    if ($LASTEXITCODE -ne 0) { throw 'The importer stopped; see the non-secret status above.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Item Env:LEAD_SNIPER_N8N_API_KEY -ErrorAction SilentlyContinue
}
