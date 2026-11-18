# GlassTasks — Widget Task List Glass Modern Tersinkron Dua Arah dengan Obsidian

**GlassTasks** adalah aplikasi desktop lokal Windows berbasis **Tauri v2 + React + TypeScript + Rust** yang menampilkan dan mengelola daftar tugas (*tasks*) langsung dari file Markdown di dalam vault Obsidian Anda dengan tampilan *glass interface* modern bergaya iOS.

## Repositori & Reproduksibilitas

Source code proyek ini disimpan di GitHub: `https://github.com/ImmanuelDeo/Glasstasks.git`.

- `node_modules/`, `dist/`, dan `target/` tidak disertakan di repo (hasil install/build). Jalankan `npm install` dan `npm run tauri build` untuk membangun dari sumber.
- Panduan lengkap ada di [ARCHITECTURE.md](ARCHITECTURE.md), [AGENT_SETUP_GUIDE.md](AGENT_SETUP_GUIDE.md), [QA_REPORT.md](QA_REPORT.md), dan [PANDUAN_PENGGUNA.md](PANDUAN_PENGGUNA.md).

## Fitur Utama

- **File Markdown Obsidian sebagai Source of Truth**: Bekerja langsung di atas file `.md` lokal Anda—tetap berfungsi penuh meskipun aplikasi Obsidian sedang ditutup dan tidak bergantung pada Rainmeter.
- **Sinkronisasi Dua Arah & Keamanan Data Tinggi**:
  - Setiap perubahan dari widget (centang selesai, buka kembali, tambah task, edit judul, ubah/hapus tenggat, hapus task) hanya mengubah satu baris sasaran secara presisi (*surgical line patch*) tanpa mengubah format catatan lain, frontmatter, callout, atau line ending (`CRLF`/`LF`).
  - Sebelum menulis ke file, GlassTasks membaca ulang isi file terbaru, memverifikasi posisi task menggunakan *Multi-Anchor Contextual Relocation* (aman terhadap penyisipan baris baru maupun task berjudul kembar), dan menyimpan backup berversi di luar vault.
  - Perubahan dari Obsidian atau editor eksternal otomatis terdeteksi melalui filesystem watcher ber-debounce dan langsung memperbarui tampilan widget.
- **Pengurutan & Pemfilteran Dinamis**:
  - Mengurutkan task aktif secara otomatis mulai dari **Overdue (Terlambat) → Hari Ini → Mendatang → Tanpa Tenggat**, dengan *tie-breaker* prioritas (`🔺`, `⏫`, `🔼`, `🔽`, `⏬`) dan urutan baris sumber yang stabil.
  - Menggunakan perhitungan tanggal kalender lokal murni sehingga bebas dari bug pergeseran hari akibat konversi zona waktu UTC.
- **Perlindungan Recurring Tasks & Custom Status**:
  - Task berulang (`🔁`) dan *custom checkbox status* (`[/]`, `[-]`, dll. yang belum dipetakan) otomatis ditampilkan dengan lencana **Baca-Saja** dan pintasan **Buka di Obsidian** agar tidak merusak aturan recurrence Anda.
- **Desain Glass Interface & Perilaku Desktop Windows**:
  - Mendukung efek native Windows (**Mica**, **Acrylic**, **Blur**) dengan fallback transparan/opak yang tetap tajam di atas wallpaper terang maupun gelap.
  - Dilengkapi **System Tray**, **Single-Instance**, **Always-on-Top**, pengaturan **Opacity & Blur**, **Compact/Comfortable Density**, **Click-Through** dengan tombol pemulihan darurat di Tray, serta pemulihan posisi otomatis saat monitor eksternal dilepas.

## Struktur Direktori Proyek

```text
GlassTasks/
├── AGENT_SETUP_GUIDE.md         # Panduan eksekusi otomatis untuk Personal Local Agent Anda
├── ARCHITECTURE.md              # Dokumentasi arsitektur 8 lapis & algoritma sinkronisasi
├── QA_REPORT.md                 # Laporan pengujian 26 test otomatis & benchmark performa nyata
├── README.md                    # Dokumentasi utama berbahasa Indonesia
├── package.json                 # Dependensi & skrip npm (Tauri v2 + React 18 + Vite)
├── tsconfig.json                # Konfigurasi TypeScript
├── vite.config.ts               # Konfigurasi bundler Vite (port 1420)
├── tailwind.config.js           # Konfigurasi utilitas styling
├── index.html                   # Entry HTML transparan
├── scripts/
│   ├── setup-windows.ps1        # Skrip PowerShell audit dependensi & instalasi awal
│   ├── dev.ps1                  # Skrip PowerShell menjalankan mode development
│   ├── test.ps1                 # Skrip PowerShell menjalankan unit, integration & benchmark test
│   └── build-windows.ps1        # Skrip PowerShell membangun installer .msi & .exe Windows
├── fixtures/
│   └── sample-vault/            # Contoh vault Obsidian untuk pengujian aman sebelum memakai vault pribadi
├── tests/
│   ├── glasstasksEngine.mjs     # Engine pengujian ESM untuk Node.js test runner
│   ├── unit.test.mjs            # 11 pengujian unit (parser, tanggal lokal, sorting, filter, patch)
│   ├── integration.test.mjs     # 15 skenario uji integrasi filesystem nyata
│   └── benchmark.mjs            # Pengukuran waktu startup, indexing 500 task, write latency & memori
├── src/
│   ├── main.tsx                 # Entry point React
│   ├── App.tsx                  # Komponen utama widget GlassTasks
│   ├── types/
│   │   └── task.ts              # Kontrak tipe data TypeScript
│   ├── core/
│   │   ├── dateUtils.ts         # Kalkulasi tanggal kalender lokal & label Bahasa Indonesia
│   │   ├── parser.ts            # Parser & lossless line patcher di sisi klien
│   │   ├── sorter.ts            # Pengurutan & pemfilteran dinamis
│   │   └── demoVault.ts         # Data Mode Demo yang terisolasi penuh dari vault nyata
│   ├── services/
│   │   └── tauriBridge.ts       # Jembatan komunikasi ke command & event Tauri v2
│   ├── components/
│   │   ├── OnboardingModal.tsx  # Pemilih vault, scope sumber, dan preview sebelum editing
│   │   ├── TaskRow.tsx          # Baris task interaktif, date picker, dan menu konteks
│   │   ├── QuickAddModal.tsx    # Panel tambah task cepat + konfirmasi pembuatan file baru
│   │   └── SettingsModal.tsx    # Pengaturan tema glass, perilaku jendela, hotkey & metrik
│   └── styles/
│       └── glass.css            # Styling Glass Interface (Light/Dark Glass, fallback, fokus)
└── src-tauri/
    ├── Cargo.toml               # Dependensi Rust (Tauri v2, notify, sha2, tempfile, window-vibrancy)
    ├── build.rs                 # Build script Tauri v2
    ├── tauri.conf.json          # Konfigurasi murni Tauri v2
    ├── capabilities/
    │   └── default.json         # Izin keamanan (ACL) Tauri v2
    ├── icons/                   # Ikon aplikasi (.png & .ico)
    └── src/
        ├── main.rs              # Entry point binary Windows
        ├── lib.rs               # Registrasi command Tauri, System Tray, Single-Instance & events
        ├── models.rs            # Model data Rust
        ├── parser.rs            # Parser Markdown & surgical line patcher (+ Rust unit tests)
        ├── sync.rs              # Engine tulis atomik, backup berversi, deteksi konflik & Undo
        ├── indexer.rs           # Pemindaian terarah & rekonsiliasi sleep/resume berbasis SHA-256
        ├── watcher.rs           # File watcher ber-debounce dengan pencegahan self-write loop
        ├── settings.rs          # Penyimpanan konfigurasi lokal & direktori backup
        └── window.rs            # Efek Mica/Acrylic/Blur native & pemulihan koordinat multi-monitor
```

## Perintah PowerShell (Install, Development, Test, dan Build)

Buka **PowerShell** di direktori root proyek `GlassTasks`:

1. **Audit Lingkungan & Install Dependensi**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
   ```
2. **Menjalankan Pengujian Otomatis (Unit, 15 Skenario Integrasi, & Benchmark)**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
   ```
3. **Menjalankan Aplikasi dalam Mode Development**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
   ```
4. **Membangun Installer Produksi Windows (`.msi` dan `.exe`)**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
   ```

## Lokasi Konfigurasi, Backup, & Cara Pemulihan

- **File Konfigurasi Widget**: `%APPDATA%\com.glasstasks.desktop\glasstasks-config.json`
- **Folder Backup Berversi (Di Luar Vault)**: `%APPDATA%\com.glasstasks.desktop\backups\`
- **Cara Memulihkan Backup**: Setiap kali GlassTasks menyimpan perubahan ke file catatan, salinan sebelum perubahan disimpan dengan nama `<nama_file>__<timestamp_ms>.bak.md`. Anda dapat membuka file tersebut dengan editor teks atau menyalin isinya kembali ke catatan Obsidian Anda kapan saja.

## Troubleshooting & Langkah Uninstall Bersih

- **Widget Tidak Terlihat (Misalnya Setelah Mencabut Monitor Eksternal)**: Klik ikon **GlassTasks** di System Tray Windows (pojok kanan bawah taskbar) lalu pilih **Tampilkan / Sembunyikan Widget**, atau tekan shortcut `Ctrl+Shift+G`.
- **Widget Tidak Bisa Diklik (Karena Mode Click-Through Aktif)**: Klik kanan ikon **GlassTasks** di System Tray lalu klik **"Matikan Click-Through (Pulihkan Interaksi)"**.
- **Cara Uninstall Bersih**:
  1. Keluar dari aplikasi melalui menu System Tray (**Keluar dari GlassTasks**).
  2. Uninstall **GlassTasks** melalui *Windows Settings → Apps → Installed Apps*.
  3. Hapus folder konfigurasi dan backup lokal dengan menjalankan perintah PowerShell berikut (vault Obsidian pribadi Anda tidak akan tersentuh):
     ```powershell
     Remove-Item -Path "$env:APPDATA\com.glasstasks.desktop" -Recurse -Force
     ```
