import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^\s*(#{1,6}\s+.+)$/;
const TASK_LINE_RE = /^([ \t]*)([-*+]|\d+\.)\s+\[(.)\]\s+(.*)$/;

const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2}|\S+)/;
const SCHEDULED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/;
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const CREATED_RE = /➕\s*(\d{4}-\d{2}-\d{2})/;
const RECURRENCE_RE = /🔁\s*([^📅⏳🛫✅➕🔺⏫🔼🔽⏬#\[\]]*)/;
const TAG_GLOBAL_RE = /(?:^|\s)(#[a-zA-Z0-9_\-/]+)/g;
const WIKILINK_GLOBAL_RE = /\[\[[^\]]+\]\]/g;
const MDLINK_GLOBAL_RE = /\[[^\]]+\]\([^\)]+\)/g;
const DATAVIEW_GLOBAL_RE = /\[[a-zA-Z0-9_\-]+::[^\]]+\]/g;
const BLOCK_ID_RE = /(?:\s)(\^[a-zA-Z0-9\-]+)\s*$/;

const IGNORED_DIRS = new Set([
  ".obsidian",
  ".git",
  ".trash",
  "node_modules",
  "target",
  "dist",
  ".glasstasks-backup",
]);

export function computeSha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function detectLineEnding(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function isValidCalendarDateString(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

export function diffCalendarDays(dueDateStr, todayLocalStr) {
  if (
    !isValidCalendarDateString(dueDateStr) ||
    !isValidCalendarDateString(todayLocalStr)
  ) {
    return null;
  }
  const [y1, m1, d1] = dueDateStr.split("-").map(Number);
  const [y0, m0, d0] = todayLocalStr.split("-").map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1, 12, 0, 0);
  const utc0 = Date.UTC(y0, m0 - 1, d0, 12, 0, 0);
  return Math.round((utc1 - utc0) / 86_400_000);
}

export function formatDeadlineBadge(
  dueDate,
  hasInvalidDueDate,
  rawInvalidDueDate,
  todayLocalStr
) {
  if (hasInvalidDueDate) {
    return {
      label: `Tanggal tidak valid (${rawInvalidDueDate ?? "?"})`,
      tone: "invalid",
      dayDiff: null,
    };
  }
  if (!dueDate) {
    return { label: "Tanpa tenggat", tone: "none", dayDiff: null };
  }
  const diff = diffCalendarDays(dueDate, todayLocalStr);
  if (diff === null) {
    return {
      label: `Tanggal tidak valid (${dueDate})`,
      tone: "invalid",
      dayDiff: null,
    };
  }
  if (diff < 0) {
    return {
      label: `Terlambat ${Math.abs(diff)} hari`,
      tone: "overdue",
      dayDiff: diff,
    };
  }
  if (diff === 0) return { label: "Hari ini", tone: "today", dayDiff: 0 };
  if (diff === 1) return { label: "Besok", tone: "tomorrow", dayDiff: 1 };
  return { label: `Dalam ${diff} hari`, tone: "upcoming", dayDiff: diff };
}

export function extractCleanDisplayTitle(body) {
  let s = body
    .replace(DUE_RE, "")
    .replace(SCHEDULED_RE, "")
    .replace(START_RE, "")
    .replace(DONE_RE, "")
    .replace(CREATED_RE, "")
    .replace(RECURRENCE_RE, "")
    .replace(/[🔺⏫🔼🔽⏬]/g, "")
    .replace(BLOCK_ID_RE, "")
    .replace(TAG_GLOBAL_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || body.trim();
}

export function parseMarkdownTasks(
  relativePath,
  content,
  customStatusMap = {}
) {
  const fileHash = computeSha256(content);
  const normalized = content.replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");
  if (normalized.endsWith("\n") && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const tasks = [];
  let inCodeFence = false;
  let fenceChar = "";
  let currentHeading = null;
  const occurrenceCounter = new Map();
  let byteCursor = 0;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const rawLine = rawLines[idx];
    const lineNumber = idx + 1;
    const byteStart = byteCursor;
    const byteEnd = byteCursor + Buffer.byteLength(rawLine, "utf8");
    byteCursor = byteEnd + 1;

    const fenceMatch = rawLine.match(FENCE_RE);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inCodeFence) {
        inCodeFence = true;
        fenceChar = markerChar;
        continue;
      } else if (fenceChar === markerChar) {
        inCodeFence = false;
        fenceChar = "";
        continue;
      }
    }
    if (inCodeFence) continue;

    const headingMatch = rawLine.match(HEADING_RE);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      continue;
    }

    const taskMatch = rawLine.match(TASK_LINE_RE);
    if (!taskMatch) continue;

    const [, indent, bulletMarker, checkboxChar, body] = taskMatch;
    const indentSpaces = Array.from(indent).reduce(
      (acc, c) => acc + (c === "\t" ? 2 : 1),
      0
    );
    const nestingLevel = Math.floor(indentSpaces / 2);

    const occIdx = occurrenceCounter.get(rawLine) ?? 0;
    occurrenceCounter.set(rawLine, occIdx + 1);

    const contextBefore = [];
    if (idx >= 2) contextBefore.push(rawLines[idx - 2]);
    if (idx >= 1) contextBefore.push(rawLines[idx - 1]);
    const contextAfter = [];
    if (idx + 1 < rawLines.length) contextAfter.push(rawLines[idx + 1]);
    if (idx + 2 < rawLines.length) contextAfter.push(rawLines[idx + 2]);

    let status;
    let isReadOnly = false;
    let readOnlyReason = null;

    if (checkboxChar === " ") {
      status = "todo";
    } else if (checkboxChar === "x" || checkboxChar === "X") {
      status = "done";
    } else {
      const mapped = customStatusMap[checkboxChar];
      if (mapped === "todo") status = "todo";
      else if (mapped === "done") status = "done";
      else {
        status = { custom: checkboxChar };
        isReadOnly = true;
        readOnlyReason = `Custom checkbox '[${checkboxChar}]' belum dipetakan; ditampilkan baca-saja`;
      }
    }

    let dueDate = null;
    let hasInvalidDueDate = false;
    let rawInvalidDueDate = null;
    const dueMatch = body.match(DUE_RE);
    if (dueMatch) {
      const token = dueMatch[1];
      if (isValidCalendarDateString(token)) {
        dueDate = token;
      } else {
        hasInvalidDueDate = true;
        rawInvalidDueDate = token;
      }
    }

    const schedMatch = body.match(SCHEDULED_RE);
    const scheduledDate =
      schedMatch && isValidCalendarDateString(schedMatch[1])
        ? schedMatch[1]
        : null;

    const startMatch = body.match(START_RE);
    const startDate =
      startMatch && isValidCalendarDateString(startMatch[1])
        ? startMatch[1]
        : null;

    const doneMatch = body.match(DONE_RE);
    const doneDate =
      doneMatch && isValidCalendarDateString(doneMatch[1])
        ? doneMatch[1]
        : null;

    const createdMatch = body.match(CREATED_RE);
    const createdDate =
      createdMatch && isValidCalendarDateString(createdMatch[1])
        ? createdMatch[1]
        : null;

    let isRecurring = false;
    let recurrenceRule = null;
    if (body.includes("🔁")) {
      isRecurring = true;
      const rMatch = body.match(RECURRENCE_RE);
      const rText = rMatch?.[1]?.trim() ?? "";
      recurrenceRule = rText ? `🔁 ${rText}` : "🔁";
      isReadOnly = true;
      readOnlyReason =
        "Task berulang (🔁) bersifat baca-saja pada MVP agar tidak merusak aturan recurrence Obsidian Tasks";
    }

    let priority = "none";
    if (body.includes("🔺")) priority = "highest";
    else if (body.includes("⏫")) priority = "high";
    else if (body.includes("🔼")) priority = "medium";
    else if (body.includes("🔽")) priority = "low";
    else if (body.includes("⏬")) priority = "lowest";

    const links = [
      ...(body.match(WIKILINK_GLOBAL_RE) ?? []),
      ...(body.match(MDLINK_GLOBAL_RE) ?? []),
    ];

    const bodyWithoutLinks = body
      .replace(WIKILINK_GLOBAL_RE, " ")
      .replace(MDLINK_GLOBAL_RE, " ");
    const tags = [];
    for (const m of bodyWithoutLinks.matchAll(TAG_GLOBAL_RE)) {
      if (!tags.includes(m[1])) tags.push(m[1]);
    }

    const unrecognizedMetadata = [...(body.match(DATAVIEW_GLOBAL_RE) ?? [])];
    const blockMatch = body.match(BLOCK_ID_RE);
    if (blockMatch) unrecognizedMetadata.push(blockMatch[1]);

    const displayTitle = extractCleanDisplayTitle(body);

    tasks.push({
      id: `${relativePath}::L${lineNumber}::occ${occIdx}`,
      rawLine,
      relativePath,
      headingContext: currentHeading,
      anchor: {
        lineNumber,
        byteStart,
        byteEnd,
        fileHash,
        duplicateOccurrenceIndex: occIdx,
        contextBefore,
        contextAfter,
      },
      indent,
      nestingLevel,
      bulletMarker,
      checkboxChar,
      status,
      displayTitle,
      dueDate,
      hasInvalidDueDate,
      rawInvalidDueDate,
      scheduledDate,
      startDate,
      doneDate,
      createdDate,
      priority,
      recurrenceRule,
      isRecurring,
      isReadOnly,
      readOnlyReason,
      tags,
      links,
      unrecognizedMetadata,
      conflictInfo: null,
    });
  }

  return tasks;
}

export function patchTaskRawLine(rawLine, patch) {
  const m = rawLine.match(TASK_LINE_RE);
  if (!m) throw new Error("Baris sumber bukan format task Markdown yang valid");
  const [, indent, bullet, oldCheck, oldBody] = m;

  if (oldBody.includes("🔁")) {
    throw new Error(
      "Task berulang (🔁) bersifat baca-saja pada MVP untuk mencegah kerusakan jadwal recurrence."
    );
  }
  if (oldCheck !== " " && oldCheck !== "x" && oldCheck !== "X") {
    throw new Error(
      `Task dengan custom status '[${oldCheck}]' bersifat baca-saja.`
    );
  }

  let newCheck = oldCheck;
  let newBody = oldBody;

  if (patch.newStatus !== undefined && patch.newStatus !== null) {
    if (patch.newStatus === "todo") {
      newCheck = " ";
      newBody = newBody.replace(DONE_RE, "");
    } else if (patch.newStatus === "done") {
      newCheck = "x";
      if (!DONE_RE.test(newBody)) {
        const blockMatch = newBody.match(BLOCK_ID_RE);
        if (blockMatch) {
          const blockId = blockMatch[1];
          const withoutBlock = newBody.replace(BLOCK_ID_RE, "").trimEnd();
          newBody = `${withoutBlock} ✅ ${patch.todayLocal} ${blockId}`;
        } else {
          newBody = `${newBody.trimEnd()} ✅ ${patch.todayLocal}`;
        }
      }
    }
  }

  if (patch.newTitle !== undefined && patch.newTitle !== null) {
    const trimmed = patch.newTitle.trim();
    if (!trimmed) throw new Error("Judul task tidak boleh kosong.");
    newBody = replaceTitlePreservingMetadata(newBody, trimmed);
  }

  if (patch.newDueDate !== undefined) {
    if (patch.newDueDate === null) {
      newBody = newBody.replace(DUE_RE, "");
    } else {
      if (!isValidCalendarDateString(patch.newDueDate)) {
        throw new Error(`Tanggal tenggat tidak valid: ${patch.newDueDate}`);
      }
      if (DUE_RE.test(newBody)) {
        newBody = newBody.replace(DUE_RE, `📅 ${patch.newDueDate}`);
      } else {
        const blockMatch = newBody.match(BLOCK_ID_RE);
        if (blockMatch) {
          const blockId = blockMatch[1];
          const withoutBlock = newBody.replace(BLOCK_ID_RE, "").trimEnd();
          newBody = `${withoutBlock} 📅 ${patch.newDueDate} ${blockId}`;
        } else {
          newBody = `${newBody.trimEnd()} 📅 ${patch.newDueDate}`;
        }
      }
    }
  }

  const cleanedBody = newBody.replace(/\s+/g, " ").trim();
  return `${indent}${bullet} [${newCheck}] ${cleanedBody}`;
}

function replaceTitlePreservingMetadata(oldBody, newTitle) {
  const preserved = [];
  const newTitleWithoutLinks = newTitle.replace(MDLINK_GLOBAL_RE, " ");

  // Preserve wikilinks and markdown links if user did not re-type them
  for (const wl of oldBody.match(WIKILINK_GLOBAL_RE) ?? []) {
    if (!newTitle.includes(wl)) preserved.push(wl);
  }
  for (const ml of oldBody.match(MDLINK_GLOBAL_RE) ?? []) {
    if (!newTitle.includes(ml)) preserved.push(ml);
  }
  for (const m of oldBody.matchAll(TAG_GLOBAL_RE)) {
    const tag = m[1];
    if (!newTitleWithoutLinks.includes(tag) && !preserved.includes(tag)) {
      preserved.push(tag);
    }
  }
  for (const dm of oldBody.match(DATAVIEW_GLOBAL_RE) ?? []) {
    if (!newTitle.includes(dm)) preserved.push(dm);
  }
  for (const p of ["🔺", "⏫", "🔼", "🔽", "⏬"]) {
    if (oldBody.includes(p) && !newTitle.includes(p)) preserved.push(p);
  }
  for (const re of [CREATED_RE, START_RE, SCHEDULED_RE, DUE_RE, DONE_RE]) {
    const m = oldBody.match(re);
    if (m && !newTitle.includes(m[0])) preserved.push(m[0]);
  }
  const bMatch = oldBody.match(BLOCK_ID_RE);
  if (bMatch && !newTitle.includes(bMatch[1])) {
    preserved.push(bMatch[1]);
  }

  return preserved.length === 0
    ? newTitle
    : `${newTitle.trimEnd()} ${preserved.join(" ")}`;
}

const PRIORITY_RANK = {
  highest: 1,
  high: 2,
  medium: 3,
  none: 4,
  low: 5,
  lowest: 6,
};

export function sortTasks(tasks, sortBy = "deadline_asc") {
  const copy = [...tasks];
  const cmpSource = (a, b) => {
    const p = a.relativePath.localeCompare(b.relativePath);
    return p !== 0 ? p : a.anchor.lineNumber - b.anchor.lineNumber;
  };

  copy.sort((a, b) => {
    if (sortBy === "deadline_asc") {
      if (a.dueDate && b.dueDate) {
        const c = a.dueDate.localeCompare(b.dueDate);
        if (c !== 0) return c;
      } else if (a.dueDate && !b.dueDate) return -1;
      else if (!a.dueDate && b.dueDate) return 1;
      else if (a.hasInvalidDueDate !== b.hasInvalidDueDate) {
        return a.hasInvalidDueDate ? -1 : 1;
      }
      const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      return pr !== 0 ? pr : cmpSource(a, b);
    }
    if (sortBy === "deadline_desc") {
      if (a.dueDate && b.dueDate) {
        const c = b.dueDate.localeCompare(a.dueDate);
        if (c !== 0) return c;
      } else if (a.dueDate && !b.dueDate) return -1;
      else if (!a.dueDate && b.dueDate) return 1;
      const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      return pr !== 0 ? pr : cmpSource(a, b);
    }
    if (sortBy === "priority") {
      const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (pr !== 0) return pr;
      if (a.dueDate && b.dueDate) {
        const c = a.dueDate.localeCompare(b.dueDate);
        if (c !== 0) return c;
      }
      return cmpSource(a, b);
    }
    if (sortBy === "title_asc") {
      const c = a.displayTitle.localeCompare(b.displayTitle, "id", {
        sensitivity: "base",
      });
      return c !== 0 ? c : cmpSource(a, b);
    }
    return cmpSource(a, b);
  });
  return copy;
}

export function filterTasks(tasks, criteria) {
  const q = (criteria.searchQuery ?? "").trim().toLowerCase();
  return tasks.filter((t) => {
    if (
      criteria.fileFilter &&
      t.relativePath !== criteria.fileFilter &&
      !t.relativePath.startsWith(`${criteria.fileFilter}/`)
    ) {
      return false;
    }
    if (criteria.tagFilter && !t.tags.includes(criteria.tagFilter)) {
      return false;
    }
    if (q) {
      const hay = `${t.displayTitle} ${t.relativePath} ${
        t.headingContext ?? ""
      } ${t.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const done = t.status === "done";
    switch (criteria.preset) {
      case "all_active":
        return !done;
      case "completed":
        return done;
      case "overdue": {
        if (done || !t.dueDate) return false;
        const d = diffCalendarDays(t.dueDate, criteria.todayLocal);
        return d !== null && d < 0;
      }
      case "today": {
        if (done || !t.dueDate) return false;
        return diffCalendarDays(t.dueDate, criteria.todayLocal) === 0;
      }
      case "upcoming_7d": {
        if (done || !t.dueDate) return false;
        const d = diffCalendarDays(t.dueDate, criteria.todayLocal);
        return d !== null && d >= 0 && d <= 7;
      }
      case "no_deadline":
        return !done && t.dueDate === null;
      default:
        return true;
    }
  });
}

/**
 * Multi-anchor contextual locator & safe filesystem sync engine
 */
export class VaultSyncTestController {
  constructor(vaultRoot, backupRoot, customStatusMap = {}) {
    this.vaultRoot = path.resolve(vaultRoot);
    this.backupRoot = path.resolve(backupRoot);
    this.customStatusMap = customStatusMap;
    this.tasksByFile = new Map();
    this.fileHashes = new Map();
    this.selfWrites = new Map();
    this.undoStack = [];
    this.simulatedLockPaths = new Set();
    fs.mkdirSync(this.backupRoot, { recursive: true });
  }

  resolveSafePath(relativePath) {
    if (path.isAbsolute(relativePath)) {
      throw new Error("Path file harus relatif terhadap vault.");
    }
    const resolved = path.resolve(this.vaultRoot, relativePath);
    if (!resolved.startsWith(this.vaultRoot + path.sep)) {
      throw new Error("Path traversal keluar dari vault ditolak.");
    }
    if (!resolved.toLowerCase().endsWith(".md")) {
      throw new Error("Hanya file .md yang diizinkan.");
    }
    return resolved;
  }

  scanAllMarkdownFiles(dir = this.vaultRoot, prefix = "") {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanAllMarkdownFiles(full, rel));
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".md") &&
        !entry.name.endsWith(".bak.md")
      ) {
        results.push({ rel, full });
      }
    }
    results.sort((a, b) => a.rel.localeCompare(b.rel));
    return results;
  }

  fullIndex() {
    this.tasksByFile.clear();
    this.fileHashes.clear();
    for (const { rel, full } of this.scanAllMarkdownFiles()) {
      const content = fs.readFileSync(full, "utf8");
      this.fileHashes.set(rel, computeSha256(content));
      this.tasksByFile.set(
        rel,
        parseMarkdownTasks(rel, content, this.customStatusMap)
      );
    }
    return this.getAllTasks();
  }

  reindexSingleFile(relativePath) {
    const normRel = relativePath.replace(/\\/g, "/");
    const full = this.resolveSafePath(normRel);
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, "utf8");
      this.fileHashes.set(normRel, computeSha256(content));
      this.tasksByFile.set(
        normRel,
        parseMarkdownTasks(normRel, content, this.customStatusMap)
      );
    } else {
      this.fileHashes.delete(normRel);
      this.tasksByFile.delete(normRel);
    }
    return this.getAllTasks();
  }

  reconcileAfterResume() {
    const files = this.scanAllMarkdownFiles();
    const seen = new Set();
    let changed = false;

    for (const { rel, full } of files) {
      seen.add(rel);
      const content = fs.readFileSync(full, "utf8");
      const h = computeSha256(content);
      if (this.fileHashes.get(rel) !== h) {
        this.fileHashes.set(rel, h);
        this.tasksByFile.set(
          rel,
          parseMarkdownTasks(rel, content, this.customStatusMap)
        );
        changed = true;
      }
    }

    for (const oldKey of Array.from(this.tasksByFile.keys())) {
      if (!seen.has(oldKey)) {
        this.tasksByFile.delete(oldKey);
        this.fileHashes.delete(oldKey);
        changed = true;
      }
    }

    return { changed, tasks: this.getAllTasks() };
  }

  getAllTasks() {
    const keys = Array.from(this.tasksByFile.keys()).sort();
    const out = [];
    for (const k of keys) {
      out.push(...(this.tasksByFile.get(k) ?? []));
    }
    return out;
  }

  locateTaskLineIndex(lines, currentHash, originalRawLine, anchor) {
    const expectedIdx = anchor.lineNumber - 1;
    if (
      currentHash === anchor.fileHash &&
      lines[expectedIdx] === originalRawLine
    ) {
      return expectedIdx;
    }

    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === originalRawLine) candidates.push(i);
    }
    if (candidates.length === 0) {
      throw new Error(
        "Konflik terdeteksi: Baris task telah diubah atau dihapus oleh editor eksternal."
      );
    }
    if (candidates.length === 1) return candidates[0];

    let bestCandidates = [];
    let bestScore = 0;

    candidates.forEach((candIdx, occIdx) => {
      let score = 0;
      const bLen = anchor.contextBefore.length;
      if (bLen > 0 && candIdx >= bLen) {
        const slice = lines.slice(candIdx - bLen, candIdx);
        if (JSON.stringify(slice) === JSON.stringify(anchor.contextBefore)) {
          score += 10;
        }
      }
      const aLen = anchor.contextAfter.length;
      if (aLen > 0 && candIdx + 1 + aLen <= lines.length) {
        const slice = lines.slice(candIdx + 1, candIdx + 1 + aLen);
        if (JSON.stringify(slice) === JSON.stringify(anchor.contextAfter)) {
          score += 10;
        }
      }
      if (occIdx === anchor.duplicateOccurrenceIndex) {
        score += 5;
      }
      if (Math.abs(candIdx - expectedIdx) <= 5) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidates = [candIdx];
      } else if (score === bestScore) {
        bestCandidates.push(candIdx);
      }
    });

    if (bestCandidates.length === 1 && bestScore >= 5) {
      return bestCandidates[0];
    }
    throw new Error(
      "Konflik ambiguitas: Terdapat task duplikat identik dan konteks sekitar berubah bersamaan."
    );
  }

  createBackup(relativePath, content) {
    const safeName = relativePath.replace(/[\/\\:\s]/g, "_");
    const backupFile = path.join(
      this.backupRoot,
      `${safeName}__${Date.now()}.bak.md`
    );
    fs.writeFileSync(backupFile, content, "utf8");
    return backupFile;
  }

  atomicWriteWithRetry(fullPath, newContent, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.simulatedLockPaths.has(fullPath)) {
        if (this.onLockRetryHook) {
          this.onLockRetryHook(fullPath, attempt);
        }
        if (this.simulatedLockPaths.has(fullPath)) {
          if (attempt === maxAttempts) {
            throw new Error(
              `File terkunci setelah ${maxAttempts} percobaan: ${fullPath}`
            );
          }
          continue;
        }
      }
      const tmpPath = `${fullPath}.glasstasks_${process.pid}_${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, newContent, "utf8");
      fs.renameSync(tmpPath, fullPath);
      return;
    }
  }

  applyTaskPatch(req) {
    const fullPath = this.resolveSafePath(req.relativePath);
    const currentContent = fs.readFileSync(fullPath, "utf8");
    const currentHash = computeSha256(currentContent);
    const lineEnding = detectLineEnding(currentContent);
    const hasTrailingNewline =
      currentContent.endsWith("\r\n") || currentContent.endsWith("\n");

    const normalized = currentContent.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    if (hasTrailingNewline && lines[lines.length - 1] === "") {
      lines.pop();
    }

    let targetIdx;
    try {
      targetIdx = this.locateTaskLineIndex(
        lines,
        currentHash,
        req.originalRawLine,
        req.anchor
      );
    } catch (conflictErr) {
      this.reindexSingleFile(req.relativePath);
      return {
        success: false,
        syncStatus: "conflict",
        message: conflictErr.message,
        conflictDetected: true,
        updatedFileTasks: this.getAllTasks(),
      };
    }

    let patchedLine;
    try {
      patchedLine = patchTaskRawLine(lines[targetIdx], req);
    } catch (patchErr) {
      return {
        success: false,
        syncStatus: "save_failed",
        message: patchErr.message,
        conflictDetected: false,
        updatedFileTasks: this.getAllTasks(),
      };
    }

    this.createBackup(req.relativePath, currentContent);
    const beforeLine = lines[targetIdx];
    lines[targetIdx] = patchedLine;

    let newContent = lines.join(lineEnding);
    if (hasTrailingNewline) newContent += lineEnding;

    try {
      this.atomicWriteWithRetry(fullPath, newContent);
    } catch (writeErr) {
      return {
        success: false,
        syncStatus: "save_failed",
        message: writeErr.message,
        conflictDetected: false,
        updatedFileTasks: this.getAllTasks(),
      };
    }

    const newHash = computeSha256(newContent);
    this.selfWrites.set(req.relativePath, newHash);
    this.undoStack.unshift({
      relativePath: req.relativePath,
      lineNumber: targetIdx + 1,
      beforeLine,
      afterLine: patchedLine,
      fileHashAfterWrite: newHash,
    });

    return {
      success: true,
      syncStatus: "synced",
      message: "Tersinkron ke Obsidian",
      conflictDetected: false,
      updatedFileTasks: this.reindexSingleFile(req.relativePath),
    };
  }

  addNewTask(req) {
    const fullPath = this.resolveSafePath(req.relativePath);
    const exists = fs.existsSync(fullPath);
    if (!exists && !req.createFileApproved) {
      return {
        success: false,
        syncStatus: "save_failed",
        message: "NEEDS_CREATE_APPROVAL",
        conflictDetected: false,
        updatedFileTasks: this.getAllTasks(),
      };
    }

    const currentContent = exists ? fs.readFileSync(fullPath, "utf8") : "";
    if (exists) this.createBackup(req.relativePath, currentContent);
    else fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const parts = [`- [ ] ${req.title.trim()}`];
    if (req.dueDate) parts.push(`📅 ${req.dueDate}`);
    for (const t of req.tags ?? []) {
      const tag = t.startsWith("#") ? t : `#${t}`;
      if (!req.title.includes(tag)) parts.push(tag);
    }
    const newTaskLine = parts.join(" ");

    const lineEnding = currentContent ? detectLineEnding(currentContent) : "\n";
    const hasTrailingNewline =
      !currentContent ||
      currentContent.endsWith("\r\n") ||
      currentContent.endsWith("\n");

    const normalized = currentContent.replace(/\r\n/g, "\n");
    const lines = currentContent ? normalized.split("\n") : [];
    if (hasTrailingNewline && lines[lines.length - 1] === "") {
      lines.pop();
    }

    if (req.targetHeading) {
      const hIdx = lines.findIndex(
        (l) => l.trim() === req.targetHeading.trim()
      );
      if (hIdx >= 0) {
        let insertAt = hIdx + 1;
        while (
          insertAt < lines.length &&
          !lines[insertAt].trimStart().startsWith("#")
        ) {
          insertAt++;
        }
        while (insertAt > hIdx + 1 && lines[insertAt - 1].trim() === "") {
          insertAt--;
        }
        lines.splice(insertAt, 0, newTaskLine);
      } else {
        lines.push(newTaskLine);
      }
    } else {
      lines.push(newTaskLine);
    }

    let newContent = lines.join(lineEnding);
    if (hasTrailingNewline) newContent += lineEnding;

    this.atomicWriteWithRetry(fullPath, newContent);
    const newHash = computeSha256(newContent);
    this.selfWrites.set(req.relativePath, newHash);

    return {
      success: true,
      syncStatus: "synced",
      message: "Task ditambahkan",
      conflictDetected: false,
      updatedFileTasks: this.reindexSingleFile(req.relativePath),
    };
  }
}

/**
 * Multi-monitor & DPI safe window bounds recovery (matches src-tauri/src/window.rs)
 */
export function clampWindowBoundsToMonitors(bounds, monitors, primaryMonitor) {
  const width = Math.min(Math.max(bounds.width, 320), 1400);
  const height = Math.min(Math.max(bounds.height, 380), 1600);

  let visible = false;
  for (const m of monitors) {
    const right = m.x + m.width;
    const bottom = m.y + m.height;
    if (
      bounds.x + 120 > m.x &&
      bounds.x < right - 60 &&
      bounds.y >= m.y &&
      bounds.y < bottom - 80
    ) {
      visible = true;
      break;
    }
  }

  if (visible) {
    return { x: bounds.x, y: bounds.y, width, height, recovered: false };
  }

  const safeX =
    primaryMonitor.x + Math.max(40, primaryMonitor.width - width - 48);
  const safeY = primaryMonitor.y + 72;
  return { x: safeX, y: safeY, width, height, recovered: true };
}
