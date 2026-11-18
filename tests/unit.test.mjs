import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMarkdownTasks,
  patchTaskRawLine,
  sortTasks,
  filterTasks,
  formatDeadlineBadge,
} from "./glasstasksEngine.mjs";

test("Unit 1: Parser checkbox standar (- [ ], - [x], - [X], * [ ], 1. [ ])", () => {
  const md = [
    "- [ ] Task satu",
    "- [x] Task dua selesai",
    "- [X] Task tiga huruf besar",
    "* [ ] Task bullet bintang",
    "1. [ ] Task bernomor",
  ].join("\n");
  const tasks = parseMarkdownTasks("Test.md", md);
  assert.equal(tasks.length, 5);
  assert.equal(tasks[0].status, "todo");
  assert.equal(tasks[1].status, "done");
  assert.equal(tasks[2].status, "done");
  assert.equal(tasks[3].bulletMarker, "*");
  assert.equal(tasks[4].bulletMarker, "1.");
});

test("Unit 2: Metadata tanggal (due 📅, scheduled ⏳, start 🛫, done ✅, created ➕ & invalid date)", () => {
  const md = [
    "- [ ] Laporan akhir ➕ 2026-10-01 🛫 2026-10-05 ⏳ 2026-10-12 📅 2026-10-16 #kuliah",
    "- [x] Submit form 📅 2026-10-10 ✅ 2026-10-09",
    "- [ ] Tanggal kabisat salah 📅 2026-02-30 #qa",
  ].join("\n");
  const tasks = parseMarkdownTasks("Dates.md", md);
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].createdDate, "2026-10-01");
  assert.equal(tasks[0].startDate, "2026-10-05");
  assert.equal(tasks[0].scheduledDate, "2026-10-12");
  assert.equal(tasks[0].dueDate, "2026-10-16");
  assert.equal(tasks[1].doneDate, "2026-10-09");
  // Invalid calendar date must not be silently dropped
  assert.equal(tasks[2].dueDate, null);
  assert.equal(tasks[2].hasInvalidDueDate, true);
  assert.equal(tasks[2].rawInvalidDueDate, "2026-02-30");
});

test("Unit 3: Task duplikat menyimpan duplicateOccurrenceIndex dan konteks baris", () => {
  const md = [
    "## Pagi",
    "- [ ] Minum vitamin 📅 2026-10-14",
    "## Malam",
    "- [ ] Minum vitamin 📅 2026-10-14",
  ].join("\n");
  const tasks = parseMarkdownTasks("Duplikat.md", md);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].anchor.duplicateOccurrenceIndex, 0);
  assert.equal(tasks[1].anchor.duplicateOccurrenceIndex, 1);
  assert.deepEqual(tasks[0].anchor.contextBefore, ["## Pagi"]);
  assert.deepEqual(tasks[1].anchor.contextBefore.slice(-1), ["## Malam"]);
});

test("Unit 4: Nested task mempertahankan indentasi dan menghitung nestingLevel", () => {
  const md = [
    "- [ ] Task Induk",
    "  - [ ] Subtask Level 1",
    "    - [ ] Subtask Level 2",
    "	- [ ] Subtask dengan Tab",
  ].join("\n");
  const tasks = parseMarkdownTasks("Nested.md", md);
  assert.equal(tasks.length, 4);
  assert.equal(tasks[0].nestingLevel, 0);
  assert.equal(tasks[1].nestingLevel, 1);
  assert.equal(tasks[2].nestingLevel, 2);
  assert.equal(tasks[3].nestingLevel, 1);
});

test("Unit 5: Code block dan query plugin yang berisi checkbox diabaikan", () => {
  const md = [
    "# Catatan",
    "```tasks",
    "not done",
    "- [ ] Jangan baca baris query ini",
    "```",
    "~~~markdown",
    "- [ ] Jangan baca baris tilde fence ini",
    "~~~",
    "- [ ] Hanya baca task nyata ini 📅 2026-10-16",
  ].join("\n");
  const tasks = parseMarkdownTasks("CodeBlock.md", md);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].displayTitle, "Hanya baca task nyata ini");
});

test("Unit 6: Custom status ([/], [-]) ditampilkan read-only kecuali dipetakan", () => {
  const md = [
    "- [/] Sedang berjalan 📅 2026-10-15",
    "- [-] Dibatalkan 📅 2026-10-15",
  ].join("\n");
  const unmapped = parseMarkdownTasks("Custom.md", md, {});
  assert.equal(unmapped[0].isReadOnly, true);
  assert.deepEqual(unmapped[0].status, { custom: "/" });

  const mapped = parseMarkdownTasks("Custom.md", md, { "/": "todo" });
  assert.equal(mapped[0].isReadOnly, false);
  assert.equal(mapped[0].status, "todo");
});

test("Unit 7: Recurring task (🔁) dideteksi sebagai read-only pada MVP dan menolak mutasi sembarangan", () => {
  const md = "- [ ] Backup database 🔁 every week 📅 2026-10-18 #ops\n";
  const tasks = parseMarkdownTasks("Recurring.md", md);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].isRecurring, true);
  assert.equal(tasks[0].isReadOnly, true);
  assert.equal(tasks[0].recurrenceRule, "🔁 every week");

  assert.throws(() => {
    patchTaskRawLine(tasks[0].rawLine, {
      newStatus: "done",
      todayLocal: "2026-10-14",
    });
  }, /baca-saja pada MVP/);
});

test("Unit 8: Sorting default (overdue -> today -> upcoming -> no-date) dan tie-breaker (priority -> source order)", () => {
  const md = [
    "- [ ] Tanpa tenggat B",
    "- [ ] Mendatang 📅 2026-10-19",
    "- [ ] Hari ini prioritas biasa 📅 2026-10-14",
    "- [ ] Hari ini prioritas tertinggi 📅 2026-10-14 🔺",
    "- [ ] Overdue kemarin 📅 2026-10-12",
  ].join("\n");
  const tasks = parseMarkdownTasks("Sort.md", md);
  const sorted = sortTasks(tasks, "deadline_asc");
  assert.deepEqual(
    sorted.map((t) => t.displayTitle),
    [
      "Overdue kemarin",
      "Hari ini prioritas tertinggi",
      "Hari ini prioritas biasa",
      "Mendatang",
      "Tanpa tenggat B",
    ]
  );
});

test("Unit 9: Filter tanggal (overdue, today, upcoming_7d, no_deadline, completed, tag, file)", () => {
  const today = "2026-10-14";
  const md = [
    "- [ ] Task Overdue 📅 2026-10-10 #kuliah",
    "- [ ] Task Hari Ini 📅 2026-10-14 #project",
    "- [ ] Task 5 Hari Lagi 📅 2026-10-19 #kuliah",
    "- [ ] Task 10 Hari Lagi 📅 2026-10-24 #kuliah",
    "- [ ] Task Tanpa Tanggal #project",
    "- [x] Task Sudah Selesai 📅 2026-10-14 ✅ 2026-10-14",
  ].join("\n");
  const tasks = parseMarkdownTasks("Filter.md", md);

  const overdue = filterTasks(tasks, { preset: "overdue", todayLocal: today });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].displayTitle, "Task Overdue");

  const dueToday = filterTasks(tasks, { preset: "today", todayLocal: today });
  assert.equal(dueToday.length, 1);
  assert.equal(dueToday[0].displayTitle, "Task Hari Ini");

  const next7 = filterTasks(tasks, { preset: "upcoming_7d", todayLocal: today });
  assert.equal(next7.length, 2); // Hari Ini (diff 0) + 5 Hari Lagi (diff 5)

  const noDate = filterTasks(tasks, { preset: "no_deadline", todayLocal: today });
  assert.equal(noDate.length, 1);
  assert.equal(noDate[0].displayTitle, "Task Tanpa Tanggal");

  const byTag = filterTasks(tasks, {
    preset: "all_active",
    tagFilter: "#project",
    todayLocal: today,
  });
  assert.equal(byTag.length, 2);
});

test("Unit 10: Pergantian hari lokal memperbarui label relatif tanpa pergeseran UTC", () => {
  const b1 = formatDeadlineBadge("2026-10-15", false, null, "2026-10-14");
  assert.equal(b1.label, "Besok");

  // Saat tanggal lokal berganti ke 2026-10-15:
  const b2 = formatDeadlineBadge("2026-10-15", false, null, "2026-10-15");
  assert.equal(b2.label, "Hari ini");

  // Saat tanggal lokal berganti ke 2026-10-17:
  const b3 = formatDeadlineBadge("2026-10-15", false, null, "2026-10-17");
  assert.equal(b3.label, "Terlambat 2 hari");
});

test("Unit 11: Patch Markdown mempertahankan indentasi, wikilink, markdown link, tag, dan block ID", () => {
  const raw =
    "  - [ ] Baca [[Bab 1|Pendahuluan]] dan [Paper](https://example.com) 📅 2026-10-16 ⏫ #riset [status:: draft] ^id42";
  const patched = patchTaskRawLine(raw, {
    newTitle: " Ringkas [[Bab 1|Pendahuluan]] dan [Paper](https://example.com) ",
    newDueDate: "2026-10-20",
    newStatus: "done",
    todayLocal: "2026-10-14",
  });
  assert.equal(
    patched,
    "  - [x] Ringkas [[Bab 1|Pendahuluan]] dan [Paper](https://example.com) #riset [status:: draft] ⏫ 📅 2026-10-20 ✅ 2026-10-14 ^id42"
  );
});
