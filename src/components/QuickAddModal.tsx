import React, { useState } from "react";
import { Plus, X, FileText, Calendar, Hash, AlertTriangle } from "lucide-react";
import { NewTaskRequest } from "../types/task";

interface QuickAddModalProps {
  availableFiles: string[];
  defaultTargetFile: string;
  todayLocal: string;
  onAdd: (req: NewTaskRequest) => Promise<{ needsCreateApproval?: boolean }>;
  onClose: () => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  availableFiles,
  defaultTargetFile,
  todayLocal,
  onAdd,
  onClose,
}) => {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<string>(todayLocal);
  const [tagsInput, setTagsInput] = useState("");
  const [targetFile, setTargetFile] = useState(
    defaultTargetFile || availableFiles[0] || "Tasks.md"
  );
  const [targetHeading, setTargetHeading] = useState("");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    const parsedTags = tagsInput
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const res = await onAdd({
      relativePath: targetFile.trim() || "Tasks.md",
      title: title.trim(),
      dueDate: dueDate.trim() || null,
      tags: parsedTags,
      targetHeading: targetHeading.trim() || null,
      createFileApproved: needsApproval,
    });
    setSubmitting(false);

    if (res.needsCreateApproval) {
      setNeedsApproval(true);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-slate-950/60 pt-14 px-3 backdrop-blur-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sky-300 flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            Tambah Task ke Obsidian
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <input
          type="text"
          autoFocus
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Judul task... (mis. Menyelesaikan revisi proposal)"
          className="w-full rounded-lg bg-slate-800 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-slate-400"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="flex items-center gap-1 text-[11px] text-slate-300 mb-1">
              <Calendar className="w-3 h-3 text-sky-400" />
              Deadline (📅)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-xs text-white"
            />
          </div>

          <div>
            <label className="flex items-center gap-1 text-[11px] text-slate-300 mb-1">
              <Hash className="w-3 h-3 text-sky-400" />
              Tag (opsional)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="#kuliah #project"
              className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-xs text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="flex items-center gap-1 text-[11px] text-slate-300 mb-1">
              <FileText className="w-3 h-3 text-sky-400" />
              File Tujuan (.md)
            </label>
            <input
              list="vault-files-datalist"
              value={targetFile}
              onChange={(e) => {
                setTargetFile(e.target.value);
                setNeedsApproval(false);
              }}
              className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-xs text-white"
            />
            <datalist id="vault-files-datalist">
              {availableFiles.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-[11px] text-slate-300 mb-1">
              Heading Tujuan (opsional)
            </label>
            <input
              type="text"
              value={targetHeading}
              onChange={(e) => setTargetHeading(e.target.value)}
              placeholder="Contoh: ## Tugas"
              className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-xs text-white"
            />
          </div>
        </div>

        {needsApproval && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-950/50 p-2.5 text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              File <strong>{targetFile}</strong> belum ada di dalam vault. Klik{" "}
              <strong>Setujui & Buat File</strong> di bawah untuk membuat file
              baru dan menyimpan task ini.
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
          >
            Batal (Esc)
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-3.5 py-1.5 rounded-lg bg-sky-400 font-semibold text-slate-950 hover:bg-sky-300"
          >
            {needsApproval ? "Setujui & Buat File" : "Simpan (Enter)"}
          </button>
        </div>
      </form>
    </div>
  );
};
