/**
 * Built-in Demo Vault Markdown files.
 * Strictly isolated from real user vaults so users can test GlassTasks safely before connecting their vault.
 */
export const INITIAL_DEMO_FILES: Record<string, string> = {
  "Kuliah & Riset.md": `# Kuliah & Riset Semester Ini

## Tugas Prioritas
- [ ] Menyelesaikan revisi proposal skripsi [[Bab 3 Metodologi]] 📅 2026-10-13 🔺 #kuliah #riset
- [ ] Menyiapkan slide presentasi seminar hasil 📅 2026-10-14 ⏫ #kuliah
- [ ] Konsultasi dosen pembimbing terkait eksperimen 📅 2026-10-16 #kuliah
  - [ ] Cetak lembar asistensi terbaru 📅 2026-10-15 #kuliah
- [x] Mengirim dokumen pendaftaran seminar ✅ 2026-10-12 #kuliah
`,
  "Proyek Aplikasi.md": `# Proyek Pengembangan

## Sprint Oktober
- [ ] Memperbaiki halaman website portofolio [Lihat Repo](https://example.com) 📅 2026-10-18 🔼 #project
- [ ] Audit aksesibilitas kontras warna pada tema terang 📅 2026-10-20 #project #ui
- [ ] Rapikan dokumentasi API lokal #project
- [ ] Backup mingguan repositori lokal 🔁 every week 📅 2026-10-19 #rutin
- [/] Eksplorasi integrasi kalender tambahan 📅 2026-10-22 #project
- [ ] Contoh task dengan tanggal tidak valid 📅 2026-02-30 #qa
\`\`\`tasks
not done
due before 2026-10-25
- [ ] Baris di dalam blok query ini diabaikan oleh parser
\`\`\`
`,
};
