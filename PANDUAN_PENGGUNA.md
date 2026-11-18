# GlassTasks — Panduan Pengguna Lengkap

## 📋 Ringkasan Cepat

| Komponen | Lokasi |
|----------|--------|
| Executable | `C:\Users\<user>\AppData\Local\GlassTasks\glasstasks.exe` |
| Config & Backup | `%APPDATA%\com.glasstasks.desktop\` |
| Sample Vault (testing) | `D:\GlassTask-App\GlassTasks\GlassTasks\fixtures\sample-vault\` |
| Installer MSI | `src-tauri\target\release\bundle\msi\GlassTasks_1.0.0_x64_en-US.msi` |
| Installer NSIS | `src-tauri\target\release\bundle\nsis\GlassTasks_1.0.0_x64-setup.exe` |

**Status Instalasi**: ✅ Terpasang dan terverifikasi (semua 30 test PASS, build production berhasil)

---

## 🚀 Memulai

### 1. Jalankan Aplikasi
- **Cara paling mudah**: Double-click `start-glasstasks.bat` di folder instalasi
- **Dari Command Line**:
  ```cmd
  cd %LOCALAPPDATA%\GlassTasks
  glasstasks.exe
  ```
- **Hotkey Global**: `Ctrl+Shift+G` (setelah aplikasi berjalan di background)

### 2. Onboarding Pertama Kali
Saat pertama kali dibuka, muncul **Modal Konfigurasi Vault Obsidian**:

```
┌─────────────────────────────────────────────────┐
│  GlassTasks — Pilih Sumber Vault Obsidian       │
├─────────────────────────────────────────────────┤
│  ☐ Coba Mode Demo Terisolasi (Recommended)      │
│  ☐ Pilih Folder Vault Obsidian Pribadi          │
│                                                 │
│  [ Tampilkan Preview Task Sebelum Mengaktifkan  │
│    Editing ]                                    │
│                                                 │
│  [ Aktifkan Sinkronisasi Dua Arah pada Vault ]  │
└─────────────────────────────────────────────────┘
```

**Rekomendasi**: Pilih **"Coba Mode Demo Terisolasi"** dulu untuk mengenal UI tanpa risiko merusak vault pribadi.

---

## 🎯 Fitur Utama & Cara Menggunakan

### Manajemen Task

| Aksi | Cara |
|------|------|
| **Tambah Task Baru** | Klik tombol `+` (kanan atas) atau tekan `Ctrl+N` |
| **Toggle Selesai/Belum** | Klik checkbox di sebelah kiri task |
| **Edit Judul** | Klik langsung pada teks judul task |
| **Ubah/Set Deadline** | Klik ikon kalender 📅 pada task |
| **Hapus Task** | Klik kanan task → **Hapus** |
| **Undo Perubahan Terakhir** | Tombol `Undo` (kiri atas) atau `Ctrl+Z` |
| **Buka di Obsidian** | Klik kanan task → **Buka di Obsidian** |

### Quick Add Modal (Ctrl+N)
```
┌────────────────────────────────────────┐
│  Tambah Task Cepat                     │
├────────────────────────────────────────┤
│  Judul: [________________________]     │
│  Deadline: [📅 Pilih Tanggal    ]      │
│  Prioritas: [ 🔺  🔼  ⏬  (none) ]      │
│  Tag: [ #tag1 #tag2           ]        │
│  File Target: [ Otomatis / Pilih... ]  │
│                                        │
│  [ Batal ]          [ Tambah Task ]    │
└────────────────────────────────────────┘
```

### Sorting & Filter Otomatis
Task aktif diurutkan otomatis:
1. **Overdue (Terlambat)** — merah, di atas
2. **Hari Ini** — oranye
3. **Mendatang (7 hari)** — biru
4. **Tanpa Tenggat** — abu-abu, di bawah

*Tie-breaker*: Prioritas (`🔺` > `⏫` > `🔼` > `🔽` > `⏬`) → Urutan baris sumber

**Filter Cepat** (klik tab di header):
- `Semua` • `Overdue` • `Hari Ini` • `7 Hari` • `Tanpa Tanggal` • `Selesai` • `Tag` • `File`

---

## ⚙️ Settings Modal (Gear Icon / `Ctrl+,`)

### Tab: Tampilan Glass
| Pengaturan | Opsi | Default |
|------------|------|---------|
| **Efek Glass** | Mica • Acrylic • Blur • Transparan • Opak | Mica (Windows 11) / Acrylic (Windows 10) |
| **Opacity** | 0% – 100% | 85% |
| **Blur Radius** | 0 – 50px | 20px |
| **Tema Warna** | Light Glass • Dark Glass • System | System |
| **Density** | Compact • Comfortable | Comfortable |

### Tab: Perilaku Jendela
| Pengaturan | Deskripsi | Default |
|------------|-----------|---------|
| **Always on Top** | Widget selalu di atas jendela lain | ✅ On |
| **Click-Through** | Klik menembus widget (untuk overlay) | ❌ Off |
| **Sembunyikan ke Tray saat Close** | Tombol X = minimize ke tray, bukan exit | ✅ On |
| **Auto-hide saat Focus Lost** | Sembunyikan saat klik di luar widget | ❌ Off |

### Tab: Hotkey & Sistem
| Pengaturan | Default | Catatan |
|------------|---------|---------|
| **Toggle Show/Hide** | `Ctrl+Shift+G` | Global, bekerja di mana saja |
| **Quick Add** | `Ctrl+N` | Hanya saat widget fokus |
| **Undo** | `Ctrl+Z` | Hanya saat widget fokus |
| **Auto-start dengan Windows** | ❌ Off | Butuh restart untuk berlaku |
| **Single Instance** | ✅ On | Mencegah multiple window |

### Tab: Metrik & Debug
- **Startup Time**: Waktu inisialisasi (ms)
- **Index Time**: Waktu memindai vault (ms)
- **Memory Usage**: RSS & Heap (MB)
- **Backup Count**: Jumlah file backup tersimpan
- **Log Level**: Error • Warn • Info • Debug

---

## 🔄 Sinkronisasi Dua Arah — Detail Teknis

### Cara Kerja
```
Widget (GlassTasks)          Vault Obsidian (.md)
     │                            │
     ├── Toggle [ ] → [x] ──────► │ Surgical Line Patch
     │                            │ (hanya 1 baris berubah)
     │                            │
     │ ◄────── Edit di Obsidian ──│ File Watcher (debounce 300ms)
     │   Auto-reload              │ SHA-256 reconciliation
     │                            │
     └── Backup otomatis ────────► %APPDATA%\com.glasstasks.desktop\backups\
```

### Keamanan Data
- **Surgical Line Patch**: Hanya baris target yang diubah; frontmatter, callout, line ending (`CRLF`/`LF`) tetap utuh
- **Multi-Anchor Contextual Relocation**: Verifikasi posisi task via `line number + surrounding context + duplicate index` — aman terhadap penyisipan baris baru & task berjudul kembar
- **Backup Berversi**: Setiap write → `<nama_file>__<timestamp_ms>.bak.md` di folder backup (di luar vault)
- **Conflict Detection**: Jika file berubah dari luar saat widget akan write → dialog konflic, tidak menimpa diam-diam
- **Read-Only Protection**: Task recurring (`🔁`) & custom status (`[/]`, `[-]`, dll) → badge **Baca-Saja** + tombol **Buka di Obsidian**

---

## 📁 Struktur Vault & Format Task

### Format Task yang Didukung
```markdown
- [ ] Task biasa
- [x] Task selesai ✅ 2026-10-14
- [ ] Task dengan deadline 📅 2026-10-20
- [ ] Task prioritas tinggi 🔺 #tag
- [ ] Nested task (indent 2 spasi)
  - [ ] Sub-task
- [ ] Recurring 🔁 every week 📅 2026-10-20  ← READ-ONLY
- [/] Custom status (in-progress)         ← READ-ONLY
- [ ] Wikilink [[Note Name]] dan [Link](url) dipertahankan
```

### Metadata Tanggal (semua lokal, bebas UTC bug)
| Simbol | Artinya | Contoh |
|--------|---------|--------|
| 📅 | Due / Deadline | `📅 2026-10-20` |
| ⏳ | Scheduled | `⏳ 2026-10-15` |
| 🛫 | Start | `🛫 2026-10-10` |
| ✅ | Done Date | `✅ 2026-10-14` |
| ➕ | Created | `➕ 2026-10-01` |

---

## 🛡️ Backup & Pemulihan

### Lokasi Backup
```
%APPDATA%\com.glasstasks.desktop\backups\
├── Tugas Utama__1728901234567.bak.md
├── Tugas Utama__1728901245678.bak.md
└── ...
```

### Cara Restore Manual
1. Buka folder backup: `Win+R` → `%APPDATA%\com.glasstasks.desktop\backups\`
2. Cari file `.bak.md` dengan timestamp sebelum kerusakan
3. Buka dengan Notepad/VS Code, salin isinya
4. Paste ke file asli di vault Obsidian

### Otomatis (Undo)
- Tombol **Undo** di widget / `Ctrl+Z` → restore ke state sebelumnya (menggunakan backup terbaru)

---

## 🖥️ System Tray Menu

Klik kanan ikon GlassTasks di **System Tray** (pojok kanan bawah taskbar):

```
┌─────────────────────────────┐
│  GlassTasks                 │
├─────────────────────────────┤
│  ✅ Tampilkan / Sembunyikan  │  ← Ctrl+Shift+G
│  ⚙️ Pengaturan              │  ← Ctrl+,
│  🔄 Reload Vault            │
│  ─────────────────────────  │
│  🖱 Matikan Click-Through   │  ← jika widget tidak bisa diklik
│  📂 Buka Folder Backup      │
│  📂 Buka Folder Config      │
│  ─────────────────────────  │
│  ❌ Keluar dari GlassTasks  │
└─────────────────────────────┘
```

---

## 🔧 Troubleshooting

### Widget Tidak Terlihat
| Penyebab | Solusi |
|----------|--------|
| Monitor eksternal dicabut, widget tersisa di koordinat lama | Klik Tray → **Tampilkan / Sembunyikan** atau tekan `Ctrl+Shift+G` |
| Click-Through aktif | Klik kanan Tray → **Matikan Click-Through (Pulihkan Interaksi)** |
| Opacity = 0% | Buka Settings (Tray → Pengaturan) → Tab Tampilan → atur Opacity > 0 |

### Tidak Bisa Klik / Interaksi
→ **Click-Through mode aktif**. Klik kanan Tray → **Matikan Click-Through (Pulihkan Interaksi)**

### Perubahan di Obsidian Tidak Ter-sync
1. Pastikan file watcher jalan: Settings → Metrik → cek "File Watcher: Active"
2. Klik Tray → **Reload Vault**
3. Restart aplikasi: Tray → **Keluar** → jalankan ulang

### Error "Vault Tidak Ditemukan" / Path Salah
1. Settings → Tab Vault → **Pilih Ulang Folder Vault**
2. Atau hapus config: hapus `%APPDATA%\com.glasstasks.desktop\glasstasks-config.json` lalu restart

### Performa Lambat (Vault Besar > 1000 task)
- Settings → Tab Metrik → cek "Index Time"
- Kurangi frekuensi file watcher di `src-tauri/src/watcher.rs` (rebuild diperlukan)
- Gunakan filter tag/file untuk mempersempit tampilan

---

## 🗑️ Uninstall Bersih

```cmd
# 1. Keluar dari aplikasi via Tray → "Keluar dari GlassTasks"
# 2. Uninstall via Windows Settings → Apps → Installed Apps → GlassTasks → Uninstall
# 3. Hapus config & backup (VAULT PRIBADI ANDA AMAN, TIDAK TERSENTUH):
Remove-Item -Path "$env:APPDATA\com.glasstasks.desktop" -Recurse -Force
```

---

## 📝 Catatan untuk Pengguna Lanjutan

### Migrasi dari Rainmeter Task Widget
1. Export task Rainmeter ke format Markdown checklist
2. Simpan sebagai `.md` di vault Obsidian
3. Arahkan GlassTasks ke vault tersebut
4. Verifikasi via **Preview Task** sebelum aktifkan editing

### Multi-Vault (Roadmap)
Saat ini hanya **1 vault aktif per instance**. Untuk multi-vault:
- Jalankan multiple instance dengan config folder berbeda (belum didukung GUI, butuh manual config)
- Atau gunakan symbolic link gabungkan vault

### Custom CSS / Tema
Edit `%APPDATA%\com.glasstasks.desktop\glasstasks-config.json` → field `customCSS` (string CSS mentah) untuk override styling lanjutan.

### Debug Log
```cmd
# Jalankan dengan log verbose
set RUST_LOG=debug
glasstasks.exe
```

---

## 📞 Bantuan & Laporkan Bug

- **GitHub Issues**: [Repo GlassTasks](https://github.com/...) — sertakan log & langkah reproduksi
- **Log File**: `%APPDATA%\com.glasstasks.desktop\logs\glasstasks.log`
- **Config Dump**: Settings → Metrik → **Export Config JSON**

---

## 📄 Lisensi & Kredit

**GlassTasks v1.0.0** — Modern iOS-inspired Glass Task Widget
- Tauri v2 + React 18 + TypeScript + Rust
- Parser & Sync Engine: Custom (lossless, surgical patch)
- UI: Tailwind CSS + Lucide Icons
- Native Windows: Mica/Acrylic via `window-vibrancy`

**Dibangun untuk menggantikan Rainmeter Task Widget** dengan fondasi Obsidian Markdown sebagai source of truth.