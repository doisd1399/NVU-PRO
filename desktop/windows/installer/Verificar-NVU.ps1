<#
 Confere o instalador da NVU PRO que está NO SEU COMPUTADOR (o arquivo realmente baixado) contra o release-manifest.json que o acompanha.
 Uso (PowerShell, na pasta dos arquivos):   .\Verificar-NVU.ps1
                                            .\Verificar-NVU.ps1 -Installer "C:\Downloads\NVU-PRO-Setup-0.2.9-x64.exe"
 Resultado: tamanho, SHA-256 e assinatura digital. NÃO desativa nenhuma proteção do Windows.
 Códigos de saída: 0 = confere · 1 = tamanho/SHA-256 diferentes (download incompleto ou alterado) · 2 = arquivo não encontrado · 3 = confere, mas NÃO está assinado/validado · 4 = erro inesperado.
 Ao abrir com o botão direito (Executar com o PowerShell) a janela espera Enter para você ler o resultado; use -NoPause para automação.
#>
param(
  [string]$Installer = '',
  [string]$Manifest = '',
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
function Finish([int]$Code) {
  if (-not $NoPause -and [Environment]::UserInteractive) {
    Write-Host ''
    Read-Host 'Pressione Enter para fechar' | Out-Null
  }
  exit $Code
}
try {
  if (-not $Installer) {
    $found = Get-ChildItem -Path $PSScriptRoot -Filter 'NVU-PRO-Setup-*-x64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $Installer = $found.FullName }
  }
  if (-not $Installer -or -not (Test-Path -LiteralPath $Installer)) {
    Write-Host 'Instalador não encontrado. Informe o caminho: .\Verificar-NVU.ps1 -Installer "C:\Downloads\NVU-PRO-Setup-0.2.9-x64.exe"'
    Finish 2
  }
  if (-not $Manifest) { $Manifest = Join-Path (Split-Path -Parent $Installer) 'release-manifest.json' }
  $item = Get-Item -LiteralPath $Installer
  $hash = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host ('Arquivo : ' + $item.FullName)
  Write-Host ('Tamanho : ' + $item.Length + ' bytes')
  Write-Host ('SHA-256 : ' + $hash)
  $status = 0
  if (Test-Path -LiteralPath $Manifest) {
    $manifestData = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $expected = $manifestData.artifacts | Where-Object { $_.role -eq 'installer' } | Select-Object -First 1
    Write-Host ('Esperado: ' + $expected.bytes + ' bytes · ' + $expected.sha256)
    if ($item.Length -ne [int64]$expected.bytes) { Write-Host 'FALHA: o tamanho não confere. O download está incompleto ou foi alterado. Baixe novamente.'; $status = 1 }
    elseif ($hash -ne $expected.sha256) { Write-Host 'FALHA: o SHA-256 não confere. O arquivo foi alterado ou corrompido. Baixe novamente.'; $status = 1 }
    else { Write-Host 'OK: tamanho e SHA-256 conferem com o release-manifest.json.' }
  } else {
    Write-Host ('Aviso: release-manifest.json não encontrado em ' + $Manifest + '. Compare o SHA-256 acima com o informado pelo suporte.')
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Installer
  Write-Host ('Assinatura digital: ' + $signature.Status)
  if ($signature.SignerCertificate) { Write-Host ('Editor: ' + $signature.SignerCertificate.Subject) }
  if ($signature.Status -ne 'Valid') {
    Write-Host 'Este instalador NÃO tem assinatura digital válida. O Windows pode mostrar "editor desconhecido". Confira a origem e o SHA-256 acima; não desative o SmartScreen nem o antivírus.'
    if ($status -eq 0) { $status = 3 }
  }
  Finish $status
} catch {
  Write-Host ('ERRO inesperado ao conferir o arquivo: ' + $_.Exception.Message)
  Finish 4
}
