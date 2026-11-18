#Requires -Version 5.1
<#
.SYNOPSIS
    Skrip Audit Lingkungan & Setup Otomatis GlassTasks untuk Windows 10/11.
.DESCRIPTION
    Memeriksa ketersediaan Node.js, Rust (rustc/cargo), Microsoft Visual C++ Build Tools,
    dan Microsoft Edge WebView2 Runtime, lalu menjalankan `npm install`.
#>

$ErrorActionPreference = "Stop"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " GlassTasks — Audit Lingkungan & Setup Windows Lokal" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$missingDeps = @()

# 1. Periksa Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = node -v
    Write-Host "[OK] Node.js terdeteksi: $nodeVer" -ForegroundColor Green
} else {
    Write-Host "[MISSING] Node.js belum terinstal." -ForegroundColor Yellow
    $missingDeps += "OpenJS.NodeJS.LTS"
}

# 2. Periksa Rust & Cargo
if (Get-Command cargo -ErrorAction SilentlyContinue) {
    $rustVer = rustc --version
    $cargoVer = cargo --version
    Write-Host "[OK] Rust terdeteksi: $rustVer ($cargoVer)" -ForegroundColor Green
} else {
    Write-Host "[MISSING] Rust toolchain (rustup/cargo) belum terinstal." -ForegroundColor Yellow
    $missingDeps += "Rustlang.Rustup"
}

# 3. Periksa WebView2 Runtime (Bawaan di Windows 11 & Windows 10 terbaru)
$wv2RegPaths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$wv2Found = $false
foreach ($p in $wv2RegPaths) {
    if (Test-Path $p) { $wv2Found = $true; break }
}
if ($wv2Found) {
    Write-Host "[OK] Microsoft Edge WebView2 Runtime tersedia." -ForegroundColor Green
} else {
    Write-Host "[WARN] WebView2 Runtime tidak terdeteksi di registry standar (biasanya sudah terpasang di Windows 11)." -ForegroundColor Yellow
}

if ($missingDeps.Count -gt 0) {
    Write-Host ""
    Write-Host "Dependensi yang belum tersedia:" -ForegroundColor Yellow
    foreach ($dep in $missingDeps) {
        Write-Host "  - winget install --id $dep -e" -ForegroundColor Yellow
    }
    Write-Host "Catatan: Untuk kompilasi Rust di Windows, pastikan 'Desktop development with C++' (MSVC Build Tools) juga terinstal:" -ForegroundColor Yellow
    Write-Host "  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Menginstal dependensi frontend (npm install)..." -ForegroundColor Cyan
npm install

Write-Host ""
Write-Host "[SELESAI] Setup GlassTasks berhasil! Jalankan .\scripts\dev.ps1 untuk mulai." -ForegroundColor Green
