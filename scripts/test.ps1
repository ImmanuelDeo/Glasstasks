#Requires -Version 5.1
$ErrorActionPreference = "Stop"
Write-Host "1. Menjalankan Unit Tests & 15 Skenario Integration Tests (Node.js)..." -ForegroundColor Cyan
npm test

Write-Host ""
Write-Host "2. Menjalankan Pengukuran Performa & Benchmark..." -ForegroundColor Cyan
npm run benchmark

if (Get-Command cargo -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "3. Menjalankan Rust Backend Unit Tests (cargo test)..." -ForegroundColor Cyan
    cargo test --manifest-path src-tauri/Cargo.toml
}
