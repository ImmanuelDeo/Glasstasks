import {
  CheckboxStatus,
  FilterPreset,
  PriorityLevel,
  SortOption,
  TaskItem,
} from "../types/task";
import { diffCalendarDays } from "./dateUtils";

export function isTaskCompleted(status: CheckboxStatus): boolean {
  return status === "done";
}

export function isTaskActive(status: CheckboxStatus): boolean {
  return status !== "done";
}

export function priorityRank(priority: PriorityLevel): number {
  switch (priority) {
    case "highest":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 3;
    case "none":
      return 4;
    case "low":
      return 5;
    case "lowest":
      return 6;
  }
}

export function compareByStableSource(a: TaskItem, b: TaskItem): number {
  const pathCmp = a.relativePath.localeCompare(b.relativePath);
  if (pathCmp !== 0) return pathCmp;
  return a.anchor.lineNumber - b.anchor.lineNumber;
}

/**
 * Sorts tasks according to Section F specification:
 * Default active order ("deadline_asc"):
 * 1. All tasks with valid due dates sorted ascending (overdue automatically before today & upcoming).
 * 2. Tasks with invalid due dates (surfaced visibly so user can fix them) or no due date after dated tasks.
 * 3. Tie-breaker: Priority rank (🔺 -> ⏫ -> 🔼 -> none -> 🔽 -> ⏬), then stable source order (file + line).
 */
export function sortTasks(tasks: TaskItem[], sortBy: SortOption): TaskItem[] {
  const copy = [...tasks];

  copy.sort((a, b) => {
    switch (sortBy) {
      case "deadline_asc": {
        const aHasDate = a.dueDate !== null;
        const bHasDate = b.dueDate !== null;

        if (aHasDate && bHasDate) {
          const cmp = a.dueDate!.localeCompare(b.dueDate!);
          if (cmp !== 0) return cmp;
        } else if (aHasDate && !bHasDate) {
          return -1;
        } else if (!aHasDate && bHasDate) {
          return 1;
        } else if (a.hasInvalidDueDate !== b.hasInvalidDueDate) {
          // Surface invalid dates before plain undated tasks so they don't hide silently
          return a.hasInvalidDueDate ? -1 : 1;
        }

        const pCmp = priorityRank(a.priority) - priorityRank(b.priority);
        if (pCmp !== 0) return pCmp;
        return compareByStableSource(a, b);
      }

      case "deadline_desc": {
        const aHasDate = a.dueDate !== null;
        const bHasDate = b.dueDate !== null;

        if (aHasDate && bHasDate) {
          const cmp = b.dueDate!.localeCompare(a.dueDate!);
          if (cmp !== 0) return cmp;
        } else if (aHasDate && !bHasDate) {
          return -1;
        } else if (!aHasDate && bHasDate) {
          return 1;
        }

        const pCmp = priorityRank(a.priority) - priorityRank(b.priority);
        if (pCmp !== 0) return pCmp;
        return compareByStableSource(a, b);
      }

      case "priority": {
        const pCmp = priorityRank(a.priority) - priorityRank(b.priority);
        if (pCmp !== 0) return pCmp;
        if (a.dueDate && b.dueDate) {
          const dCmp = a.dueDate.localeCompare(b.dueDate);
          if (dCmp !== 0) return dCmp;
        } else if (a.dueDate && !b.dueDate) {
          return -1;
        } else if (!a.dueDate && b.dueDate) {
          return 1;
        }
        return compareByStableSource(a, b);
      }

      case "source": {
        return compareByStableSource(a, b);
      }

      case "title_asc": {
        const tCmp = a.displayTitle.localeCompare(b.displayTitle, "id", {
          sensitivity: "base",
        });
        if (tCmp !== 0) return tCmp;
        return compareByStableSource(a, b);
      }
    }
  });

  return copy;
}

export interface TaskFilterCriteria {
  preset: FilterPreset;
  searchQuery: string;
  fileFilter: string | null;
  tagFilter: string | null;
  todayLocal: string;
}

/**
 * Filters tasks by preset, file/folder, tag, and search query.
 * Note on "upcoming_7d" ("Tujuh hari ke depan"):
 * Includes active tasks whose dueDate is within the inclusive calendar window [todayLocal .. todayLocal + 7 days]
 * (i.e. 0 <= diffCalendarDays <= 7).
 */
export function filterTasks(
  tasks: TaskItem[],
  criteria: TaskFilterCriteria
): TaskItem[] {
  const q = criteria.searchQuery.trim().toLowerCase();

  return tasks.filter((t) => {
    // 1. File or folder filter
    if (criteria.fileFilter) {
      if (
        t.relativePath !== criteria.fileFilter &&
        !t.relativePath.startsWith(`${criteria.fileFilter}/`)
      ) {
        return false;
      }
    }

    // 2. Tag filter
    if (criteria.tagFilter) {
      if (!t.tags.includes(criteria.tagFilter)) {
        return false;
      }
    }

    // 3. Search query across displayTitle, rawLine, relativePath, headingContext, and tags
    if (q.length > 0) {
      const hay = [
        t.displayTitle,
        t.relativePath,
        t.headingContext ?? "",
        t.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) {
        return false;
      }
    }

    // 4. Preset filter
    const completed = isTaskCompleted(t.status);
    switch (criteria.preset) {
      case "all_active":
        return !completed;

      case "completed":
        return completed;

      case "overdue": {
        if (completed || !t.dueDate) return false;
        const diff = diffCalendarDays(t.dueDate, criteria.todayLocal);
        return diff !== null && diff < 0;
      }

      case "today": {
        if (completed || !t.dueDate) return false;
        const diff = diffCalendarDays(t.dueDate, criteria.todayLocal);
        return diff === 0;
      }

      case "upcoming_7d": {
        if (completed || !t.dueDate) return false;
        const diff = diffCalendarDays(t.dueDate, criteria.todayLocal);
        return diff !== null && diff >= 0 && diff <= 7;
      }

      case "no_deadline":
        return !completed && t.dueDate === null;
    }
  });
}
