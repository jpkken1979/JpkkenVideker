$ErrorActionPreference = "Stop"

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$binaryDir = Join-Path $projectRoot "src-tauri\binaries"
$targetTriple = (& rustc --print host-tuple).Trim()

if ($targetTriple -ne "x86_64-pc-windows-msvc") {
    throw "Este script de preparación admite Windows x64. Target detectado: $targetTriple"
}

New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null

$ytDlpDestination = Join-Path $binaryDir "yt-dlp-$targetTriple.exe"
$ffmpegDestination = Join-Path $binaryDir "ffmpeg-$targetTriple.exe"
$ffprobeDestination = Join-Path $binaryDir "ffprobe-$targetTriple.exe"
$denoDestination = Join-Path $binaryDir "deno-$targetTriple.exe"

Write-Host "Descargando yt-dlp oficial..."
$ytDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$checksumsUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS"
$checksumsPath = Join-Path $env:TEMP "jpkkenvideker-yt-dlp-checksums.txt"
Invoke-WebRequest -Uri $ytDlpUrl -OutFile $ytDlpDestination
Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath
$expectedLine = Get-Content $checksumsPath | Where-Object { $_ -match "\syt-dlp\.exe$" } | Select-Object -First 1
if (-not $expectedLine) {
    throw "No se encontró el checksum oficial de yt-dlp.exe."
}
$expectedHash = ($expectedLine -split "\s+")[0].ToUpperInvariant()
$actualHash = Get-Sha256 -Path $ytDlpDestination
if ($actualHash -ne $expectedHash) {
    throw "La verificación SHA-256 de yt-dlp.exe falló."
}

Write-Host "Buscando la compilación FFmpeg recomendada por yt-dlp..."
$headers = @{
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "JpkkenVideker-Build-Script"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest"
$asset = $release.assets |
    Where-Object { $_.name -match "win64-gpl\.zip$" -and $_.name -notmatch "shared" } |
    Select-Object -First 1
if (-not $asset) {
    throw "No se encontró una compilación FFmpeg win64-gpl compatible."
}

$ffmpegZip = Join-Path $env:TEMP "jpkkenvideker-ffmpeg.zip"
$ffmpegExtract = Join-Path $env:TEMP "jpkkenvideker-ffmpeg-extract"
if (Test-Path -LiteralPath $ffmpegExtract) {
    Remove-Item -LiteralPath $ffmpegExtract -Recurse -Force
}
Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $ffmpegZip
if ($asset.digest -and $asset.digest.StartsWith("sha256:")) {
    $expectedFfmpegHash = $asset.digest.Substring(7).ToUpperInvariant()
    $actualFfmpegHash = Get-Sha256 -Path $ffmpegZip
    if ($actualFfmpegHash -ne $expectedFfmpegHash) {
        throw "La verificación SHA-256 del paquete FFmpeg falló."
    }
}

Expand-Archive -LiteralPath $ffmpegZip -DestinationPath $ffmpegExtract -Force
$ffmpegSource = Get-ChildItem -LiteralPath $ffmpegExtract -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
$ffprobeSource = Get-ChildItem -LiteralPath $ffmpegExtract -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
if (-not $ffmpegSource -or -not $ffprobeSource) {
    throw "El paquete FFmpeg no contenía ffmpeg.exe y ffprobe.exe."
}
Copy-Item -LiteralPath $ffmpegSource.FullName -Destination $ffmpegDestination -Force
Copy-Item -LiteralPath $ffprobeSource.FullName -Destination $ffprobeDestination -Force

Write-Host "Descargando Deno para el motor JavaScript de YouTube..."
$denoRelease = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/denoland/deno/releases/latest"
$denoAsset = $denoRelease.assets |
    Where-Object { $_.name -eq "deno-x86_64-pc-windows-msvc.zip" } |
    Select-Object -First 1
if (-not $denoAsset) {
    throw "No se encontró el paquete oficial de Deno para Windows x64."
}
$denoZip = Join-Path $env:TEMP "jpkkenvideker-deno.zip"
$denoExtract = Join-Path $env:TEMP "jpkkenvideker-deno-extract"
if (Test-Path -LiteralPath $denoExtract) {
    Remove-Item -LiteralPath $denoExtract -Recurse -Force
}
Invoke-WebRequest -Headers $headers -Uri $denoAsset.browser_download_url -OutFile $denoZip
if ($denoAsset.digest -and $denoAsset.digest.StartsWith("sha256:")) {
    $expectedDenoHash = $denoAsset.digest.Substring(7).ToUpperInvariant()
    $actualDenoHash = Get-Sha256 -Path $denoZip
    if ($actualDenoHash -ne $expectedDenoHash) {
        throw "La verificación SHA-256 del paquete Deno falló."
    }
}
Expand-Archive -LiteralPath $denoZip -DestinationPath $denoExtract -Force
$denoSource = Get-ChildItem -LiteralPath $denoExtract -Recurse -Filter "deno.exe" | Select-Object -First 1
if (-not $denoSource) {
    throw "El paquete oficial de Deno no contenía deno.exe."
}
Copy-Item -LiteralPath $denoSource.FullName -Destination $denoDestination -Force

Write-Host "Sidecars preparados y verificados:"
Write-Host "  $ytDlpDestination"
Write-Host "  $ffmpegDestination"
Write-Host "  $ffprobeDestination"
Write-Host "  $denoDestination"
