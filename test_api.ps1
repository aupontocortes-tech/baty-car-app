param(
  [string]$BaseUrl = 'http://localhost:5001/api',
  [string]$ImagePath = '',
  [string]$ImageUrl = '',
  [string]$Region = 'br'
)

function Write-Section($title) { Write-Host "`n=== $title ===" -ForegroundColor Cyan }

function Test-Health($base) {
  Write-Section "Health Check"
  try {
    $h = Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 10
    $ok = $h.ok
    Write-Host ("ok: {0} | uptime: {1}s" -f $ok, [math]::Round([double]$h.uptime,2)) -ForegroundColor Green
    return $true
  } catch {
    Write-Host "Health falhou: $($_.Exception.Message)" -ForegroundColor Red
    return $false
  }
}

function Invoke-RecognizeBytes($base, $path, $region) {
  Write-Section "Reconhecimento via bytes (/api/recognize-bytes)"
  if (-not (Test-Path $path)) { Write-Host "Imagem não encontrada: $path" -ForegroundColor Yellow; return $null }
  try {
    $u = "$base/recognize-bytes?region=$region"
    $resp = Invoke-RestMethod -Uri $u -Method Post -ContentType 'application/octet-stream' -InFile $path -TimeoutSec 60
    Write-Host "Status: sucesso (bytes)" -ForegroundColor Green
    return $resp
  } catch {
    Write-Host "Falha (bytes): $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

function Invoke-RecognizeUrl($base, $url, $region) {
  Write-Section "Reconhecimento por URL (baixa e envia como bytes)"
  if ([string]::IsNullOrWhiteSpace($url)) { Write-Host "URL não fornecida" -ForegroundColor Yellow; return $null }
  $tmp = New-TemporaryFile
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 30
    $resp = Invoke-RecognizeBytes $base $tmp $region
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    return $resp
  } catch {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Write-Host "Falha ao baixar URL: $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

function Print-Result($label, $resp) {
  Write-Section $label
  if ($null -eq $resp) { Write-Host "Sem resposta" -ForegroundColor Yellow; return }
  if ($resp.results -and $resp.results.Count -gt 0) {
    $first = $resp.results[0]
    Write-Host ("Placa: {0} | Confiança: {1}" -f $first.plate, [math]::Round([double]$first.confidence,2)) -ForegroundColor Green
  } elseif ($resp.plates -and $resp.plates.Count -gt 0) {
    $first = $resp.plates[0]
    Write-Host ("Placa: {0} | Confiança: {1}" -f $first.plate, [math]::Round([double]$first.confidence,2)) -ForegroundColor Green
  } else {
    Write-Host "Nenhuma placa detectada" -ForegroundColor Yellow
  }
}

$okHealth = Test-Health $BaseUrl

$respBytes = $null
if (-not [string]::IsNullOrWhiteSpace($ImagePath)) {
  $respBytes = Invoke-RecognizeBytes $BaseUrl $ImagePath $Region
  Print-Result "Resultado (bytes)" $respBytes
}

$respUrl = $null
if (-not [string]::IsNullOrWhiteSpace($ImageUrl)) {
  $respUrl = Invoke-RecognizeUrl $BaseUrl $ImageUrl $Region
  Print-Result "Resultado (URL)" $respUrl
}

Write-Section "Resumo"
if ($okHealth -and (
    ($respBytes -and ($respBytes.results -or $respBytes.plates)) -or 
    ($respUrl -and ($respUrl.results -or $respUrl.plates))
  )) {
  Write-Host "Tudo OK: backend ativo e reconhecimento retornou resultados." -ForegroundColor Green
} elseif ($okHealth) {
  Write-Host "Backend OK, porém sem placas detectadas nas entradas fornecidas." -ForegroundColor Yellow
  Write-Host "Sugestões: use imagem nítida, alta resolução e foco na placa." -ForegroundColor DarkYellow
} else {
  Write-Host "Backend indisponível. Verifique se o servidor está rodando e as variáveis de ambiente." -ForegroundColor Red
}

Write-Host "`nComo usar:" -ForegroundColor Cyan
Write-Host "# Teste local com bytes:" -ForegroundColor Cyan
Write-Host (".\test_api.ps1 -BaseUrl 'http://localhost:5001/api' -ImagePath 'C:\\caminho\\para\\imagem.jpg' -Region 'br'") -ForegroundColor White
Write-Host "# Teste com URL:" -ForegroundColor Cyan
Write-Host (".\test_api.ps1 -BaseUrl 'http://localhost:5001/api' -ImageUrl 'http://plates.openalpr.com/h786poj.jpg' -Region 'eu'") -ForegroundColor White