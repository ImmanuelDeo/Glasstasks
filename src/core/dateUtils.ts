/**
 * Local calendar date utilities for GlassTasks.
 * Strictly avoids UTC conversion drift by operating on local (year, month, day) components.
 */

export function getTodayLocalDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidCalendarDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yStr, mStr, dStr] = dateStr.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const constructed = new Date(year, month - 1, day);
  return (
    constructed.getFullYear() === year &&
    constructed.getMonth() === month - 1 &&
    constructed.getDate() === day
  );
}

/**
 * Returns integer day difference: (targetDate - todayLocal) in calendar days.
 * Negative = overdue, 0 = today, +1 = tomorrow, >1 = upcoming.
 */
export function diffCalendarDays(
  dueDateStr: string,
  todayLocalStr: string
): number | null {
  if (
    !isValidCalendarDateString(dueDateStr) ||
    !isValidCalendarDateString(todayLocalStr)
  ) {
    return null;
  }
  const [y1, m1, d1] = dueDateStr.split("-").map(Number);
  const [y0, m0, d0] = todayLocalStr.split("-").map(Number);

  // Use UTC noon of local components solely for exact integer day subtraction without DST shift
  const utc1 = Date.UTC(y1, m1 - 1, d1, 12, 0, 0);
  const utc0 = Date.UTC(y0, m0 - 1, d0, 12, 0, 0);
  return Math.round((utc1 - utc0) / 86_400_000);
}

export interface RelativeDeadlineBadge {
  label: string;
  tone: "overdue" | "today" | "tomorrow" | "upcoming" | "invalid" | "none";
  tooltip: string;
  dayDiff: number | null;
}

export function formatDeadlineBadge(
  dueDate: string | null,
  hasInvalidDueDate: boolean,
  rawInvalidDueDate: string | null,
  todayLocalStr: string
): RelativeDeadlineBadge {
  if (hasInvalidDueDate) {
    return {
      label: `Tanggal tidak valid (${rawInvalidDueDate ?? "?"})`,
      tone: "invalid",
      tooltip: `Format kalender tidak valid pada catatan sumber: ${rawInvalidDueDate ?? ""}`,
      dayDiff: null,
    };
  }

  if (!dueDate) {
    return {
      label: "Tanpa tenggat",
      tone: "none",
      tooltip: "Klik untuk menetapkan tenggat waktu (📅 YYYY-MM-DD)",
      dayDiff: null,
    };
  }

  const diff = diffCalendarDays(dueDate, todayLocalStr);
  if (diff === null) {
    return {
      label: `Tanggal tidak valid (${dueDate})`,
      tone: "invalid",
      tooltip: `Tanggal tidak valid: ${dueDate}`,
      dayDiff: null,
    };
  }

  const absoluteFormatted = formatIndonesianLongDate(dueDate);

  if (diff < 0) {
    const daysLate = Math.abs(diff);
    return {
      label: `Terlambat ${daysLate} hari`,
      tone: "overdue",
      tooltip: `Tenggat: ${dueDate} (${absoluteFormatted}) — Terlambat ${daysLate} hari`,
      dayDiff: diff,
    };
  }
  if (diff === 0) {
    return {
      label: "Hari ini",
      tone: "today",
      tooltip: `Tenggat hari ini: ${dueDate} (${absoluteFormatted})`,
      dayDiff: 0,
    };
  }
  if (diff === 1) {
    return {
      label: "Besok",
      tone: "tomorrow",
      tooltip: `Tenggat besok: ${dueDate} (${absoluteFormatted})`,
      dayDiff: 1,
    };
  }
  return {
    label: `Dalam ${diff} hari`,
    tone: "upcoming",
    tooltip: `Tenggat: ${dueDate} (${absoluteFormatted}) — Dalam ${diff} hari`,
    dayDiff: diff,
  };
}

const INDONESIAN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

export function formatIndonesianLongDate(dateStr: string): string {
  if (!isValidCalendarDateString(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${INDONESIAN_MONTHS[m - 1]} ${y}`;
}
