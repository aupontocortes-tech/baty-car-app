param(
  [string]$BaseUrl = 'http://localhost:5001/api',
  [string]$ImageUrl = 'http://plates.openalpr.com/h786poj.jpg',
  [string]$Region = 'eu'
)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $env:TEMP 'plate_test.jpg'
Write-Host "Baixando imagem: $ImageUrl" -ForegroundColor Cyan
Invoke-WebRequest -Uri $ImageUrl -OutFile $tmp -UseBasicParsing -TimeoutSec 30
Write-Host "Enviando bytes para $BaseUrl/recognize-bytes?region=$Region" -ForegroundColor Cyan
$res = Invoke-RestMethod -Uri "$BaseUrl/recognize-bytes?region=$Region" -Method Post -ContentType 'application/octet-stream' -InFile $tmp -TimeoutSec 60
$res | ConvertTo-Json -Depth 6