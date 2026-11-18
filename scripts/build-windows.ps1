#Requires -Version 5.1
$ErrorActionPreference = "Stop"
Write-Host "Membangun aplikasi produksi & installer Windows (.msi dan .exe NSIS)..." -ForegroundColor Cyan
npm run tauri build
Write-Host "Hasil build tersedia di: src-tauri\target\release\bundle\" -ForegroundColor Green
