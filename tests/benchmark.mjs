import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { VaultSyncTestController, sortTasks, filterTasks } from "./glasstasksEngine.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "glasstasks-bench-"));
const vaultDir = path.join(root, "BenchVault");
const backupDir = path.join(root, "BenchBackups");
fs.mkdirSync(vaultDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

// Populate 50 Markdown files with 10 tasks each = 500 tasks total
const FILE_COUNT = 50;
const TASKS_PER_FILE = 10;

for (let f = 1; f <= FILE_COUNT; f++) {
  const lines = [`# Proyek File ${f}`, "", "## Daftar Task"];
  for (let t = 1; t <= TASKS_PER_FILE; t++) {
    const day = String(((f + t) % 28) + 1).padStart(2, "0");
    const status = t % 4 === 0 ? "x" : " ";
    const prio = t % 5 === 0 ? "🔺 " : t % 3 === 0 ? "⏫ " : "";
    lines.push(
      `- [${status}] Task nomor ${t} pada dokumen ${f} [[Referensi ${f}]] ${prio}📅 2026-10-${day} #proyek${f % 5}`
    );
  }
  fs.writeFileSync(
    path.join(vaultDir, `Dokumen_${String(f).padStart(2, "0")}.md`),
    lines.join("\n") + "\n",
    "utf8"
  );
}

// 1. Measure Engine Startup / Controller Initialization
const t0 = performance.now();
const ctrl = new VaultSyncTestController(vaultDir, backupDir);
const startupMs = performance.now() - t0;

// 2. Measure Full Vault Indexing (50 files, 500 tasks)
const tIndex0 = performance.now();
const allTasks = ctrl.fullIndex();
const fullIndexMs = performance.now() - tIndex0;

// 3. Measure Sorting + Filtering (500 tasks)
const tSort0 = performance.now();
const activeFiltered = filterTasks(allTasks, {
  preset: "all_active",
  todayLocal: "2026-10-14",
});
const sorted = sortTasks(activeFiltered, "deadline_asc");
const sortFilterMs = performance.now() - tSort0;

// 4. Measure Single-File Incremental Watcher Update Latency
const tWatch0 = performance.now();
ctrl.reindexSingleFile("Dokumen_01.md");
const incrementalWatchMs = performance.now() - tWatch0;

// 5. Measure Safe Atomic Write + Versioned Backup Latency
const sampleTask = allTasks.find((t) => t.status === "todo");
const tWrite0 = performance.now();
const writeOut = ctrl.applyTaskPatch({
  taskId: sampleTask.id,
  relativePath: sampleTask.relativePath,
  anchor: sampleTask.anchor,
  originalRawLine: sampleTask.rawLine,
  newStatus: "done",
  todayLocal: "2026-10-14",
});
const writeLatencyMs = performance.now() - tWrite0;

const mem = process.memoryUsage();
const results = {
  environment: `${os.type()} ${os.release()} (${os.arch()}) — Node ${process.version}`,
  filesIndexed: FILE_COUNT,
  tasksIndexed: allTasks.length,
  activeTasksSorted: sorted.length,
  startupInitMs: Number(startupMs.toFixed(3)),
  fullIndex50Files500TasksMs: Number(fullIndexMs.toFixed(2)),
  sortAndFilter500TasksMs: Number(sortFilterMs.toFixed(3)),
  incrementalSingleFileReindexMs: Number(incrementalWatchMs.toFixed(3)),
  safeAtomicWriteWithBackupMs: Number(writeLatencyMs.toFixed(2)),
  writeSuccess: writeOut.success,
  memoryRssMB: Number((mem.rss / (1024 * 1024)).toFixed(2)),
  memoryHeapUsedMB: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
};

console.log(JSON.stringify(results, null, 2));
fs.rmSync(root, { recursive: true, force: true });
