param(
  [string]$ApiBase = "https://openalpr-fastapi-1.onrender.com",
  [string]$ImagePath = ""
)

Write-Host "Testando API..."
try {
  $response = Invoke-WebRequest -Uri "$ApiBase/" -UseBasicParsing -TimeoutSec 15
  Write-Host "Resposta /:"
  Write-Host $response.Content
} catch {
  Write-Host "Erro ao acessar /:"
  Write-Host $_.Exception.Message
}

try {
  $response = Invoke-WebRequest -Uri "$ApiBase/health" -UseBasicParsing -TimeoutSec 15
  Write-Host "Resposta /health:"
  Write-Host $response.Content
} catch {
  Write-Host "Erro ao acessar /health:"
  Write-Host $_.Exception.Message
}

if ($ImagePath -and (Test-Path $ImagePath)) {
  Write-Host "Testando read-plate com $ImagePath"
  try {
    $resp = Invoke-RestMethod -Uri "$ApiBase/read-plate?region=br" -Method Post -ContentType 'application/octet-stream' -InFile $ImagePath -TimeoutSec 60
    $json = $resp | ConvertTo-Json -Depth 6
    Write-Host "Resposta read-plate:"
    Write-Host $json
  } catch {
    Write-Host "Erro ao acessar read-plate:"
    Write-Host $_.Exception.Message
  }
} else {
  if ($ImagePath) { Write-Host "Arquivo não encontrado: $ImagePath" }
}