# Panduan Eksekusi Otomatis untuk Personal Local Agent (Windows)

Dokumen ini disusun khusus untuk **Personal Local Agent** di laptop Windows pengguna agar dapat mengekstrak, memverifikasi dependensi, menjalankan pengujian, dan mengaktifkan aplikasi desktop **GlassTasks** secara mandiri dari bundel `GlassTasks-Full-Project.zip`.

## 1. Urutan Langkah Setup Otomatis oleh Local Agent

### Langkah 1: Ekstrak Bundel Proyek
Ekstrak `GlassTasks-Full-Project.zip` ke direktori kerja pilihan pengguna (misalnya `C:\Projects\GlassTasks` atau `~/GlassTasks`), lalu masuk ke direktori root proyek tempat `package.json` dan folder `src-tauri/` berada:
```powershell
Expand-Archive -Path .\GlassTasks-Full-Project.zip -DestinationPath .\GlassTasks -Force
Set-Location .\GlassTasks
```

### Langkah 2: Audit Prasyarat Sistem (Tanpa Menginstal Komponen Sistem Diam-Diam)
Jalankan pemeriksaan prasyarat berikut di PowerShell:
```powershell
node -v
npm -v
rustc --version
cargo --version
```
- **Jika semua terdeteksi** (`Node.js >= 18`, `Rust >= 1.77.2`): lanjutkan langsung ke **Langkah 3**.
- **Jika ada yang belum terinstal**: minta konfirmasi pengguna sebelum menjalankan perintah instalasi `winget` berikut:
  ```powershell
  # Node.js LTS
  winget install --id OpenJS.NodeJS.LTS -e

  # Rustup & Cargo
  winget install --id Rustlang.Rustup -e

  # Microsoft Visual C++ Build Tools (diperlukan oleh linker Rust di Windows)
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

  # Microsoft Edge WebView2 Runtime (biasanya sudah terinstal bawaan di Windows 10/11)
  winget install --id Microsoft.EdgeWebView2Runtime -e
  ```

### Langkah 3: Instalasi Dependensi NPM & Verifikasi Test Otomatis
Jalankan perintah berikut dari root proyek:
```powershell
npm install
npm test
npm run benchmark
cargo test --manifest-path src-tauri/Cargo.toml
```
Pastikan seluruh **26 pengujian otomatis** (11 Unit Test + 15 Integration Test) dan `cargo test` berstatus **PASS** (menggunakan vault sementara di `%TEMP%`, bukan vault pribadi pengguna).

### Langkah 4: Menjalankan Aplikasi (Development atau Produksi)
- **Untuk langsung mencoba dan menjalankan aplikasi:**
  ```powershell
  npm run tauri dev
  ```
- **Untuk membangun file executable (`.exe`) dan installer mandiri (`.msi` / NSIS `.exe`):**
  ```powershell
  npm run tauri build
  ```
  Setelah selesai, binary dan installer tersedia di:
  - Binary langsung: `src-tauri\target\release\glasstasks.exe`
  - Installer NSIS: `src-tauri\target\release\bundle\nsis\GlassTasks_1.0.0_x64-setup.exe`
  - Installer MSI: `src-tauri\target\release\bundle\msi\GlassTasks_1.0.0_x64_en-US.msi`

## 2. Protokol Keamanan Saat Pertama Kali Menghubungkan Vault Pribadi
1. Saat `GlassTasks` pertama kali terbuka, jendela **Konfigurasi Sumber Vault Obsidian** akan muncul.
2. Pengguna dapat mencoba **Mode Demo Terisolasi** terlebih dahulu atau langsung memilih folder Vault Obsidian nyata.
3. Sebelum mengaktifkan editing pada vault nyata, klik **"4. Tampilkan Preview Task Sebelum Mengaktifkan Editing"** untuk memverifikasi daftar task yang terbaca.
4. Setiap kali `GlassTasks` menulis perubahan ke file Markdown, salinan backup berversi (`<nama_file>__<timestamp>.bak.md`) otomatis dibuat di luar vault pada folder:
   - `%APPDATA%\com.glasstasks.desktop\backups\`
