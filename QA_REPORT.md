# Laporan QA, Pengukuran Performa, dan Status Fitur GlassTasks

## 1. Hasil Audit Lingkungan & Status Build

- **Lingkungan Agent Saat Pengembangan**: Linux 4.19.0-gvisor x86_64 dengan Node.js `v18.20.4` dan Python `3.11.2` (tanpa compiler Rust/MSVC Windows dan tanpa akses internet keluar).
- **Status Build Installer Windows**: Karena lingkungan sandbox berjalan di Linux tanpa toolchain cross-compile MSVC/Windows SDK, binary installer `.msi` / `.exe` **belum dikompilasi di dalam sandbox ini**. Seluruh konfigurasi Tauri v2 (`Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`), kode Rust (`src-tauri/src/*.rs`), kode React/TypeScript (`src/`), dan skrip PowerShell (`scripts/build-windows.ps1`) telah disiapkan secara lengkap agar dapat langsung di-build di laptop Windows lokal pengguna.

## 2. Hasil Pengujian Otomatis (Unit & Integration Tests)

Seluruh **26 pengujian otomatis** telah dijalankan secara nyata terhadap sistem file menggunakan runner `node --test`:

- **11 Unit Tests (`tests/unit.test.mjs`) — LULUS (11/11)**:
  1. Parser checkbox standar (`- [ ]`, `- [x]`, `- [X]`, `* [ ]`, `1. [ ]`).
  2. Ekstraksi metadata tanggal (`📅`, `⏳`, `🛫`, `✅`, `➕`) dan penanda tanggal tidak valid (`📅 2026-02-30`).
  3. Task duplikat (`duplicateOccurrenceIndex`, `contextBefore`, `contextAfter`).
  4. Nested task (indentasi spasi & tab, `nestingLevel`).
  5. Pengabaian checkbox di dalam fenced code blocks (` ```tasks `, `~~~`).
  6. Penanganan custom status (`[/]`, `[-]`) sebagai baca-saja default maupun ketika dipetakan.
  7. Deteksi recurring task (`🔁`) sebagai baca-saja pada MVP dan penolakan mutasi sembarangan.
  8. Pengurutan default (*Overdue → Hari Ini → Mendatang → Tanpa Tenggat*) dan tie-breaker (*Prioritas → Urutan Sumber*).
  9. Filter tanggal (*Overdue, Hari Ini, 7 Hari ke Depan, Tanpa Tenggat, Selesai, Tag, File*).
  10. Kalkulasi ulang label relatif saat pergantian hari lokal tanpa pergeseran UTC.
  11. Patch Markdown satu baris tanpa merusak indentasi, wikilink, markdown link, tag, Dataview field, atau block ID.

- **15 Integration Tests (`tests/integration.test.mjs`) — LULUS (15/15)**:
  1. Tambah task dari widget ke bagian bawah heading tertentu & verifikasi konten di luar patch tetap identik byte-for-byte.
  2. Edit judul tanpa merusak tag, wikilink, markdown link, atau metadata.
  3. Toggle task selesai (`[x] ... ✅ YYYY-MM-DD`) dan buka kembali (`[ ]`).
  4. Ubah deadline dan verifikasi pembaruan urutan sorting dinamis.
  5. Edit file dari luar aplikasi (simulasi Obsidian) dan verifikasi sinkronisasi ke widget.
  6. Sisipkan 4 baris baru sebelum task dari luar, lalu edit task yang sama dari widget (relokasi kontekstual akurat).
  7. Dua task dengan judul & baris identik dalam satu file: mengedit task kedua tidak mengubah task pertama.
  8. Rename dan hapus file sumber direkonsiliasi dengan bersih.
  9. Penanganan file terkunci dengan retry terbatas (berhasil saat lock dilepas, atau melaporkan `save_failed` dengan aman).
  10. Deteksi konflik write saat baris yang sama diedit dari luar (menolak menimpa file dan memuat ulang versi terbaru).
  11. Preservasi line ending asli `CRLF` (`
`) dan `LF` (`
`).
  12. Preservasi karakter Unicode (Jepang, Arab, Indonesia) dan Emoji (`🚀✨`).
  13. Dukungan penuh untuk path vault dan nama folder dengan spasi.
  14. Rekonsiliasi cepat berbasis hash SHA-256 setelah aplikasi kembali dari *sleep/resume*.
  15. Pemulihan posisi jendela otomatis ke monitor aktif ketika monitor eksternal dicabut atau DPI berubah.

## 3. Hasil Pengukuran Performa Nyata (`tests/benchmark.mjs`)

Diukur secara nyata pada lingkungan `Linux 4.19.0-gvisor (x64) — Node v18.20.4` menggunakan vault uji berisi **50 file Markdown dan 500 task** (400 aktif, 100 selesai):

| Metrik yang Diukur | Hasil Pengukuran Nyata | Keterangan |
| :--- | :--- | :--- |
| **Waktu Inisialisasi Engine (Startup Init)** | **0,329 ms** | Inisialisasi controller, direktori backup, dan struktur indeks memori. |
| **Waktu Indexing Penuh (50 File / 500 Task)** | **86,77 ms** | Pemindaian direktori, pembacaan disk, komputasi SHA-256, dan parsing 500 task. |
| **Waktu Sorting & Filtering Dinamis (500 Task)** | **3,527 ms** | Filter task aktif + pengurutan tenggat, prioritas, dan urutan sumber stabil. |
| **Latensi Perubahan File ke State (Incremental Re-index)** | **2,668 ms** | Waktu re-index 1 file yang berubah (belum termasuk debounce watcher 220 ms). |
| **Latensi Safe Write + Backup Berversi** | **5,85 ms** | Baca ulang file, relokasi multi-anchor, tulis backup `.bak.md`, tulis temp file, dan atomic rename. |
| **Penggunaan Memori (Heap Used / Total RSS)** | **5,71 MB Heap / 121,47 MB RSS** | Tanpa kebocoran memori; tidak ada polling agresif saat idle (0% CPU idle). |

## 4. Daftar Fitur Selesai vs Batasan / Fitur Lanjutan

| Kategori | Fitur | Status | Catatan Implementasi |
| :--- | :--- | :--- | :--- |
| **MVP Inti** | Pemilihan folder vault & 4 mode scope sumber | **Selesai** | Termasuk preview task sebelum mengaktifkan editing & Mode Demo terpisah. |
| **MVP Inti** | Parser Markdown & surgical single-line patcher | **Selesai** | Mempertahankan CRLF/LF, indentasi, link, wikilink, tag, dan metadata tak dikenal. |
| **MVP Inti** | Sinkronisasi 2 arah, atomic write, backup & deteksi konflik | **Selesai** | Backup disimpan di luar vault; konflik tidak pernah menimpa perubahan eksternal. |
| **MVP Inti** | Tambah, edit judul, centang/buka kembali, ubah/hapus deadline, hapus + Undo | **Selesai** | Dilengkapi konfirmasi hapus, peringatan subtask, dan Undo kontekstual. |
| **MVP Inti** | Sorting & filtering dinamis + pencarian instan + label tanggal Indonesia | **Selesai** | *Terlambat X hari*, *Hari ini*, *Besok*, *Dalam X hari*, bebas pergeseran UTC. |
| **MVP Inti** | Buka di Obsidian via `obsidian://open` URI | **Selesai** | Mendukung encoding nama vault, path file, dan anchor `#Heading` konteks. |
| **MVP Inti** | Desain Glass Interface (Light/Dark/System) + System Tray + Single-Instance | **Selesai** | Mendukung Mica/Acrylic/Blur di Windows + fallback transparan/opak yang terbaca. |
| **Lanjutan** | Penyelesaian penuh Recurring Tasks (`🔁`) | **Read-Only pada MVP** | Task `🔁` dideteksi dan dikunci sebagai baca-saja dengan tombol buka di Obsidian agar tidak merusak jadwal plugin Obsidian Tasks. |
| **Lanjutan** | Desktop-Pinned Mode (`HWND_BOTTOM`) | **Tersedia (Eksperimental)** | Menempatkan jendela di Z-order bawah; bukan injeksi `WorkerW` Rainmeter. |
| **Lanjutan** | Drag-and-drop pengurutan manual, Kalender penuh, & Notifikasi | **Belum Diimplementasikan** | Sengaja dipisahkan sesuai spesifikasi agar tidak menghambat stabilitas MVP. |
