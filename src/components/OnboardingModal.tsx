import React, { useState } from "react";
import {
  FolderOpen,
  FileText,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { SourceScopeMode, TaskItem, VaultConfig } from "../types/task";
import {
  listVaultMarkdownFiles,
  pickVaultDirectory,
  previewVaultScope,
} from "../services/tauriBridge";

interface OnboardingModalProps {
  initialConfig: VaultConfig | null;
  onComplete: (config: VaultConfig) => Promise<void>;
  onCancel?: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  initialConfig,
  onComplete,
  onCancel,
}) => {
  const [vaultPath, setVaultPath] = useState(initialConfig?.vaultPath ?? "");
  const [vaultName, setVaultName] = useState(initialConfig?.vaultName ?? "");
  const [scopeMode, setScopeMode] = useState<SourceScopeMode>(
    initialConfig?.scopeMode ?? "single_file"
  );
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>(
    initialConfig?.selectedFiles ?? []
  );
  const [selectedFolder, setSelectedFolder] = useState<string>(
    initialConfig?.selectedFolder ?? ""
  );
  const [defaultTargetFile, setDefaultTargetFile] = useState<string>(
    initialConfig?.defaultTargetFile ?? "Tasks.md"
  );
  const [previewData, setPreviewData] = useState<{
    fileCount: number;
    taskCount: number;
    sampleTasks: TaskItem[];
    defaultTargetExists: boolean;
  } | null>(null);
  const [confirmNewTargetFile, setConfirmNewTargetFile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBrowseVault = async () => {
    setError(null);
    const chosen = await pickVaultDirectory();
    if (chosen) {
      await loadVaultFiles(chosen);
    }
  };

  const loadVaultFiles = async (pathStr: string) => {
    setLoading(true);
    setError(null);
    try {
      setVaultPath(pathStr);
      const parts = pathStr.replace(/\\/g, "/").split("/").filter(Boolean);
      const inferredName = parts[parts.length - 1] || "ObsidianVault";
      setVaultName(inferredName);

      const files = await listVaultMarkdownFiles(pathStr);
      setAvailableFiles(files);
      if (files.length > 0 && selectedFiles.length === 0) {
        setSelectedFiles([files[0]]);
        setDefaultTargetFile(files[0]);
      }
      setPreviewData(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const buildCurrentConfig = (demo = false): VaultConfig => ({
    vaultPath: demo ? "DEMO_VAULT" : vaultPath.trim(),
    vaultName: demo ? "DemoVault" : vaultName.trim() || "Vault",
    scopeMode: demo ? "whole_vault" : scopeMode,
    selectedFiles,
    selectedFolder: selectedFolder.trim() || null,
    defaultTargetFile: demo
      ? "Kuliah & Riset.md"
      : defaultTargetFile.trim() || "Tasks.md",
    demoMode: demo,
  });

  const handleRunPreview = async () => {
    setError(null);
    if (!vaultPath.trim()) {
      setError("Silakan pilih atau masukkan path folder vault Obsidian terlebih dahulu.");
      return;
    }
    if (
      (scopeMode === "single_file" || scopeMode === "multiple_files") &&
      selectedFiles.length === 0
    ) {
      setError("Pilih minimal satu file Markdown sebagai sumber task.");
      return;
    }
    setLoading(true);
    try {
      const cfg = buildCurrentConfig(false);
      const res = await previewVaultScope(cfg);
      setPreviewData(res);
      setConfirmNewTargetFile(res.defaultTargetExists);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleActivateVault = async () => {
    if (!previewData) {
      await handleRunPreview();
      return;
    }
    if (!previewData.defaultTargetExists && !confirmNewTargetFile) {
      setError(
        `File tujuan default '${defaultTargetFile}' belum ada di vault. Centang persetujuan pembuatan file terlebih dahulu.`
      );
      return;
    }
    setLoading(true);
    try {
      await onComplete(buildCurrentConfig(false));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleStartDemoMode = async () => {
    setLoading(true);
    try {
      await onComplete(buildCurrentConfig(true));
    } finally {
      setLoading(false);
    }
  };

  const toggleFileSelection = (rel: string) => {
    if (scopeMode === "single_file") {
      setSelectedFiles([rel]);
      setDefaultTargetFile(rel);
      setPreviewData(null);
      return;
    }
    setSelectedFiles((prev) =>
      prev.includes(rel) ? prev.filter((x) => x !== rel) : [...prev, rel]
    );
    setPreviewData(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="w-full max-w-md max-h-[92vh] flex flex-col rounded-2xl border border-white/15 bg-slate-900/95 text-slate-100 shadow-2xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-sky-400" />
            <h2 id="onboarding-title" className="text-sm font-semibold tracking-wide">
              Konfigurasi Sumber Vault Obsidian
            </h2>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded"
            >
              Tutup
            </button>
          )}
        </div>

        <div className="p-4 space-y-4 overflow-y-auto text-xs flex-1 task-list-scroll">
          {/* Step 1: Select Vault Folder */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-200">
              1. Pilih Folder Vault Obsidian (Source of Truth)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={vaultPath}
                onChange={(e) => {
                  setVaultPath(e.target.value);
                  setPreviewData(null);
                }}
                placeholder="Contoh: C:\Users\Nama\Documents\ObsidianVault"
                className="flex-1 rounded-lg bg-slate-800/90 border border-white/10 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={handleBrowseVault}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/20 border border-sky-400/40 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/30"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Pilih Folder
              </button>
            </div>
            {vaultPath && availableFiles.length === 0 && (
              <button
                type="button"
                onClick={() => loadVaultFiles(vaultPath)}
                className="text-[11px] text-sky-400 underline hover:text-sky-300"
              >
                Muat daftar file Markdown dari path di atas
              </button>
            )}
          </div>

          {/* Step 2: Scope Selection */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-200">
              2. Ruang Lingkup Sumber Task
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: "single_file", label: "Satu File Markdown" },
                  { id: "multiple_files", label: "Beberapa File" },
                  { id: "folder", label: "Folder Tertentu" },
                  { id: "whole_vault", label: "Seluruh Vault (Lanjutan)" },
                ] as { id: SourceScopeMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setScopeMode(opt.id);
                    setPreviewData(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                    scopeMode === opt.id
                      ? "border-sky-400 bg-sky-500/20 text-white font-medium"
                      : "border-white/10 bg-slate-800/60 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {opt.id === "whole_vault" ? (
                    <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  )}
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* File or Folder details */}
          {(scopeMode === "single_file" || scopeMode === "multiple_files") &&
            availableFiles.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] text-slate-300">
                  Pilih file sumber ({selectedFiles.length} dipilih):
                </span>
                <div className="max-h-28 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/60 p-1.5 space-y-1 task-list-scroll">
                  {availableFiles.map((f) => (
                    <label
                      key={f}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer"
                    >
                      <input
                        type={scopeMode === "single_file" ? "radio" : "checkbox"}
                        checked={selectedFiles.includes(f)}
                        onChange={() => toggleFileSelection(f)}
                      />
                      <span className="truncate text-slate-200">{f}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

          {scopeMode === "folder" && (
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-300">
                Sub-folder di dalam Vault (relatif):
              </label>
              <input
                type="text"
                value={selectedFolder}
                onChange={(e) => {
                  setSelectedFolder(e.target.value);
                  setPreviewData(null);
                }}
                placeholder="Contoh: Proyek/Kuliah"
                className="w-full rounded-lg bg-slate-800/90 border border-white/10 px-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>
          )}

          {/* Step 3: Default Target File */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-200">
              3. File Tujuan Default untuk Task Baru
            </label>
            <input
              type="text"
              value={defaultTargetFile}
              onChange={(e) => {
                setDefaultTargetFile(e.target.value);
                setPreviewData(null);
              }}
              placeholder="Contoh: Tasks.md"
              className="w-full rounded-lg bg-slate-800/90 border border-white/10 px-2.5 py-1.5 text-xs text-slate-100"
            />
            <p className="text-[11px] text-slate-400">
              Folder <code>.obsidian</code>, <code>.git</code>,{" "}
              <code>node_modules</code>, dan folder backup otomatis dikecualikan.
            </p>
          </div>

          {/* Step 4: Preview Before Editing */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleRunPreview}
              disabled={loading}
              className="w-full rounded-lg border border-sky-400/50 bg-sky-500/15 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
            >
              {loading
                ? "Memindai catatan Markdown..."
                : "4. Tampilkan Preview Task Sebelum Mengaktifkan Editing"}
            </button>
          </div>

          {previewData && (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Berhasil membaca {previewData.taskCount} task dari{" "}
                  {previewData.fileCount} file
                </span>
              </div>

              {!previewData.defaultTargetExists && (
                <label className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-950/40 p-2 text-amber-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmNewTargetFile}
                    onChange={(e) => setConfirmNewTargetFile(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    File tujuan default <strong>{defaultTargetFile}</strong> belum
                    ada. Saya menyetujui pembuatan file baru ini saat menambah task.
                  </span>
                </label>
              )}

              {previewData.sampleTasks.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-lg bg-slate-950/70 p-2 space-y-1 border border-white/10 task-list-scroll">
                  {previewData.sampleTasks.slice(0, 8).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 text-[11px] text-slate-300"
                    >
                      <span className="truncate">
                        [{t.checkboxChar}] {t.displayTitle}
                      </span>
                      <span className="text-slate-500 shrink-0">
                        {t.dueDate ?? t.relativePath}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/50 p-2.5 text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions: Real Vault vs Demo Mode */}
        <div className="px-4 py-3 border-t border-white/10 bg-slate-950/70 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleActivateVault}
            disabled={loading || !previewData}
            className="w-full rounded-lg bg-sky-500 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 transition"
          >
            Aktifkan Sinkronisasi Dua Arah pada Vault Ini
          </button>

          <button
            type="button"
            onClick={handleStartDemoMode}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/10 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Coba Mode Demo Terisolasi (Tanpa Menyentuh File Vault Nyata)
          </button>
        </div>
      </div>
    </div>
  );
};
