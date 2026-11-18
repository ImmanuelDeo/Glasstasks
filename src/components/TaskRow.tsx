import React, { useState } from "react";
import {
  Calendar,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Repeat,
  Trash2,
  Edit3,
  Copy,
  AlertCircle,
  Check,
  X,
} from "lucide-react";
import { TaskItem } from "../types/task";
import { formatDeadlineBadge } from "../core/dateUtils";

interface TaskRowProps {
  task: TaskItem;
  todayLocal: string;
  density: "compact" | "comfortable";
  hasSubtasksBelow: boolean;
  onToggleStatus: (task: TaskItem) => void;
  onSaveTitle: (task: TaskItem, newTitle: string) => void;
  onSaveDueDate: (task: TaskItem, newDueDate: string | null) => void;
  onOpenInObsidian: (task: TaskItem) => void;
  onRequestDelete: (task: TaskItem, hasSubtasksBelow: boolean) => void;
}

const PRIORITY_BADGE: Record<string, { icon: string; label: string } | null> = {
  highest: { icon: "🔺", label: "Prioritas Tertinggi" },
  high: { icon: "⏫", label: "Prioritas Tinggi" },
  medium: { icon: "🔼", label: "Prioritas Menengah" },
  none: null,
  low: { icon: "🔽", label: "Prioritas Rendah" },
  lowest: { icon: "⏬", label: "Prioritas Terendah" },
};

export const TaskRow: React.FC<TaskRowProps> = ({
  task,
  todayLocal,
  density,
  hasSubtasksBelow,
  onToggleStatus,
  onSaveTitle,
  onSaveDueDate,
  onOpenInObsidian,
  onRequestDelete,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.displayTitle);
  const [isPickingDate, setIsPickingDate] = useState(false);
  const [draftDate, setDraftDate] = useState(task.dueDate ?? "");
  const [menuOpen, setMenuOpen] = useState(false);

  const isDone = task.status === "done";
  const badge = formatDeadlineBadge(
    task.dueDate,
    task.hasInvalidDueDate,
    task.rawInvalidDueDate,
    todayLocal
  );
  const prio = PRIORITY_BADGE[task.priority];

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draftTitle.trim() && draftTitle.trim() !== task.displayTitle) {
        onSaveTitle(task, draftTitle.trim());
      }
      setIsEditingTitle(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraftTitle(task.displayTitle);
      setIsEditingTitle(false);
    }
  };

  const handleDateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftDate.trim();
    onSaveDueDate(task, cleaned.length > 0 ? cleaned : null);
    setIsPickingDate(false);
  };

  const badgeToneClass = {
    overdue: "bg-rose-500/20 text-rose-300 border-rose-400/35",
    today: "bg-amber-500/20 text-amber-200 border-amber-400/35",
    tomorrow: "bg-sky-500/20 text-sky-200 border-sky-400/35",
    upcoming: "bg-slate-500/20 text-slate-300 border-white/10",
    invalid: "bg-rose-600/30 text-rose-200 border-rose-400/60",
    none: "bg-white/5 text-slate-400 border-white/10 opacity-0 group-hover:opacity-100 focus:opacity-100",
  }[badge.tone];

  return (
    <div
      className={`glass-row group relative flex flex-col ${
        density === "compact" ? "px-2.5 py-1.5" : "px-3 py-2.5"
      }`}
      style={{ marginLeft: `${Math.min(task.nestingLevel, 4) * 14}px` }}
    >
      <div className="flex items-start gap-2.5">
        {/* Checkbox or Read-Only Indicator */}
        <button
          type="button"
          onClick={() => !task.isReadOnly && onToggleStatus(task)}
          disabled={task.isReadOnly}
          aria-label={
            task.isReadOnly
              ? task.readOnlyReason ?? "Task baca-saja"
              : isDone
              ? `Buka kembali task ${task.displayTitle}`
              : `Selesaikan task ${task.displayTitle}`
          }
          title={
            task.isReadOnly
              ? task.readOnlyReason ?? "Baca-saja"
              : isDone
              ? "Klik untuk membuka kembali"
              : "Klik untuk menyelesaikan"
          }
          className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition ${
            task.isReadOnly
              ? "border-amber-400/40 bg-amber-500/10 text-amber-300 cursor-not-allowed"
              : isDone
              ? "bg-sky-400 border-sky-400 text-slate-950"
              : "border-slate-400/60 hover:border-sky-400 bg-transparent"
          }`}
        >
          {task.isReadOnly ? (
            <Lock className="w-2.5 h-2.5" />
          ) : isDone ? (
            <Check className="w-3 h-3 stroke-[3]" />
          ) : null}
        </button>

        {/* Title & Metadata Area */}
        <div className="flex-1 min-w-0">
          {isEditingTitle ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                className="w-full rounded bg-slate-900/90 border border-sky-400/60 px-2 py-0.5 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => {
                  if (draftTitle.trim()) onSaveTitle(task, draftTitle.trim());
                  setIsEditingTitle(false);
                }}
                className="p-1 text-emerald-400 hover:text-emerald-300"
                title="Simpan (Enter)"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(task.displayTitle);
                  setIsEditingTitle(false);
                }}
                className="p-1 text-slate-400 hover:text-white"
                title="Batal (Escape)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!task.isReadOnly) {
                    setDraftTitle(task.displayTitle);
                    setIsEditingTitle(true);
                  }
                }}
                className={`text-left text-xs leading-snug break-words flex-1 ${
                  isDone ? "line-through opacity-55" : "font-medium"
                }`}
                title={
                  task.isReadOnly
                    ? task.readOnlyReason ?? "Task baca-saja"
                    : "Klik untuk mengedit judul task"
                }
              >
                {prio && (
                  <span className="mr-1" title={prio.label}>
                    {prio.icon}
                  </span>
                )}
                {task.displayTitle}
              </button>

              {/* Deadline Badge */}
              <button
                type="button"
                onClick={() => {
                  if (!task.isReadOnly) {
                    setDraftDate(task.dueDate ?? todayLocal);
                    setIsPickingDate((v) => !v);
                  }
                }}
                title={badge.tooltip}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 transition ${badgeToneClass}`}
              >
                {badge.tone === "invalid" ? (
                  <AlertCircle className="w-2.5 h-2.5" />
                ) : (
                  <Calendar className="w-2.5 h-2.5" />
                )}
                <span>{badge.label}</span>
              </button>
            </div>
          )}

          {/* Sub-row: Source file/heading, Tags, Recurrence, ReadOnly badge */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] opacity-75">
            <button
              type="button"
              onClick={() => onOpenInObsidian(task)}
              className="inline-flex items-center gap-0.5 hover:underline text-sky-400"
              title={`Buka ${task.relativePath} di Obsidian (Baris ${task.anchor.lineNumber})`}
            >
              <span className="truncate max-w-[140px]">
                {task.relativePath.replace(/\.md$/i, "")}
              </span>
              {task.headingContext && (
                <span className="opacity-75 truncate max-w-[90px]">
                  › {task.headingContext.replace(/^#+\s*/, "")}
                </span>
              )}
              <ExternalLink className="w-2.5 h-2.5 ml-0.5 shrink-0" />
            </button>

            {task.isRecurring && (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-purple-500/20 border border-purple-400/30 px-1.5 py-0.2 text-purple-200"
                title={task.readOnlyReason ?? "Task berulang (Baca-saja)"}
              >
                <Repeat className="w-2.5 h-2.5" />
                <span>{task.recurrenceRule ?? "Berulang"}</span>
              </span>
            )}

            {typeof task.status === "object" && "custom" in task.status && (
              <span
                className="rounded bg-amber-500/20 border border-amber-400/30 px-1.5 text-amber-200"
                title={task.readOnlyReason ?? "Custom status baca-saja"}
              >
                Status [{task.status.custom}] (Baca-saja)
              </span>
            )}

            {task.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-sky-500/15 px-1.5 text-sky-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Overflow Action Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu aksi task"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-white/10 transition"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              className="absolute right-0 top-6 z-30 w-44 rounded-xl border border-white/15 bg-slate-900/95 p-1 text-xs text-slate-100 shadow-xl backdrop-blur-lg"
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenInObsidian(task);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-left"
              >
                <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                <span>Buka di Obsidian</span>
              </button>

              {!task.isReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraftTitle(task.displayTitle);
                    setIsEditingTitle(true);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-left"
                >
                  <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Edit Judul</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(task.rawLine);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-left"
              >
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Salin Baris Markdown</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRequestDelete(task, hasSubtasksBelow);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/20 text-rose-300 text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Task...</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Date Picker Popover */}
      {isPickingDate && !task.isReadOnly && (
        <form
          onSubmit={handleDateSubmit}
          className="mt-2 flex items-center justify-between gap-1.5 rounded-lg border border-white/15 bg-slate-900/90 px-2.5 py-1.5 text-xs"
        >
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="rounded bg-slate-800 border border-white/10 px-2 py-0.5 text-xs text-white"
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onSaveDueDate(task, todayLocal);
                setIsPickingDate(false);
              }}
              className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-[11px]"
            >
              Hari Ini
            </button>
            {task.dueDate && (
              <button
                type="button"
                onClick={() => {
                  onSaveDueDate(task, null);
                  setIsPickingDate(false);
                }}
                className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 text-[11px]"
              >
                Hapus
              </button>
            )}
            <button
              type="submit"
              className="px-2.5 py-0.5 rounded bg-sky-400 text-slate-950 font-semibold text-[11px]"
            >
              Simpan
            </button>
            <button
              type="button"
              onClick={() => setIsPickingDate(false)}
              className="p-0.5 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
