import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  VaultSyncTestController,
  clampWindowBoundsToMonitors,
  sortTasks,
} from "./glasstasksEngine.mjs";

function createTempVaultFixture(prefix = "glasstasks-int-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const vaultDir = path.join(root, "My Obsidian Vault 2026");
  const backupDir = path.join(root, "backups");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  return { root, vaultDir, backupDir };
}

test("Integration 1: Tambah task dari widget dan verifikasi file sumber serta integritas konten sekitar", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Catatan Harian.md";
  const initialContent = [
    "# Catatan Harian",
    "Paragraf pembuka yang tidak boleh rusak.",
    "",
    "## Tugas",
    "- [ ] Task awal 📅 2026-10-16 #kuliah",
    "",
    "## Catatan Rapat",
    "Isi catatan rapat penting di bagian bawah.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(vaultDir, fileRel), initialContent, "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  ctrl.fullIndex();

  const res = ctrl.addNewTask({
    relativePath: fileRel,
    title: "Menyusun draf eksperimen",
    dueDate: "2026-10-19",
    tags: ["#riset"],
    targetHeading: "## Tugas",
    createFileApproved: false,
  });

  assert.equal(res.success, true);
  const afterContent = fs.readFileSync(path.join(vaultDir, fileRel), "utf8");
  assert.ok(
    afterContent.includes("- [ ] Menyusun draf eksperimen 📅 2026-10-19 #riset")
  );
  assert.ok(afterContent.includes("Paragraf pembuka yang tidak boleh rusak."));
  assert.ok(afterContent.includes("Isi catatan rapat penting di bagian bawah."));
});

test("Integration 2: Edit judul tanpa merusak tag, wikilink, markdown link, atau metadata", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Riset.md";
  const initial =
    "# Riset\n- [ ] Evaluasi [[Model A]] dengan [Dataset](https://example.com) 📅 2026-10-18 ⏫ #ai [kesulitan:: tinggi] ^b12\nPenutup.\n";
  fs.writeFileSync(path.join(vaultDir, fileRel), initial, "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const [task] = ctrl.fullIndex();

  const res = ctrl.applyTaskPatch({
    taskId: task.id,
    relativePath: fileRel,
    anchor: task.anchor,
    originalRawLine: task.rawLine,
    newTitle: "Validasi akurasi [[Model A]]",
    todayLocal: "2026-10-14",
  });

  assert.equal(res.success, true);
  const disk = fs.readFileSync(path.join(vaultDir, fileRel), "utf8");
  assert.ok(disk.includes("[[Model A]]"));
  assert.ok(disk.includes("[Dataset](https://example.com)"));
  assert.ok(disk.includes("📅 2026-10-18"));
  assert.ok(disk.includes("⏫"));
  assert.ok(disk.includes("#ai"));
  assert.ok(disk.includes("[kesulitan:: tinggi]"));
  assert.ok(disk.includes("^b12"));
  assert.ok(disk.endsWith("\nPenutup.\n"));
});

test("Integration 3: Toggle task selesai dan buka kembali", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Toggle.md";
  fs.writeFileSync(
    path.join(vaultDir, fileRel),
    "- [ ] Kirim laporan mingguan 📅 2026-10-16 #kerja\n",
    "utf8"
  );

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  let [task] = ctrl.fullIndex();

  // Toggle Done
  const r1 = ctrl.applyTaskPatch({
    taskId: task.id,
    relativePath: fileRel,
    anchor: task.anchor,
    originalRawLine: task.rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });
  assert.equal(r1.success, true);
  assert.equal(r1.updatedFileTasks[0].status, "done");
  assert.equal(r1.updatedFileTasks[0].doneDate, "2026-10-14");

  // Reopen back to Todo
  task = r1.updatedFileTasks[0];
  const r2 = ctrl.applyTaskPatch({
    taskId: task.id,
    relativePath: fileRel,
    anchor: task.anchor,
    originalRawLine: task.rawLine,
    newStatus: "todo",
    todayLocal: "2026-10-14",
  });
  assert.equal(r2.success, true);
  assert.equal(r2.updatedFileTasks[0].status, "todo");
  assert.equal(r2.updatedFileTasks[0].doneDate, null);
  assert.equal(
    fs.readFileSync(path.join(vaultDir, fileRel), "utf8"),
    "- [ ] Kirim laporan mingguan 📅 2026-10-16 #kerja\n"
  );
});

test("Integration 4: Ubah deadline dan verifikasi urutan dinamis diperbarui", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Deadline.md";
  fs.writeFileSync(
    path.join(vaultDir, fileRel),
    "- [ ] Task A 📅 2026-10-20\n- [ ] Task B 📅 2026-10-16\n",
    "utf8"
  );

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const initialTasks = sortTasks(ctrl.fullIndex(), "deadline_asc");
  assert.equal(initialTasks[0].displayTitle, "Task B");

  // Ubah deadline Task A menjadi lebih awal (2026-10-12)
  const taskA = initialTasks.find((t) => t.displayTitle === "Task A");
  const res = ctrl.applyTaskPatch({
    taskId: taskA.id,
    relativePath: fileRel,
    anchor: taskA.anchor,
    originalRawLine: taskA.rawLine,
    newDueDate: "2026-10-12",
    todayLocal: "2026-10-14",
  });
  assert.equal(res.success, true);

  const resorted = sortTasks(res.updatedFileTasks, "deadline_asc");
  assert.equal(resorted[0].displayTitle, "Task A");
  assert.equal(resorted[0].dueDate, "2026-10-12");
});

test("Integration 5: Edit file dari luar aplikasi (Obsidian) dan verifikasi sinkronisasi ke state widget", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "External.md";
  const fullPath = path.join(vaultDir, fileRel);
  fs.writeFileSync(fullPath, "- [ ] Task awal 📅 2026-10-16\n", "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  assert.equal(ctrl.fullIndex().length, 1);

  // Simulasi perubahan dari Obsidian
  fs.writeFileSync(
    fullPath,
    "- [x] Task awal 📅 2026-10-16 ✅ 2026-10-14\n- [ ] Task tambahan dari Obsidian 📅 2026-10-15\n",
    "utf8"
  );

  const updated = ctrl.reindexSingleFile(fileRel);
  assert.equal(updated.length, 2);
  assert.equal(updated[0].status, "done");
  assert.equal(updated[1].displayTitle, "Task tambahan dari Obsidian");
});

test("Integration 6: Sisipkan baris sebelum task dari luar, kemudian edit task yang sama dari widget", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Shifted.md";
  const fullPath = path.join(vaultDir, fileRel);
  fs.writeFileSync(
    fullPath,
    "# Catatan\n- [ ] Target task yang akan bergeser 📅 2026-10-18 #penting\n",
    "utf8"
  );

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const [staleTask] = ctrl.fullIndex();
  assert.equal(staleTask.anchor.lineNumber, 2);

  // Editor luar menyisipkan 4 baris baru di atas task sebelum widget sempat reload
  fs.writeFileSync(
    fullPath,
    [
      "# Catatan",
      "Paragraf tambahan 1",
      "Paragraf tambahan 2",
      "## Subjudul Baru",
      "Catatan pengantar",
      "- [ ] Target task yang akan bergeser 📅 2026-10-18 #penting",
      "",
    ].join("\n"),
    "utf8"
  );

  // Widget mengedit menggunakan anchor lama (line 2), namun engine menemukan task pada line 6 secara akurat
  const outcome = ctrl.applyTaskPatch({
    taskId: staleTask.id,
    relativePath: fileRel,
    anchor: staleTask.anchor,
    originalRawLine: staleTask.rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });

  assert.equal(outcome.success, true);
  const afterLines = fs.readFileSync(fullPath, "utf8").split("\n");
  assert.equal(afterLines[1], "Paragraf tambahan 1");
  assert.match(
    afterLines[5],
    /^- \[x\] Target task yang akan bergeser 📅 2026-10-18 #penting ✅ 2026-10-14$/
  );
});

test("Integration 7: Dua task dengan judul dan baris identik dalam satu file tidak salah edit", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Identical.md";
  const fullPath = path.join(vaultDir, fileRel);
  const initial = [
    "## Semester Ganjil",
    "- [ ] Bayar UKT 📅 2026-10-20 #kampus",
    "Catatan ganjil",
    "",
    "## Semester Genap",
    "- [ ] Bayar UKT 📅 2026-10-20 #kampus",
    "Catatan genap",
    "",
  ].join("\n");
  fs.writeFileSync(fullPath, initial, "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const tasks = ctrl.fullIndex();
  assert.equal(tasks.length, 2);

  // Centang task KEDUA (di bawah ## Semester Genap)
  const secondTask = tasks[1];
  const outcome = ctrl.applyTaskPatch({
    taskId: secondTask.id,
    relativePath: fileRel,
    anchor: secondTask.anchor,
    originalRawLine: secondTask.rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });

  assert.equal(outcome.success, true);
  const updatedTasks = outcome.updatedFileTasks;
  assert.equal(updatedTasks[0].status, "todo"); // Task pertama tetap belum selesai!
  assert.equal(updatedTasks[1].status, "done"); // Hanya task kedua yang selesai!
});

test("Integration 8: Rename dan hapus file sumber direkonsiliasi dengan benar", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const oldPath = path.join(vaultDir, "Lama.md");
  const newPath = path.join(vaultDir, "Baru.md");
  fs.writeFileSync(oldPath, "- [ ] Task di file lama 📅 2026-10-16\n", "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  assert.equal(ctrl.fullIndex().length, 1);

  // Rename Lama.md -> Baru.md
  fs.renameSync(oldPath, newPath);
  const rec1 = ctrl.reconcileAfterResume();
  assert.equal(rec1.changed, true);
  assert.equal(rec1.tasks.length, 1);
  assert.equal(rec1.tasks[0].relativePath, "Baru.md");

  // Hapus Baru.md
  fs.unlinkSync(newPath);
  const rec2 = ctrl.reconcileAfterResume();
  assert.equal(rec2.changed, true);
  assert.equal(rec2.tasks.length, 0);
});

test("Integration 9: Penanganan file terkunci dengan retry terbatas dan pelaporan kegagalan aman", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Locked.md";
  const fullPath = path.join(vaultDir, fileRel);
  fs.writeFileSync(fullPath, "- [ ] Task terkunci 📅 2026-10-16\n", "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const [task] = ctrl.fullIndex();

  // Skenario A: File terkunci sementara pada percobaan 1, lalu terbuka pada percobaan 2
  ctrl.simulatedLockPaths.add(fullPath);
  ctrl.onLockRetryHook = (p, attempt) => {
    if (attempt >= 2) ctrl.simulatedLockPaths.delete(p);
  };

  const r1 = ctrl.applyTaskPatch({
    taskId: task.id,
    relativePath: fileRel,
    anchor: task.anchor,
    originalRawLine: task.rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });
  assert.equal(r1.success, true);

  // Skenario B: File tetap terkunci melewati batas retry -> gagal dengan aman tanpa merusak file
  const [task2] = r1.updatedFileTasks;
  ctrl.simulatedLockPaths.add(fullPath);
  ctrl.onLockRetryHook = null;

  const r2 = ctrl.applyTaskPatch({
    taskId: task2.id,
    relativePath: fileRel,
    anchor: task2.anchor,
    originalRawLine: task2.rawLine,
    newStatus: "todo",
    todayLocal: "2026-10-14",
  });
  assert.equal(r2.success, false);
  assert.equal(r2.syncStatus, "save_failed");
});

test("Integration 10: Konflik write terdeteksi tanpa menimpa perubahan eksternal secara diam-diam", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Conflict.md";
  const fullPath = path.join(vaultDir, fileRel);
  fs.writeFileSync(fullPath, "- [ ] Revisi bab 3 📅 2026-10-16\n", "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const [task] = ctrl.fullIndex();

  // Sementara pengguna membuka widget, baris yang sama diubah di Obsidian
  const externalEdit = "- [ ] Revisi bab 3 dan bab 4 (diedit di Obsidian) 📅 2026-10-22\n";
  fs.writeFileSync(fullPath, externalEdit, "utf8");

  // Pengguna mencoba menyimpan dari state lama di widget
  const outcome = ctrl.applyTaskPatch({
    taskId: task.id,
    relativePath: fileRel,
    anchor: task.anchor,
    originalRawLine: task.rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });

  assert.equal(outcome.success, false);
  assert.equal(outcome.conflictDetected, true);
  assert.equal(outcome.syncStatus, "conflict");
  // Pastikan file di disk TIDAK ditimpa!
  assert.equal(fs.readFileSync(fullPath, "utf8"), externalEdit);
  // Pastikan state terbaru dikembalikan ke UI
  assert.equal(outcome.updatedFileTasks[0].dueDate, "2026-10-22");
});

test("Integration 11: Pertahankan line ending CRLF (\r\n) dan LF (\n) asli", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const crlfFile = "WindowsCRLF.md";
  const lfFile = "UnixLF.md";

  fs.writeFileSync(
    path.join(vaultDir, crlfFile),
    "# Judul CRLF\r\n- [ ] Task satu CRLF 📅 2026-10-16\r\nBaris bawah\r\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(vaultDir, lfFile),
    "# Judul LF\n- [ ] Task satu LF 📅 2026-10-16\nBaris bawah\n",
    "utf8"
  );

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const all = ctrl.fullIndex();
  const tCrlf = all.find((t) => t.relativePath === crlfFile);
  const tLf = all.find((t) => t.relativePath === lfFile);

  ctrl.applyTaskPatch({
    taskId: tCrlf.id,
    relativePath: crlfFile,
    anchor: tCrlf.anchor,
    originalRawLine: tCrlf.rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });
  ctrl.applyTaskPatch({
    taskId: tLf.id,
    relativePath: lfFile,
    anchor: tLf.anchor,
    originalRawLine: tLf.rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });

  const crlfAfter = fs.readFileSync(path.join(vaultDir, crlfFile), "utf8");
  const lfAfter = fs.readFileSync(path.join(vaultDir, lfFile), "utf8");

  assert.ok(crlfAfter.includes("\r\n"));
  assert.equal(crlfAfter.replace(/\r\n/g, "").includes("\n"), false);
  assert.equal(lfAfter.includes("\r\n"), false);
  assert.ok(lfAfter.includes("\n"));
});

test("Integration 12: Dukungan penuh Unicode dan Emoji pada judul, tag, dan konten catatan", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "Unicode.md";
  const initial =
    "# 🌏 Catatan Internasional\n- [ ] Belajar Bahasa Jepang (日本語の勉強) & Arab (العربية) 🚀✨ 📅 2026-10-18 #bahasa\n";
  fs.writeFileSync(path.join(vaultDir, fileRel), initial, "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const [task] = ctrl.fullIndex();
  assert.ok(task.displayTitle.includes("日本語の勉強"));
  assert.ok(task.displayTitle.includes("العربية"));

  const res = ctrl.applyTaskPatch({
    taskId: task.id,
    relativePath: fileRel,
    anchor: task.anchor,
    originalRawLine: task.rawLine,
    newDueDate: "2026-10-21",
    todayLocal: "2026-10-14",
  });
  assert.equal(res.success, true);
  const after = fs.readFileSync(path.join(vaultDir, fileRel), "utf8");
  assert.ok(after.includes("日本語の勉強"));
  assert.ok(after.includes("🚀✨"));
  assert.ok(after.includes("📅 2026-10-21"));
});

test("Integration 13: Vault path dan sub-folder dengan spasi bekerja tanpa masalah", () => {
  const { vaultDir, backupDir } = createTempVaultFixture("glasstasks space ");
  const subDir = path.join(vaultDir, "Folder Kuliah Semester 7");
  fs.mkdirSync(subDir, { recursive: true });
  const fileRel = "Folder Kuliah Semester 7/Catatan Tugas Besar.md";
  fs.writeFileSync(
    path.join(vaultDir, fileRel),
    "- [ ] Selesaikan modul autentikasi 📅 2026-10-17 #tubes\n",
    "utf8"
  );

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  const tasks = ctrl.fullIndex();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].relativePath, fileRel);

  const res = ctrl.applyTaskPatch({
    taskId: tasks[0].id,
    relativePath: fileRel,
    anchor: tasks[0].anchor,
    originalRawLine: tasks[0].rawLine,
    newStatus: "done",
    todayLocal: "2026-10-14",
  });
  assert.equal(res.success, true);
});

test("Integration 14: Rekonsiliasi setelah aplikasi bangun dari sleep (Sleep/Resume)", () => {
  const { vaultDir, backupDir } = createTempVaultFixture();
  const fileRel = "SleepResume.md";
  const fullPath = path.join(vaultDir, fileRel);
  fs.writeFileSync(fullPath, "- [ ] Task sebelum sleep 📅 2026-10-16\n", "utf8");

  const ctrl = new VaultSyncTestController(vaultDir, backupDir);
  ctrl.fullIndex();

  // Tidak ada perubahan -> changed: false
  assert.equal(ctrl.reconcileAfterResume().changed, false);

  // Saat laptop sleep/watcher terlewat, file berubah di disk
  fs.writeFileSync(
    fullPath,
    "- [ ] Task sebelum sleep 📅 2026-10-16\n- [ ] Task baru saat sleep 📅 2026-10-15\n",
    "utf8"
  );
  const rec = ctrl.reconcileAfterResume();
  assert.equal(rec.changed, true);
  assert.equal(rec.tasks.length, 2);
});

test("Integration 15: Perubahan Monitor / DPI mengembalikan posisi widget yang berada di luar layar ke monitor aktif", () => {
  const primaryMonitor = { x: 0, y: 0, width: 1920, height: 1080 };
  const activeMonitors = [primaryMonitor];

  // Posisi lama berada di monitor kedua (x: 2400) yang sekarang sudah dicabut
  const offscreenBounds = { x: 2400, y: 120, width: 410, height: 640 };
  const recovered = clampWindowBoundsToMonitors(
    offscreenBounds,
    activeMonitors,
    primaryMonitor
  );
  assert.equal(recovered.recovered, true);
  assert.ok(recovered.x >= 0 && recovered.x + recovered.width <= 1920);
  assert.ok(recovered.y >= 0 && recovered.y + recovered.height <= 1080);

  // Posisi yang masih berada di dalam monitor utama dipertahankan apa adanya
  const validBounds = { x: 120, y: 90, width: 410, height: 640 };
  const kept = clampWindowBoundsToMonitors(
    validBounds,
    activeMonitors,
    primaryMonitor
  );
  assert.equal(kept.recovered, false);
  assert.equal(kept.x, 120);
  assert.equal(kept.y, 90);
});
