# Arsitektur Teknis GlassTasks

GlassTasks dibangun menggunakan **Tauri v2 + React 18 + TypeScript + Vite + Rust** dengan pemisahan tanggung jawab (separation of concerns) ke dalam 8 lapisan independen.

## 1. Diagram Lapisan Arsitektur

| Lapisan | File Utama | Tanggung Jawab Inti |
| :--- | :--- | :--- |
| **1. Task Model** | `src-tauri/src/models.rs`, `src/types/task.ts` | Struktur data kanonis `TaskItem`, `SourceAnchor`, `VaultConfig`, `WidgetSettings`, `WriteOutcome`, dan `UndoRecord`. |
| **2. Markdown Parser & Patcher** | `src-tauri/src/parser.rs`, `src/core/parser.ts` | Parsing task nir-rugi (lossless): mengabaikan fenced code blocks & blok query plugin (`tasks`/`dataview`), mengenali tenggat `📅`, scheduled `⏳`, start `🛫`, done `✅`, created `➕`, prioritas `🔺⏫🔼🔽⏬`, recurrence `🔁`, custom status `[/]`, tag, wikilink, dan melakukan *surgical single-line patching*. |
| **3. Vault Indexer & Watcher** | `src-tauri/src/indexer.rs`, `src-tauri/src/watcher.rs` | Pemindaian terarah sesuai scope (`SingleFile`, `MultipleFiles`, `Folder`, `WholeVault`), mengecualikan `.obsidian`, `.git`, `node_modules`, dan folder backup. Menggunakan `notify-debouncer-mini` (220 ms debounce) serta rekonsiliasi berbasis SHA-256 saat aplikasi bangun dari *sleep*. |
| **4. Safe Write & Conflict Engine** | `src-tauri/src/sync.rs` | Validasi batas path vault (anti-path-traversal), baca ulang file sebelum tulis, *Multi-Anchor Contextual Task Locator*, penulisan atomik via temporary file + rename dengan retry terbatas untuk file terkunci, backup berversi di luar vault, *Self-Write Hash Registry* (mencegah loop watcher), serta fitur Undo kontekstual. |
| **5. Dynamic Sorting & Filtering** | `src/core/sorter.ts`, `src/core/dateUtils.ts` | Perhitungan tanggal kalender lokal murni (tanpa pergeseran UTC), pengurutan dinamis (*Overdue → Hari Ini → Mendatang → Tanpa Tenggat → Selesai*) dengan tie-breaker prioritas lalu urutan sumber stabil. |
| **6. Native Window Management** | `src-tauri/src/window.rs`, `src-tauri/src/lib.rs` | Jendela tanpa title bar standar, efek native Windows (`window-vibrancy`: Mica, Acrylic, Blur) beserta fallback CSS transparan/opak, System Tray, Single-Instance, pemulihan posisi multi-monitor & DPI scaling, Always-on-Top, Click-Through aman, dan mode lanjutan Desktop-Pinned (`HWND_BOTTOM`). |
| **7. Glass UI Layer** | `src/App.tsx`, `src/components/*.tsx`, `src/styles/glass.css` | Antarmuka kaca bergaya iOS (Light Glass, Dark Glass, Follow System), header draggable (mengecualikan tombol interaktif), pencarian/filter ringkas, virtualized task list (>100 item), indikator status sinkronisasi, dan navigasi keyboard. |
| **8. Settings & Local Cache** | `src-tauri/src/settings.rs` | Penyimpanan preferensi widget dan konfigurasi sumber di `%APPDATA%\com.glasstasks.desktop\glasstasks-config.json` tanpa pernah mencemari catatan Markdown pengguna dengan ID tersembunyi. |

## 2. Algoritma *Multi-Anchor Contextual Task Locator* (`sync.rs`)

Mengandalkan nomor baris (`line_number`) saja berbahaya jika file diedit bersamaan di Obsidian, dan mengandalkan judul task saja berbahaya jika terdapat dua task identik dalam satu catatan. GlassTasks menyelesaikan masalah ini dengan menyimpan `SourceAnchor` pada setiap task:
1. **Fast Path**: Jika hash SHA-256 file saat ini sama persis dengan `anchor.file_hash` saat terakhir diindeks, dan `lines[anchor.line_number - 1] == original_raw_line`, baris tersebut langsung di-patch.
2. **Relokasi Kontekstual (Saat Baris Bergeser)**: Jika file berubah di luar (misalnya pengguna menyisipkan paragraf baru di atas task melalui Obsidian), engine mencari semua kandidat baris yang identik dengan `original_raw_line`.
3. **Disambiguasi Task Duplikat**: Jika terdapat >1 baris task yang identik di dalam file yang sama, setiap kandidat dinilai berdasarkan kecocokan `context_before` (2 baris sebelum), `context_after` (2 baris sesudah), `duplicate_occurrence_index`, dan jarak ke nomor baris awal.
4. **Penghentian Aman Saat Konflik**: Jika baris target sudah diubah isinya dari luar atau terjadi ambiguitas pada task duplikat, proses tulis langsung dibatalkan (`SyncStatus::Conflict`), perubahan eksternal **tidak pernah ditimpa**, dan versi terbaru file dimuat ulang ke UI.

## 3. Perbedaan Mode Jendela Desktop Windows (`window.rs`)

1. **Floating Widget Biasa (Default Baseline Stabil)**: Jendela frameless transparan yang dapat dipindah dan diubah ukurannya, berada pada Z-order aplikasi normal.
2. **Always-on-Top**: Menggunakan `window.set_always_on_top(true)` agar widget selalu tampil di atas aplikasi kerja lain.
3. **Desktop-Pinned (`HWND_BOTTOM` — Fitur Lanjutan)**: Menempatkan HWND jendela pada dasar tumpukan Z-order (`SetWindowPos(..., HWND_BOTTOM, ...)`) sehingga jendela aplikasi lain selalu berada di atas widget. Dokumentasi dan UI menjelaskan secara jujur bahwa mode ini berbeda dari injeksi sub-window `WorkerW`/`Progman` ala Rainmeter yang rentan rusak pada pembaruan Windows 11 24H2 Explorer.
