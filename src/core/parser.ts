import {
  CheckboxStatus,
  PriorityLevel,
  TaskItem,
  TaskPatchRequest,
} from "../types/task";
import { isValidCalendarDateString } from "./dateUtils";

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

export function simpleHash(content: string): string {
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function parseMarkdownTasksTS(
  relativePath: string,
  content: string,
  customStatusMap: Record<string, string> = {}
): TaskItem[] {
  const fileHash = simpleHash(content);
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");
  if (content.endsWith("\n") && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const tasks: TaskItem[] = [];
  let inCodeFence = false;
  let fenceChar = "";
  let currentHeading: string | null = null;
  const occurrenceCounter = new Map<string, number>();
  let byteCursor = 0;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const rawLine = rawLines[idx];
    const lineNumber = idx + 1;
    const byteStart = byteCursor;
    const byteEnd = byteCursor + rawLine.length;
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

    const indent = taskMatch[1];
    const bulletMarker = taskMatch[2];
    const checkboxChar = taskMatch[3];
    const body = taskMatch[4];

    const indentSpaces = Array.from(indent).reduce(
      (acc, c) => acc + (c === "\t" ? 2 : 1),
      0
    );
    const nestingLevel = Math.floor(indentSpaces / 2);

    const occIdx = occurrenceCounter.get(rawLine) ?? 0;
    occurrenceCounter.set(rawLine, occIdx + 1);

    const contextBefore: string[] = [];
    if (idx >= 2) contextBefore.push(rawLines[idx - 2]);
    if (idx >= 1) contextBefore.push(rawLines[idx - 1]);
    const contextAfter: string[] = [];
    if (idx + 1 < rawLines.length) contextAfter.push(rawLines[idx + 1]);
    if (idx + 2 < rawLines.length) contextAfter.push(rawLines[idx + 2]);

    let status: CheckboxStatus;
    let isReadOnly = false;
    let readOnlyReason: string | null = null;

    if (checkboxChar === " ") {
      status = "todo";
    } else if (checkboxChar === "x" || checkboxChar === "X") {
      status = "done";
    } else {
      const mapped = customStatusMap[checkboxChar];
      if (mapped === "todo") {
        status = "todo";
      } else if (mapped === "done") {
        status = "done";
      } else {
        status = { custom: checkboxChar };
        isReadOnly = true;
        readOnlyReason = `Custom checkbox '[${checkboxChar}]' belum dipetakan; ditampilkan baca-saja`;
      }
    }

    let dueDate: string | null = null;
    let hasInvalidDueDate = false;
    let rawInvalidDueDate: string | null = null;
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
    let recurrenceRule: string | null = null;
    if (body.includes("🔁")) {
      isRecurring = true;
      const rMatch = body.match(RECURRENCE_RE);
      const rText = rMatch?.[1]?.trim() ?? "";
      recurrenceRule = rText ? `🔁 ${rText}` : "🔁";
      isReadOnly = true;
      readOnlyReason =
        "Task berulang (🔁) bersifat baca-saja pada MVP agar tidak merusak aturan recurrence Obsidian Tasks";
    }

    let priority: PriorityLevel = "none";
    if (body.includes("🔺")) priority = "highest";
    else if (body.includes("⏫")) priority = "high";
    else if (body.includes("🔼")) priority = "medium";
    else if (body.includes("🔽")) priority = "low";
    else if (body.includes("⏬")) priority = "lowest";

    const links: string[] = [
      ...(body.match(WIKILINK_GLOBAL_RE) ?? []),
      ...(body.match(MDLINK_GLOBAL_RE) ?? []),
    ];

    const bodyWithoutLinks = body
      .replace(WIKILINK_GLOBAL_RE, " ")
      .replace(MDLINK_GLOBAL_RE, " ");
    const tags: string[] = [];
    for (const m of bodyWithoutLinks.matchAll(TAG_GLOBAL_RE)) {
      if (!tags.includes(m[1])) tags.push(m[1]);
    }

    const unrecognizedMetadata: string[] = [
      ...(body.match(DATAVIEW_GLOBAL_RE) ?? []),
    ];
    const blockMatch = body.match(BLOCK_ID_RE);
    if (blockMatch) unrecognizedMetadata.push(blockMatch[1]);

    const displayTitle = extractCleanDisplayTitleTS(body);

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

export function extractCleanDisplayTitleTS(body: string): string {
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

export function patchTaskRawLineTS(
  rawLine: string,
  patch: TaskPatchRequest
): string {
  const m = rawLine.match(TASK_LINE_RE);
  if (!m) {
    throw new Error("Baris sumber bukan format task Markdown yang valid");
  }
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
    newBody = replaceTitlePreservingMetadataTS(newBody, trimmed);
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

function replaceTitlePreservingMetadataTS(
  oldBody: string,
  newTitle: string
): string {
  const preserved: string[] = [];
  const newTitleWithoutLinks = newTitle.replace(MDLINK_GLOBAL_RE, " ");

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
